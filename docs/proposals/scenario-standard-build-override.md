# Proposal: overriding a standard member's build in a scenario

Status: DRAFT for Smitty's review. Nothing here is applied. `schema/scenario.schema.json`, `src/` and DESIGN.md are untouched.
Related: DESIGN.md K14 (standard build), K14b (per-character files, main-stat switch), S3 (relics per member),
`schema/standard-build.schema.json`, `data/standard-builds/*.json`.

## The problem

K14b says a scenario can switch a standard member's main stats, for example a CRIT Rate body or a CRIT DMG body. Today a member
says `"relics": "standard"` and nothing more. Switching a main stat has a catch the per-character files make visible:
**the cap depends on the main stats**. A stat's distributed rolls are limited to 2 per relic whose main stat is not that stat.
Acheron's file has 12 CRIT DMG and 10 CRIT Rate rolls, legal with a CRIT Rate body (CRIT Rate cap 10, CRIT DMG cap 12). Swap the
body to CRIT DMG and the CRIT DMG cap becomes 10, so that split is illegal. A main-stat switch therefore cannot be a bare
"change the body" with the old split kept.

## Recommended shape

Add one optional key to a scenario member, `standard_build`, allowed only when the member's relics resolve to `"standard"`
(explicitly, or by default because the scenario has no `account`).

```json
{
  "key": "acheron",
  "character": "1308",
  "eidolon": 0,
  "light_cone": { "id": "23024", "superimposition": 1 },
  "relics": "standard",
  "standard_build": {
    "notes": "CRIT DMG body, to compare with the shipped CRIT Rate body.",
    "main_stats": { "Body": "CRIT DMG" },
    "distributed": { "rolls": { "SPD": 2, "CRIT DMG": 10, "CRIT Rate": 12 } }
  }
}
```

- `main_stats`: any non-empty subset of `Body`, `Feet`, `Planar Sphere`, `Link Rope`, same enums as the standard-build schema.
  Slots left out keep the file's value.
- `distributed`: optional, same shape as the standard-build file's `distributed` (`rolls`, `notes`). When present it **replaces the
  file's split whole** (no merging stat by stat, so what a reader sees is what runs). When absent the file's split is used.
- `notes`: free text, like every other level.
- Unknown keys are rejected (S7). Fragment for the scenario schema: a `standard_build` `$def` with `additionalProperties: false`,
  `minProperties: 1`, reusing the enums of `standard-build.schema.json` (best by moving them into that schema's `$defs` and
  `$ref`-ing them, so the two files cannot drift).

### Resolution order (what the loader does)

1. Find the file by `(character, ability_version)`. No file for the character: error (a member on `"standard"` already needs one).
2. Start from the file's sets, main stats and split.
3. Apply `standard_build.main_stats` slot by slot.
4. If `standard_build.distributed` is present, replace the split with it.
5. Check the rules from the standard-build schema's description against the **resulting** build: total exactly 24, and per-stat
   cap from the resulting main stats. A failure is an error, naming the stat, its rolls and its cap. Never a silent re-split.
6. The resolved build (sets, four main stats, the 12 totals) is written into the run's results, so a comparison shows what ran.

Two teams in one scenario that differ only in one member's `standard_build` give a CRIT Rate vs CRIT DMG comparison on one scale (S1).

## Two examples (Acheron)

Example 1, no override, the shipped file: CRIT Rate body, SPD 2, CRIT DMG 12, CRIT Rate 10.

```json
{ "key": "acheron", "character": "1308", "eidolon": 0, "light_cone": { "id": "23024", "superimposition": 1 }, "relics": "standard" }
```

Example 2, CRIT DMG body. With only `"main_stats": { "Body": "CRIT DMG" }` the file's CRIT DMG 12 breaks the cap of 10 and the
scenario is **rejected** with a message saying so. A legal one needs `distributed`:

```json
{
  "key": "acheron", "character": "1308", "eidolon": 0,
  "light_cone": { "id": "23024", "superimposition": 1 },
  "relics": "standard",
  "standard_build": {
    "main_stats": { "Body": "CRIT DMG" },
    "distributed": { "rolls": { "SPD": 2, "CRIT DMG": 10, "CRIT Rate": 12 } }
  }
}
```

What the two do to the numbers (Computed with a throwaway arithmetic script, 2026-11-13: base 5% CRIT Rate and 50% CRIT DMG,
Acheron's +24% CRIT DMG trace, Pioneer Diver 4-piece +4% CRIT Rate and +8% CRIT DMG, Izumo +12% CRIT Rate, the 2 fixed rolls
at 2.916% and 5.832%; no light cone, no other buffs):

| Build | CRIT Rate | CRIT DMG |
|---|---|---|
| Example 1 (CRIT Rate body, 10 CR + 12 CD rolls) | 88.4% | 163.6% |
| Example 2 (CRIT DMG body, 12 CR + 10 CD rolls) | 61.8% | 216.8% |
| CRIT DMG body keeping the file's split (rejected) | 56.0% | 228.4% |

