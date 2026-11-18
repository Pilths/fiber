# Phase 2: production build without Node or nginx

## Problem

`web/Dockerfile` ends with `CMD ["npm", "run", "dev"]`. Production would serve unbundled development
code through the Vite dev server: slow, about 310 MB of memory, and not hardened.

## Plan: FastAPI serves the built frontend

```
dev (unchanged)
browser -> web :5173 (Vite, hot reload) --/api--> api :8000

prod
browser -> api :8000 --+-- /api/*  FastAPI routes
                       +-- /*      dist/ (vite build output)
```

Changes, about 20 lines:

- `api/Dockerfile`: a first stage on `node:24.22.1-slim` runs `npm ci && npm run build`; the Python
  image copies `web/dist`. Node exists only at build time.
- `api/app/main.py`: if the `dist` folder exists, mount `StaticFiles(directory=dist, html=True)` at
  `/`, after the `/api` routers.
- `docker-compose.yml`: put `web` under a `dev` profile (or a prod override file) so production starts
  only `db` and `api`.
- `CLAUDE.md` and `README`: one line for the production start.

## Why it fits this app

- Links are hash links (`#segment=`, `#route=`), so every page is `index.html`; no SPA rewrite rules.
- PMTiles needs HTTP Range requests; Starlette file responses support them. Verify with one curl
  that `malaysia.pmtiles` returns `206`.
- One origin for pages and API: the session cookie and CORS need no extra config.
- At 1 to 50 users, Python serving static files is no load.

## Open points

- TLS: if IT puts a proxy or load balancer in front of the server, nothing changes. If not, Uvicorn
  terminates TLS with `--ssl-keyfile` and `--ssl-certfile`, paths from `.env`. Confirm with IT.
- Caching: Starlette sends ETag and Last-Modified but no long `Cache-Control` for hashed `assets/*`.
  Fine at this scale; add a header only if load time is measured slow.

## Done when

- `vite build` succeeds in the image build.
- The prod stack (db and api only) loads the map, the pmtiles requests return `206`, sign-in works.
- The e2e suite passes against the prod stack (`E2E_BASE_URL=http://localhost:8000`).
