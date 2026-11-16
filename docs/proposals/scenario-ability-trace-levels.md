# Proposal: ability levels and traces per member (K15)

Status: APPROVED by Smitty (K18, 2026-11-13) and BUILT (2026-11-16): option A (K15a) for the buffs of the kits in his comparisons, D (a `levels-not-modelled` warning) elsewhere; levels are in-game totals; a scan without levels falls back to max with an info warning (`levels-scan-missing`). Original draft follows. Labels: **Searched** (file:line or URL), **Computed** (command), **Recalled** (unverified).

## What exists today

- **Scan.** The README lists, per character: `skills {basic, skill, ult, talent}` (plus `elation` on that path), a separate `memosprite {skill, talent}` (Remembrance only), `traces` keyed `ability_1..3` and `stat_1..10` ("ordered by earliest availability"), and `affinitive_eidolons` (Searched: https://github.com/kel-z/HSR-Scanner). The README gives no `ability_version`, though NouSR and Fribbels read it. Value types (number / boolean) and the mapping of `stat_N` to the game's PointS1..S10 are not documented: **Recalled**, check against Smitty's file.
- **Fribbels reads none of it.** Its v4 character type is `id, name, path, level, ascension, eidolon, ability_version` (`vendor/hsr-optimizer/src/lib/importer/kelzFormatParser.tsx:46-54`). NouSR's `ScanCharacter` is narrower still (`src/scenario/types.ts:31-35`). The fixtures have no `skills` or `traces` (Computed: `src/run/fixtures/*.json` character keys are `id,name,path,level,ascension,eidolon`), so they cannot test this.
- **A correction.** The schema says the scan has no field for the Affinitive Eidolon (`schema/scenario.schema.json:222`). The README lists `affinitive_eidolons`. Worth reading it as a default for `affinitive_eidolon` too (separate decision).

## What Fribbels can price

| Input | Supported? |
|---|---|
| Ability level below max | **No.** Multiplier helpers are `ability(n)(eidolon, valueAtBase, valueAtUpgrade)` (`conditionals/conditionalUtils.ts:36-40, 63+`). `valueAtBase` is the max level before eidolon bonuses; the only input is the eidolon. Cyrene: `skill(e, 0.24, 0.264)` (`1400/Cyrene.ts:135`). No form field takes a level. |
| Minor stat traces locked | **Yes, but awkwardly.** `calculateCustomTraces` subtracts nodes listed in `scoringMetadataOverrides[id].traces.deactivated` (`optimization/calculateTraces.ts:4-25`), called by `generateContext` (`context/calculateContext.ts:127`). Node ids are the game's PointIDs, e.g. `1415201` (Computed: `game_data.json` `traceTree`). The store is process-global (`stores/scoring/scoringStore.ts:106-108`), not part of the `Form`. |
| Major traces locked | **No.** Their effects are hard-coded in each character's conditionals file, always on (Fribbels' hint text: "maxed traces", `interactions/hint.tsx:123`). |
| Memosprite ability levels | **No.** `memoSkill`/`memoTalent` helpers have the same two-value shape (`conditionalUtils.ts:94-130`). |

**What matters most (Computed, `src/battle/battle.ts:706-722`):** NouSR does not use Fribbels' ability multipliers. The kit gives the multiple, and the kernel gives only damage per 100% of the scaling stat per hit. So **damage multipliers by level live in the kits, where NouSR can fix them**. What Fribbels cannot do is the *buffs* that scale with ability level inside its conditionals: Cyrene's Zone True DMG, ult CRIT Rate and talent DMG% are examples (Cyrene lv1 Skill is 12%, not 24%: Computed, `AvatarSkillConfig.json` skill 141502).

## Legal values (Computed: `node tools/gamedata/kit-text.mjs 1415`, `AvatarSkillTreeConfig.json`)

- Tree `MaxLevel` per ability: basic 6, skill/ult/talent 10, memosprite skill/talent 6. Eidolons add: basic +1, skill/ult/talent +2, memosprite +1, on kit-specific E3/E5 (Cyrene: E3 ult, talent, memo skill; E5 skill, basic, memo talent). Level `L` always has a row for 1..15 (`AvatarSkillConfig.json`, Computed for 130802 and 141502).
- Traces: 3 major (`PointType 3`, `B1..B3`) and 10 minor (`PointType 1`, `S1..S10`) per character, with a prerequisite chain (`PrePoint`, e.g. Cyrene `1415202` needs `1415201`). Major and minor traces have `DefaultUnlock` unset; ability nodes (type 2) are default-unlocked.

## Proposed JSON

New optional member key `levels`. Absent = `"scan"` (K15 default). With no `account` there is no scan, so absent means `"max"`.

