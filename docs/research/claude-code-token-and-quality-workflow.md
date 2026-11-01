> Historical document: it uses the old words (span = today's segment, segment = today's route).

# Cutting Claude Code token cost without cutting quality

Researched 2026-10-31. Convention check: `docs/` is flat (PRD.md, architecture.md, plan.md, fiber-dashboard-workflow.md) with no research folder, so this note creates `docs/research/`.

Legend: **[S]** = sourced, URL or file path given inline. **[SYN]** = my own synthesis from the sources, not a quoted claim. **UNVERIFIED** = could not confirm from a primary source.

## Summary

1. Cost is mostly context being re-read, not text being written. Claude Code resends the whole conversation on every request, so long sessions, tool output, and always-loaded instructions dominate. Prompt caching discounts the re-read only while the cache is warm. [S] https://code.claude.com/docs/en/costs ("Why usage climbs in a long session")
2. The biggest levers are Anthropic's own: `/clear` between unrelated tasks, matching model and effort to the task, delegating verbose work to subagents, a short CLAUDE.md, few MCP servers, and pass/fail checks so Claude does not need re-prompting. [S] same page, plus https://code.claude.com/docs/en/best-practices
3. Of your four tools, only rtk and graphify attack the large cost (reading). Caveman and ponytail attack output. Their own vendor numbers show caveman gives high single digits on output in real agentic coding (8.5% in a JetBrains test it cites) and ponytail's saving is task dependent. None of the four should be applied to design, review, or debugging reasoning at full strength. [S] see section 3
4. Quality comes from verification, not from prose style: explore, plan, implement, verify, with a runnable check, a written spec, and a fresh-context reviewer. [S] https://code.claude.com/docs/en/best-practices
5. Recommended: keep rtk on (with `rtk recall`/`rtk bypass` known), use graphify for navigation with the post-commit hook so it is not stale, turn caveman to lite or off in design/review/debug phases, use ponytail only when writing code, and never let either rewrite documents, commit messages, or specs. [SYN] section 5

## 1. Where tokens and cost actually go

**Every request resends everything.** The model keeps nothing between requests, so Claude Code re-sends system prompt, project context (CLAUDE.md, auto memory, unscoped rules), every prior message and every tool result. [S] https://code.claude.com/docs/en/prompt-caching ("How the cache is organized")

**Cost scales with context size.** "Token costs scale with context size: the more context Claude processes, the more tokens you use." Caching and auto-compaction are the built-in mitigations. [S] https://code.claude.com/docs/en/costs ("Reduce token usage")

**Cache reads are cheaper but not free.** A one-line question in a session open all day still draws usage for the whole conversation, billed at the cached rate. Each tool call sends another request carrying the tool results. [S] https://code.claude.com/docs/en/costs ("Why usage climbs in a long session")

**Output and thinking.** Thinking tokens are billed as output tokens, and "the default budget can be tens of thousands of tokens per request depending on the model". On Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable thinking cannot be turned off, so effort level is the control. [S] https://code.claude.com/docs/en/costs ("Adjust extended thinking")

**Subagents are not free.** Every subagent sends its own requests against the same usage. They keep verbose output out of the main context, but a fresh subagent must gather context the main session already had, so it can be slower, and by default it is the same model or a smaller one, so you get isolation, not a smarter answer. [S] https://code.claude.com/docs/en/best-practices ("Know what subagents cost"). Agent teams use "approximately 7x more tokens than standard sessions" in plan mode. [S] https://code.claude.com/docs/en/costs

**Always-on overhead.** CLAUDE.md, auto memory, MCP tool names and skill descriptions load before you type. [S] https://code.claude.com/docs/en/context-window. MCP tool definitions are deferred by default (only names enter context), and CLI tools like `gh` are still cheaper than MCP because they add no per-tool listing. [S] https://code.claude.com/docs/en/costs ("Reduce MCP server overhead")

