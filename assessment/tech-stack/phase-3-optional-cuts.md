# Phase 3: optional cuts

Small wins. Do each only when already working in that area.

## 3.1 NetworkX

Used only for shortest path over a few hundred segment edges (`api/app/routing/graph.py`, 36 lines).
Dijkstra with the standard library `heapq` is about 20 lines. Removes one dependency and its import
time. Keep the existing routing tests as the check.

## 3.2 Geist fonts

Two `@fontsource` packages. The system font stack (`system-ui`) needs no files. Taste decision with a
small gain; leave it unless the owner prefers the system look.

## 3.3 APScheduler (planned, not installed)

Do not add it. A host cron entry, or a small compose service that loops with `sleep`, can call
`python -m app.daily_digest`. The planned `job_runs` table and advisory lock already give the
"run once" guarantee.

## Removing Vite entirely: not recommended

Vite does five jobs here: dev server with hot reload, TSX compile, Tailwind compile, the `/api`
proxy, and the `@/` alias. Every replacement bundler also needs Node, and Vite is already the lightest
option. Phase 2 removes Vite from production, which is where its cost is.
