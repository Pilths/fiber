# Phase 1: quick fixes

## 1.1 API burns 55 to 86% CPU at idle

Measured with `docker stats` on 18 Nov 2026, no traffic:

| Container | CPU | Memory |
| --- | --- | --- |
| web | 0.00% | 645 MiB |
| api | 55 to 86% | 195 MiB |
| db | 0.00% | 175 MiB |

Likely cause (not yet proven): `docker-compose.yml` runs `uvicorn ... --reload` with `./api:/app`
bind-mounted. That mount includes the 258 MB host venv `api/.venv`. The reloader watches the whole
tree, and on WSL2 bind mounts it falls back to polling.

Fix, one line:

```yaml
command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir app
```

Check: `docker stats --no-stream fiber-api-1` should drop to near 0%.

## 1.2 Web memory is not a problem

Web CPU is 0%. The Vite process holds about 310 MB, which is normal for Vite with Tailwind and
MapLibre; the rest of the 645 MiB is file cache counted by `docker stats`. A burst of 72 PIDs seen
once was leftover Playwright Chromium processes, since gone. Phase 2 removes this process from
production anyway.

## 1.3 `opentelemetry-api` in the lock file

Nothing in `api/app` imports it. Either it is a leftover or it belongs to the uncommitted
`observability.py` work. If unused, remove it from `api/requirements.lock` and run `pip check`.

## 1.4 Run only the e2e specs a change touches

`scripts/e2e-changed.mjs` (on `dev`, not committed yet) maps changed files to the specs that cover
them, plus specs that depend on them. Shared files (`App.tsx`, `index.css`, `api/client`,
`e2e/helpers.ts`, `package.json`, unknown `web/src` or `api/app` files) run the whole suite. Docs and
scripts run nothing.

```bash
node scripts/e2e-changed.mjs --list        # show which specs
node scripts/e2e-changed.mjs               # run them in the web container
node scripts/e2e-changed.mjs --base main   # compare against main
```

The map is written by hand. A new component with an unfamiliar name falls back to the full suite;
add a rule to `RULES` when adding one.
