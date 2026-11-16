# Proposal: the results report (`nousr-result`) and the command line

Status: APPROVED and BUILT, 2026-11-16. Smitty approved every recommended option (Q11 = option A, the Vite bundle); the report
writer is `src/result/`, the command is `src/cli.ts` (K33, K34), and `schema/result.schema.json` is version 1. Where the build
differs from what is written below: the schema gained `technique` per member (the technique echo had no field), `kit_stats`
(decision 7) is in the schema but nothing writes it yet, the log's per-action damage includes damage dealt in reaction to the
action (Tribbie's Additional DMG, K35; damage with no triggering action is the run's optional `unattributed`), and each
`standard_builds[]` echo carries an optional `spd_solved` (`file_rolls`, `used_rolls`, `reachable`, `moves`: K32's solving, from
`StandardBuildReport.spdSolved`). Both are optional additions, so the version stays 1. Written 2026-11-15 as a draft; the text below is left as proposed.
Related: DESIGN.md K8 (this report), K19 (structured warnings), K27 (kit options and their echo), K14c/K14f (standard-build echo),
S1 (teams in one file share conditions), S7/S8 (strictness, identity), decision 1 (enemy counts 1, 3, 5 reported separately),
"Planned experiments", Roadmap (optimizer, stochastic mode, graphs and a readable action log).

## The problem

Today a scenario runs only from code: `runScenario` (`src/run/run.ts`) returns one `TeamRun` per team and enemy count, holding a
`BattleResult` (`src/battle/battle.ts`): total, per cycle, per member, the action log, downed allies, warnings, plus the standard-build
and kit-option echoes. There is no file a run writes, so a result cannot be kept, shared, diffed or read by another tool, and there
is no command to run a scenario. K8 asks for both: a `nousr-result` JSON with its own schema, and a plain table on the command line.

Three readers want different things from it:

- **A person** comparing teams: totals per enemy count, the ratio between teams (as in the CLAUDE.md reference table), who did the
  damage, which warnings apply, and for the Planned experiments things like "Breaths launched" and "Territory uptime".
- **A person debugging a kit**: the action log, in order, with when each action happened, its damage and skill points.
- **The future optimizer**: one number to rank by, per enemy count, and as little else as possible per run (it runs thousands).

## Prior work

What the other simulators report and how (Searched, read 2026-11-15):

