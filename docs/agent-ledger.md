# Agent ledger

One row per subagent run, kept as we go, so a scorecard per model (Haiku, Sonnet, ...) can be charted at the end.
Requested by Smitty, 2026-11-16. Side sessions (separate Claude Code sessions on their own branches) are listed apart:
they run on the lead's model and do their own delegating.

Columns:
- **Tokens / tools / minutes:** from the harness's completion notice ("—" when it wasn't shown).
- **Found later:** errors in the agent's own work that a reviewer or the lead found afterwards. "Clean" means none found.
- **Mutations:** for writers, how many deliberate breakages its tests caught; for reviewers, how many they ran.

## Subagents

| Date | Model | Job | Tokens | Tools | Min | Found later | Mutations | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-11-13 | Haiku | Tribbie kit (pilot) | — | — | — | 6 modelling errors (deep review) | — | Passed its own tests. Led to "Sonnet for kits" (memory: subagent-models) |
| 2026-11-13/14 | Haiku ×3 | 15 relic-set modules | 266k–342k each | — | — | 1 medium, 1 low-medium error; 2 over-cautious refusals (Sonnet review) | — | Good at honest refusals; missed engine semantics |
| 2026-11-15 | Sonnet | Review: Castorice kit | 213k | 47 | 10.5 | Reviewer: 5 bugs found (B1–B5), no wrong numbers | ran 41, 31 caught | Found the rounded Cyrene rate, the healed-event leak |
| 2026-11-15 | Sonnet | Review: Hyacine kit | 210k | 31 | 10.3 | Reviewer: 6 items, no wrong numbers | ran 34, ~17 caught | Found missing Technique, Ultimate order question |
| 2026-11-15 | Sonnet | Hyacine review fixes + ~20 tests | — | — | — | Clean (lead verified) | 20 run, 18 killed, 2 equivalent | |
| 2026-11-15 | Sonnet | WRD + Amphoreus memosprite modules | 229k | 69 | 14.0 | Clean (lead read the logic) | 24 run, all killed | Flagged stale wording in 3 other modules |
| 2026-11-15 | Sonnet | Write: Cyrene kit + This Love, Forever | 413k | 33* | 15.2* | 1 reading arguably wrong (Ode to Ego; settled in game), 4 surviving mutants, Robin Ode gap | 22 run, all caught | *after resume; first run hit the usage limit |
| 2026-11-15 | Sonnet | Review: Cyrene kit + end-to-end run | 224k | 51 | 19.1 | Reviewer: standard-build bug (not the writer's file), Robin gap | ran 22, 17 caught | First full Castorice-team run |
| 2026-11-15 | Haiku | 4 missing Cyrene tests | 120k | 12 | 1.7 | Clean (lead verified) | 4 run, 4 killed | Tight brief, pattern work |
| 2026-11-15 | Sonnet | Apply in-game results (8 items) | 273k | 81 | 16.3 | Clean (lead verified suite) | 12 run, all killed | |
| 2026-11-15 | Sonnet | K31 technique toggles + K32 SPD at load | 257k | 82 | 22.1 | Clean; flagged its own change to an earlier decision (K14f) | ~14 run, all killed | |
| 2026-11-16 | Sonnet | Build `nousr run` CLI, results writer, packaging, CI | 266k | 86 | 21.0 | Clean so far (lead verified suite, build, real run); 1 schema field added and reported | 7 run, all caught | Fixed the stale example scenario; flagged 4 open choices |
| 2026-11-16 | Sonnet | CLI follow-ups: reaction damage, downed targets, spd_solved | 136k | 36 | 7.2 | Clean (lead verified suite, build, log sums = totals) | 3 run, all caught | 2 optional schema fields, reported |

## Side sessions

| Date | Job | Branch / commit | Outcome |
|---|---|---|---|
| 2026-11-15 | The Herta + Anaxa kits | `claude/practical-khayyam-2c2d55` / b132ce4 | Done; 1,768 tests reported passing (to verify on merge). Hit a usage limit once |
| 2026-11-15 | Sunday + Dan Heng PT standard builds | `claude/focused-albattani-bf53c3` / e057d91 | Done; lead verified 1,657 pass, 1 environment skip |
| 2026-11-15 | Results report + CLI draft | `claude/jolly-shannon-4661a4` / 59f10e5 | Draft for review (12 questions) |
