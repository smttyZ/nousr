# Proposal: overriding a standard member's build in a scenario

Status: APPROVED by Smitty 2026-11-13 (DESIGN.md K18) and BUILT (`member.standard_build` in `schema/scenario.schema.json`, resolved in `src/scenario/load.ts`); K32 later added SPD re-solving at load. Written as a draft, so the next line and the text below describe the state before it was built.
`schema/scenario.schema.json`, `src/` and DESIGN.md are untouched.
Related: DESIGN.md K14 (standard build), K14b (per-character files, main-stat switch), K14c (this rule), K14e (SPD target),
S3 (relics per member), `schema/standard-build.schema.json`, `data/standard-builds/*.json`.

## The problem

K14b says a scenario can switch a standard member's main stats, for example a CRIT Rate body or a CRIT DMG body. Today a member
says `"relics": "standard"` and nothing more. Switching a main stat has a catch the per-character files make visible:
**the cap depends on the main stats**. A stat's distributed rolls are limited to 2 per relic whose main stat is not that stat.
Acheron's file has 12 CRIT DMG and 10 CRIT Rate rolls, legal with a CRIT Rate body (CRIT Rate cap 10, CRIT DMG cap 12). Swap the
body to CRIT DMG and the CRIT DMG cap becomes 10, so keeping that split is illegal. K14c settles this: a bare swap is re-split
automatically by one published rule, and every file carries what the rule needs.

## The decided rule (K14c)

A scenario member on `"relics": "standard"` may carry `standard_build`:

```json
{
  "key": "acheron",
  "character": "1308",
  "eidolon": 0,
  "light_cone": { "id": "23024", "superimposition": 1 },
  "relics": "standard",
  "standard_build": {
    "notes": "CRIT DMG body, to compare with the shipped CRIT Rate body.",
    "main_stats": { "Body": "CRIT DMG" }
  }
}
```

- `main_stats`: any non-empty subset of `Body`, `Feet`, `Planar Sphere`, `Link Rope`, with the same enums as the standard-build schema.
  Slots left out keep the file's value.
- `distributed`: optional, same shape as the standard-build file's `distributed` (`rolls`, `notes`; `priority` is not needed and ignored).
  When present it **replaces the file's split whole** (no merging stat by stat) and no re-split happens.
- `notes`: free text. Unknown keys are rejected (S7). Sets are not overridable in v1.

### Resolution order (what the loader does)

1. Find the file by `(character, ability_version)`. No file: error.
2. Start from the file's sets, main stats and split.
3. Apply `standard_build.main_stats` slot by slot.
4. If `standard_build.distributed` is present, use it as the split and go to 6.
5. Otherwise re-split with the published rule below. Starting from the file's `distributed.rolls`, go once down
   `distributed.priority` (most wanted first; SPD is never in it). For each stat whose rolls exceed its cap under the new main
   stats: take the excess off it and give it to the first stat lower in the list that still has room (cap minus rolls), filling
   each in turn. A stat not in the list never receives rolls. If rolls are left over after the last stat, the scenario is an
   **error** naming the stat. SPD is not touched by this rule.
6. Check the result: total exactly 24; every stat within its cap from the resulting main stats (SPD under the K14e rule in the
   schema description: SPD may pass its cap only as far as the file's `spd_target` needs, never past the physical limit of 6 rolls
   per relic). An explicit `distributed` that fails is an **error** naming the stat, its rolls and its cap, never silently fixed.
7. The run result echoes the split it used: sets, the four main stats, the 12 totals (fixed 2 plus distributed), which path produced
   them (`file`, `re-split` with the list of moves such as `2 CRIT DMG -> CRIT Rate`, or `explicit`), and the out-of-combat SPD
   against `spd_target`.

Two teams in one scenario that differ only in one member's `standard_build` give a CRIT Rate vs CRIT DMG comparison on one scale (S1).

### Why the priority order is in each file

