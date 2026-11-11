# NouSR — design

Status: build order steps 1–4 done (setup, timeline engine, damage kernel adapter, scenario format).
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

## Period modules

A MoC period (Memory Turbulence) is a module with the same hook interface as a kit: it subscribes to events
(cycle start, Ult used, SP spent …) and registers modifiers. A scenario selects one by ID
(`"period": "moc-2026-11-survival-of-the-fittest"`). Swapping periods means adding a file and changing one field.

## Enemy profiles

JSON, modelled on hsr-simulator's format: level, HP, ATK, DEF, SPD, toughness, RES per element, and an
attack list (multiplier × ATK, target type single/blast/bounce, debuffs, energy given, priority).
v1 ships one generic MoC-level profile. Real stage bosses (summons, phases) are roadmap items that reuse
the same schema plus a behaviour module where needed. Enemy stats source: the Dimbreath datamine used by Fribbels.

### Step 5 inputs (researched 2026-11-11, nothing built yet)

Sourced:

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

No source found yet: enemy ATK at level 95, enemy attack multipliers, energy gained per hit taken, and
memosprite base aggro values. Fribbels' `game_data.json` has no enemy data.

Smitty's calls before building: enemy SPD (132 or 158), the attack pattern (single-target only, or with a
periodic AoE), the unsourced numbers above, and the shape of the enemy profile file (it needs its own schema).

For step 7, the current period's rule text (Game8, read 2026-11-11): an ally gains 5 Punchlines on using
their Ultimate; at the start of each cycle Aha takes an extra turn counted at a fixed 20 Punchlines, which
does not consume Punchlines. Runs 2026-11-02 to 2026-12-14.

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
