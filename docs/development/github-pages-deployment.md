# GitHub Pages deployment

Production: https://stlim0727.github.io/flight3d/

The simulator is a static Vite application. `.github/workflows/pages.yml` runs
checks, tests, and a production build on pushes to `main`, then publishes `dist/`
with the official GitHub Pages actions. No Cloudflare account or secrets are needed.

Repository Settings → Pages must use **GitHub Actions** as its build source.
The `github-pages` environment permits deployments from `main`.

The workflow sets `VITE_BASE_PATH` to the repository subpath. Runtime terrain and
texture URLs use `import.meta.env.BASE_URL` so they work under that subpath.
Local development and normal builds default to `/`.

To reproduce the production build locally:

```sh
npm ci
VITE_BASE_PATH=/flight3d/ npm run build
npm run preview
```

Open `/flight3d/` on the preview server. For a custom domain served at its root,
change the workflow's `VITE_BASE_PATH` to `/` before deploying.

## PR and branch preview URLs (Cloudflare Workers Builds)

Like Keepory, flight3d supports automatic preview URLs for unmerged branches and PR commits:

- **Config**: `wrangler.toml` at the repository root with `preview_urls = true` enables Cloudflare Workers Builds preview URLs.
- **Preview domain**: `https://<alias>-flight3d.stlim0727.workers.dev` (where `<alias>` is the sanitized branch name or short commit SHA).
- **CI reporting**: `.github/workflows/ci.yml` calculates and displays the preview URLs in the GitHub Step Summary and check annotations on pull requests and non-main branch pushes.
- **Isolation**: Production remains on GitHub Pages (`https://stlim0727.github.io/flight3d/`), unaffected by preview URLs.