The rule has to know where displaced rolls should go, and only the character's file knows. In the shipped files the order is the
file's own split in descending roll count (ties in Fribbels' substat list order), then Fribbels-listed stats with 0 rolls. Every
file's `distributed.notes` says where that order is a guess.

## Worked example: Acheron, CRIT DMG body

File (`data/standard-builds/1308.json`): Body CRIT Rate, split `SPD 2, CRIT DMG 12, CRIT Rate 10`, priority
`CRIT DMG, CRIT Rate, ATK%, ATK`, SPD target 133.34 (2 rolls reach 135.232).

New main stats: Head HP, Hands ATK, Body CRIT DMG, Feet SPD, Sphere Lightning DMG, Rope ATK%. Caps are 2 x (6 - relics with that main stat):

| Stat | Old cap (CRIT Rate body) | New cap (CRIT DMG body) | Old rolls |
|---|---|---|---|
| CRIT DMG | 12 | 10 | 12 |
| CRIT Rate | 10 | 12 | 10 |
| SPD | 10 (target needs 2) | 10 (target needs 2) | 2 |

Walk down the priority list:

1. CRIT DMG has 12, cap 10: excess 2. The next stat is CRIT Rate, which has 10 of 12, room 2. Move 2. CRIT DMG 10, CRIT Rate 12.
2. CRIT Rate has 12, cap 12: no excess.
3. ATK%, ATK: 0 rolls, nothing to do.

Result: `SPD 2, CRIT DMG 10, CRIT Rate 12`, total 24. The run result echoes `re-split: 2 CRIT DMG -> CRIT Rate`.
(Computed with `scratchpad/validate.mjs`, function `resplit`, 2026-11-13.) This equals the split the earlier draft of this
proposal wrote by hand as "Example 2", so the rule reproduces it with no `distributed` typed.

What it does to the numbers (Computed with a throwaway arithmetic script earlier on 2026-11-13: base 5% CRIT Rate and 50% CRIT DMG,
Acheron's +24% CRIT DMG trace, Pioneer Diver 4-piece +4% CRIT Rate and +8% CRIT DMG, Izumo +12% CRIT Rate, the 2 fixed rolls at
2.916% and 5.832%; no light cone, no other buffs):

| Build | CRIT Rate | CRIT DMG |
|---|---|---|
| Shipped file (CRIT Rate body, 10 CR + 12 CD rolls) | 88.4% | 163.6% |
| CRIT DMG body, rule's split (12 CR + 10 CD rolls) | 61.8% | 216.8% |
| CRIT DMG body keeping the file's split (illegal, rejected) | 56.0% | 228.4% |

The rule is a legality repair, not an optimizer: the throwaway damage proxy used to draft the files had its own best CRIT DMG split
as `SPD 2, CRIT DMG 6, CRIT Rate 12, ATK% 4`, which is also legal. A scenario that wants it writes it as an explicit `distributed`.

### What the explicit `distributed` looks like

```json
"standard_build": {
  "main_stats": { "Body": "CRIT DMG" },
  "distributed": { "rolls": { "SPD": 2, "CRIT DMG": 6, "CRIT Rate": 12, "ATK%": 4 } }
}
```

## What is rejected

- `standard_build` on a member whose `relics` is `"equipped"` or a list (there is no standard build to change).
- A slot key outside `Body`, `Feet`, `Planar Sphere`, `Link Rope` (`Head` and `Hands` are fixed), or a stat not allowed in that slot
  (for example `Feet: "CRIT Rate"`).
- `distributed.rolls` with an unknown substat, a negative or non-integer count, or a total other than 24.
- An explicit split with a stat over its cap from the resulting main stats.
- A re-split that cannot place all displaced rolls (every stat below the overflowing one is full or not in the priority list).
- An empty `standard_build` (`{}`) or an empty `main_stats`.
- Any unknown key, and a character with no standard-build file for its ability version.

## Open points for Smitty