**Reference point.** Anthropic's average across enterprise deployments is about $13 per developer per active day, below $30 for 90% of users. [S] https://code.claude.com/docs/en/costs

**Context quality, not just cost.** Anthropic's engineering post says recall degrades as context grows ("context rot") and context is "a finite resource with diminishing marginal returns", so a small focused context is also better for correctness. [S] https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

### What breaks the cache

The cache matches an exact prefix: a change anywhere in the prefix recomputes everything after it. [S] https://code.claude.com/docs/en/prompt-caching

Invalidates (next turn is slower and costlier):
- Switching model with `/model`. Each model has its own cache. `opusplan` makes every plan-mode toggle a model switch. A skill or command whose frontmatter names a different `model` is also a switch for that turn.
- Changing effort level on most models (not on Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1 with API key or subscription).
- Fast mode on/off.
- Changing the set of loaded tool definitions (MCP server added or removed when tool search is not deferring them, denying a whole tool without tool search).
- `/compact` (replaces history by design; system prompt and unchanged CLAUDE.md stay cached).
- Many images accumulating, and upgrading Claude Code.
- Idle longer than the TTL: one hour on a subscription within plan usage for the main conversation, five minutes on API key or usage credits, and five minutes for subagents unless configured.

Does not invalidate: editing files, editing CLAUDE.md mid-session (the edit also does not apply until `/clear`, `/compact` or restart), changing permission mode, changing output style, invoking skills, enabling or disabling plugin skills/hooks/agents, `/rewind`, `/recap`, spawning a subagent.

Practical implication [S]: "Pick your model and effort level at the top of a session, then save `/compact` for natural breaks between tasks."

Implication for your tools [SYN]: caveman and ponytail inject their rules as session-start or message context, so toggling levels (`/caveman lite`) mid-task costs only the appended message, not a cache rebuild. Output style changes are documented as cache-safe; I did not find a primary statement about plugin mode-switch commands specifically (UNVERIFIED). Check with `/usage` ("Prompt cache (main)" line shows misses and a likely cause, v2.1.251+/v2.1.260+).

## 2. Concrete cost levers, ranked

Ranking is [SYN]; each lever is [S] from https://code.claude.com/docs/en/costs and https://code.claude.com/docs/en/best-practices unless noted.

| # | Lever | Why it matters | How |
|---|---|---|---|
| 1 | `/clear` between unrelated tasks | "Stale context wastes tokens on every subsequent message"; `/clear` itself costs nothing. After two failed corrections, `/clear` plus a better prompt beats a third correction. | `/rename x` first, `/resume` later |
| 2 | Right model per task | "Sonnet handles most coding tasks well and costs less than Opus. Reserve Opus for complex architectural decisions." Haiku for simple subagents. | `model:` in subagent frontmatter, `/model` at session start |
| 3 | Effort level | Medium is default and "plenty for everyday feature work"; raise to high/xhigh for subtle bugs and schema changes; `max` "tends to overthink" on ordinary tasks. | `/effort`, or `ultrathink` for one prompt |
| 4 | Verification targets and plan mode | Avoids expensive rework: "Use plan mode for complex tasks", "Give verification targets", "Test incrementally". | Shift+Tab; test command in CLAUDE.md |
| 5 | Subagents for verbose work | Tests, log processing, doc fetches stay in the subagent's context; only a summary returns. Ask for short summaries; give reviewer `tools: Read, Grep, Glob`. | `.claude/agents/*.md` |
| 6 | Short CLAUDE.md | Under 200 lines; every line costs attention on every task. Move workflow-specific text into skills (loaded on demand) or `.claude/rules/` with `paths:`. | `/doctor`, `/context` |
| 7 | MCP hygiene | Disable unused servers; prefer CLIs. | `/mcp` |
| 8 | Specific prompts | "add input validation to the login function in auth.ts" beats "improve this codebase". | |
| 9 | Hooks that pre-filter output | Docs example: a PreToolUse hook that filters test output to failures (this is the mechanism rtk uses). | `/hooks` |
| 10 | Code intelligence (LSP) plugins | A go-to-definition call replaces grep plus reading candidate files; also reports type errors after edits. You already have pyright-lsp and typescript-lsp installed. | plugin |
| 11 | Compact with focus | `/compact keep the API changes and test commands`; `/compact` is itself a big request, costlier when the cache has expired. | CLAUDE.md "Compact instructions" section |
| 12 | Watch background work | `/loop`, goal check-ins, idle compaction, session recap and prompt suggestions all send requests while you are idle. | `/usage` attribution |

