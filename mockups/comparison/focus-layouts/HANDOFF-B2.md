# Handoff: build option B2 in the real app

Goal: change the map page right column so the Inspector card sits at the top with a slim, fixed layout, and fix the dropdown arrow in the Find card "Route A to B" form. Do not touch anything else.

Reference mock (open in a browser, click the "Span selected", "Nothing selected" and "Route selected" buttons in the black strip): `docs/mockups/comparison/focus-layouts/b2.html`. Screenshots: `docs/mockups/comparison/focus-layouts/shots/b2-*.png`. The mock uses AABB - BBCC sample data and was built from an older mock, so match its layout, not its data or exact CSS.

Read first: `CLAUDE.md`, `docs/PRD.md` section 2 "Design decisions" (style tokens, WCAG, status never by colour alone). UI work goes to an Opus or Fable subagent per CLAUDE.md.

## Why

Selecting a span left the focus area below the fold. The old Inspector card is also tall (about 640px), which pushes Find down. Owner chose B2: Inspector first in the right column, fixed height, Find below it.

## B2 card layout (real app: `web/src/components/Inspector.tsx`, column order in `web/src/App.tsx`)

- Move Inspector above Find in the right column (`App.tsx`, the `col-span-4` column).
- Fixed height 420px at 1440x900, identical in every state (nothing selected, span selected, route selected) so Find never jumps. Content that does not fit scrolls inside the card; the footer buttons stay pinned at the bottom.
- Header row: small "Selected span" label on the left; the Cores | Site (Later) | Services (Later) tabs shrunk to 12px on the right.
- Title row: 32px/700 span name with the only Healthy chip on the right, then the facts line (region, route type, km, route).
- Free line: big number (22) then "free to reserve: 26 Available minus 4 held without cores, of 36 surveyed"; under it the proportional bar and one inline legend row (22 free, 9 held with cores, 4 held without cores, 1 faulty). No duplicate Healthy chip, no 2x2 legend.
- "Held on this span": at most 3 compact lines (status icon + word, customer, cores), plus a "+N more in Held on this span" link that scrolls to the full table.
- Footer (sticky bottom): "Go to cores" (primary) and "Plan a route from here".
- Nothing selected: dashed placeholder inside the same sized card. Route mode: "Selected route" header, route figures and span list scroll inside the card.
- 20px card padding, 8px radius, 1px #e2e5ea border, no shadows, like the other cards.

## Dropdown arrow, Find card "Route A to B" form

The owner asked for the dropdown arrow of the Route A to B selects (From, To, and likely Optimise for) to be fixed. The owner did not say what is wrong with it; look at it in the running app (http://localhost:5173, login required) and ask the owner if it is not obvious. The mock draws the arrow as a wrapper `span.selw` with a native `select` (`appearance:none; padding-right:30px`) and an inline SVG chevron (`<path d="M4 6l4 4 4-4">`, 16x16 viewBox), positioned inside the right edge of the select. Region, Route type and Route selects use the same pattern. Reuse the app's existing select component or style if there is one.

## Do not

- Do not edit `docs/mockups/`. Do not commit unless asked.
- Other uncommitted work exists in the repo (Inspector.tsx, LossCard.tsx, span list upload, routing, tests). Read `git diff` for `Inspector.tsx` before editing and keep those changes.
- The Collapse map control was removed from the app in a recent commit; do not bring it back.

## Check

`docker compose exec web npm run lint`, then screenshot the real page at 1440x900 in the three states and confirm the Inspector height is the same in each and Find starts at the same y.
