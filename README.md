# Vesicle Hunt — deployable site

Static frontend for the fly-vesicle ground-truth annotation app. This is a **public,
deploy-only mirror** of `fly-vesicles/assessment_metrics/web/` — do not edit it by
hand; regenerate it with the publisher (below).

- Pure static: `index.html` + JS/CSS at root, tile JPEGs + `manifest.json` under
  `public/`. No build step.
- `config.js` holds the Supabase **anon** key — this is safe to be public (RLS makes
  the `submissions` table insert-only). The service_role key is never here.

## Deploy (one-time)

```bash
# 1. create an EMPTY public repo on github.com (or: gh repo create vesicle-hunt-site --public --source=. --remote=origin)
git remote add origin https://github.com/<you>/vesicle-hunt-site.git
git push -u origin main
# 2. on vercel.com/new -> Import Git Repository -> pick this repo -> Deploy
#    (framework: Other / no build — vercel.json already says so)
```

You get a public URL. Share it.

## Update (after re-baking tiles)

From the main repo:

```bash
bash assessment_metrics/bake/run_bake.sh        # regenerate web/public
bash assessment_metrics/publish.sh              # rsync -> here, commit, push -> Vercel auto-redeploys
```
