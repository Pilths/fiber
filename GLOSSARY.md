# Glossary

Domain terms used in code, docs and reviews. Domain rules live in `CLAUDE.md`; this file names the concepts.

- **Segment capacity**: how many cores of a segment can still be booked, and whether it can be booked at all. One
  module owns it: `api/app/inventory/capacity.py` (free to reserve, health, the booking check, and the check that a
  lower verified core count still leaves room for count-only reservations).
- **Free to reserve**: Available cores within the verified core count, minus the remaining unassigned cores of
  active count-only reservations on the segment. 0 when the segment is cut or not verified.
- **Health**: the display state of free to reserve, one of `free`, `full` (0 free), `cut`, `not_verified`. Decided
  by the API; the web only maps it to a word and a style.
- **Verified cores**: `segments.survey_cores`, set by core verification. A segment shows one core cell per verified
  core. Lowering the count hides the core rows above it; rows are never deleted.
