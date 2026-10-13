# Deploying Saga HQ (static, €0)

The build output `dist/` is plain static files with **relative** asset URLs and **hash routing**, so the exact
same artifact runs at `/` or any subpath on any static host. No server, database or function is required.

## Build-time configuration (`.env`, `.env.<mode>` or CI variables)
| Variable | Purpose |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Public OAuth client id for this deployment (dev or prod Google Cloud project). Empty = Google features hidden; local workspaces still work. |
| `VITE_ENV_NAME` | `dev` / `preview` / `prod` (shown in Settings › About). |
| `VITE_BASE_PATH` | Optional; defaults to `./` (works everywhere). |

## GitHub Pages (initial personal/dev deployment)
1. Free GitHub plans serve Pages only from **public** repositories. The repo contains no secrets (OAuth client ids are public).
2. Settings › General › Default branch: `main`. Settings › Pages › Source: *GitHub Actions*.
   Optionally add the repository variable `VITE_GOOGLE_CLIENT_ID`.
3. Every push to `main` runs the **Deploy (GitHub Pages)** workflow (tests, build, publish). It can also be run by
   hand from the Actions tab. It adds `.nojekyll` (host-specific file) in the job.
4. Recommended: host under a free GitHub **organization** so the origin differs from Saga Studio's (storage/XSS isolation).

## Cloudflare Pages (zero-cost fallback; allows commercial use / private repos)
Build command `npm run build`, output `dist`. Optionally add a `_headers` file in the deploy step with stronger
headers (e.g. `Content-Security-Policy` incl. `frame-ancestors 'none'`); the app already ships a baseline CSP meta tag.

## Google Cloud (human steps, €0, no billing account)
1. Create `saga-hq-dev` (OAuth consent: **Testing**, add test users) and later `saga-hq-prod` (**In production** + brand verification).
2. Enable the Google Drive API. Create an OAuth *Web* client; add Authorized JavaScript origins for each deployment (and `http://localhost:5173` for dev).
3. Scopes: `openid email profile https://www.googleapis.com/auth/drive.file` only. Never add restricted scopes.
4. Whether HQ prod should share Studio's project depends on INTEROP-01 (`docs/INTEROP-01.md`).

Moving hosts changes the origin — read `docs/RISK-01-origin-permanence.md` first.
