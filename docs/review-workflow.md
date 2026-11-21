# Review workflow

How to review and improve this codebase over several sessions, using the mattpocock skills. Rules for the code itself are in `CODING_STANDARDS.md`. Tickets live in `.scratch/<feature>/` (see `docs/agents/issue-tracker.md`).

## The loop

```
Window A  (one unbroken window, no /clear)
  1  /mattpocock-skills:improve-codebase-architecture
       report opens -> pick ONE candidate -> answer its grilling questions
  2  /mattpocock-skills:to-spec       -> .scratch/<feature>/spec.md
  3  /mattpocock-skills:to-tickets    -> .scratch/<feature>/issues/01-<slug>.md ...
                    /clear
Window B, C, ...  (one per ticket, lowest number first)
  4  /mattpocock-skills:implement .scratch/<feature>/issues/01-<slug>.md
       runs tdd, then code-review, then commits
                    /clear, then the next ticket
Last ticket window
  5  /mattpocock-skills:code-review <sha before ticket 01>
  6  /mattpocock-skills:retro          (before /clear)
```

`improve-codebase-architecture` already grills you on the candidate you pick, so a separate `/grill-with-docs` is not needed after it.

## Notes

- Before ticket 01, note the starting commit for step 5: `git log --oneline -1`.
- A ticket with `Blocked by: NN` waits until those tickets are done.
- If window A grows long before `/to-tickets` (about 150k tokens), use `/compact` between steps, not `/clear`. A `/clear` there loses the grilling answers.
- Type the full name `/mattpocock-skills:code-review`. Plain `/code-review` is a different built-in skill.
- `/retro` suggests changes to `CODING_STANDARDS.md`, checks or docs. Accept the ones that would have prevented a real mistake.

## Shortcuts

| Situation | Do |
|---|---|
| Small fix, one file, obvious | `/mattpocock-skills:implement` or `/mattpocock-skills:tdd` directly, skip steps 1-3 |
| Open item in `docs/optimization-roadmap.md` | Same as a small fix, one fresh session each |
| Something is broken | `/mattpocock-skills:diagnosing-bugs`, then `/mattpocock-skills:retro` |
| An answer is full of jargon | `/mattpocock-skills:wait-what` |
| Want to learn a concept | `/mattpocock-skills:teach` |

## Skipped skills

Not used here: `wayfinder`, `implement-spec`, `triage`, `prototype`, `setup-ts-deep-modules`, `setup-pre-commit`, `migrate-to-shoehorn`, `handoff`, `to-questionnaire`, `wizard`. They suit bigger teams or projects, or add tooling that works against the simple style.

## Lost your place?

Start a fresh session and paste:

```text
Read docs/review-workflow.md, .scratch/ and git log --oneline -10. Which step and ticket is next?
```