Skills use progressive disclosure: only name and description sit in context each session, the body loads when the task needs it. [S] https://code.claude.com/docs/en/best-practices ("Put team procedures in skills"). Invoked skill bodies are re-injected after compaction capped at 5,000 tokens per skill and 25,000 total. [S] https://code.claude.com/docs/en/context-window

Headless mode (`claude -p`) with `--max-turns` or `--max-budget-usd` gives a hard cost cap for automated runs. [S] https://code.claude.com/docs/en/best-practices (table "How much it spends")

Measure before tuning: `/usage` (Session block, plus on subscriptions an attribution breakdown by skill, subagent, plugin and MCP server, with recommendations for anything at least 10% of usage) and `/context`. [S] https://code.claude.com/docs/en/costs

## 3. The four tools: what they save, how they can hurt, what they document

### 3.1 caveman (plugin 2.7.0)

What it is: an output-style skill. Drops articles, filler and hedging, with levels lite/full/ultra and wenyan variants. [S] `/home/user1/.claude/plugins/cache/caveman/caveman/2.7.0/skills/caveman/SKILL.md`

Vendor numbers (all vendor-reported unless noted) [S] `.../caveman/2.7.0/README.md` lines 200-214:
- Its own eval: 50% fewer output tokens at the median on ten dev Q&A questions, "length only, not correctness".
- Cites a JetBrains A/B (86 real coding tasks, Claude Code): 8.5% fewer output tokens, about 10% cost, no detectable quality change. The README's own reading: "Agentic coding sessions, where most tokens are code and tool calls that the skill never touches: high single digits on output, quality flat." JetBrains blog itself returned HTTP 403 to me, so that figure is UNVERIFIED at the primary source.
- Its honesty page states the skill gives 0% input reduction, adds input tokens every call (about 1,000 estimated for the full skill), does not touch thinking tokens, and can be net-negative on terse Q&A. "Compare provider-billed totals on the same task with and without Caveman." [S] `.../caveman/2.7.0/docs/HONEST-NUMBERS.md`, README line 541.

Documented safeguards [S] SKILL.md:
- Auto-Clarity: drops caveman for security warnings, irreversible-action confirmations, multi-step sequences where fragment order could be misread, and when compression creates ambiguity or the user repeats a question.
- Boundaries: code, comments, commits, docs, issue/PR text and memory files stay normal prose. "Never drop not/never/no/only/except".
- Numbers and units exact; code, API names, error strings untouched.

How it can hurt correctness [SYN, grounded in the above]:
- Terse status lines can hide uncertainty. If the model says "Fixed." instead of "Fixed X, did not run Y", you lose the evidence. Counter with the Anthropic rule: ask for evidence (command and output). [S] https://code.claude.com/docs/en/best-practices ("Give Claude a check to run")
- Order-dependent instructions (migrations, destructive steps) are the case its own Auto-Clarity names.
- Adobe paper, as cited by caveman's README: compressing the human's prompt into caveman-speak makes models answer longer and worse. So do not write your prompts or specs in caveman. UNVERIFIED (arXiv 2606.24083 not fetched).