- **srsim** ([simimpact/srsim](https://github.com/simimpact/srsim); architecture reference only, no license, no code used). Writes
  two files: a result document defined in protobuf
  ([`pb/model/result.proto`](https://github.com/simimpact/srsim/blob/main/pb/model/result.proto)) and serialised as gzipped JSON,
  and a separate gzipped event log, one JSON line per engine event as `{name, event}`
  ([`cmd/srsim/writers.go`](https://github.com/simimpact/srsim/blob/main/cmd/srsim/writers.go),
  [`pkg/engine/logging/logger.go`](https://github.com/simimpact/srsim/blob/main/pkg/engine/logging/logger.go)). The result carries
  `schema_version {major, minor}`, the sim version, a `modified` flag, the build date, the seed and the full config echoed back, then
  statistics over Monte Carlo iterations: total damage dealt and taken, damage per cycle, total AV, each as min/max/mean/SD (and
  quartiles and a histogram per cycle). Nothing per character yet (a TODO in the proto). CLI: `srsim run` with `-o` output path
  (default `result/`), `--seed`, `-i` iterations (default 1000), `-w` workers, `-s` to also print events to stdout; by default it
  then serves the result to a web UI, `-n` to skip that
  ([`cmd/srsim/main.go`](https://github.com/simimpact/srsim/blob/main/cmd/srsim/main.go)).
- **hsr-simulator** ([tingyumian662/hsr-simulator](https://github.com/tingyumian662/hsr-simulator), MIT). A local web app, no CLI.
  Its `/simulate` endpoint ([`web/api.py`](https://github.com/tingyumian662/hsr-simulator/blob/main/%E6%A8%A1%E6%8B%9F%E5%99%A8%E6%9C%AC%E4%BD%93/web/api.py),
  `run_simulation`) returns one untyped JSON with no schema or version: `log` (a list of free-text Chinese lines, including
  `[WARN]` lines mixed in), `summary` per unit (name, damage, % of team total, HP left, alive), `total_damage`, `turns`, `cycles`,
  `action_counts`, and the enemies' HP, alive and broken state. One team, one enemy setup per request; numbers are rounded to
  integers before they leave the engine.
- **Fribbels' hsr-optimizer** (MIT; vendored). No file output for damage: the benchmark shows "Combo DMG" (or Combo Heal / Shield /
  Buff) for one hand-written rotation and a percentage against generated benchmark builds, in the UI
  ([`docs/guides/en/benchmarks.md`](https://github.com/fribbels/hsr-optimizer/blob/main/docs/guides/en/benchmarks.md)). The docs say
  scores "should not be used to compare across different configurations", and that action advance, energy and stacking frequency are
  not considered. That is the gap NouSR fills, so its report must make cross-team comparison the primary view.

What to take from them: srsim's separation of a compact result from a large event log, its version block and config echo, and its
"one number becomes min/max/mean/SD" shape for when a stochastic mode exists. hsr-simulator's per-member damage share is the view
people read first. Neither puts warnings in structured form, compares teams, or reports per enemy count.

## What the engine has today, and what it would need

Not every field below exists yet. Building the report means some engine work, which is busywork once the shape is settled but worth
seeing before choosing:

| Field | Today | Needed |
|---|---|---|
| Total, per cycle, per member | `BattleResult.totalDamage`, `damageByCycle`, `damageByMember` | nothing |
| Action order, actor, owner, ability, kind, expected enemies hit, debuffs | `actionUsed` events in `BattleResult.actions` | nothing |
| Action value and cycle of each action | not recorded (the timeline has `now` and `cycle`) | add `at`, `cycle` to `actionUsed` |
| Damage of each action | not recorded per action (summed into totals in `Battle`, around `battle.ts:987`) | sum `damageDealt` per action serial |
| Skill points before / after each action | `Battle.skillPoints` exists, not logged | add to the log entry |
| Energy per action | not recorded | optional, add if wanted |
| Downed: who | `BattleResult.downed: string[]` | nothing |
| Downed: when | not recorded | add `at`, `cycle` |
| Warnings | `TeamRun.warnings` (K19) | nothing |
| Standard builds, kit options | `TeamRun.standardBuilds`, `TeamRun.kitOptions` | nothing |
| Out-of-combat stats used (SPD, HP, DEF, ERR) | in `MemberSetup.stats`, not returned by `runScenario` | return it |
| Kit-specific counters (Breaths launched, Territory uptime) | none | decision 7 below |

The Roadmap already says the optimizer needs "the action log to carry each action's action value and skill points", so that work is
wanted anyway.

## The decisions

### 1. One file per scenario run

| Option | For readers | For the optimizer |
|---|---|---|
| **A. One result file per scenario run, holding every team at every enemy count** | Matches S1: a scenario is one set of conditions, the result is one comparison. Ratios between teams live in the same file | One file per evaluated scenario; an optimizer that writes no files at all just uses the in-memory object |
| B. One file per team (all enemy counts) | Easy to keep a team's history; comparing means opening two files and trusting they ran under the same conditions | Same |
| C. One file per team and enemy count | Smallest units, most files; no comparison inside | Same |

**Recommendation: A.** It is what S1 promises and the only option where the comparison ratios belong inside the file.

### 2. Identity and reproducibility

Following S8, the top level carries `format: "nousr-result"`, an integer `version`, `game_version`, and `$schema` optional. Beyond
that, what lets someone tell what produced a result:

- `generator`: `{ "nousr": "<package version>", "nousr_commit": "<git sha or null>", "kernel": "fribbels/hsr-optimizer@31644d9" }`.
  The kernel commit matters because new Fribbels damage math changes numbers with no NouSR change.
- `created`: an ISO 8601 timestamp. Optional, because it makes two runs of the same input differ byte for byte (see decision 12).
- The scenario that was run:

| Option | For readers | Cost |
|---|---|---|
| **A. Embed the scenario as given, account as given (a path stays a path), plus SHA-256 of the scenario file and the account file** | The result is self-explaining: what teams, what conditions. The hash proves which account scan was used without copying it | A few KB |
| B. Hashes and paths only | Smallest; the result means nothing without the original files | none |
| C. Embed the fully resolved input, the account scan inlined | Fully reproducible from one file | Copies the whole account scan (every relic the user owns) into each result: a privacy problem for shared results, and large |

**Recommendation: A.** A shared result should not carry someone's whole account by default. An inline account in the scenario (S8
allows it) is embedded as written, since the author chose to put it there.

### 3. How runs are laid out

| Option | Shape | Reading |
|---|---|---|
| **A. A `teams` list (each team once: id, members, echoes) and a flat `runs` list, one entry per team and enemy count, each naming its `team` and `enemy_count`** | `runs[i] = {team, enemy_count, total, per_cycle, by_member, actions, downed}` | Mirrors `TeamRun`. A table is a filter over `runs`; the optimizer reads `runs[].total` directly. Things that do not depend on enemy count (members, standard builds, kit options) appear once |
| B. Nested: `teams[].runs_by_count["1"]` | Grouped as a person reads it | Object keys that are numbers as strings; every consumer re-flattens |
| C. Nested the other way: `by_count["3"].teams[]` | Grouped as the comparison table reads | Same problem; team echoes repeated per count |

**Recommendation: A.**

### 4. Totals and per cycle

Per run: `total` (damage over the window), `per_cycle` (an array, index 0 is cycle 1, as `damageByCycle` is now), and `window`:
`{ "cycles": 5, "action_value": 550 }` (150 for cycle 1, 100 after, decision 2), so "damage per cycle" and "damage per 100 AV" can be
derived without knowing MoC rules.

Open choice: whether the file also carries derived numbers (`average_per_cycle = total / cycles`, cumulative per cycle). They are one
division away. **Recommendation:** leave derived numbers out of the file and compute them in front ends; the file holds what the
engine measured. One exception worth having is `share` per member (below), because every reader wants it and it removes rounding
disagreements between front ends. Q2 asks.

### 5. Per member

| Option | Contents |
|---|---|
| A. Damage only (today's `damageByMember`) | `{ "acheron": 1234567.8, ... }` |
| **B. One object per member: `damage`, `share` (of the run total), `actions` (count by kind: basic, skill, ultimate, follow_up), `by_ability` (damage per ability name the kernel priced, including `EXTRA` and Break DMG)** | Answers "who did the damage, and with what"; `by_ability` is what a kit reviewer checks first |
| C. B plus per member per cycle | Lets a graph show when each member's damage came; grows the file by members x cycles numbers |

Memosprite damage is priced as and credited to the owner (K6, `actionUsed.owner`). Under B, it stays in the owner's `damage` and shows
in `by_ability` under the memosprite's abilities, so Castorice's total includes Netherwing and the split is still visible.

**Recommendation: B.** C can come later as an addition (the graphs on the Roadmap), and the action log already allows rebuilding it.

### 6. The action log

The log is what lets a person see why a team won and what the optimizer's constraints (turn order, SP never at 0 on a Skill turn) are
checked against. Proposed entry, snake_case, one per ally action in order:

```json
{
  "serial": 14,
  "at": 233.4,
  "cycle": 2,
  "actor": "netherwing",
  "owner": "castorice",
  "action": "Breath Scorches the Shadow",
  "kind": "skill",
  "damage": 412345.6,
  "sp_before": 2,
  "sp_after": 2,
  "expected_enemies_hit": 2.44,
  "debuffed": { "enemy_2": 1.0 }
}
```

`at` is the action value when the action started; `debuffed` merges today's `debuffed` and `debuffChance` (enemy → chance, K22);
`enemies_hit` (the could-hit set) and `hit_chance` are left out in favour of `expected_enemies_hit`, which is what effects use (K17).
Q4 asks whether the full sets are wanted for debugging.

Where it goes:

| Option | For readers | For the optimizer |
|---|---|---|
| **A. In the result file by default, inside each run; `--no-log` leaves it out; the schema makes `actions` optional** | One file to share. Size: on the order of 50 to 100 actions per run at 5 cycles, so a 2-team scenario at 3 counts is a few hundred entries, tens of KB | The optimizer never asks for it (it does not write files, or writes them with no log) |
| B. A separate log file, like srsim's | Main file stays small; two files to keep together | Same |
| C. Opt in only (`--log`) | Smallest default; a shared result usually lacks what a debugger needs | Same |

**Recommendation: A.** NouSR's logs are small (fixed window, no iterations), unlike srsim's thousands of iterations.

Not in the log under this proposal: enemy actions, buffs applied and expired, energy. Those are the "readable action log" Roadmap
item, and a full event stream like srsim's is the natural shape for it later, as a separate opt-in file.

### 7. Kit-specific counters

The Netherwing experiment reads "Breaths launched" and "Territory uptime in action value". Neither is in the action log as proposed:
uptime is a duration, not an action.

| Option | What it does | Cost |
|---|---|---|
| A. None: compute from the action log | Breaths can be counted from the log; uptime cannot | No new interface; the experiment cannot read uptime |
| **B. `kit_stats` per member, declared per kit in `schema/kit-stats/<character id>.schema.json`, like kit options (K27)** | Each kit publishes named counters (`breaths_launched`, `territory_uptime_av`); the schema says what each means and its unit | A new kit interface (a kit returns its counters at battle end) and one schema file per kit that has any. Design decision, since it is a public interface |
| C. Generic: uptime of every named modifier, counts of every event type | Nothing per kit; everything measurable | Large, noisy, and modifier names are internal: renaming one breaks readers |

**Recommendation: B**, with only the counters an experiment needs, added as experiments need them. It is the same pattern as kit
options, so an optimizer can also read which counters exist from the schema and use them as constraints ("Territory uptime at least
X").

### 8. Downed allies

Today: a list of member keys. Proposed: `downed: [{ "member": "hyacine", "at": 412.0, "cycle": 4 }]` plus a run-level
`objectives: { "no_downed": false }`, since "no downed characters" is a MoC objective (decision 8) and readers filter on it. Memosprites
leaving (Netherwing at 0 HP) are not "downed" and stay out. **Recommendation:** as proposed; the `at`/`cycle` need the engine change
in the table above.

### 9. Warnings

K19 settled the record: severity, code, message, and where (team, enemy count, member). Proposed in the file exactly as
`RunWarning`, snake_cased (`enemy_count`). Where they go:

| Option | Reading |
|---|---|
| **A. One top-level `warnings` list for the whole file, each with its where-fields; a setup warning that holds for every enemy count appears once, without `enemy_count`** | A front end shows them in one block and can filter by team or run. Today `TeamRun.warnings` repeats a team's setup warnings once per enemy count; the writer de-duplicates |
| B. Inside each run | Repeats setup warnings per count; a reader has to merge them for a summary |

**Recommendation: A.** The `code` list stays the closed enum in `src/run/warnings.ts`; the schema lists it, so a new code is a schema
change and a front end can key on codes safely.

### 10. Echoes

Per team, once (they do not depend on enemy count):

- `members`: key, character id, ability version, eidolon, Affinitive Eidolon, light cone id and superimposition, relic source
  (`equipped`, `standard`, `list`), and the out-of-combat stats the timeline used: `spd`, `hp`, `def`, `err`, `effect_res`. SPD is the
  first thing anyone checks when a result looks wrong.
- `standard_builds`: today's `StandardBuildReport` per standard member (sets, main stats, distributed and total rolls, `path`, moves,
  swaps, SPD target and miss), snake_cased.
- `kit_options`: today's `MemberKitOptions` (options used, which were defaulted).

**Recommendation:** all three, as listed.

### 11. Comparing teams

The CLAUDE.md reference table states results as "X over Y" ratios of totals. The scenario has no notion of a baseline team.

| Option | What it does |
|---|---|
| A. No comparison in the file; front ends divide | Smallest; every front end reinvents it, and two people may quote ratios against different baselines |
| **B. A `comparison` block: one baseline team, and per other team and enemy count the ratio `total / baseline total`. Baseline: the first team in the file by default, or `--baseline <team id>` on the command line; the block names which** | Matches the reference table. Written once, quoted the same everywhere |
| C. Every pair (a ratio matrix per enemy count) | Complete; for n teams, n² numbers per count. Useful once there are many teams (Demiurge orders), where a sorted list is better anyway |
| D. A `baseline` field in the scenario | The author fixes the reference; a scenario schema change (version stays 1 if optional) |

Also considered: a single number across enemy counts (an average or weighted blend of 1, 3 and 5). Decision 1 says counts are
reported separately, as Prydwen does, and any blend's weights are a judgment about which MoC stages matter, so it is not proposed.
Per-cycle ratios are not proposed either: they are noisy (an Ultimate landing in cycle 3 instead of 2) and the totals carry the
comparison.

**Recommendation: B**, ratio of totals only, per enemy count. With many teams (an optimizer's output), the table sorts by ratio.

### 12. Numbers

| Option | Effect |
|---|---|
| **A. Full doubles in the file, rounding only in the table** | Exact; diffs of two results show real changes; ratios match what the code computed. The engine is deterministic, so the same inputs, versions and kernel give the same numbers |
| B. Rounded to integers in the file (hsr-simulator) | Readable raw JSON; small changes vanish; ratios computed from rounded totals differ in the 6th digit from the table |

**Recommendation: A.** Leaving `created` out (or behind a flag) makes two runs of the same inputs byte-identical, which gives a
cheap regression check: rerun the reference scenarios, diff the files.

### 13. Versioning and the schema `$id`

Following S8: `"format": "nousr-result"`, `"version": 1`, schema `$id` `urn:nousr:schema:result:1` (the same placeholder URN scheme as
`urn:nousr:schema:scenario:1`, to be replaced with the scenario's when a publication address is chosen).

The scenario schema is strict (S7: unknown keys rejected), which is right for input a person writes. For output, the question is what
an older reader does with a newer file:

| Option | Effect |
|---|---|
| A. Strict schema (`additionalProperties: false`), version bump on any change | A reader validating against an old schema rejects every newer file, even one that only added a counter |
| **B. Strict schema for NouSR's own tests (what it writes matches the schema exactly); `version` goes up only on a breaking change (a field removed, renamed or changing meaning); adding an optional field keeps the version; readers are told to ignore keys they do not know** | Additions (kit counters, energy in the log, graphs data) do not break existing readers |
| C. srsim's `{major, minor}` | B with the additions also counted; a reader can say "needs 1.3 or later" |

**Recommendation: B.** C is cheap to add later if a reader ever needs to require a feature.

The stochastic mode on the Roadmap reports a spread, not one number. When it exists, it would get its own `mode: "stochastic"` and
its own statistics blocks (srsim's min/max/mean/SD shape is the precedent), as a version 2 or a sibling format; this proposal does not
reserve fields for it.

## The command line

### Command and arguments

```
nousr run <scenario.json> [options]

  -o, --out <file>          write the nousr-result JSON to <file> ("-" for stdout)
      --json                print the JSON to stdout instead of the table
      --baseline <team>     the team ratios are taken against (default: the first team)
      --teams <a,b,...>     run only these teams
      --enemies <1,3,...>   run only these enemy counts (must be counts the scenario lists)
      --no-log              leave the action log out of the JSON
      --log <team>:<count>  print one run's action log after the tables
      --cycles              add the per-cycle table
      --no-color            plain text (also when stdout is not a terminal, or NO_COLOR is set)
      --strict              exit with code 3 when any 'warning'-severity warning was raised

nousr validate <scenario.json>  check a scenario and its kit options without running it
nousr version                   NouSR version, kernel commit, game version
```

The filters (`--teams`, `--enemies`) only take subsets of what the scenario says. No option changes conditions (cycles, start state,
weaknesses): those live in the file, so a result can always be traced to a scenario (S1).

Exit codes: 0 ran; 1 the scenario cannot run (`RunError`, `ScenarioError`: every problem listed, as the loader does now); 2 bad
arguments; 3 warnings with `--strict`.

### How it runs (a dependency question)

The kernel imports Fribbels through tsconfig path aliases that only Vite's resolver follows (`vitest.config.ts`: `tsconfigPaths`,
the `cross-fetch` alias), and `RunError` uses a TypeScript parameter property, which Node's built-in type stripping does not accept
(Recalled; Node 24.14.1 is installed here, Computed with `node --version`). So `node src/cli.ts` will not work as is.

| Option | Effect |
|---|---|
| **A. Bundle the CLI with Vite (already installed as Vitest's dependency) into `dist/cli.js`; `package.json` `bin: { "nousr": "dist/cli.js" }`; `npm run build` before use** | Plain `node dist/cli.js` afterwards, fast start. Vite becomes a direct devDependency instead of a transitive one |
| B. `tsx` as a runner (`tsx src/cli.ts`) | No build step; a new dependency; whether tsx follows the nearest tsconfig's paths for Fribbels' files the way Vite does is unchecked |
| C. Run through Vitest's machinery (a script that calls Vite's module runner) | No new dependency; leans on Vitest internals that change between versions |

**Recommendation: A**, verified by a spike before it is built. Q11 asks.

### Table layout

Default output: a header, the totals with ratios, then one per-member block per enemy count, then warnings. Example (layout only, the
numbers are made up, not a run):

```
NouSR 0.1.0 · kernel fribbels@31644d9 · game 4.7
Scenario: Acheron, Welt vs Tribbie (examples/acheron-welt-vs-tribbie.scenario.json)
MoC, 5 cycles (550 AV), generic-moc, weakness: all, start 50% energy, 3 SP, techniques on

Total damage                      1 enemy             3 enemies           5 enemies
                                  total   ratio       total   ratio       total   ratio
sw_welt_dhpt                  3,210,000   1.434         ...
sw_tribbie_dhpt (baseline)    2,238,000   1.000         ...

sw_welt_dhpt, 1 enemy                     damage   share  basic  skill   ult  fup
  acheron                              2,850,000   88.8%      9      0     6    0
  silver_wolf                            240,000    7.5%      3      5     2    0
  welt                                   120,000    3.7%      2      6     1    0
  dan_heng                                     0    0.0%      ...
  downed: none

⚠ team "sw_tribbie_dhpt", member "tribbie": SPD may be understated by up to just under 2 (2 SPD substats, each can hide just under 1): ...
```

Numbers: thousands separators, totals to the integer, ratios to 3 decimals (as the CLAUDE.md table), shares to 1 decimal. With
`--cycles`, a per-cycle table per enemy count (teams as rows, cycles as columns). With `--log sw_welt_dhpt:1`, that run's action
log, one line per action: serial, AV, cycle, actor, action, damage, SP before → after.

### Warnings

Rendered by the existing `formatWarning` (`src/run/warnings.ts`): `⚠` and red for `warning`, `ℹ` and plain for `info`, the where-part
first, printed after the tables so they are the last thing on screen. Which stream: all on stdout (one stream, simplest), or
warnings on stderr (they still show with `--json > file`, and the JSON on stdout stays pure JSON). **Recommendation:** warnings to
stderr always, tables and JSON to stdout. With `--json` or `-o`, the warnings are in the JSON too.

## What it does to results

Nothing to any number: the report reads what the battle already computed. The engine changes in the table above add fields to the
action log and downed list; they change no damage. Once built, the reference scenarios can be rerun from the command line and their
result files diffed across commits.

## Questions for Smitty

1. **File granularity (decision 1):** one result file per scenario run, every team and enemy count inside? (Recommended.)
2. **Derived numbers (decision 4):** keep only measured numbers in the file plus each member's `share`, and compute averages and
   cumulative sums in front ends? (Recommended.)
3. **Scenario echo (decision 2):** embed the scenario as given with SHA-256 hashes of it and the account file, never inlining a
   path-referenced account? (Recommended.)
4. **Action log (decision 6):** in the file by default with `--no-log` to drop it? And do you want the full could-hit sets
   (`enemies_hit`, `hit_chance`) in each entry, or only `expected_enemies_hit`? Energy per action too?
5. **Per member (decision 5):** damage, share, action counts and per-ability damage (B), without per-cycle per member for now?
6. **Kit counters (decision 7):** a `kit_stats` interface with a schema per kit, like kit options, so experiments can read Breaths
   launched and Territory uptime? Or leave counters out for now and count only what the log shows?
7. **Comparison (decision 11):** ratio of totals per enemy count against one baseline team, the first team by default and
   `--baseline` to change it? Or should the scenario name its baseline (a scenario schema addition)?
8. **No blended score across enemy counts:** agreed that 1, 3 and 5 stay separate in every view, the optimizer included (it would rank
   per count or take a count as a parameter)?
9. **Versioning (decision 13):** integer `version` bumped only on breaking changes, additions allowed without a bump, readers ignore
   unknown keys, `$id` `urn:nousr:schema:result:1`?
10. **Command line:** command `nousr` with `run`, `validate`, `version`; the arguments above; filters only, never condition overrides;
    warnings to stderr; `--strict` for a non-zero exit on warnings. Anything to add or drop?
11. **How the CLI runs (a dependency):** bundle with Vite into `dist/cli.js` (Vite as a direct devDependency), `tsx`, or Vitest's
    runner? A spike would confirm the chosen one loads the kernel before anything else is built.
12. **Engine additions for the log:** OK to add `at`, `cycle`, per-action damage and skill points to the `actionUsed` record, and
    `at`/`cycle` to downed allies? (Internal, but they shape what the log can show.)
