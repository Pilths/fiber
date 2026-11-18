# Parked: React to Vue

Status: parked by the owner on 18 Nov 2026. The owner finds React hard to read.

## Options

| Option | Verdict |
| --- | --- |
| Next.js | No. It is React plus a server framework, and adds a Node server in production. |
| Vue 3 with Vite | Recommended if switching. Same build, Docker and Playwright setup. Single-file components with HTML templates, `v-if` and `v-for` instead of JSX, `ref()` instead of `useEffect` and dependency arrays. MapLibre is framework-agnostic. |
| Svelte | Reads even simpler, smaller ecosystem. |
| Preact | Same code, smaller bundle; does not help readability. |
| Stay on React | Split the largest files (`Reservations.tsx`, `ReservationUpload.tsx`, about 19 KB each) and move their state into hooks, per the code style rules. |

## Cost of a switch to Vue

- About 30 components, 4.5k lines rewritten: roughly 2 to 4 sessions. Largest parts: the map,
  `Reservations`, `ReservationUpload`, `NetworkDetail`.
- Carries over unchanged: backend, generated API types, `web/src/lib/*.ts`, the e2e suite (it tests
  the DOM, not the framework).
- Order: shell, Auth, Upload, Reservations, NetworkDetail, map last. Run the affected e2e specs after
  each step. React and Vue cannot share a page, so the branch stays unmerged until done.