```json
"levels": "scan"
"levels": "max"
"levels": {
  "base": "scan",                      // optional: what unnamed items start from ("scan" | "max")
  "abilities": { "basic": 1, "skill": 1, "ult": 6, "talent": 1,
                 "memo_skill": 1, "memo_talent": 1 },
  "traces": { "major": [true, true, true],           // B1..B3
              "minor": { "locked": [1, 3, 5, 8] } }  // S numbers; or "unlocked": [...]
}
```

Levels are the in-game total, eidolon bonus included. Why: that is what the in-game screen and the scan show. Unknown keys are rejected (S7).

### Validation (all problems reported together, as `ScenarioError` does today)

- Level in `1..(treeMax + eidolon bonus)`, integer. Example error: `team "a", member "cyrene": levels.abilities.skill is 13, but at E0 Cyrene's Skill goes up to 10 (12 at E5)`.
- `memo_*` only for characters with a memosprite; `elation` only on that path.
- Traces: a minor trace unlocked while its prerequisite is locked is an error naming both; major trace flags need exactly 3 entries; `locked` and `unlocked` are exclusive.
- A scan whose levels exceed the eidolon-bound (a stale scan after an eidolon override) is an error under `"scan"`, with a hint to set `eidolon` or `levels: "max"`.
- Scan values absent for a character (the older fixtures): `"scan"` falls back to `"max"` with a warning in the run result.

### Examples

Cyrene 1415 now (my reading of Smitty's scan; verify the exact nodes):
```json
{ "key": "cyrene", "character": "1415", "levels": "scan" }
```
Written out explicitly (which three abilities are at level 1 must come from the scan; basic, skill and talent here are a guess, and the four locked minor traces are the CRIT DMG x3 and HP x1 DESIGN.md names, S numbers a guess):
```json
{ "key": "cyrene", "character": "1415",
  "levels": { "base": "max", "abilities": { "basic": 1, "skill": 1, "talent": 1 },
              "traces": { "minor": { "locked": [7, 8, 9, 10] } } } }
```
Fully built:
```json
{ "key": "cyrene", "character": "1415", "levels": "max" }
```
(`max` = tree max plus the member's eidolon bonus, all 13 traces unlocked, which is today's behaviour.)

## What changes in code

- **Scenario** (`Member`): add `levels` resolved to `{ abilities, majorTraces, minorTraces }`, plus a 6-line schema def.
- **Kernel interface** (`KernelUnit`): `abilityLevels?` and `deactivatedTraces?: string[]` (PointIDs).
- **Fribbels adapter**: set the minor-trace override around each call and restore it afterwards (the store is global, so concurrent use would be unsafe; Recalled that NouSR is single-threaded). It must also set this for teammates' stats only if a teammate's stat feeds a buff.
- **Kits**: replace `acheronScalings(eidolon)`-style functions with a table by ability level from `AvatarSkillConfig` (generated, not typed). Trace-gated behaviour: Acheron's Red Oni, The Abyss, Thunder Core (`acheron.ts:258-263, 242-252`); Tribbie's Lamb, Glass Ball and Pebble traces (`tribbie.ts:14-20`). Each kit gets a `majorTraces` check on those. Today all three are unconditional.
- Unknown: the ability-level-dependent *buffs* (below).

## What is impossible or expensive

1. **Ability-level buffs inside Fribbels.** For Cyrene this is the Zone True DMG, ult CRIT Rate and talent DMG%, and for most supports it is every numeric buff. Options:
   - **(A) Kit applies the buff itself** through NouSR modifiers, and suppresses Fribbels' copy. Exact; large kit work per character; touches what the sim models.
   - **(B) Fork or patch the submodule** so the helpers take a level. Exact and broad, but breaks the pinned `31644d9` and every Fribbels update, and the MIT patch has to be maintained.
   - **(C) Ratio scaling in the adapter** (level value over max value, applied to a buff's output). Cheap, only right for buffs linear in the final damage, wrong for stats feeding other formulas.
   - **(D) Refuse** a below-max ability level on characters whose buffs depend on it, with an explicit error. Honest and cheap, but Cyrene's own case would be refused.
   Recommendation to discuss: (A) for Cyrene (the actual need), (D) elsewhere until needed.
2. **Major traces locked** are kit-side only (see above). Fribbels cannot be told, so a trace that is a pure stat/DMG buff in Fribbels' file would still be on. Needs a per-character check.
3. **Memosprite levels** are Fribbels-opaque too; same options.
4. **Process-global trace store** is a hazard, not a blocker.

## Open questions

1. Levels as in-game totals (proposed) or base level plus eidolon bonus separately?
2. Option (A), (B), (C) or (D) for Fribbels-internal level buffs?
3. Should `"scan"` with a missing field be a hard error instead of a warning?