`/caveman-compress` on CLAUDE.md: claims about 46% smaller on five fixtures with headings, code, paths and URLs verified intact; keeps a `.original.md` backup; refuses code files. [S] README line 245, `.../skills/caveman-compress/SKILL.md`. Caution [SYN]: Anthropic says the lever for CLAUDE.md is deleting what Claude can already infer and staying under 200 lines. Your CLAUDE.md is 59 lines, so compression gains little and compressed rule text carries a small ambiguity risk. Also, an edit to CLAUDE.md does not apply until `/clear`, `/compact` or restart. [S] prompt-caching page.

cavecrew subagents: investigator (locate code), builder (1-2 file edits), reviewer (one line per finding). Their output is compressed so the main thread reads less. [S] agent descriptions in the Claude Code agent list; skill `caveman:cavecrew`. Use for locating code, not for architectural review where nuance matters [SYN].

### 3.2 ponytail (plugin 4.10.0)

What it is: a coding-mode rule set. A "ladder" (does it need to exist, reuse, stdlib, native, existing dependency, one line, minimum code). Output rule: code first, at most three short lines. [S] `/home/user1/.claude/plugins/cache/ponytail/ponytail/4.10.0/skills/ponytail/SKILL.md` (also the SessionStart text injected into this agent)

Vendor numbers [S] `.../ponytail/4.10.0/README.md` lines 33-90, `benchmarks/README.md`:
- Agentic benchmark (real Claude Code sessions on a FastAPI+React repo, 12 feature tasks, Haiku 4.5, n=4): about 54% less code, 22% fewer tokens, 20% cheaper, 27% faster, 100% safe. Reaches 94% less where an agent over-builds, "near zero" where code is already minimal.
- Its own older single-shot numbers (80-94% less code) are described as partly a baseline artifact.
- Independent benchmarks it lists: about 44% less code with no correctness regression but "trims everyday bad-input handling on 5/24 tasks"; another found "higher process cost (more tool calls/tokens) on large completion-forced tasks". Its own conclusion: "whether that saves money depends on the workload".
- Its README admits a terse reasoning model can spend thinking tokens deliberating the rungs and cost more (on GPT-5.5).

Documented safeguards [S] SKILL.md "When NOT to be lazy": never simplify away input validation at trust boundaries, error handling that prevents data loss, security, accessibility, anything explicitly requested. "Never lazy about understanding the problem": read all touched code and trace the flow first. Non-trivial logic leaves one runnable check. Deliberate shortcuts get a `ponytail:` comment naming the ceiling (harvested by `/ponytail-debt`).

How it can hurt [SYN, grounded]:
- The independent finding that it trims bad-input handling on some tasks matters for this project: Fiber has strict domain rules (insert-only reservations, 409 on over-booking, reasons on every edit). Those are trust-boundary and data-integrity rules, so ponytail's own exception should cover them, but it can only do so if CLAUDE.md states them (it does). Review any "simplification" that deletes a guard.
- "Ship the lazy version and question it" can push a decision onto the user that belongs in design. Do not use it while designing.
- "No design notes" conflicts with phases where you want reasoning written down (ADRs, plans). Its own text allows "explanation the user explicitly asked for" in full.
- Ponytail's ladder step 2 ("already in this codebase?") is exactly what graphify supports; they are complementary [SYN].

### 3.3 rtk (v1.1.0 installed, `rtk --version` confirmed)

What it is: a Rust CLI proxy; a PreToolUse hook rewrites Bash commands so output is filtered before it reaches context. [S] https://github.com/rtk-ai/rtk

Vendor numbers: "60-90% on common dev commands", "up to 90%". The README itself says this "is not the same as cutting your bill by 90%", counts tokens as bytes/4, and says percentages are reliable but absolute counts approximate. The methodology behind 60-90% was not on the page (UNVERIFIED). [S] https://github.com/rtk-ai/rtk

Independent datapoint, secondhand: caveman's README says a JetBrains test found RTK at +7.6% median cost per task at low reasoning effort (p = 0.004) and +0.1% at high, quality tie. This comes from a competitor's README and I could not open the JetBrains post (403), so treat it as UNVERIFIED. It is a reason to measure on your own work, not proof RTK is bad. [S for the quote] `.../caveman/2.7.0/README.md` line 271.

