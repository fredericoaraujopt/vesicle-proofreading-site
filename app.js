/* Vesicle Hunt — annotation frontend.
 *
 * Coordinate contract (verified against vesicle_gui.py / inference_to_csv.py):
 *   rendered frame[row, col] = vol[x_start - center_offset + row, y_start - center_offset + col]
 *   centre annotation tile occupies frame px [center_offset, center_offset+tile_size).
 *   A click on the centre tile at frame (col, row) -> tile-local (x_local=col-center_offset,
 *   y_local=row-center_offset) and global (x_global=x_start+x_local, y_global=y_start+y_local),
 *   matching the detector and the original GT exactly.
 */
(function () {
  "use strict";
  const PUBLIC = "public/";
  const POINT_R = 6;            // hit radius (image px) for toggle-remove
  const $ = id => document.getElementById(id);

  let META = null, TILES = [], EXAMPLES = [];
  let username = null, order = [], doneSet = new Set(), idx = 0;
  let tile = null, images = [], zi = 0, points = [];
  let view = { cx: 0, cy: 0, scale: 1 };
  let startedAt = 0, viewportEvents = 0;
  let session = { tiles: 0, vesicles: 0, secs: 0 };
  const canvas = $("view"), ctx = canvas.getContext("2d");

  // ───────────────────────── boot ─────────────────────────
  async function boot() {
    META = (await (await fetch(PUBLIC + "manifest.json")).json());
    TILES = META.tiles; EXAMPLES = META.examples || []; META = META.meta;
    wireLogin(); wireControls(); wireKeys(); renderExamples();
    const saved = localStorage.getItem("am_username");
    if (saved) { $("username-input").value = saved; }
  }

  function wireLogin() {
    $("login-btn").onclick = doLogin;
    $("username-input").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
    $("show-tutorial-from-login").onclick = () => $("tutorial").classList.remove("hidden");
    $("tutorial-close").onclick = () => $("tutorial").classList.add("hidden");
    $("tutorial-btn").onclick = () => $("tutorial").classList.remove("hidden");
    $("logout-btn").onclick = () => { localStorage.removeItem("am_username"); location.reload(); };
    if (!window.AM_DB.ONLINE) $("login-status").textContent = "Offline mode: data saved in this browser.";
  }

  async function doLogin() {
    const name = $("username-input").value.trim();
    if (!name) { $("login-status").textContent = "Please enter a name."; return; }
    username = name; localStorage.setItem("am_username", name);
    $("login-status").textContent = "Loading your progress…";
    try { doneSet = new Set(await window.AM_DB.getUserTilesDone(name)); } catch (_) { doneSet = new Set(); }
    order = TILES.map(t => t.tile_id);
    idx = order.findIndex(id => !doneSet.has(id));
    if (idx < 0) idx = order.length;             // everything done
    session.tiles = doneSet.size;
    $("who").textContent = name;
    $("login").classList.add("hidden"); $("app").classList.remove("hidden");
    refreshLeaderboard(); updateStats();
    loadTile();
  }

  // ───────────────────────── tile loading ─────────────────────────
  function loadTile() {
    if (idx >= order.length) return finishAll();
    tile = TILES.find(t => t.tile_id === order[idx]);
    points = []; zi = META.center_index; viewportEvents = 0; startedAt = Date.now();
    defaultView();
    images = new Array(META.n_slices).fill(null);
    // load centre slice first for responsiveness, then the rest
    loadSlice(META.center_index, () => draw());
    for (let k = 0; k < META.n_slices; k++) if (k !== META.center_index) loadSlice(k);
    updateProgress(); updateBanner(); updateCount();
    $("tileinfo").innerHTML = `tile <b>${tile.tile_id}</b> · ${tile.category} · ${tile.kind}`;
  }
  function loadSlice(k, cb) {
    const im = new Image();
    im.onload = () => { images[k] = im; if (cb) cb(); else if (k === zi) draw(); };
    im.src = PUBLIC + META.image_template.replace("{tile_id}", tile.tile_id).replace("{k}", k);
  }
  function finishAll() {
    tile = null; ctx.clearRect(0, 0, canvas.width, canvas.height);
    $("banner").classList.remove("hidden");
    $("banner").textContent = "🎉 You've completed every tile — thank you!";
    $("progress-pill").textContent = `${order.length}/${order.length} tiles`;
  }

  // ───────────────────────── view transforms ─────────────────────────
  function defaultView() {
    const c = META.center_offset + META.tile_size / 2;
    view = { cx: c, cy: c, scale: canvas.width / META.tile_size };  // centre tile fills canvas
  }
  function minScale() { return canvas.width / META.frame_px; }
  function maxScale() { return (canvas.width / META.tile_size) * 4; }
  function img2scr(ix, iy) { return [canvas.width / 2 + (ix - view.cx) * view.scale,
                                     canvas.height / 2 + (iy - view.cy) * view.scale]; }
  function scr2img(sx, sy) { return [view.cx + (sx - canvas.width / 2) / view.scale,
                                     view.cy + (sy - canvas.height / 2) / view.scale]; }
  function evtImg(e) {
    const r = canvas.getBoundingClientRect();
    const sx = (e.clientX - r.left) * canvas.width / r.width;
    const sy = (e.clientY - r.top) * canvas.height / r.height;
    return scr2img(sx, sy);
  }

  // ───────────────────────── draw ─────────────────────────
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const im = images[zi] || images[META.center_index];
    if (im) {
      ctx.save();
      ctx.setTransform(view.scale, 0, 0, view.scale,
                       canvas.width / 2 - view.cx * view.scale,
                       canvas.height / 2 - view.cy * view.scale);
      ctx.imageSmoothingEnabled = view.scale < 3;
      ctx.drawImage(im, 0, 0);
      ctx.restore();
    }
    // centre-tile frame + dim the context outside it
    const [bx0, by0] = img2scr(META.center_offset, META.center_offset);
    const [bx1, by1] = img2scr(META.center_offset + META.tile_size, META.center_offset + META.tile_size);
    ctx.save();
    ctx.fillStyle = "rgba(6,9,14,0.5)";
    // four bands outside the box
    ctx.fillRect(0, 0, canvas.width, Math.max(0, by0));
    ctx.fillRect(0, by1, canvas.width, canvas.height - by1);
    ctx.fillRect(0, by0, Math.max(0, bx0), by1 - by0);
    ctx.fillRect(bx1, by0, canvas.width - bx1, by1 - by0);
    ctx.strokeStyle = getCSS("--frame"); ctx.lineWidth = 2;
    ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
    ctx.restore();
    drawPoints();
  }
  function drawPoints() {
    const onCentre = zi === META.center_index;
    ctx.lineWidth = 2;
    for (const p of points) {
      const [sx, sy] = img2scr(META.center_offset + p.x_local, META.center_offset + p.y_local);
      ctx.beginPath(); ctx.arc(sx, sy, POINT_R, 0, 7);
      ctx.strokeStyle = onCentre ? getCSS("--vesicle") : "rgba(255,77,109,0.4)";
      ctx.stroke();
      ctx.beginPath(); ctx.arc(sx, sy, 1.5, 0, 7); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
    }
  }
  function getCSS(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

  // ───────────────────────── interaction ─────────────────────────
  let dragging = false, dragStart = null, moved = false;
  function wireControls() {
    canvas.addEventListener("pointerdown", e => { dragging = true; moved = false; dragStart = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", e => {
      if (!dragging) return;
      const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      const r = canvas.getBoundingClientRect(); const k = canvas.width / r.width / view.scale;
      view.cx = dragStart.cx - dx * k; view.cy = dragStart.cy - dy * k; clampView(); draw();
    });
    canvas.addEventListener("pointerup", e => { dragging = false; if (!moved) handleClick(e); else viewportEvents++; });
    canvas.addEventListener("wheel", e => { e.preventDefault(); zoomAt(e, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });

    $("z-up").onclick = () => stepZ(+1);
    $("z-down").onclick = () => stepZ(-1);
    $("zoom-in").onclick = () => zoomCentre(1.3);
    $("zoom-out").onclick = () => zoomCentre(1 / 1.3);
    $("snap").onclick = snapBack;
    $("clear").onclick = () => { points = []; updateCount(); draw(); };
    $("empty-btn").onclick = () => submit(true);
    $("submit-btn").onclick = () => submit(false);
  }

  function handleClick(e) {
    if (zi !== META.center_index) return nudge("You can only annotate on the centre slice — press 0 / Snap back.");
    const [ix, iy] = evtImg(e);
    const xl = ix - META.center_offset, yl = iy - META.center_offset;
    if (xl < 0 || yl < 0 || xl >= META.tile_size || yl >= META.tile_size)
      return nudge("Click inside the framed tile.");
    // toggle: remove if near an existing point, else add
    let best = -1, bd = POINT_R * POINT_R;
    points.forEach((p, i) => { const d = (p.x_local - xl) ** 2 + (p.y_local - yl) ** 2; if (d <= bd) { bd = d; best = i; } });
    if (best >= 0) points.splice(best, 1);
    else points.push({ x_local: Math.round(xl), y_local: Math.round(yl) });
    updateCount(); draw();
  }

  function stepZ(d) {
    const nz = Math.min(META.n_slices - 1, Math.max(0, zi + d));
    if (nz === zi) return; zi = nz; viewportEvents++; updateBanner(); draw();
  }
  function zoomCentre(f) { view.scale = clamp(view.scale * f, minScale(), maxScale()); viewportEvents++; clampView(); draw(); }
  function zoomAt(e, f) {
    const [ix, iy] = evtImg(e);
    const ns = clamp(view.scale * f, minScale(), maxScale());
    // keep cursor's image point fixed
    view.cx = ix - (ix - view.cx) * (view.scale / ns);
    view.cy = iy - (iy - view.cy) * (view.scale / ns);
    view.scale = ns; viewportEvents++; clampView(); draw();
  }
  function snapBack() { defaultView(); zi = META.center_index; viewportEvents++; updateBanner(); draw(); }
  function clampView() {
    const half = META.frame_px / 2;
    view.cx = clamp(view.cx, half - 0, META.frame_px - 0); // soft clamp to frame
    view.cx = clamp(view.cx, 0, META.frame_px);
    view.cy = clamp(view.cy, 0, META.frame_px);
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function wireKeys() {
    window.addEventListener("keydown", e => {
      if ($("app").classList.contains("hidden")) return;
      if (e.target.tagName === "INPUT") return;
      switch (e.key) {
        case "ArrowUp": case "]": stepZ(+1); break;
        case "ArrowDown": case "[": stepZ(-1); break;
        case "+": case "=": zoomCentre(1.3); break;
        case "-": case "_": zoomCentre(1 / 1.3); break;
        case "0": snapBack(); break;
        case "Enter": submit(false); break;
        case "e": case "E": submit(true); break;
      }
    });
  }

  // ───────────────────────── UI bits ─────────────────────────
  function updateBanner() {
    const off = zi - META.center_index;
    const b = $("banner");
    $("z-label").textContent = off === 0 ? "centre" : "slice " + (off > 0 ? "+" + off : off);
    if (off === 0) { b.classList.add("hidden"); }
    else { b.classList.remove("hidden"); b.textContent = `Context slice ${off > 0 ? "+" + off : off} — annotate only on the centre slice (press 0)`; }
  }
  function updateCount() { $("count-label").textContent = points.length + (points.length === 1 ? " vesicle" : " vesicles"); }
  function updateProgress() { $("progress-pill").textContent = `tile ${idx + 1} / ${order.length}`; }
  function updateStats() {
    $("stat-tiles").textContent = session.tiles;
    $("stat-vesicles").textContent = session.vesicles;
    $("stat-time").textContent = Math.round(session.secs / 60) + "m";
  }
  let nudgeTimer = null;
  function nudge(msg) {
    const n = $("nudge"); n.textContent = msg; n.classList.remove("hidden");
    clearTimeout(nudgeTimer); nudgeTimer = setTimeout(() => n.classList.add("hidden"), 1400);
  }

  async function refreshLeaderboard() {
    let rows = [];
    try { rows = await window.AM_DB.getLeaderboard(15); } catch (_) {}
    const tb = $("leaderboard").querySelector("tbody"); tb.innerHTML = "";
    rows.forEach((r, i) => {
      const tr = document.createElement("tr"); if (r.username === username) tr.className = "me";
      tr.innerHTML = `<td>${i + 1}</td><td>${escapeHtml(r.username)}</td><td>${r.vesicles_found}</td>`
        + `<td>${r.tiles_completed}</td><td>${r.hours_annotated ?? "-"}</td>`;
      tb.appendChild(tr);
    });
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ───────────────────────── submit ─────────────────────────
  async function submit(isEmpty) {
    if (!tile) return;
    const pts = isEmpty ? [] : points;
    const now = Date.now();
    const row = {
      username, tile_id: tile.tile_id, tile_kind: tile.kind, category: tile.category,
      n_points: pts.length, is_empty: isEmpty && pts.length === 0,
      started_at: new Date(startedAt).toISOString(), submitted_at: new Date(now).toISOString(),
      duration_s: Math.round((now - startedAt) / 1000), viewport_events: viewportEvents,
      app_version: META.version,
      points: pts.map(p => ({ x_local: p.x_local, y_local: p.y_local,
        x_global: tile.x_start + p.x_local, y_global: tile.y_start + p.y_local, z: tile.z_crop })),
    };
    $("submit-btn").disabled = true;
    try { await window.AM_DB.insertSubmission(row); }
    catch (err) { nudge("Save failed — will retry."); console.error(err); $("submit-btn").disabled = false; return; }
    $("submit-btn").disabled = false;
    doneSet.add(tile.tile_id);
    session.tiles += 1; session.vesicles += row.n_points; session.secs += row.duration_s;
    updateStats(); refreshLeaderboard();
    idx += 1; loadTile();
  }

  // ───────────────────────── examples (tutorial) ─────────────────────────
  function renderExamples() {
    const grid = $("examples-grid"); grid.innerHTML = "";
    EXAMPLES.forEach(ex => {
      const fig = document.createElement("figure");
      const c = document.createElement("canvas"); c.width = c.height = META.tile_size;
      fig.appendChild(c);
      const cap = document.createElement("figcaption"); cap.textContent = ex.note || "";
      fig.appendChild(cap); grid.appendChild(fig);
      const im = new Image();
      im.onload = () => {
        const cc = c.getContext("2d");
        cc.drawImage(im, META.center_offset, META.center_offset, META.tile_size, META.tile_size, 0, 0, META.tile_size, META.tile_size);
        cc.strokeStyle = "#3fb950"; cc.lineWidth = 1.5;
        (ex.gt_points || []).forEach(p => { cc.beginPath(); cc.arc(p.x_local, p.y_local, 5, 0, 7); cc.stroke(); });
      };
      im.src = PUBLIC + META.image_template.replace("{tile_id}", ex.tile_id).replace("{k}", META.center_index);
    });
  }

  boot();
})();
