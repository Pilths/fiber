# Brief: Fiber Dashboard span view (one page, light theme)

Product: Fiber, an internal dashboard where a telecom's network planners in Malaysia find fiber spans between sites, see which cores of a cable are free, reserve cores for a customer, and where admins approve requests. Users sit at office desktops in long sessions; 50 planners and a few admins.

Build ONE screen: the span view for span AABB - BBCC, light theme, desktop 1440 first, must still work at 768 and 390.

## What the screen must answer
"Can I book cores on this span, and which ones?" Main job: select Available cores and press Reserve. Second job: see what is waiting for approval.

## Rules from the product spec (must hold)
- Core status is never shown by colour alone: each status has its own symbol or pattern AND a text label. Statuses: Available, Requested, Reserved, In use, Faulty, plus a Chosen (selected) state.
- Core grid: one cell per SURVEYED core, 12 cells per row (one fibre tube per row). Un-surveyed cores are not drawn; say how many.
- Only Available cores are selectable; the grid is keyboard operable (real buttons, visible focus, aria labels with core number and status).
- Text contrast at least 4.5:1, placeholders included. Nothing under 11px.
- "Free to reserve" is the headline number: Available cores minus cores held by count-only reservations (reserved without specific cores).
- Every span name, core number, port label and ID must be readable; span names look like "AABB - BBCC" (sites are 4-letter codes).

## Data (use exactly; totals add up)
- Span AABB - BBCC: North region, Trunk route, 32.5 km, group "DWDM Trunk Route 1", cable size 144 cores, surveyed 36 (tubes 1 to 3).
- Cores 1-2 Reserved for DWDM(R): ports AABB Tray 1 P1 / P2 to BBCC MOD B P23 / P24, planned 2026-11-21.
- Core 3 Requested by [Customer A] (planner2), planned 2026-12-01, waiting for approval.
- Cores 13-18 In use, circuits CKT-1011 to CKT-1016.
- Core 30 Faulty.
- Core 7 currently Chosen by the user.
- All other cores Available: 26.
- [Customer B] holds 4 cores "not assigned" (a count-only reservation from the Excel import, planned 2026-09-02): they lower free to reserve but mark no cell.
- Free to reserve = 26 - 4 = 22. Held with cores = 2 reserved + 1 requested + 6 in use = 9. 108 cores (37 to 144) not surveyed.
- Other North spans (free to reserve): BBCC - CCDD 20, BBCC - FFGG 11, CCDD - DDEE 3, DDEE - EERR 0, EERR - TTEE not surveyed, FFGG - GGHH 17, GGHH - HHJJ 9, HHJJ - JJKK 31 (9 of 14 North spans shown).
- Waiting for approval (2): [Customer A] route AABB - BBCC - CCDD, 2 cores per span, planned 2026-12-01, planner2, 2 days ago, new customer name close to existing "[Customer A] Sdn Bhd"; DWDM(R) KKLL - LLMM cores 7, 8, planned 2026-12-01, planner1, 5 hours ago.
- Navigation destinations: Spans (current), Routes, Map, Approvals (2 waiting), Upload, account planner1.

## Output constraints (the page becomes a canvas artboard later)
- One self-contained file `index.html` in your output folder. Fonts only from Google Fonts. No external images, no data: URIs.
- Static markup. No script that builds the UI (a tiny script for toggling selection is allowed but optional).
- Close every SVG element explicitly (`<path ...></path>`, never `/>`).
- Sample customer names stay in brackets like [Customer A]; no invented companies, no lorem.

## Screenshots (host has no Chrome; use the web container)
A neutral camera is available in the web container (skill copy at /tmp/ts, no-sandbox Chrome wrapper at /tmp/chrome.sh):
```
C=$(cd /home/user1/project/fiber && docker compose ps -q web)
docker exec $C mkdir -p /tmp/cmp/<you>
docker cp <OUT>/index.html $C:/tmp/cmp/<you>/index.html
docker exec -w /tmp/cmp/<you> -e CHROME_PATH=/tmp/chrome.sh $C node /tmp/ts/scripts/inspect.mjs --app /tmp/cmp/<you>/index.html
docker cp $C:/tmp/cmp/<you>/.taste-skill/inspect <OUT>/shots
```
Then Read `<OUT>/shots/desktop-fold.jpg` and `mobile-fold.jpg`. (This tool also prints taste-skill verdicts; follow them only if your assigned skill is taste.)

## Report (short)
Output path; which skill steps you ran; your design direction in one line; check results; what you would improve next.