Scope and limits [S] https://github.com/rtk-ai/rtk:
- The hook fires only on Bash tool calls. Claude's built-in Read, Grep and Glob do not pass through it.
- Filters are lossy by design: failures only for test runners, traceback trimmed, long lines truncated, `cat` shows "signatures and structure over full bodies". The page does not list exactly what each filter drops.

Safeguards [S]:
- `rtk bypass <cmd>` runs one command unfiltered (`rtk proxy` is a deprecated alias). Confirmed locally with `rtk bypass --help`.
- `rtk recall [HASH] --full | --from N | --lines N | --grep RE` returns output a filter elided, by content hash from a recovery hint. Confirmed in local `rtk recall --help` only; the GitHub page I fetched mentioned "recall recovery" without detail, so the full behavior is UNVERIFIED beyond the help text.
- Your global `~/.claude/RTK.md` already tells Claude to re-run as `rtk bypass` only when a result is unusable.

How it can hurt [SYN]: a truncated test or build failure can hide the line that explains a bug (a warning above the first failure, a passing-count anomaly, the middle of a traceback). Rule of thumb: when debugging, or when a result contradicts the exit code, use `rtk recall` or `rtk bypass` before theorizing. Also remember `cat` output via rtk shows signatures only; when you need exact function bodies to edit, make sure Claude reads with the Read tool or `rtk bypass cat`.

### 3.4 graphify (skill at `~/.claude/skills/graphify`)

What it is: builds `graphify-out/graph.json`, `GRAPH_REPORT.md`, `graph.html`; answers questions with `graphify query "<q>" --budget N`. Code is extracted by AST with no LLM and no API key; docs and images need an LLM pass. Edges are labeled EXTRACTED, INFERRED or AMBIGUOUS, and its Honesty Rules say never invent an edge. [S] `/home/user1/.claude/skills/graphify/SKILL.md` lines 47, 163-165, 785-791. A `graphify-out/` folder already exists in this repo.

Vendor numbers [S] https://github.com/safishamsi/graphify: the README's benchmark table is about retrieval and QA accuracy (for example ERPNext cross-tool key-fact coverage 82.0% vs 70.8% grep/read baseline, n=6), not token counts. The "80% fewer tokens" headline applies to the hosted Graphify Cloud and has no stated method. I found no measured token saving for the local tool, so any "Nx fewer tokens" claim is UNVERIFIED. Sample sizes there are small (n=6, n=50).

Staleness safeguards [S] same README and `references/hooks.md`: `graphify hook install` rebuilds after each commit (code files only; docs need `/graphify --update`); `graphify watch`; `graphify update .` after `git pull`. `graphify claude install` writes a CLAUDE.md section telling Claude to check the graph before answering and rebuild after code changes. The skill's fast path answers natural-language questions straight from an existing graph without re-checking freshness.

How it can hurt [SYN]:
- A stale graph gives confident wrong answers about callers and structure. Edits made in the working tree between commits are not in the graph until a rebuild.
- INFERRED edges are model guesses; do not treat them as call-graph facts when deciding what a change can break.
- Adding the CLAUDE.md section costs always-on tokens and the project's CLAUDE.md should stay short [S] (200-line guidance). Keep it to two lines.
- For typed Python/TypeScript code, the LSP plugins you already have give exact, live definitions and references; Anthropic documents this as a way to reduce file reads. Use graphify for orientation and cross-file relationships (docs, architecture), LSP for exact symbol facts [SYN].

### 3.5 Overlap and scoping

[S] caveman SKILL.md Boundaries and ponytail README FAQ (line 357): caveman "shrinks what the agent says; ponytail shrinks what it builds. Different halves, no overlap: caveman leaves code byte-for-byte exact, ponytail stays out of the prose." The ponytail benchmark lists caveman as a prose-compression skill that leaves code normal. [S] `benchmarks/README.md` line 106.

