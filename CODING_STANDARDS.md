# Coding standards

Owner decision: readable over short. Applies to all new and changed code. Existing code is tidied in a cleanup session, not during feature work. Reviewers (human or `/code-review`) check a diff against this file. Anything the linters already enforce (oxlint, ruff, tsc) is not repeated here.

## Style

- One step per line. Aim for 110 characters per line; a few characters over is fine, split once a line passes about 120.
- Full, plain names: `planner`, `option`, `segment`, `site`, not `rp`, `op`, `s`, `g`, `x`. Short names only for loop counters (`i`) and tiny arrow functions over one item.
- If/else is never on one line. Put the condition on its own line and the body indented below, also for a single statement:
  ```python
  # no
  if seg is None: continue
  # yes
  if seg is None:
      continue
  ```
  ```tsx
  // no
  if (!ol || !b) return;
  // yes
  if (!ol || !b) {
    return;
  }
  ```
- No `cond && doSomething()` for actions in TypeScript; write an `if`. `cond && <Element />` in JSX is fine.
- Ternaries only for a simple value choice (`x ? "on" : "off"`). Never nested, never for actions.
- No several statements joined with `;` on one line.
- Small functions with one job and a name that says it. A React component that grows past one screen part is split; its state and handlers go in a hook.
- SQL goes in named functions near the top of the module, not inline in the logic.
- Comments say why, not what. If code needs a comment to explain a trick, rewrite it plainly.

## Simple over abstract

- Plain functions, plain data (dicts, lists, primitives, simple dataclasses or TypeScript types). No classes, interfaces, factories or wrappers unless there are already two real users of them.
- Add an abstraction only when it makes the calling code shorter and easier to read today, not for a possible future need.
- A bigger structural change (a new module, moving logic between modules) is welcome when it makes the code simpler to work in. Explain in one line what gets simpler.

## Overrides for the code-review smell baseline

The `/code-review` skill carries a list of Fowler smells. Where this file disagrees, this file wins.

| Smell | Rule here |
|---|---|
| Primitive Obsession | Off. Strings, numbers and plain dicts are the default. Do not suggest wrapper types. |
| Data Clumps | Flag only when the same group of values is passed through 3 or more functions. A small `TypedDict` or dataclass is then enough. |
| Duplicated Code | Flag only code that is truly the same, not code that merely looks alike. Two similar blocks are fine; extract on the third. |
| Repeated Switches | Fix with one shared lookup (a dict or map) both places use. Never suggest polymorphism or class hierarchies. |
| Feature Envy, Message Chains, Middle Man, Refused Bequest | Judgement call only. Do not suggest new classes to fix them. |
| Speculative Generality | On, and strict: unused parameters, options, hooks or layers are a finding. |
| Mysterious Name, Shotgun Surgery, Divergent Change | On, as in the baseline. |

## Algorithm and query checks

Every review looks for these. Name the cost in plain words or Big-O (n = rows, segments, cores, sites).

- **Big-O of loops.** A loop inside a loop over the same data is O(n²). Fine for a small fixed list (route types, a site's ports); a finding for data that grows (segments, cores, reservations, upload rows). Fix with a dict lookup built once.
- **Repeated scans.** Searching the same list again and again (`x in some_list`, `.find()`, `.filter()` inside a loop) is a finding. Build a `set`/`dict` (Python) or `Set`/`Map` (TypeScript) once.
- **N+1 queries.** A database query inside a loop over rows is a finding. Fetch all needed rows in one query (`WHERE id = ANY(...)`, a join, or a grouped query) and match them in Python.
- **Work done twice.** The same value computed twice in one request or render (same query, same derived list) is a finding. Compute once and pass it on. In React, use `useMemo` only when the work is over a growing list.
- **Let the database do set work.** Counting, summing, filtering and sorting large sets belongs in SQL, not in Python after loading every row.
- **Mark known limits.** A deliberate simple choice with a known ceiling (an O(n²) scan over a list that stays small) gets a short comment naming the limit and when to change it.
