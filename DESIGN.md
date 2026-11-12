# NouSR — design

Status: build order steps 1–5 built (setup, timeline engine, damage kernel adapter, scenario format, generic
enemy with the HP and aggro pipeline).
Pinned target: Honkai: Star Rail 4.7.

NouSR (`nousr`) is a deterministic, action-value timeline simulator for Honkai: Star Rail teams.
It answers questions a per-action damage calculator can't: what a team does over N cycles of
real game time, including SPD, action advance, energy and stack timing, so that teams with
different DPS units land on one shared scale.

## Architecture

```
scenario.json + account.json (HSR-Scanner v4)
        │
        ▼
 ┌──────────────┐   events    ┌───────────────────┐
 │ AV scheduler │ ──────────► │ kit modules       │  one per character / light cone / relic set
 │ (gauge/SPD)  │ ◄────────── │ (timing behaviour)│  — advances, energy, stacks, summons
 └──────────────┘  modifiers  └───────────────────┘
        │ each damaging action, with the live buff state
        ▼
 ┌────────────────────────────┐
 │ damage kernel: Fribbels    │  pinned git submodule, MIT
 │ hsr-optimizer conditionals │  (per-action damage with buffs on/off)
 └────────────────────────────┘
        │
        ▼
 per-cycle damage totals, action log, graphs
```

- **Scheduler.** Each unit has an action gauge of 10,000; time to act = gauge ÷ SPD. Action advance
  and delay edit the gauge. The idea follows srsim's turn manager; no srsim code is used (srsim has no license).
- **Event bus.** Turn start/end, attack, Ultimate, follow-up, debuff applied, SP spent, HP lost,
  energy gained. Kits subscribe to events and register timed modifiers.
- **Damage kernel.** Fribbels' optimizer already implements the damage formulas, including the 4.7
  Affinitive Eidolons. NouSR handles timing and state, then asks the kernel for each action's damage.
  When Fribbels updates for a new patch, new damage math comes with it, so NouSR's upkeep stays limited
  to timing behaviour.
- **Language.** TypeScript, so the kernel can be imported directly.

## Decisions (Smitty, 2026-11-10)

| # | Topic | Decision |
|---|---|---|
| 1 | Enemy count | All three scenarios: 1, 3 and 5 targets, reported separately (as Prydwen does) |
| 2 | Time window | Memory of Chaos cycles: 150 AV first cycle, 100 AV after. Other modes on the roadmap |
| 4b | MoC period rules | Current period (Survival of the Fittest) for v1, implemented as a swappable **period module**, never hard-coded |
| 3 | Crits | Expected value |
| 4 | Randomness | None. Expected-value engine: random choices (enemy targeting by aggro, bounce targets) are split fractionally by weight. Debuffs always land; EHR stays a full stat (it feeds EHR→ATK conversions and thresholds) but there is no hit roll |
| 5 | Action policy | Per-team priority scripts |
| 6 | Starting state | MoC defaults, confirmed in-game 2026-11-10: 50% energy, 3 SP, techniques on |
| 7 | Enemy behaviour | MoC behaviour, with enough basic logic (taking turns, attacking, applying debuffs/burn) for effects like Trend of the Universal Market to work |
| 8 | Survival | Modelled: HP, healing, shields and HP loss matter (Castorice). Incoming damage = enemy ATK × multiplier through the standard formula vs ally DEF, no crits. A downed ally fails the MoC "no downed characters" objective and is removed from the turn order |
| 7b | Enemies (v1) | One generic MoC-level enemy profile, in a JSON schema that real bosses can use later (roadmap) |
| 9 | Inputs | Standard JSON. Builds use the HSR-Scanner v4 format (also what Fribbels imports); scenarios use a NouSR JSON |

## Inputs

**Account / builds — HSR-Scanner v4** (`source`, `build`, `version: 4`, `metadata`, `light_cones[]`,
`relics[]`, `characters[]`). Relics carry `set_id`, `slot`, `mainstat`, `substats[{key,value}]` and `location`
(equipped character ID). This is the de facto format: Fribbels imports it, and the output is loosely based
on Genshin's GOOD format. A **standard-relics mode** reuses Fribbels' benchmark builds when no scan is given.

**Scenario — NouSR JSON, version 1.** The format is defined by `schema/scenario.schema.json` (JSON Schema
2020-12) and enforced from that file with Ajv, so the published schema and the loader cannot disagree.
`examples/` holds a worked scenario.

### Scenario format decisions (Smitty, 2026-11-11)

