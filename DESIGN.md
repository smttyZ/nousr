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

Key to decision numbers: plain numbers are the first design decisions (below); **S** the scenario format (step 4);
**E** the generic enemy (step 5); **K** started as the kit decisions (step 6) and continues for every later
decision, including engine ones (enemy HP, damage pricing, break).

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
| S6 | Do enemies die | No. A fixed window of `cycles`; enemies are damage sponges and the result is damage per cycle. Enemy HP is tracked (K10) but nothing reacts to it |
| S7 | Strictness | Unknown keys are rejected. Every level has a free-text `notes` field the simulator ignores |
| S8 | Identity | `format: "nousr-scenario"`, integer `version`, `game_version`. The schema `$id` is a placeholder URN until a publication address is chosen |
| S9 | Multi-target damage | Fribbels computes an action against the primary target only. Each kit action declares its parts as single / blast / AoE / bounce with their scaling; NouSR asks the kernel per part and multiplies by the enemies hit |

Consequence of S6 to keep in mind: effects that trigger on a kill, overkill, and wave changes are not modelled.

## Known approximations (documented on purpose)

- **Threshold effects on expected values.** "Energy full → Ult", stack thresholds and similar are evaluated on
  expected-value state. The average over real fights can differ (a threshold on an average is not the average
  of thresholds). If in-game results disagree, fix the model and log it here.
- **Debuffs always land.** Effect Hit Rate keeps its stat value but never fails a roll.
- **"Enemies hit" counts every enemy a random-target attack could reach.** Expected value spreads random hits
  over all enemies (K2), so an action's `enemiesHit` lists all of them, even when a few random hits would on
  average reach fewer. Example: a 3-hit Lightning-Lord action on 5 enemies counts as 5 enemies hit, where the
  expected number of distinct enemies is 5 x (1 - (4/5)^3) = 2.44. Effects keyed on "per enemy hit" are biased
  upward: Tribbie's Zone instances and Pebble energy, Eternal Calculus's stacks and its 3-enemy SPD buff. Size
  Found by the Jing Yuan review, 2026-11-13. **Fixed by K17:** each action now records each enemy's chance of
  being hit at least once (`actionUsed.hitChance`) and their sum (`expectedEnemiesHit`); `enemiesHit` stays
  "could have been hit". Remaining: Tribbie's highest-HP choice still picks among every enemy a random-target
  action could reach, not the ones it hit.
