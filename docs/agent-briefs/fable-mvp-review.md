# Brief: Fable's pre-release review of the NouSR MVP

Prepared 2026-11-16 by the lead session, NOT run yet. Smitty starts it. To run: start a Claude Code session or subagent on
model Fable in this repo, on an up-to-date `main`, and give it everything below the line.

Budget note (2026-11-16): the weekly all-models limit was at 94%. Keep the run focused: review and report first; fixes only for
clear-cut problems; anything that changes behaviour or results goes to Smitty as a question.

---

You are reviewing NouSR before it goes public: a deterministic expected-value timeline simulator for Honkai: Star Rail 4.7
that uses Fribbels' hsr-optimizer as its per-action damage kernel. You have not seen how it was built; that is the point.
You are the fresh eyes.

Read first: `CLAUDE.md` (working rules: label claims Recalled / Searched / Computed; design decisions are Smitty's; ask
questions as mini-demos with a label like [Design · big], [Design · small], [Go-ahead], [FYI]), then `README.md`,
`DESIGN.md`, `docs/proposals/results-format.md`, `schema/result.schema.json`, `schema/scenario.schema.json`.

Do, in this order, and keep a running list of findings:

1. **First-time user.** From a clean checkout, follow README.md exactly (`npm run setup`, `npm ci`, `npm run build`,
   `node dist/cli.js run examples/acheron-welt-vs-tribbie.scenario.json`). Note every place a newcomer would get stuck.
2. **Correctness spot-check.** Pick three kits (suggested: Acheron, Castorice, Cyrene). For each, compare the kit header and
   numbers against `node tools/gamedata/kit-text.mjs <id>` and Fribbels' conditional file. Report only real discrepancies,
   with file:line and the source that disagrees.
3. **Public-readiness.** Licensing and credits (Fribbels and hsr-simulator are MIT; srsim has no license and must not
   have contributed code; check the tree for anything copied); secrets, personal data, account IDs or UIDs anywhere in the
   repo or its history; files that look internal (`docs/agent-ledger.md`, `docs/agent-briefs/`, `docs/in-game-checks.md`,
   `side-session-notes/`); whether README states scope, status and limits honestly (DESIGN.md "Known approximations",
   not modelled items, the missing period module, fully-built assumption).
4. **Documentation.** Fix typos, broken links and stale statements in README.md and docs/ directly. Do not rewrite
   DESIGN.md's decision tables (they are a record); flag stale rows instead.
5. **Charts.** From `docs/agent-ledger.md`, produce a per-model scorecard (Haiku vs Sonnet: runs, tokens, minutes,
   findings later, mutation catch rate) as a simple chart (a Markdown table plus an SVG or PNG under `docs/`).

Rules: don't change engine or kit behaviour, schemas or numbers; those are Smitty's decisions. Never commit or push;
leave changes in the working tree. Run `npm run typecheck` and `npm test` after any edit.

Report (under 800 words): findings ranked most severe first (blocking release / should fix / nice to have), each with
file:line and a suggested fix; what you changed; questions for Smitty in the mini-demo format with labels; the chart path.