1. **A swap that changes the SPD main stat.** The re-split rule does not touch SPD. Swapping Feet from SPD to ATK% leaves the file's SPD
   rolls in place while the 25.032 from the boots is gone, so the SPD target is badly missed (Acheron would fall from 135.2 to 110.2),
   and the other direction (HP% or ATK% boots to SPD boots) leaves SPD rolls that were sized for a build without boots. Options:
   (a) the run result only reports out-of-combat SPD against the target and says it was missed (recommended: no hidden choice, and
   the comparison "what do SPD boots buy" stays honest); (b) re-solve SPD rolls for the target and move the difference to or from the
   lowest-priority stat (hidden choice, but keeps the target); (c) make a Feet swap an error unless `distributed` is given.
2. **Two caps, one limit.** The physical limit is 6 rolls of one stat per relic (Fribbels uses 36 total for six pieces,
   `simScoringUtils.ts:204-213`); at this build's average of 8 rolls per piece it is 5. No file is near either (the highest is Cyrene
   with 20 total SPD rolls against 30 or 25), so which one the loader uses does not change any shipped result.
3. **Where the loader gets SPD.** Enforcing "only as far as the target needs" needs the character's base SPD, trace SPD and the
   SPD% of the sets, which live in game data and kits, not in the standard-build file. Either the loader derives them (the same
   arithmetic as each file's notes), or the file stores its own base figure. This is a schema choice and not made here.

## Not covered, deliberately

- Changing the 24 fixed rolls or the average roll value: global rules (K14), not per-member.
- Level or rarity of the relics: fixed by the standard build (5-star, +15, as Fribbels' stat simulation builds them).
- Changing sets (`relic_sets`, `ornament_set`): needs the set's module and conditionals in `src/equipment`; sets without one are rejected
  today. Left for later (K14c: not overridable in v1).

## What `BenchmarkBuild` needs (not changed here)

`src/kernel/types.ts` documents `BenchmarkBuild` as "max-value substat rolls per stat". The adapter passes `substatRolls` straight
to Fribbels' stat simulation (`src/kernel/fribbels/fribbelsKernel.ts:208-222`), which turns counts into values in
`convertRollCountsToSubstatTotal` (`vendor/hsr-optimizer/src/lib/simulations/statSimulation.ts:149-160`):

- non-SPD stats: `StatCalculator.getMaxedSubstatValue(stat, quality)` (`src/lib/relics/statCalculator.ts:34-42`): quality 1 gives the
  5-star **high** value, 0.9 the **mid**, 0.8 the **low**;
- SPD: `params.speedRollValue`.

The defaults are `quality: 1` and `speedRollValue: 2.6` (`statSimulation.ts:34-36`), i.e. every roll at its maximum. K14d sets the
average: quality 0.9, and `speedRollValue: 2.3` for SPD, as optional `BenchmarkBuild` fields defaulting to today's values.
`simulateBenchmark` calls `runStatSimulations` without any inputParams today (`fribbelsKernel.ts:221`); K14d's change is to pass them.

1. `substatRolls` carries fixed plus distributed counts: for every one of the 12 types, `2 + distributed` (types with no distributed
   rolls still carry 2). SPD rolls above the KQMS cap (Cyrene 20, Hyacine 17) are ordinary counts for Fribbels' stat simulation.
2. A loader from `StandardBuild` (the file after overrides) to `BenchmarkBuild`: `relic_sets.four_piece` becomes `relicSet1` and
   `relicSet2` both the same name (two 2-piece sets become the two names), `ornament_set.name` becomes `ornamentSet`, `main_stats`
   map slot to field, and set names are Fribbels' strings, which the files already use.
3. Unchanged: Head HP 705.6 and Hands ATK 352.8 and the 5-star +15 main-stat values are already what Fribbels' stat simulation builds
   (`statSimulation.ts:109-130`).
4. Check before relying on it: `substatRollsModifier` defaults to the identity (`statSimulation.ts:38`), so no diminishing-returns
   penalty applies on this path; Fribbels' benchmark orchestrator applies one on its own, but NouSR does not call it.