- **"3 or more enemies hit" is a threshold on an expected count** (Eternal Calculus's SPD buff). Measured by the K17
  build: at 3 enemies a Lightning-Lord action's expected count is 2.9997 and never reaches 3, though the chance of
  hitting all three is about 1.000 from 8 hits on, so the buff never fires on those actions. Decided as K21
  (apply the buff scaled by the chance), being built.
- **Allies are never crowd-controlled,** so "Lightning-Lord cannot act while Jing Yuan is under Crowd Control" is
  not modelled. The generic enemy applies no crowd control.
- **Every character is simulated fully built: all traces unlocked, abilities at the kit text's levels.**
  The scan's ability and trace levels are not read (nothing in `src/scenario` or `src/run` uses them), and
  kits follow Fribbels in assuming everything unlocked. Found 2026-11-13: Smitty's Cyrene has three abilities
  at level 1 and what look like four minor traces (CRIT DMG x3, HP x1) not unlocked, so a run with his scan
  overstates her. To fix: read the levels from the scan and pass them to the kernel, if Fribbels accepts them.
- **"Highest HP" ties go to the first enemy in standing order** when the primary target is not among the tied
  enemies (K10). The game text does not say how such a tie is broken. Implemented once for every kit in
  `Battle.highestHpAmong` (`src/battle/battle.ts`); first used by Tribbie's Zone Additional DMG. It happens right after an attack that hits the primary harder than its
  neighbours, for example after Tribbie's own Ultimate: 1 to 2 times per 5-cycle battle, out of 8 to 19 Zone hits
  (Computed by the reviewer, 2026-11-13). "Nearest the primary" would pick a different enemy in about 1 of those
  cases, and only with 5 enemies. **Today it changes no result**, because the tied enemies are identical copies
  with identical per-enemy state, so the hit deals the same damage on either one. **It starts to change results
  silently as soon as tied enemies can differ:** different debuffs or marks on each (Acheron's Crimson Knots,
  any per-enemy debuff), enemies that die or change phase (real bosses, multi-stage fights), or mixed enemy
  profiles. **Guarded (2026-11-13):** whenever this tie-break picks between enemies that would take different damage
  from the hit, the run result carries a warning naming the attacker, the hit, the tied enemies, each one's
  price and the battle time, so it cannot change numbers silently. The rule itself still needs a decision.

## Open questions

**In-game checks for Smitty.** Each is implemented one way and marked `IN-GAME CHECK:` in the code.

| Where | Question | As implemented |
|---|---|---|
| Acheron | Does Thunder Core's +30% apply to the Rainblade that grants it? | From the next hit on |
| Tribbie | E2: one extra Zone instance per instance, or one per attack? | Per instance (Fribbels' reading) |
| Tribbie | Does the Glass Ball Max HP bonus count her own HP? | Other allies only |
| Tribbie | Does her Ultimate's own hit get the Zone's damage bonus? | Yes |
| Tribbie | Does the Lamb trace buff last one turn longer when applied on her own turn? | It does, as coded |
| Along the Passing Shore | Does the hit that applies Mirage Fizzle already get its DMG bonus? Moves single-hit Basic and Skill damage by about 24% | No (Fribbels: yes) |
| Along the Passing Shore | Does re-applying Mirage Fizzle count as inflicting a debuff for Acheron's talent? | Yes |
| Pioneer Diver | Is the doubling's "1 turn" the wearer's next turn or the current one? | Next turn |
| Pioneer Diver | Does the 4% CRIT Rate double with fewer than 2 debuffs? | Follows Fribbels |
| Pioneer Diver | Does Acheron's E4 battle-start debuff count as the wearer inflicting one? | Yes |
| Dance! Dance! Dance! | Does "all allies" include the wearer? | Yes |
| Memosprites | Can enemies target Netherwing and Little Ica? (hsr-simulator says no) | Not built yet |
| Break | Is Break DMG itself reduced by the 0.9 not-broken multiplier? | No (Fribbels' default: yes) |
| Break | Does a frozen enemy stay broken through its skipped turn? | Yes |
| Break | Does Acheron's own Lightning break count as inflicting a debuff for her talent? | No |
| Acheron | Toughness of the Affinitive Eidolon follow-up | 30 to every enemy on the 300% part, none on the bounces |
| Jing Yuan | Affinitive Eidolon "4 turns": the enhanced state, renewed after each Lightning-Lord action? | Yes, so it is nearly always on |
| Jing Yuan | Is one Lightning-Lord action one "ally attack" (one Tribbie Zone instance), or is each hit? | One per action |
| Jing Yuan | E6 Vulnerable: does the hit that applies a stack benefit, and do adjacent splash hits apply stacks? | No and no |
| Eternal Calculus | Does Lightning-Lord's action count as the wearer's attack, and do stacks count distinct enemies? | Yes and yes |


- **"Highest HP" tie-break** when the primary is not among the tied enemies: first in standing order (as
  implemented) or nearest the primary. Harmless today, not harmless later; see "Known approximations" for when
  it starts to matter.

Timeline rules the sources do not settle. Each is implemented one way in `src/engine/timeline.ts` (see the
header comment there) and is a one-line change. Smitty agreed on 2026-11-12 to keep all five as implemented;
they stay listed here because no source settles them.

- **A turn exactly on a cycle boundary** counts in the cycle that is ending. Game8's breakpoint chart and
  stephenli.ca need this; a Reddit breakpoint post listing 120.1 / 160.1 / 200.1 implies the opposite.
- **Equal action value.** A unit advanced to 0 goes first, the most recently advanced first (KQM speed
  guide); otherwise party order. Ally-versus-enemy ties have no source.
- **Gauge refill timing.** The gauge refills after turn start and before the action, so an advance at turn
  start is wasted and one during the action shortens the next turn.
- **Self-applied turn-end buffs** do not count the turn they were applied in, unless the kit says otherwise.
- **Scan precision.** Fribbels treats HSR-Scanner SPD as unverified and Reliquary Archiver SPD as verified.
  Both write the v4 shape and both are accepted; SPD decimals decide breakpoints. Settled by K5 (Step 6 notes).

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

## Step 6 notes (2026-11-12, in progress)

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
  +1 Slashed Dream and 1 knot on the enemy with the most. E4 enemies entering combat are inflicted with 8% more
  Ultimate DMG taken; this is a debuff on every enemy, so from E4 her E1 is always active. E6 +20% RES PEN for
  Ultimate DMG; Basic and Skill count as Ultimate DMG.
- Affinitive Eidolon: after a teammate attacks an enemy that has Crimson Knot, a follow-up of 300% to all
  enemies then 6 hits of 80% on random enemies, +1 Slashed Dream and 1 knot on the enemy with the most. Counts
  as Ultimate DMG, The Abyss applies, at most once per turn, resetting at the start of Acheron's turn.

**Step 6 decisions (Smitty, 2026-11-12):**

| # | Topic | Decision |
|---|---|---|
| K1 | Debuffs and marks | Kept per enemy, as in the game (and as srsim and hsr-simulator do). They are modifiers on the enemy's timeline unit |
| K2 | Stacks placed on "a random enemy" | Go on the primary target. A player aims at the enemy that got them and the generic enemies are identical, so this reproduces real play. Random *damage* hits (Thunder Core, the Affinitive Eidolon's bounces) still split evenly across enemies, as Fribbels does |
| K3 | Primary target | The middle enemy, with the others at its sides. A blast hits 3 of 3 or 3 of 5 |

**Decisions for the rest of the build (Smitty, 2026-11-12):**

| # | Topic | Decision |
|---|---|---|
| K4 | Light cones and relic sets | Each is a small equipment module with the same hook style as a kit: it subscribes to events and supplies its own Fribbels conditional values for the wearer, as attacker and as teammate. Character kits stop supplying light cone conditionals |
| K5 | Scanned relics | The scanned relic objects go to Fribbels as they are in the file and its own importer reads them. A Reliquary Archiver file writes each substat's exact value (and `count` / `step`, which Fribbels uses to rebuild the roll split and check the value, not to recompute SPD), so SPD is exact. Fribbels does replace rounded non-SPD substats with the exact roll sum (6.4% CRIT Rate becomes 6.48%), never SPD An HSR-Scanner file carries the rounded-down SPD the game shows; it is used as is and the result carries a warning that SPD may be understated |
| K6 | Summons and memosprites | Two kinds, both run by the owner's kit and not by the team policy, with damage asked from the kernel as the owner's. An untargetable summon (Lightning-Lord) is a timeline unit with its own SPD and no HP or aggro. A memosprite is a timeline unit plus a party member with its own HP and aggro |
| K7 | Weakness break | Modelled in a reduced form: a toughness bar per enemy, toughness damage on each attack part, and on break the kernel's Break DMG, the break delay and the broken state until recovery. The element-specific break effects (damage over time, Imprisonment, Entanglement, Freeze) are left out |
| K8 | Results report | A `nousr-result` JSON with its own schema, to be drafted for Smitty's review as the scenario format was: per team and enemy count the total, per cycle, per member, the action log and downed allies. Plus a plain table on the command line |
| K9 | Pela and Jiaoqiu | After the build-order roster, not in this pass |
| K10 | Enemy HP (2026-11-13) | Each enemy tracks max HP and current HP; every hit lowers current HP. Enemies still never die (S6): HP may go below 0 and nothing reacts to it, so kills, phases and multi-stage fights later add a rule at 0, not new state. "Highest HP" effects (Tribbie's Zone) read current HP. The generic profile gets a sourced max HP |
| K7b | Break scope (2026-11-13) | K7 also models the element break effects that change timing: Quantum and Imaginary extra delay scaled by (1 + Break Effect), Imprisonment's SPD reduction and Freeze's skipped turn. Damage over time (Bleed, Burn, Shock, Wind Shear, Entanglement's damage) stays out. srsim and hsr-simulator implement all seven element effects. Because of what is left out, results are only valid for the v1 roster's teams; README.md says so prominently, and lifting that limit (modelling everything) is a goal, since the simulator is meant to be usable by other people without much effort |
| K12 | Generic enemy stats (2026-11-13) | Max HP 2,904,993 and toughness 480 (internal units): the floor 12 elite medians over the last 9 periods (`node tools/gamedata/moc-enemies.mjs`). Bosses: HP median 8,510,721, toughness 600 |
| K13 | Kit versions (2026-11-13) | Each kit lists the ability versions it implements; a scenario naming another version stops with an error. Silver Wolf and Welt are written for version 1 (Nova Flare) |
| K14 | Standard build (2026-11-13) | Deterministic and static, KQMS-style (after KQM's Genshin standard; KQM publishes no Star Rail one): 24 fixed rolls (2 on each of the 12 substat types) plus 24 distributed rolls, every roll at its average value, at most 2 distributed rolls of a stat per relic whose main stat is not that stat. The same build in every team; no search or optimizer. Prior work: hsr-simulator uses a fixed 50-roll total with hand-set SPD; Fribbels' 100% benchmark is a search over a team and a typed-in SPD; Prydwen's method could not be read |
| K14b | Standard build files (2026-11-13) | NouSR ships one small file per character with its standard build's sets, main stats and the split of the 24 distributed rolls (SPD included), drafted from Fribbels' preset and reviewed by Smitty, so every choice is visible. A scenario can switch a standard member's main stats (for example CRIT Rate or CRIT DMG body), so one character can be compared across main-stat choices. That is a scenario schema addition, drafted for Smitty's review before it is built |
| K14c | Standard-build override (2026-11-13) | A scenario member on `"standard"` relics may carry `standard_build` with `main_stats` (any of Body, Feet, Planar Sphere, Link Rope) and optionally `distributed` (a whole 24-roll split). A bare main-stat swap re-splits automatically by one published rule: rolls above the new cap move to the next stat in that character file's priority order. The run result echoes the split it actually used. An explicit `distributed` overrides the rule; a split that breaks the total or a cap is an error, never silently fixed. Sets are not overridable in v1. Draft: `docs/proposals/scenario-standard-build-override.md` (to be updated to this rule) |
| K14d | Standard-build roll values (2026-11-13) | `BenchmarkBuild` gains two optional fields, roll quality and SPD roll value, which Fribbels' stat simulation already accepts. Standard builds set K14's averages (quality 0.9, SPD 2.3 per roll); anything that does not set them keeps today's high-roll defaults (1.0, 2.6) |
| K14e | SPD in standard builds (2026-11-13) | Each standard-build file declares a SPD target with its reason (a breakpoint, a set threshold, or none). SPD rolls may pass the KQMS cap only as far as needed to reach it; every other stat keeps KQMS rules. KQMS was written for Genshin, which has no SPD stat; Fribbels also allocates SPD first to a target and only soft-penalizes it (`benchmarks.md:80-107`). Evidence: Smitty's Cyrene is 192 SPD out of combat, while strict KQMS caps top out at 162.6. Targets set with Smitty 2026-11-13: Cyrene 180 (her trace and Fribbels' breakpoint), Hyacine 200 (her Tempestuous Halt trace and Fribbels' breakpoint), most others 133.34 (two turns in cycle 1), Tribbie none, Castorice a ceiling under 95 |
| K15 | Ability and trace levels (2026-11-13) | A member's ability levels and traces come from the scan by default, and a scenario can override them per member with any legal value: for example a character's current state or fully built. Never a blocker as long as the values are legal for that character. Scenario schema addition, drafted for Smitty's review before it is built |
| K15a | Ability-level buffs (2026-11-13) | Option A: Fribbels applies level-dependent buffs at max level only (its ability helper is keyed on eidolon, `conditionalUtils.ts:36-40`). For a member below max, the kit switches Fribbels' copy of that buff off and supplies the level-scaled value itself, from the game data's per-level tables, through one generic kernel feature for injected buffs. Minor traces switch off through Fribbels' trace-override list; major traces and attack multipliers are kit-side. Proposal: `docs/proposals/scenario-ability-trace-levels.md`. **Mechanism (2026-11-13): delta injection.** Fribbels' switch stays on and NouSR injects the difference between the right level's value and the max-level value Fribbels applied (for a level-1 Cyrene Zone: +12% - 24% = -12%). Exact for every additive stat on the roster (DMG%, CRIT Rate, CRIT DMG, RES PEN, DEF PEN, Vulnerability, True DMG, ATK%, HP%), and safe where one switch gates several effects or there is no switch (Acheron's talent RES PEN). Verified: an injected buff matches Fribbels' own to 6 decimals on every ability (Acheron with a Cyrene teammate) |
| K16 | Jing Yuan E6 (2026-11-13) | Vulnerable stacks build hit by hit, as the text says: each Lightning-Lord hit sees the stacks earlier hits left on its target (`E6_VULNERABILITY_RAMP` in `src/kits/jingYuan.ts`). Fribbels gives every hit all 3 stacks, which overstates E6 |
| K17 | Enemies hit by random hits (2026-11-13) | Effects that count "per enemy hit" use the expected number of distinct enemies an action hits, not every enemy a random-target attack could reach (for 3 random hits on 5 enemies: 5 x (1 - (4/5)^3) = 2.44, not 5). Affects Tribbie's Zone instances and Pebble energy, Eternal Calculus's stacks and its 3-enemy SPD buff |
| K14f | Swapping SPD boots away (2026-11-13) | Option A: a standard-build override that changes the Feet main stat leaves the distributed rolls as they are, runs at the resulting SPD, and reports in the run result that the SPD target was missed (by how much). SPD is never re-solved silently |
| K18 | Schema drafts approved (2026-11-13) | Smitty approved `schema/standard-build.schema.json` with the 14 files in `data/standard-builds/`, the override proposal (`docs/proposals/scenario-standard-build-override.md`, with K14c's re-split rule) and the levels proposal (`docs/proposals/scenario-ability-trace-levels.md`) |
| K19 | Warnings are structured (2026-11-13) | Every run warning carries a severity, a short stable code (e.g. `spd-target-missed`, `undecided-tie`, `spd-may-be-understated`), the message, and where it applies (team, enemy count, member). Front ends render them: the CLI in red with a warning sign, a web UI as a warning box. Part of the results format (K8) |
| K20 | Level data in the repo (2026-11-13) | Ability max levels, per-level values (1 to 15) and trace lists are extracted by a script from the game data into a small committed file under `data/`, regenerated when the game version changes. Numbers only, no game text. Users need no game-data download |
| K21 | Thresholds on random-hit counts (2026-11-13) | A buff that needs "N or more enemies hit" is applied scaled by the chance the condition holds (P(N or more) x the buff), the expected value of the buff itself, with no cliff. First case: Eternal Calculus's SPD buff |
| K11 | Multi-hit pricing (2026-11-13) | The kernel returns damage per hit, not one number per ability, and a kit says which hit each attack part is. One reference multiple per ability gave every hit a blended rate wherever hits get different buffs (Tribbie's E6 follow-up came out at 0.689 of the correct total on 3 enemies) |

K4, K6 and K7 were agreed before the prior-work check on them had come back; anything in srsim, hsr-simulator or
Fribbels that contradicts them goes back to Smitty. The exact break rules for K7 (toughness formula, delay,
recovery) are taken from sources at build time, not from memory.

Why K5 matters: a 5-star SPD substat roll is 2.0, 2.3 or 2.6 (`vendor/hsr-optimizer/src/lib/constants/constants.ts`,
`SubStatValues`) and the game shows the sum rounded down, so one relic can hide just under 1 SPD. Fribbels marks
HSR-Scanner as `speedVerified: false` and Reliquary Archiver as `speedVerified: true`
(`vendor/hsr-optimizer/src/lib/importer/importConfig.ts`).

Also agreed 2026-11-12: the five timeline rules under "Open questions" stay as implemented; the HP and enemy-turn
rules stay as implemented while each is checked against a source; technique damage stays out; the schema `$id`
waits for a publication address. Still open: what Aha's extra turn does (step 7, needs the full rule text).

**Open, for an in-game check:** does Thunder Core's +30% apply to the Rainblade that grants it? Implemented as
"from the next hit on", so the first Rainblade is unbuffed and its Crimson Knot detonation is buffed. Fribbels
assumes all three stacks for the whole Ultimate.

**Not modelled yet:** the 200% ATK hit of Acheron's technique (Fribbels has no number for technique damage);
the technique's Quadrivalent Ascendance stack is modelled.

**Built so far for step 6:**

- `src/battle/battle.ts`, the battle runner. It opens an Ultimate window between any two actions and before
  the first turn, takes the first applicable policy rule on an ally's turn, and stops with an error when none
  applies. A kit declares what each attack hits (single / blast / AoE / bounce) and which of the ability's
  hits each part is, with its multiple. The kernel returns damage per hit with the multiple Fribbels used for
  that hit (K11), so the runner prices every part at its own hit's rate against each enemy's own state; kits
  no longer supply a reference multiple. Every hit lowers the enemy's current HP (K10).
  Checked against Fribbels in `src/kernel/fribbels/acheron.integration.test.ts`, and Acheron's per-cycle damage
  is pinned across the change in `acheronPerCycle.integration.test.ts`. Hits with no ATK/HP/DEF multiple
  (Break DMG, heals, shields, damage over time) are not priced this way; K7 prices Break DMG on its own.
- `src/kits/kit.ts`, the kit interface, `src/kits/acheron.ts` (Acheron E0 to E6 with the Affinitive Eidolon) and
  `src/kits/tribbie.ts` (pilot kit, six review fixes pending). `src/kits/index.ts` is the kit registry.
- `src/run/`, the scenario-to-battle bridge: member stats from Fribbels' out-of-combat stats (not its
  in-combat ones, which already include buffs the timeline applies), `ability_version` mapped to Fribbels ids.

**Still missing before a scenario file can be run end to end:**

- Standard builds (K14 family) and scanned relics (K5) both run. A standard build only runs once every relic set
  it names has an equipment module: today Acheron's and Silver Wolf's. The other 12 roster files stop with the
  missing-module error until their sets exist.
- Equipment modules for every light cone and relic set the roster wears. K4 is built (`src/equipment/`) with
  Along the Passing Shore, Dance! Dance! Dance!, Pioneer Diver of Dead Waters, and three items registered as
  having no conditional behaviour. A light cone or set with no module stops the run with an error, because
  Fribbels' defaults count conditional buffs as always on.
- The period module (step 7): a scenario that names a period stops with an error until then.
- The other characters, and a results report.

## Castorice / HP loss

Following hsr-simulator: one HP-loss pipeline. Every point of HP lost by an ally or memosprite becomes 1 Newbud
(up to the cap), healing also charges Newbud (12% per target per action cap), technique HP costs use the same
pipeline, and an `on_hp_loss` event lets other effects react. Enemy targeting is split fractionally by aggro
(character + memosprite aggro; Taunt forces the target).

## Roadmap

- **User-facing documentation of standard builds** (Smitty, 2026-11-13). A rendered page (a wiki or docs site)
  that shows, per character, the standard build's sets, main stats, roll split and SPD target with its reason,
  in a form a player can read without opening JSON. Generated from `data/standard-builds/` so it cannot drift.
- **Timeline-aware build optimizer** (after the MVP). Fribbels optimizes without a clock; NouSR can score a build
  by simulating it, so SPD breakpoints and rotation timing count. Constraints rather than "maximize damage" alone:
  - Turn order: a unit acts before or after another (a buffer ahead of its DPS, or a "-1 SPD" tune behind it).
  - Skill points: a rotation that needs a Skill never finds the team at 0 SP on that turn.
  - Breakpoints: maximize damage at a target turn count per cycle (e.g. 134 SPD for 2 turns in cycle 1).
  What it needs first: a way for a policy rule to be marked required (today a missing Skill quietly falls to the
  next rule, usually a basic attack), and the action log to carry each action's action value and skill points.
- **Stochastic battle mode** (proposed by Smitty 2026-11-13). An opt-in mode beside the deterministic one, which
  stays the default and keeps decision 4 ("no RNG"). Runs a configurable number of battles, each with its own
  seed, so every fight is reproducible. Only mechanics the simulator explicitly models as random are sampled.
  Reports the mean and spread of results, plus objective rates such as finishing with no downed allies.
  - **Builds are compared on the same seeds** (common random numbers), and promising builds are then
    re-evaluated on a separate seed set, to catch builds that only did well on the optimizer's sample.
  - **Crits are sampled by default.** Crits are the largest source of damage variance; averaging them would
    report a spread far too narrow. Non-crit and crit damage per hit follow from Fribbels' expected value and
    the attacker's CRIT Rate and CRIT DMG.
  - **Each random mechanic is its own decision:** crits, enemy targeting by aggro, bounce targets, debuff hit
    chance (always lands today) and "a random enemy" for stacks (the primary, K2, today).
  - **Clearing within the cycle limit needs enemies that die.** That is a separate roadmap item (kills, overkill
    and wave changes; today enemies never die, S6), so this objective comes after it.
  - **What it measures that expected value cannot:** the first "Known approximation" (thresholds evaluated on
    expected values), directly, and objectives that are really probabilities.
  - **Results are estimates.** Their precision depends on the number of runs and on the outcome measured.
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