| # | Topic | Decision |
|---|---|---|
| S1 | Teams per file | Many teams under one shared `battle` and `enemies` block, so teams in a file are always compared under the same conditions |
| S2 | Buffed (Nova Flare) kits | `character` is the game id (`"1006"`) plus `ability_version` (0 = original, 1 = buffed), the scanner's own field. The kernel adapter maps this to Fribbels' `1006b1` ids |
| S3 | Relics per member | `"equipped"` (from the scan), `"standard"` (Fribbels' benchmark build), or an explicit list of scan `_uid`s or v4 relic objects |
| S4 | Action policy | An ordered rule list per team; the first rule that applies is taken. Conditions are structured (`what` with `min` / `max` / `is`). A turn where no rule applies is an error, never a silent basic attack |
| S5 | Enemy weaknesses | `"all"` by default (every team hits a weakness); an explicit element list models a specific stage |
| S6 | Do enemies die | No. A fixed window of `cycles`; enemies are damage sponges and the result is damage per cycle. Enemy HP in a profile is not used in v1 |
| S7 | Strictness | Unknown keys are rejected. Every level has a free-text `notes` field the simulator ignores |
| S8 | Identity | `format: "nousr-scenario"`, integer `version`, `game_version`. The schema `$id` is a placeholder URN until a publication address is chosen |
| S9 | Multi-target damage | Fribbels computes an action against the primary target only. Each kit action declares its parts as single / blast / AoE / bounce with their scaling; NouSR asks the kernel per part and multiplies by the enemies hit |

Consequence of S6 to keep in mind: effects that trigger on a kill, overkill, and wave changes are not modelled.

## Known approximations (documented on purpose)

- **Threshold effects on expected values.** "Energy full → Ult", stack thresholds and similar are evaluated on
  expected-value state. The average over real fights can differ (a threshold on an average is not the average
  of thresholds). If in-game results disagree, fix the model and log it here.
- **Debuffs always land.** Effect Hit Rate keeps its stat value but never fails a roll.

## Open questions

Timeline rules the sources do not settle. Each is implemented one way in `src/engine/timeline.ts` (see the
header comment there) and is a one-line change. Not yet confirmed by Smitty.

- **A turn exactly on a cycle boundary** counts in the cycle that is ending. Game8's breakpoint chart and
  stephenli.ca need this; a Reddit breakpoint post listing 120.1 / 160.1 / 200.1 implies the opposite.
- **Equal action value.** A unit advanced to 0 goes first, the most recently advanced first (KQM speed
  guide); otherwise party order. Ally-versus-enemy ties have no source.
- **Gauge refill timing.** The gauge refills after turn start and before the action, so an advance at turn
  start is wasted and one during the action shortens the next turn.
- **Self-applied turn-end buffs** do not count the turn they were applied in, unless the kit says otherwise.
- **Scan precision.** Fribbels treats HSR-Scanner SPD as unverified and Reliquary Archiver SPD as verified.
  Both write the v4 shape and both are accepted; SPD decimals decide breakpoints.

HP and enemy-turn rules implemented from memory, without a source (`src/battle/party.ts` and
`src/battle/enemies.ts` header comments). Also not yet confirmed by Smitty:

- **Several shields do not add up.** A hit is absorbed up to the largest shield and every shield loses the
  hit's amount.
- **HP a unit spends on its own abilities** stops at 1 HP and ignores shields.
- **Energy from being hit** is scaled by Energy Regeneration Rate.
- **Copies of one enemy profile start their attack loops together,** so with 3 enemies all three use the AoE
  on the same turn.
- **Raising max HP** leaves current HP where it was; lowering it below current HP pulls HP down.

## Period modules

A MoC period (Memory Turbulence) is a module with the same hook interface as a kit: it subscribes to events
(cycle start, Ult used, SP spent …) and registers modifiers. A scenario selects one by ID
(`"period": "moc-2026-11-survival-of-the-fittest"`). Swapping periods means adding a file and changing one field.

## Enemy profiles

JSON, modelled on hsr-simulator's format: level, HP, ATK, DEF, SPD, toughness, RES per element, and an
attack list (multiplier × ATK, target type single/blast/bounce, debuffs, energy given, priority).
v1 ships one generic MoC-level profile. Real stage bosses (summons, phases) are roadmap items that reuse
the same schema plus a behaviour module where needed. Enemy stats source: the Dimbreath datamine used by Fribbels.

### Step 5 decisions (Smitty, 2026-11-12)

| # | Topic | Decision |
|---|---|---|
| E1 | Generic enemy SPD | 158.4, the median floor 12 elite and boss over the last 8 Memory of Chaos periods |
| E2 | Generic enemy attacks | A repeating loop: single-target 250% ATK, single-target 250% ATK, AoE 300% ATK. Each gives 10 energy to an ally it hits |
| E3 | Several enemies | Every enemy is a full copy with its own turns and attacks, so the 3- and 5-enemy runs take more hits and gain more energy |

The profile is `data/enemies/generic-moc.json`; its format is `schema/enemy-profile.schema.json`
(version 1, approved by Smitty 2026-11-12). The profile orders attacks with a `pattern` list where
hsr-simulator uses a `priority` number, because E2 needs a fixed order.

What the prior work does here (read 2026-11-12):

- **srsim** (approach only, no code used): one "dummy" enemy on the game's base stats (ATK 18, DEF 210,
  SPD 100 before level scaling, which is 132 at level 86+). Its attack is a scenario setting: none by default,
  or one of single / blast / bounce / AoE with a damage percent, hit count and energy, repeated every turn.