Neither example has any distributed ATK% (2 + 10 + 12 = 24). The throwaway damage proxy used to draft the files (scale stat
x (1 + CR x CD), not Fribbels and not the kernel) puts the CRIT Rate body about 4% ahead for Acheron, and its own best CRIT DMG
split was SPD 2, CRIT DMG 6, CRIT Rate 12, ATK% 4, which the loader would also accept. Real numbers need the kernel.

## Options and what each does to results

| Option | Lets a scenario change | What it does to results | Cost |
|---|---|---|---|
| A. `main_stats` only | main stats | Totals move with the main stat, but the file's split must still obey the new cap, so many swaps (any CRIT Rate to CRIT DMG body, or a SPD boots swap) are rejected | Smallest; rejects the very comparison K14b names |
| **B. `main_stats` + `distributed` (recommended)** | main stats and the split | Both examples above work. The author owns the split, so a comparison is only as fair as the splits chosen; each is written in the scenario and echoed in results | Small. Needs the cap check at load |
| C. B + sets (`relic_sets`, `ornament_set`) | also the sets | Changes set effects: needs the set's module and conditionals (`setConditionals`, `teamRelicSet`) to exist in `src/equipment`; sets without a module are rejected today | Large and not asked for in K14b. Leave for later |
| D. Named variants inside the per-character file | pick `"variant": "cd_body"` | Smitty reviews every variant once, in the file; scenarios stay short and comparable across people | Files grow; a split nobody pre-wrote cannot be tried. Can be added later on top of B |
| E. Loader re-splits automatically after a main-stat change | main stats | Hidden choices in the loader (which stat absorbs the excess, in what order) become results nobody reviewed | Not recommended: conflicts with K14's "no search" |

Recommendation: B now, D later if the same overrides keep being typed. Not C for v1.

### What B rejects

- `standard_build` on a member whose `relics` is `"equipped"` or a list (there is no standard build to change).
- A slot key outside `Body`, `Feet`, `Planar Sphere`, `Link Rope` (`Head` and `Hands` are fixed), or a stat not allowed in that slot
  (for example `Feet: "CRIT Rate"`).
- `distributed.rolls` with an unknown substat, a negative or non-integer count, or a total other than 24.
- A stat over its cap from the resulting main stats (schema description rule (b)).
- An empty `standard_build` (`{}`) or an empty `main_stats`.
- Any unknown key, and a character with no standard-build file for its ability version.

## Not covered, deliberately

- Changing the 24 fixed rolls or the average roll value: global rules (K14), not per-member.
- Level or rarity of the relics: fixed by the standard build (5-star, +15, as Fribbels' stat simulation builds them).

## What `BenchmarkBuild` needs (not changed here)

`src/kernel/types.ts` documents `BenchmarkBuild` as "max-value substat rolls per stat". The adapter passes `substatRolls` straight
to Fribbels' stat simulation (`src/kernel/fribbels/fribbelsKernel.ts:208-222`), which turns counts into values in
`convertRollCountsToSubstatTotal` (`vendor/hsr-optimizer/src/lib/simulations/statSimulation.ts:149-160`):

- non-SPD stats: `StatCalculator.getMaxedSubstatValue(stat, quality)` (`src/lib/relics/statCalculator.ts:34-42`): quality 1 gives the
  5-star **high** value, 0.9 the **mid**, 0.8 the **low**;
- SPD: `params.speedRollValue`.

The defaults are `quality: 1` and `speedRollValue: 2.6` (`statSimulation.ts:34-36`), i.e. every roll at its maximum. K14 wants the
average. For a 5-star substat the three values are evenly spaced, so the average is the mid value: quality 0.9, and
`speedRollValue: 2.3` for SPD. `runStatSimulations` already accepts these as its `inputParams` argument, but
`simulateBenchmark` calls it without any (`fribbelsKernel.ts:221`). So the change is:

1. `simulateBenchmark` passes `{ quality, speedRollValue }` through. Either new optional fields on `BenchmarkBuild`
   (`rollQuality?: 0.8 | 0.9 | 1`, `speedRollValue?: number`, defaulting to today's 1 and 2.6 so existing tests keep their numbers),
   or a second type for the standard build. Adding fields is a public-interface change, so Smitty's call.
2. `substatRolls` carries fixed plus distributed counts: for every one of the 12 types, `2 + distributed` (types with no distributed
   rolls still carry 2). Today's tests pass only three stats at 10 rolls each.
3. A loader from `StandardBuild` (the file after overrides) to `BenchmarkBuild`: `relic_sets.four_piece` becomes `relicSet1` and
   `relicSet2` both the same name (two 2-piece sets become the two names), `ornament_set.name` becomes `ornamentSet`, `main_stats`
   map slot to field, and set names are Fribbels' strings, which the files already use.
4. Unchanged: Head HP 705.6 and Hands ATK 352.8 and the 5-star +15 main-stat values are already what Fribbels' stat simulation builds
   (`statSimulation.ts:109-130`).
5. Check before relying on it: `substatRollsModifier` defaults to the identity (`statSimulation.ts:38`), so no diminishing-returns
   penalty applies on this path; Fribbels' benchmark orchestrator applies one on its own, but NouSR does not call it.
