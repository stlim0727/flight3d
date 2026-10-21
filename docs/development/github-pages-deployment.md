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

Cloudflare is no longer configured in this repository. Any previously connected
Cloudflare Workers Builds integration must be disconnected in Cloudflare before
retiring that deployment; removing Wrangler configuration does not remove a live Worker.