- **hsr-simulator** (MIT): enemy JSON with an attack list. Each turn the enemy uses its highest-priority usable
  attack; `requires_buff` allows charge sequences; elites can act twice per turn. Targets are drawn at random
  by aggro. Its shipped enemies are test dummies.
- **Fribbels:** no enemy turns. **Prydwen:** its calculation rules could not be retrieved.

Neither simulator models a typical Memory of Chaos enemy, so E1 and E2 rest on the game data below.

From the game data (`DimbreathBot/TurnBasedGameData` at `fe15a954eb`, tagged 4.7.0; an enemy stat is
template base × per-enemy ratio × elite-group ratio × level ratio). Re-run with
`node tools/gamedata/fetch.mjs fe15a954eb` then `node tools/gamedata/moc-enemies.mjs`:

- Floor 12 stages are level 95. Every floor 12 enemy in the current period, the two before it and the next
  one has ATK 625.5 (base 18 × 34.75065) and DEF 1150. Older periods had a higher elite-group ratio: 656.8
  (Duty Action, Academy Ghost Story) and 688.1 (the three before those).
- Floor 12 SPD over the 9 newest periods in the data (Breached Nest through the upcoming Echo of Darkness):
  elites 132 ×7, 145 ×1, 158 ×14, 174 ×7, 190 ×8, 227 ×1; bosses mostly 158, up to 264. Median 158.4 for both.
  E1 was decided on the 8 periods up to the current one, where the median is the same. The current period is
  fast (bosses 238 and 264).
- Energy given to a target: 10 for most single-target, blast and sweep skills; 10 to 20 for AoE; 5 per
  bounce hit.
- First skill parameter, read as the ATK multiplier (an inference, the descriptions give no numbers):
  single-target mostly 2.5 to 3.5, AoE mostly 2.5 to 3.5 with "massive" ones at 5, blast about 2.5 main and
  1.8 to 2 adjacent.
- Base aggro matches the guides below; Elation is 4. Memosprites: Netherwing, Little Ica, Demiurge, Summer
  Songbirds and Mem are 4; Garmentmaker and Evey are 5.

Earlier findings these build on:

- **Base aggro:** Hunt / Erudition 3; Harmony / Nihility / Abundance / Remembrance 4; Destruction 5;
  Preservation 6. Aggro = base × (1 + modifier); chance to be hit = own aggro ÷ team total. Each memosprite
  has its own base aggro. ([HoYoLAB 3.0 mechanics guide](https://www.hoyolab.com/article/36700608),
  [KQM beginner guide](https://hsr.keqingmains.com/misc/beginner-guide))
- **Damage taken:** DEF multiplier = 1 − DEF ÷ (DEF + 200 + 10 × attacker level).
  ([Prydwen damage formula](https://www.prydwen.gg/star-rail/guides/damage-formula))
- **Enemy level:** 95, Fribbels' default (`vendor/hsr-optimizer/src/lib/optimization/defaultForm.ts`).
  Enemy DEF = 200 + 10 × level (HoYoLAB guide above).
- **Enemy SPD tiers:** 110 basic, 132 most elites and bosses, 158 many, 190 some.
  ([HoYoLAB](https://www.hoyolab.com/article/33674443), written for level 90)
- **Profile format reference:** hsr-simulator's `data/enemies/*.json`: level, HP, ATK, DEF, SPD, toughness,
  RES per element, and attacks with multiplier, target type (single / blast / bounce), hits, priority,
  debuffs, energy given. Its two files are test dummies, not real stage numbers.

For step 7, the current period's rule text (Game8, read 2026-11-11): an ally gains 5 Punchlines on using
their Ultimate; at the start of each cycle Aha takes an extra turn counted at a fixed 20 Punchlines, which
does not consume Punchlines. Runs 2026-11-02 to 2026-12-14.

## Step 6 notes (2026-11-12, nothing built yet)

**Kit text source.** `node tools/gamedata/kit-text.mjs <characterId>` prints a character's in-game English
text from the 4.7.0 game data: abilities with their numbers at the relevant levels, traces, eidolons and the
Affinitive Eidolon. This is the text kits are transcribed from. Game text is not committed to this repo.

**Acheron (1308), read from that output:**

- Basic ATK: 100% ATK single (110% at E3), +1 skill point. She has no energy; the Ultimate needs 9 Slashed Dream.
- Skill: −1 skill point, +1 Slashed Dream, 1 Crimson Knot on the target, 160% main and 60% adjacent.
- Ultimate: 3 Rainblades (24% single each; each removes up to 3 Crimson Knots from the target and then deals
  15% to all enemies, plus 15% per knot removed, up to 60%), then Stygian Resurge (120% to all enemies, removes
  all knots). During it, all enemies have −20% all-type RES.
- Talent: when any unit inflicts a debuff during an ability, +1 Slashed Dream and 1 Crimson Knot, once per
  ability use. With several debuffed targets the knot goes to the enemy with the most knots.
- Technique: 200% ATK to all enemies at the start of each wave. Quadrivalent Ascendance: after the Ultimate,
  +1 Slashed Dream and 1 Crimson Knot on a random enemy.
- Traces: Red Oni (starts with 5 Slashed Dream and 5 Crimson Knots on a random enemy; overflow becomes
  Quadrivalent Ascendance, up to 3). The Abyss (1 or 2 other Nihility allies: Basic, Skill and Ultimate DMG ×1.15
  or ×1.60). Thunder Core (+30% DMG per Rainblade that hits a knotted target, 3 stacks, 3 turns; Stygian Resurge
  adds 6 hits of 25% on random enemies, counted as Ultimate DMG).
- E1 +18% CRIT Rate against debuffed enemies. E2 The Abyss needs one fewer Nihility ally; at her turn start
  +1 Slashed Dream and 1 knot on the enemy with the most. E4 enemies take 8% more Ultimate DMG. E6 +20% RES PEN
  for Ultimate DMG; Basic and Skill count as Ultimate DMG.
- Affinitive Eidolon: after a teammate attacks an enemy that has Crimson Knot, a follow-up of 300% to all
  enemies then 6 hits of 80% on random enemies, +1 Slashed Dream and 1 knot on the enemy with the most. Counts
  as Ultimate DMG, The Abyss applies, at most once per turn, resetting at the start of Acheron's turn.

**Modelling questions to put to Smitty before building** (with what prior work does):

1. *Is debuff state kept per enemy?* srsim and hsr-simulator both keep statuses on each enemy; Fribbels has one
   enemy with global switches. Per enemy is needed for single-target debuffs to boost only their target in the
   3- and 5-enemy runs, and costs one kernel call per distinct enemy state.
2. *Stacks placed on "a random enemy"* (Acheron's opening 5 Crimson Knots). Splitting them evenly as expected
   values leaves the primary target with a third of them; putting them on the primary target matches what a
   player does (they then aim at the knotted enemy, and the enemies are identical). Random damage hits (Thunder
   Core, the Affinitive Eidolon's bounces) split evenly either way, as Fribbels does.
3. *Which enemy is the primary target.* The middle one makes a blast hit 3 of 3 or 3 of 5; an end one hits 2.

**Still to build for step 6:** the battle runner (policy rules, skill points, Ultimate windows), the kit
interface with per-action hit shapes (S9), and wiring ally HP, DEF and Energy Regeneration Rate from the kernel.

## Castorice / HP loss

Following hsr-simulator: one HP-loss pipeline. Every point of HP lost by an ally or memosprite becomes 1 Newbud
(up to the cap), healing also charges Newbud (12% per target per action cap), technique HP costs use the same
pipeline, and an `on_hp_loss` event lets other effects react. Enemy targeting is split fractionally by aggro
(character + memosprite aggro; Taunt forces the target).

## Roadmap

- Real MoC stage bosses
- Pure Fiction, Apocalyptic Shadow, Anomaly Arbitration
- Graphs and a readable action log
- Possibly public, with the README stating scope and status

## Validation

- Single actions must match Fribbels exactly (same kernel, so this is a wiring test).
- Turn order and energy for overlapping units are cross-checked against hsr-simulator (MIT), with permission
  before running it.
- SPD breakpoint math is checked against known MoC breakpoints (e.g. 134 SPD for two turns in cycle 1).

## Scope (v1 roster)

Acheron, Jing Yuan, Castorice, The Herta, Anaxa, Silver Wolf, Welt, Pela, Sunday, Tribbie,
Robin Summeretto, Cyrene, Hyacine, Dan Heng • Permansor Terrae, Fu Xuan (+ Jiaoqiu).

## Prior work and credits

- [fribbels/hsr-optimizer](https://github.com/fribbels/hsr-optimizer) — MIT, damage kernel
- [kel-z/HSR-Scanner](https://github.com/kel-z/HSR-Scanner) — build JSON format
- [tingyumian662/hsr-simulator](https://github.com/tingyumian662/hsr-simulator) — MIT, reference/validation
- [simimpact/srsim](https://github.com/simimpact/srsim) — architecture reference only (no license, no code used)

Dependencies: TypeScript, Vitest and @types/node (development only), Ajv (MIT, scenario validation).
