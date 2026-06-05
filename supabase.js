// Thin Supabase REST wrapper (no SDK, no build step). Falls back to an OFFLINE
// localStorage store when config.js has no URL/key, so the UI is fully testable
// without a backend.
(function () {
  const cfg = window.AM_CONFIG || {};
  const URL = (cfg.SUPABASE_URL || "").replace(/\/+$/, "");
  const KEY = cfg.SUPABASE_ANON_KEY || "";
  const ONLINE = !!(URL && KEY);
  const LS_KEY = "am_offline_subs";

  function headers(extra) {
    return Object.assign({ apikey: KEY, Authorization: "Bearer " + KEY,
      "Content-Type": "application/json" }, extra || {});
  }
  function loadLocal() { try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch (_) { return []; } }
  function saveLocal(rows) { localStorage.setItem(LS_KEY, JSON.stringify(rows)); }

  async function insertSubmission(row) {
    if (!ONLINE) {
      const rows = loadLocal(); rows.push(Object.assign({ id: rows.length + 1, created_at: new Date().toISOString() }, row)); saveLocal(rows); return { ok: true, offline: true };
    }
    const r = await fetch(URL + "/rest/v1/submissions", { method: "POST",
      headers: headers({ Prefer: "return=minimal" }), body: JSON.stringify(row) });
    if (!r.ok) throw new Error("insert failed: " + r.status + " " + (await r.text()));
    return { ok: true };
  }

  async function getUserTilesDone(username) {
    if (!ONLINE) {
      return [...new Set(loadLocal().filter(s => s.username === username).map(s => s.tile_id))];
    }
    const q = "?username=eq." + encodeURIComponent(username) + "&select=tile_id";
    const r = await fetch(URL + "/rest/v1/user_tiles_done" + q, { headers: headers() });
    if (!r.ok) return [];
    return (await r.json()).map(x => x.tile_id);
  }

  async function getLeaderboard(limit) {
    if (!ONLINE) {
      const by = {};
      for (const s of loadLocal()) {
        if (String(s.username || "").startsWith("__")) continue;   // hide diagnostic/test users
        const u = (by[s.username] = by[s.username] || { username: s.username, vesicles_found: 0, tiles: new Set(), secs: 0 });
        u.vesicles_found += s.n_points || 0; u.tiles.add(s.tile_id); u.secs += s.duration_s || 0;
      }
      return Object.values(by).map(u => ({ username: u.username, vesicles_found: u.vesicles_found,
        tiles_completed: u.tiles.size, hours_annotated: +(u.secs / 3600).toFixed(2) }))
        .sort((a, b) => b.vesicles_found - a.vesicles_found).slice(0, limit || 20);
    }
    const q = "?select=*&order=vesicles_found.desc,tiles_completed.desc&limit=" + (limit || 50);
    const r = await fetch(URL + "/rest/v1/leaderboard" + q, { headers: headers() });
    if (!r.ok) return [];
    return (await r.json()).filter(x => !String(x.username || "").startsWith("__")).slice(0, limit || 20);
  }

  function exportOfflineCSV() {
    const rows = loadLocal();
    const cols = ["id", "username", "tile_id", "tile_kind", "category", "n_points", "is_empty",
      "started_at", "submitted_at", "duration_s", "viewport_events", "app_version", "points"];
    const esc = v => '"' + String(v == null ? "" : (typeof v === "object" ? JSON.stringify(v) : v)).replace(/"/g, '""') + '"';
    const csv = [cols.join(",")].concat(rows.map(r => cols.map(c => esc(r[c])).join(","))).join("\n");
    const a = document.createElement("a");
    a.href = URL_OBJ(csv); a.download = "am_offline_submissions.csv"; a.click();
  }
  function URL_OBJ(text) { return "data:text/csv;charset=utf-8," + encodeURIComponent(text); }

  window.AM_DB = { ONLINE, insertSubmission, getUserTilesDone, getLeaderboard, exportOfflineCSV };
})();