Scoping table [SYN]:

| Tool | Owns | Must not touch |
|---|---|---|
| caveman | Chat prose to you; tool-call narration | Code, comments, commits, docs, specs, ADRs, your own prompts |
| ponytail | Choice of what code to write and how much | Design discussion, requirements, tests that define behavior, validation/security/data-integrity code |
| rtk | Bash command output (tests, git, build, ls) | Debugging evidence you need verbatim; Read/Grep/Glob are outside it anyway |
| graphify | Orientation: where things are, how modules relate | Exact current symbol facts (use LSP/grep), anything newer than the last rebuild |

Real conflict points [SYN]:
- Caveman and ponytail both cap prose. Stacked, you may get almost no reasoning shown. That is fine for routine edits and harmful for design and review.
- Both add rule text to context on every request. Anthropic's guidance is that every always-loaded line costs attention. [S] best-practices "Keep CLAUDE.md short".
- Caveman and rtk both reduce "noise"; only rtk changes what evidence Claude sees. A wrong terse summary of a truncated output compounds the risk. When rtk output is trimmed and Claude's report is terse, you cannot tell what was never seen. Use evidence requests.
- Subagent model delegation (your CLAUDE.md) does not carry the main session's caveman/ponytail mode unless the subagent's prompt or hooks do (the ponytail hook text was injected into this agent, so at least the plugin hooks do run in subagents; caveman's subagent behavior not verified, UNVERIFIED).

## 4. Workflow for building a coding project well

### 4.1 Anthropic's recommended loop

All [S] https://code.claude.com/docs/en/best-practices unless noted.

1. **Tell Claude what it cannot see.** Write down only what is not discoverable from the repo (decisions, env vars, gotchas, test commands). Test: could it find this by reading code, and would it look? If yes to both, leave it out.
2. **Interview first for vague features.** "Interview me until you could write the spec, then write it to SPEC.md." Then start a fresh session to build from the spec with a clean context and a written definition of done.
3. **Explore and plan before editing.** Plan mode (Shift+Tab) lets Claude explore and propose an approach for approval; Anthropic cites this as preventing rework. [S] https://code.claude.com/docs/en/costs
4. **Implement in small steps with a check.** "Give Claude something it can run that comes back pass or fail": a test, build exit code, linter, fixture diff, or browser screenshot. Ask for evidence (command and output), not "all tests pass".
5. **Enforce what cannot have exceptions deterministically.** CLAUDE.md is advisory; a Stop hook running typecheck, a PostToolUse formatter hook, deny rules for secrets. "If you keep adding emphasis to a CLAUDE.md line and Claude still misses it, that line belongs in a hook." Keep the enforced set small.
6. **Review in a fresh context.** `/code-review` or a read-only reviewer subagent "that never saw your conversation", prompted against the spec, with "skip style" so it does not invent findings and add abstractions. Verify with `/verify` (builds and runs the app).
7. **Steer early.** Esc on drift, `/rewind` to roll back code and conversation, `/clear` after two failed corrections.
8. **Commit small.** Checkpoints cover only files edited by Claude's file tools, not Bash changes, and "work alongside git rather than replacing it". Commit at each green step [SYN from that warning].

The broader Anthropic principles back this: start with the simplest solution, add complexity "only when it demonstrably improves outcomes", and agents need "ground truth from the environment at each step". [S] https://www.anthropic.com/engineering/building-effective-agents (the post notes some of its tooling guidance is dated). Context should be treated as a finite resource and sub-agents return condensed summaries of roughly 1,000-2,000 tokens. [S] https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

### 4.2 Architecture-first steps

Anthropic's pages above do not prescribe ADRs or module boundaries; that part is from the mattpocock skills and your own docs. [S for skill content] `/home/user1/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/1.3.1/skills/`

Sequence [SYN]:
1. Requirements: PRD (you have `docs/PRD.md`; CLAUDE.md says the PRD wins on conflict).
2. Grill the plan until the decision tree is empty: `grilling` skill (asks the whole frontier of decisions per round with a recommended answer; dispatches a sub-agent to find facts so the user is only asked for decisions; "done when the frontier is empty").
3. Domain model and decisions: `domain-modeling` (GLOSSARY.md plus `docs/adr/NNNN-*.md`, created lazily; challenges terms that conflict with the glossary). Your project already keeps domain rules in CLAUDE.md "Domain rules"; a glossary/ADR split would shorten CLAUDE.md [SYN].
4. Module boundaries: `codebase-design` (deep modules: small interface, much behavior behind it, seams where tests observe behavior; terms module, interface, depth, seam, adapter, leverage, locality).
5. Spec and tickets: `to-spec` (picks test seams, "the ideal number is one", publishes a spec), then implement.
6. Build: `tdd` (red before green, one slice at a time, tests only at pre-agreed seams, avoid implementation-coupled and tautological tests, "expected values must come from an independent source of truth").
7. Bugs: `diagnosing-bugs` ("Phase 1: build a feedback loop. This is the skill"; redact secrets before showing output).
8. Review: `code-review` (two parallel sub-agents, Standards vs Spec, on a diff from a fixed point; includes a Fowler smell baseline such as Speculative Generality, which overlaps ponytail-review).
9. `implement` (disable-model-invocation) chains tdd, typechecking regularly, one full suite run at the end, code-review, commit. That matches Anthropic's loop.

Where the skills cost tokens: skills load on demand [S], so having them installed is cheap; the cost is in running grilling and review sub-agents, which are worth it on design and risky changes, not on a one-line fix [SYN].

## 5. Recommended combined setup

Everything in this section is [SYN] unless a source is cited. Test it with `/usage` and a same-task A/B, which both caveman's honesty page and Anthropic's `/usage` recommend. [S]

### Always on (low risk)

- **rtk**: on. It targets the reading side, which is where the bill is. Know `rtk recall <hash>` and `rtk bypass <cmd>`; use them whenever output is part of the evidence (test failures, build errors, git diffs you must review).
- **LSP plugins** (pyright, typescript): on; Anthropic documents fewer reads and automatic type-error feedback. [S]
- **A short CLAUDE.md** (yours is 59 lines, fine). Put the exact test, lint and typecheck commands in it (already there).
- **Stop/PostToolUse hooks** for lint and typecheck, if you want them enforced rather than requested. [S]

### Per phase

| Phase | Model / effort | caveman | ponytail | graphify | rtk | Skills |
|---|---|---|---|---|---|---|
| Requirements, architecture, ADRs, domain model | Opus, high | off or lite | off | query for existing structure | on | grilling, domain-modeling, codebase-design |
| Plan an implementation | plan mode, Opus/Sonnet, medium-high | lite | off | query | on | to-spec |
| Routine implementation of a clear ticket | Sonnet, medium | full | full (lite if domain rules are tight) | query | on | tdd, implement |
| Non-trivial bug | Opus, high | off or lite | off until root cause found | query for callers | use `rtk recall` / `rtk bypass` | diagnosing-bugs |
| Review, security, migration | fresh subagent, high | off (findings must be complete) | use `ponytail-review` as a separate pass only | query for blast radius | bypass for diffs | code-review |
| UI | Opus 5.5 or Fable per your CLAUDE.md | lite | lite | optional | on | impeccable |
| Writing docs, commit messages, specs | any | off (its own Boundaries rule) | off | n/a | n/a | |

Switching mode inside a session is cache-safe for output styles per Anthropic [S]; switching model is not, so decide model per session, and use subagents (a different model per task) or a new session for model changes instead of `/model` mid-task. [S for the cost, SYN for the advice]

### Keep off or scoped down

- caveman-compress on CLAUDE.md or the PRD: off. Gain is small on a 59-line file; ambiguity risk is real on domain rules. Never compress the PRD or architecture docs, which are specs.
- ponytail ultra: off for this project; its own documentation says over-trimming of input handling appeared on some tasks. Keep lite/full.
- graphify `claude install` CLAUDE.md section: keep to a couple of lines or skip; use the post-commit hook for freshness instead of relying on instructions. [S for the hook, SYN for advice]
- Dynamic agent teams and many parallel subagents: off unless needed. [S] 7x token note.
- Cavecrew builder for multi-file or domain-rule edits: off; it hard-refuses 3+ files by design. [S] agent description

### Checklist

1. Set model and effort at the start of the session; do not toggle mid-task. [S]
2. `/clear` at each new task; `/rename` first if you want to return. [S]
3. Start features with a spec (grilling, then SPEC or issue), build in a fresh session. [S/SYN]
4. State the check command in the prompt: "run X, keep going until it passes, show the output". [S]
5. Use plan mode for anything touching several files or the domain rules. [S]
6. Keep graph fresh: `graphify hook install` once; `graphify update .` after pulls. [S]
7. If a test or build output looks too clean, run `rtk recall` or `rtk bypass` before trusting it. [SYN]
8. Turn caveman to off/lite and ponytail to off when designing, debugging or reviewing; on for routine, well-specified edits. [SYN]
9. Review with a fresh-context subagent against the spec, "skip style"; then run the full suite once. [S]
10. Commit at each green step with a normal-prose message (caveman Boundaries). [S/SYN]
11. Weekly: `/usage` to see skill/subagent/MCP shares and cache misses; `/doctor` to prune CLAUDE.md. [S]
12. Prove each tool's value on your own work: same task with and without it, compare billed totals and the number of corrections. [S: caveman HONEST-NUMBERS, Anthropic `/usage`]

## Unverified items

- JetBrains 8.5% (caveman) and +7.6% median cost (rtk) figures: only seen in caveman's README; JetBrains blog returned 403.
- Adobe arXiv 2606.24083 finding about compressed prompts: only seen via caveman's README.
- rtk's methodology for 60-90%, and the full detail of `rtk recall` behavior (local `--help` only).
- Any token-saving number for local graphify (the 80% claim is for the hosted product, no method).
- Whether caveman's mode applies inside subagents; whether plugin mode-switch commands touch the cache beyond what the output-style docs say.
- "Plan mode with Sonnet implementation" cost trade-offs beyond Anthropic's statements; I did not run a benchmark in this repo.

## Sources

Anthropic (primary):
- https://code.claude.com/docs/en/costs
- https://code.claude.com/docs/en/best-practices
- https://code.claude.com/docs/en/prompt-caching
- https://code.claude.com/docs/en/context-window
- https://code.claude.com/docs/en/memory
- https://code.claude.com/docs/en/sub-agents
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- https://www.anthropic.com/engineering/building-effective-agents

Tools (their own repos and files):
- caveman 2.7.0: `/home/user1/.claude/plugins/cache/caveman/caveman/2.7.0/` (`README.md`, `docs/HONEST-NUMBERS.md`, `skills/caveman/SKILL.md`, `skills/caveman-compress/SKILL.md`)
- ponytail 4.10.0: `/home/user1/.claude/plugins/cache/ponytail/ponytail/4.10.0/` (`README.md`, `benchmarks/README.md`, `skills/ponytail/SKILL.md`)
- rtk: https://github.com/rtk-ai/rtk and local `rtk --version`, `rtk bypass --help`, `rtk recall --help`
- graphify: `/home/user1/.claude/skills/graphify/SKILL.md`, `references/hooks.md`, and https://github.com/safishamsi/graphify
- mattpocock-skills 1.3.1: `/home/user1/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/1.3.1/skills/` (`engineering/tdd`, `code-review`, `domain-modeling`, `codebase-design`, `diagnosing-bugs`, `implement`, `to-spec`, `productivity/grilling`)
- Project context: `/home/user1/project/fiber/CLAUDE.md`
