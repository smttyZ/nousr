# NouSR — design

Status: build order steps 1–6 built (setup, timeline engine, damage kernel adapter, scenario format, generic
enemy with the HP and aggro pipeline, the 14 roster kits), plus the `nousr run` command and results format (K33).
Step 7 (the period module) is not built. "Where things stand" has the dated detail.
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
  upward: Tribbie's Zone instances and Pebble energy, Eternal Calculus's stacks and its 3-enemy SPD buff.
  Found by the Jing Yuan review, 2026-11-13. **Fixed by K17:** each action now records each enemy's chance of
  being hit at least once (`actionUsed.hitChance`) and their sum (`expectedEnemiesHit`); `enemiesHit` stays
  "could have been hit". Remaining: Tribbie's highest-HP choice still picks among every enemy a random-target
  action could reach, not the ones it hit.
- **"3 or more enemies hit" is a threshold on an expected count** (Eternal Calculus's SPD buff). Measured by the K17
  build: at 3 enemies a Lightning-Lord action's expected count is 2.9997 and never reaches 3, though the chance of
  hitting all three is 1 - 2/3^n (0.9997 at 8 hits), so the buff never fired on those actions. Decided as K21
  (apply the buff scaled by the chance). Built: `src/battle/hitProbability.ts` computes the exact chance of N or more
  distinct enemies hit from an action's attacks, and Eternal Calculus applies SPD% x that chance. Small open gap:
  for fractional hit counts (Jing Yuan's E6 ramp) it treats the fraction as one extra hit with that probability,
  while `hitChance` raises the miss chance to the fractional power; the two agree for whole hits.
- **Uncertain debuffs are priced by enumerating states (K22).** Each uncertain debuff or buff around an enemy is
  present or absent; the kernel prices every combination and weights it by the chances, so every consumer reads the
  same state. Up to 14 uncertain modifiers per enemy, then a clear error. Approximations inside it: re-applying a
  debuff unions the chances and takes the newer duration; Silver Wolf's three Bugs are independent modifiers at 1/3
  each, so after one application "has any Bug" reads 0.70 where the game has exactly one (expected counts are
  exact); Acheron's talent treats enemies as independent for "a debuff landed"; Pioneer Diver's doubling and its
  triggering debuff are independent states (exact when the wearer's debuffs are certain).
- **Anaxa's weakness counts (K28)** treat enemies as independent (Roaming Signifier's "no enemy in Disclosure"), treat the
  implants left by his chance-weighted extra Skill as independent of each other (they land together or not at all; the means
  are exact, the spread of live implants is not), and give Qualitative Shift the expected type count (DEF in the kernel is not
  linear in it). Default runs (all weaknesses) are exact: every enemy has 7 types.
- **Acheron's Ultimate waits for an expected 9 Slashed Dream** (a threshold on an expected value: an action cannot
  be scaled by a chance). Exact whenever her stacks are whole, which is every case in the repo today.
- **Allies are never crowd-controlled,** so "Lightning-Lord cannot act while Jing Yuan is under Crowd Control" is
  not modelled. The generic enemy applies no crowd control.
- **Ability and trace levels (K15, K15a, K18): read from the scan and followed by 12 of the 14 kits; the rest warn.**
  Built 2026-11-16. A member's `levels` (scan by default with an account, else max) reaches `Member.levels`
  and the kits (`LevelView`, `src/levels`); locked minor traces go to Fribbels through its trace override;
  the result echoes the levels. Level-aware kits (their `levelsModelled` lists what they follow): Cyrene,
  Hyacine, Tribbie, Silver Wolf, Welt, Dan Heng PT, Robin Summeretto, The Herta (Basic ATK only), Anaxa,
  Sunday, Fu Xuan (Basic, Ultimate, Talent only). Multiples scale by the table's ratio; buffs Fribbels applies
  at the maximum level get the difference injected. Silver Wolf and Welt also switch locked major traces off.
  **Still full strength, with a `levels-not-modelled` warning naming what is below:** Acheron, Castorice and
  Jing Yuan at any level below maximum, every ability a kit does not list (Hyacine's Skill, Ultimate and
  memosprite; Robin's Memosprite Talent; Cyrene's Memosprite Skill, whose Chrysos Heir Odes are priced in
  the heirs' kits; Fu Xuan's Skill; The Herta's Skill, Ultimate, Talent), and every locked major trace the
  kit does not list (all kits but Silver Wolf and Welt). Minor traces never warn: the kernel follows them.
  Unverified: the scan's `stat_N` / `ability_N` order is read as S N / B N (consistent with every
  prerequisite chain in Smitty's scan, and with the game's tree order for Silver Wolf and Welt). A teammate's
  locked minor traces are given to the kernel for its own form, but Fribbels may not read them for the buffs
  a teammate's stats feed.
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

**In-game checks for Smitty.** Each is implemented one way and marked `IN-GAME CHECK:` in the code. The working to-do
list, ordered by effect on results and with step-by-step procedures, is `docs/in-game-checks.md`; results go there first.

| Where | Question | As implemented |
|---|---|---|
| Acheron | Does Thunder Core's +30% apply to the Rainblade that grants it? | **Settled by Smitty 2026-11-15: no**, from the next hit on (the buff icon appears after the slash; the text does not say otherwise) |
| Tribbie | E2: one extra Zone instance per instance, or one per attack? | Per instance (Fribbels' reading) |
| Tribbie | Does the Glass Ball Max HP bonus count her own HP? | Other allies only |
| Tribbie | Does her Ultimate's own hit get the Zone's damage bonus? | Yes |
| Tribbie | Does the Lamb trace buff last one turn longer when applied on her own turn? | It does, as coded |
| Along the Passing Shore | Does the hit that applies Mirage Fizzle already get its DMG bonus? Moves single-hit Basic and Skill damage by about 24% | **Settled by Smitty in game, 2026-11-15: yes** (Fribbels' reading). Non-crit 2,028, then 2,842 with Sunday's +53%: 2,842 / 2,028 = 1.4014, matching 1.85 / 1.32 = 1.4015 |
| Along the Passing Shore | Does re-applying Mirage Fizzle count as inflicting a debuff for Acheron's talent? | Yes |
| Pioneer Diver | Is the doubling's "1 turn" the wearer's next turn or the current one? | Next turn |
| Pioneer Diver | Does the 4% CRIT Rate double with fewer than 2 debuffs? | Follows Fribbels |
| Pioneer Diver | Does Acheron's E4 battle-start debuff count as the wearer inflicting one? | Yes |
| Dance! Dance! Dance! | Does "all allies" include the wearer? | Yes |
| Memosprites | Can enemies target Netherwing and Little Ica? (hsr-simulator says no) | Settled by Smitty 2026-11-14: Netherwing cannot be targeted but has real HP, spends it on its own attacks and bears allies' HP loss below 1 HP at 500% (its talent calls this "backup"); Summer Songbirds cannot be targeted, and their HP (70% of Robin Summeretto's Max HP) only scales their damage. **Little Ica: settled by Smitty 2026-11-15, enemies can target it** (seen hit in Memory of Chaos). Demiurge stays untargetable (its text: "Out-of-Bounds"). **Game statuses, from in-game tooltips (Smitty's screenshots, 2026-11-15):** *Out-of-Bounds* (Demiurge): "Neither allies nor enemies can actively select Out-of-Bounds units." *Backup* (Netherwing): "Enemies cannot actively target backup units. Allies' Blast-type abilities cannot Blast to backup units." Little Ica shows neither, so it is a normal unit. **To build:** replace the `UNTARGETABLE_MEMOSPRITES` name list with a per-memosprite status (normal / backup / out-of-bounds); enemy targeting, ally ability targets and blast splash follow from it. Kits accept memosprite targets per their text; Sunday's Skill and Ultimate and Robin's Ultimate on Netherwing are legal (Backup), nothing selects Demiurge. **Summer Songbirds: settled by Smitty 2026-11-15, a normal unit** (no tag; a boss's "Target Locked On" and two enemy DoTs were on them), so the 2026-11-14 "cannot be targeted" note was wrong; Robin's Skill now restores their HP (100%, 110% from E3), and an enemy attack skips a memosprite that left earlier in the same attack. How a scenario names a memosprite target is waiting on Smitty (dotted `castorice.netherwing` vs a separate field). Same screenshots: Netherwing 34,000 / 34,000 HP at his account's levels, the same as `NEWBUD_MAX`; Demiurge 5,585 / 6,557, its HP percentage following Cyrene's |
| Break | Is Break DMG itself reduced by the 0.9 not-broken multiplier? | No (Fribbels' default: yes) |
| Break | Does a frozen enemy stay broken through its skipped turn? | Yes |
| Break | Does Acheron's own Lightning break count as inflicting a debuff for her talent? | No |
| Acheron | Toughness of the Affinitive Eidolon follow-up | 30 to every enemy on the 300% part, none on the bounces |
| Jing Yuan | Affinitive Eidolon "4 turns": the enhanced state, renewed after each Lightning-Lord action? | Yes, so it is nearly always on |
| Jing Yuan | Is one Lightning-Lord action one "ally attack" (one Tribbie Zone instance), or is each hit? | One per action |
| Jing Yuan | E6 Vulnerable: does the hit that applies a stack benefit, and do adjacent splash hits apply stacks? | No and no |
| Eternal Calculus | Does Lightning-Lord's action count as the wearer's attack, and do stacks count distinct enemies? | Yes and yes |
| Break | Does a break effect (e.g. Entanglement) trigger Acheron's talent, as "a debuff inflicted during an ability"? | **Settled by Smitty 2026-11-15: yes** (a Quantum break by Fu Xuan's Basic ATK gave Acheron a Slashed Dream). Built; two pinned battles' cycle 5 rose (308,839 to 1,276,193 and 275,506 to 932,104) |
| Welt | Skill energy: 30 in total (the data prints 6 per hit over 5 hits) | **Settled by Smitty 2026-11-15: 30** (90 to 120 after one Skill) |
| Welt | Ultimate as 2 hits (10%/90%, from Fribbels, not the text): sets Talent triggers, E2 energy and Weightless delays | 2 hits |
| Welt | Weightless delay per hit, cap 8 per target per turn, reset at that enemy's turn start | As written |
| Welt | Retribution: one stack per attack, given after it | As written |
| Silver Wolf | Does her E2 Vulnerability count as a debuff (adds 1 to every count from battle start)? | Yes |
| Silver Wolf | E2: one Bug per enemy per action, or per attack call? | Per action |
| Silver Wolf | Is trace and eidolon energy scaled by Energy Regeneration Rate? | Yes |
| Dan Heng PT | Souldragon Follow-Up toughness: 60 (text) or 30 (Fribbels) | 60 |
| Dan Heng PT | Does Lightning-Lord's action trigger Sylvanity as the Bondmate attacking? | Yes |
| Dan Heng PT | E2 doubling also applies to Sublimity's Additional DMG | Yes |
| Texture of Memories | Is the hit that grants the shield already reduced? | Yes |
| Extra turns | Does an extra turn (Little Ica, Demiurge) count down durations and fire turn start/end effects? | Yes |
| Memosprites | Does a memosprite leave when its owner is downed? | Yes |
| Memosprites | Do memosprite actions count for "after a teammate attacks" (Acheron's Affinitive Eidolon) and for equipment that reacts to the wearer's attacks (Ashblazing, Eternal Calculus, Dance! Dance! Dance!, Scholar)? | Acheron: yes; equipment: no (they check the wearer as actor) |
| Fu Xuan | Is the redirected 65% taken before or after the ally's damage reductions, and does Fu Xuan's own Misfortune Avoidance reduce it? | After the ally's reductions; hers do not apply |
| Fu Xuan | Does her redirection cover memosprites ("teammates")? | Yes |
| Fu Xuan | Knowledge's HP buff (6% of her Max HP): her Max HP before or after her own Knowledge? | **Settled by Smitty 2026-11-15: before** (her out-of-combat Max HP 9,420 x 6% = 565.2; an ally showed +565 in battle; after would be about 599) |
| Fu Xuan | E4 energy: scaled by Energy Regeneration Rate? | Yes |
| Fu Xuan | Does her HP Restore (a share of missing HP) get Outgoing Healing Boost? Fribbels has no hit for it, so NouSR applies none | No |
| Giant Tree | Its SPD thresholds read in-battle SPD (Fribbels' in-combat SPD)? NouSR stops the run if the timeline's SPD and Fribbels' SPD fall on different sides of 135 or 180 | In-battle |
| Cyrene x Tribbie | Ode to Passage's extra Zone instance: on her Follow-Up ATK only (the text), or on Basic ATK, Ultimate and ally-triggered hits too (Fribbels)? | Follow-Up only |
| Robin Summeretto | During Fever she takes no turns: is her action gauge frozen (kept as it was), and do advances or delays she receives meanwhile still apply? | Frozen; they apply to the frozen gauge |
| Robin Summeretto | Do the Songbirds and the countdown enter Fever with a full gauge? | Yes |
| Robin Summeretto | "Ally target" for Vibes: every character including Robin, and every memosprite including the Songbirds; summon actions count as their owner's? | Yes |
| Robin Summeretto | The 20 energy when the Songbirds are summoned: once per Bessie summon, not per member? | Once |
| Robin Summeretto | Deviated Chords: given even when Vibes are at the cap? Its value follows live Vibes? | Yes and yes |
| Robin Summeretto | Special Guest "2 turns" with the Ultimate advancing the guest straight into its turn: one attack or two? | One |
| Memory's Curtain Never Falls | Its buff on the Songbirds counts down only on their own turns (Fever only), so it can outlast the allies' copy | As written |
| Robin Summeretto | E6: energy above 140 when Fever ends is cut to the normal cap? | Yes |
| Robin Summeretto | E1: does the tally include the triggering Memosprite Skill's own damage, start at Bessie's summon, include Break DMG, and vanish when the Songbirds leave? | Yes to all |
| Robin Summeretto | Healing and shields share one "first time in a turn" Vibe per provider? | Yes |
| Robin Summeretto | Groove: set before the same heal's Vibe can spend it; the 3 energy is flat? | Yes and yes |
| Fu Xuan | E2: "during this action" is the turn in progress (several units saved in one turn); "ally" includes herself and memosprites; the restore is not a heal (triggers nothing heal-based) | As written |
| Netherwing | When Castorice's costs ask for more HP than an ally has ("reduce to 1"), does Netherwing bear the shortfall? | Yes, as the backup rule is written |
| Sunday | Is his Ultimate's energy for the target flat (no Energy Regeneration Rate)? His trace and E4 energy scaled? | Ultimate flat; trace and E4 scaled |
| Sunday | E4 "when the turn starts": his own turn? | Yes |
| Sunday | E6: does a new Talent stack renew all stacks' duration? | Yes |
| Sunday | Does his Skill advance the target's memosprites ("their summon"), and cover a memosprite summoned after the Skill or Ultimate? | Yes and yes |
| Sunday | His Ultimate on himself: does it consume the Technique buff or give the E6 Talent stack? | Neither (not modelled) |
| Cyrene | Her Ultimate "activates all teammates' Ultimate": what does it do? | **Settled by Smitty 2026-11-15: it fills every teammate's energy to full** (hovering a teammate shows full energy); the team policy then casts their Ultimates as usual. Guides only repeat the line ([Prydwen](https://www.prydwen.gg/star-rail/characters/cyrene)) |
| Cyrene | Is Ode to Ego always on, or only after an Ode on her? Can "This Ode, to All Lives" target her? | **Settled by Smitty in game, 2026-11-15: always on** (every Minuet gets the bounces, 1 per distinct teammate she has gained Recollection from, characters and memosprites, never Demiurge; Story and E1/E4/E6 work from the start). **The Ode cannot target Cyrene herself:** a `demiurge_order` entry naming her own key is rejected by the loader (`x-nousr-domain.exclude_self`, K27) |
| Cyrene | Ultimate cost: the first needs 24 and spends 12? Reunion at First Sight? | **Settled by Smitty in game, 2026-11-15: the first needs 24 and spends 12** (leaves the rest); **Reunion at First Sight needs 12 and spends 12** |
| Cyrene | Recollection at the start of a Memory of Chaos battle | **Settled by Smitty in game, 2026-11-15: 0 + trace only** (6 of 24 with 3 Chrysos Heir / Remembrance teammates, E0/E1); the 50% start energy adds nothing. The kit already did this |
| Cyrene | Story from the first Ultimate | **Settled by Smitty in game, 2026-11-15: 2** (1 for using the Ultimate, 1 for summoning Demiurge) |
| Cyrene | Do teammates' Ultimates (activated by the energy fill) come before or after Demiurge's extra turn? | **Settled by Smitty in game, 2026-11-15: before.** The Ultimate window runs to the end before the timeline gives the extra turn, and again before Demiurge's turn starts; no engine change was needed, a test pins it |
| Castorice | Does Contained Dark Tide count overheal? | **Settled by Smitty in game, 2026-11-15: yes** (Newbud 47% to 63% from Hyacine's Ultimate on 3 full-HP allies); the full heal (`amount + overheal`) counts, still capped at 12% of max Newbud per ally per action |
| Hyacine | Does her Ultimate heal use her Max HP before or after After Rain's buff? | **Settled by Smitty in game, 2026-11-15: before.** 4,946 Max HP, 34.5% Outgoing Healing, Lv10: +1,073 on allies, +1,288 on Little Ica. The Ultimate heals first, then starts After Rain |
| Past and Future | "The next ally taking action": a character's turn start (not a summon such as Lightning-Lord, not a memosprite, not an Ultimate in the window)? Fribbels sends it to the memosprite for owners like Castorice | A character's turn start; summons and memosprites never get it |


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

**Built (step 7, 2026-11-16).** `src/periods/`: `PeriodModule` (`id`, `name`, optional `check(members)` that returns
a problem line per member the module cannot model, and `create(battle)` that runs after the kits and equipment
exist) and `PERIODS`, the registry by ID. `run.ts` resolves `battle.period`; an unknown ID stops the run and lists
the known ones, and the module's `check` runs while each team is planned. `BattleSetup.period` carries it into the
`Battle`, and the result header shows `period: <id>` (the scenario file embedded in the result has it too).

*To add a period:* write `src/periods/<name>.ts` exporting a `PeriodModule`, add it to the list in
`src/periods/index.ts`, and set `battle.period` in the scenario to its ID. Nothing else changes.

*`moc-2026-11-survival-of-the-fittest`:* its rule is about Punchlines and Aha, which are the Elation path's
mechanic and not modelled. A team with no Elation-path character (kit `path` is `'Elation'`, the same word
Fribbels uses) runs exactly as with `period: null`; a team with one stops with an error naming the member.
The in-game text is in the module's header.

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

**Settled by Smitty 2026-11-16** (in-game text: "When an ally target uses their Ultimate, they gain 5 Punchlines. At the start of each Cycle, Aha immediately gains 1 extra turn with a fixed 20 Punchlines taken into account. This turn does not consume Punchlines."): Punchlines and Aha's turn are the Elation path's mechanic (the period's banner is Aha with three Elation characters). For teams with no Elation character the period changes nothing, so the module is a documented no-op for them; a team with an Elation character stops with an error naming it until Elation is modelled.

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
| K14b | Standard build files (2026-11-13) | NouSR ships one small file per character with its standard build's sets, main stats and the split of the 24 distributed rolls (the SPD count is a starting point: K32 re-solves it at load), drafted from Fribbels' preset and reviewed by Smitty, so every choice is visible. A scenario can switch a standard member's main stats (for example CRIT Rate or CRIT DMG body), so one character can be compared across main-stat choices. That is a scenario schema addition, drafted for Smitty's review before it is built |
| K14c | Standard-build override (2026-11-13) | A scenario member on `"standard"` relics may carry `standard_build` with `main_stats` (any of Body, Feet, Planar Sphere, Link Rope) and optionally `distributed` (a whole 24-roll split). A bare main-stat swap re-splits automatically by one published rule: rolls above the new cap move to the next stat in that character file's priority order. The run result echoes the split it actually used. An explicit `distributed` overrides the rule; a split that breaks the total or a cap is an error, never silently fixed. Sets are not overridable in v1. Draft: `docs/proposals/scenario-standard-build-override.md` (to be updated to this rule) |
| K14d | Standard-build roll values (2026-11-13) | `BenchmarkBuild` gains two optional fields, roll quality and SPD roll value, which Fribbels' stat simulation already accepts. Standard builds set K14's averages (quality 0.9, SPD 2.3 per roll); anything that does not set them keeps today's high-roll defaults (1.0, 2.6) |
| K14e | SPD in standard builds (2026-11-13) | Each standard-build file declares a SPD target with its reason (a breakpoint, a set threshold, or none); K32 solves the roll count for the member's light cone at load. SPD rolls may pass the KQMS cap only as far as needed to reach it; every other stat keeps KQMS rules. KQMS was written for Genshin, which has no SPD stat; Fribbels also allocates SPD first to a target and only soft-penalizes it (`benchmarks.md:80-107`). Evidence: Smitty's Cyrene is 192 SPD out of combat, while strict KQMS caps top out at 162.6. Targets set with Smitty 2026-11-13: Cyrene 180 (her trace and Fribbels' breakpoint), Hyacine 200 (her Tempestuous Halt trace and Fribbels' breakpoint), most others 133.34 (two turns in cycle 1), Tribbie none, Castorice a ceiling under 95 |
| K15 | Ability and trace levels (2026-11-13) | A member's ability levels and traces come from the scan by default, and a scenario can override them per member with any legal value: for example a character's current state or fully built. Never a blocker as long as the values are legal for that character. Scenario schema addition, drafted for Smitty's review before it is built |
| K15a | Ability-level buffs (2026-11-13) | Option A: Fribbels applies level-dependent buffs at max level only (its ability helper is keyed on eidolon, `conditionalUtils.ts:36-40`). For a member below max, the kit switches Fribbels' copy of that buff off and supplies the level-scaled value itself, from the game data's per-level tables, through one generic kernel feature for injected buffs. Minor traces switch off through Fribbels' trace-override list; major traces and attack multipliers are kit-side. Proposal: `docs/proposals/scenario-ability-trace-levels.md`. **Mechanism (2026-11-13): delta injection.** Fribbels' switch stays on and NouSR injects the difference between the right level's value and the max-level value Fribbels applied (for a level-1 Cyrene Zone: +12% - 24% = -12%). Exact for every additive stat on the roster (DMG%, CRIT Rate, CRIT DMG, RES PEN, DEF PEN, Vulnerability, True DMG, ATK%, HP%), and safe where one switch gates several effects or there is no switch (Acheron's talent RES PEN). Verified: an injected buff matches Fribbels' own to 6 decimals on every ability (Acheron with a Cyrene teammate) |
| K16 | Jing Yuan E6 (2026-11-13) | Vulnerable stacks build hit by hit, as the text says: each Lightning-Lord hit sees the stacks earlier hits left on its target (`E6_VULNERABILITY_RAMP` in `src/kits/jingYuan.ts`). Fribbels gives every hit all 3 stacks, which overstates E6 |
| K17 | Enemies hit by random hits (2026-11-13) | Effects that count "per enemy hit" use the expected number of distinct enemies an action hits, not every enemy a random-target attack could reach (for 3 random hits on 5 enemies: 5 x (1 - (4/5)^3) = 2.44, not 5). Affects Tribbie's Zone instances and Pebble energy, Eternal Calculus's stacks and its 3-enemy SPD buff |
| K14f | Swapping SPD boots away (2026-11-13) | Option A: a standard-build override that changes the Feet main stat leaves the distributed rolls as they are, runs at the resulting SPD, and reports in the run result that the SPD target was missed (by how much). SPD is never re-solved silently. **Superseded in part by K32 (2026-11-15):** the loader now re-solves SPD for the actual main stats and says so in the echo (`spdSolved`), so a Feet swap no longer misses unless no roll count reaches the target (then `spd-target-missed` as described here); an explicit `distributed` is still taken as given and still warns. **Confirmed by Smitty 2026-11-16:** keep re-solving; a user who wants "swap boots and lose the speed" gives the split explicitly |
| K18 | Schema drafts approved (2026-11-13) | Smitty approved `schema/standard-build.schema.json` with the 14 files in `data/standard-builds/`, the override proposal (`docs/proposals/scenario-standard-build-override.md`, with K14c's re-split rule) and the levels proposal (`docs/proposals/scenario-ability-trace-levels.md`) |
| K19 | Warnings are structured (2026-11-13) | Every run warning carries a severity, a short stable code (e.g. `spd-target-missed`, `undecided-tie`, `spd-may-be-understated`), the message, and where it applies (team, enemy count, member). Front ends render them: the CLI in red with a warning sign, a web UI as a warning box. Part of the results format (K8) |
| K20 | Level data in the repo (2026-11-13) | Ability max levels, per-level values (1 to 15) and trace lists are extracted by a script from the game data into a small committed file under `data/`, regenerated when the game version changes. Numbers only, no game text. Users need no game-data download |
| K21 | Thresholds on random-hit counts (2026-11-13) | A buff that needs "N or more enemies hit" is applied scaled by the chance the condition holds (P(N or more) x the buff), the expected value of the buff itself, with no cliff. First case: Eternal Calculus's SPD buff |
| K22 | Random-target debuffs (2026-11-14) | A debuff from a random-target hit is present on each enemy with the chance it landed there (expected value), not on every enemy the hit could reach. Debuff counts become expected values; thresholds on them use K21's scaled form; "once per action" triggers use the chance. Silver Wolf's random Bug is each of ATK, DEF and SPD at 1/3. Affects Silver Wolf, Welt's Skill slow, Along the Passing Shore on bounces, and every debuff consumer (Acheron's talent, Pioneer Diver, Good Night and Sleep Well, Silver Wolf E1/E4/E6) |
| K23 | Extra hits for teammates (2026-11-14) | A damage request can carry extra Additional DMG hits. A kit hands one to a teammate through its teammate state, and it is priced in that teammate's own request (the teammate's ATK, crits, element and buffs). First use: Dan Heng • Permansor Terrae's Bondmate Additional DMG (enhanced Souldragon, Sublimity, E6), which Fribbels does not price. Built 2026-11-14: Fribbels builds all hits in one pass inside `generateContext`, so the adapter adds the extra hit through Fribbels' own per-character `actionModifiers` hook (the extension point its Hidden Shadow light cone uses), for one synchronous call, restored afterwards, and reports it as ability `EXTRA`. Priced exactly as Fribbels' own Additional hits (tested against Pela with Hidden Shadow and Tribbie's Zone) |
| K24 | Break effects are debuffs (2026-11-14) | Each break effect NouSR models (Entanglement and Imprisonment delays, Imprisonment's slow, Freeze) counts as a debuff while it lasts, and one shared Imprisoned state serves both a break and Welt. Damage over time stays out (K7b) |
| K25 | Netherwing burn or hold (2026-11-15) | Both are modelled and the user picks per scenario: burn (Breath into the finisher on Netherwing's first turn, what the game's auto-battle does, the default) or hold (Breath only above 25% HP until a chosen turn 2 or 3, Claw Splits the Veil on held turns with no HP above 25%, finish on that turn). Built as Castorice's `finishOnTurn`, set from a scenario with `kit_options.netherwing_finish_turn` (K27). Purpose: the experiment under "Planned experiments" |
| K26 | Demiurge's order (2026-11-15) | Demiurge's choice turns follow a user-set order (an ally key per Ode, or attack), as part of the rotation, e.g. Hyacine, Castorice, Robin (never Cyrene herself: the Ode cannot target her, settled 2026-11-15). Every option like this has a finite, schema-declared domain so the optimizer can search it. Scenario field `kit_options.demiurge_order` / `after_order` (K27); the order's default (every other member in party order, then attack) is a placeholder that raises `kit-option-default-used`, to be replaced by a priority derived from runs before anyone outside the private beta relies on it; running past the list raises `kit-option-list-exhausted` |
| K27 | Kit options (2026-11-15) | A scenario member may carry `kit_options`, checked against `schema/kit-options/<character id>.schema.json` (`src/scenario/kitOptions.ts`). Every option has a finite domain and a default, enforced by a test, so an optimizer enumerates any kit's options from its schema; values naming members are checked against the team (`x-nousr-domain`; `exclude_self: true` also refuses the member's own key, which Cyrene's `demiurge_order` uses). Kits take them through `RegisteredKit.configure`; the run result echoes the options used and which were defaulted. Parallel search needs nothing more; branching on shared prefixes later needs kit state that can be snapshotted (kit state lives in closures today). Proposal: `docs/proposals/scenario-kit-options.md` |
| K28 | Anaxa's weaknesses (2026-11-15) | His kit counts each enemy's weakness types itself, as expected values, starting from the scenario's setting (S5): his implants and Sublimation raise the count, which drives Qualitative Disclosure, Qualitative Shift and The Great Cosmic Enterprise. Teammates' RES and toughness keep the scenario's list (a documented approximation). Under the default `"all"` every enemy has 7 types from the start, so default runs are unaffected. Per-enemy weaknesses in the engine are a roadmap item. hsr-simulator implements them per enemy |
| K29 | Enemy Control RES (2026-11-15) | Enemies are entities built from a template, as characters are (real bosses later: a template plus a behaviour module, like a kit). The enemy profile gains `control_res` (a fraction, the game data's `STAT_CTRL`; optional, 0 when left out); the generic enemy has 0, since floor 12 Elites have none (Computed: 0 of 22 Elites over the last 9 periods; 9 of 13 bosses have 0.5, 1 has 1.0). So Anaxa's Sublimation stops the generic enemy from acting: its next turn passes (`Enemies.skipNextTurn`, no thaw advance) |
| K30 | The Herta's aim (2026-11-15) | Her Enhanced Skill aims at the enemy with the most Interpretation, ties to the middle enemy; her other actions and her teammates keep the middle (K3). Every generic enemy is Elite-level, so the Ultimate's rearrangement changes nothing. Choosing Basic ATK over her Skill in Skill Point-heavy teams is the team policy's job (`team.skill_points` conditions); planning Skill Points ahead is an optimizer item |
| K31 | Techniques per member (2026-11-15) | Every member's pre-fight Technique has its own switch: a scenario member's `technique` (true/false) overrides `battle.start.techniques`, which stays the default for everyone. Every kit's technique honours it, and the optimizer can search it (some niche teams skip a technique). Hyacine's Technique is modelled: at battle start all allies healed 30% of her Max HP + 600, and all allies +20% Max HP for 2 turns (numbered K31 because the Herta/Anaxa branch uses K28-K30). **Built 2026-11-15:** `technique` on a member, resolved at load (`Member.technique`, `techniqueGiven`), `MemberSetup.technique`, echoed per member in the run result (`techniques`); Hyacine heals characters first (an overheal at full HP, counted in her tally), then Max HP +20% as a timeline modifier on each, counted by that ally's own turns, injected into the kernel as HP% (five in-game checks in `docs/in-game-checks.md` item 7) |
| K32 | Standard-build SPD solved at load (2026-11-15) | A standard build file states its SPD target, and the loader works out the fewest distributed SPD rolls that reach it with the member's actual light cone and main stats (K14e's rule, applied at load instead of written into the file); the rolls that frees or needs move along the file's `distributed.priority` (K14c's re-split rule). So the default build always fits the light cone equipped (Cyrene with This Love, Forever: 10 SPD rolls; with a light cone without SPD: about 18). A target out of reach runs with the `spd-target-missed` warning (K14f). The run result echoes the split used. Found because Cyrene's file had 18 SPD rolls computed without her light cone and was refused |
| K33 | Results format and CLI (2026-11-16) | The MVP deliverable. `nousr run` prints human-readable tables to stdout and writes a `nousr-result` JSON with `-o/--out` (or prints it with `--json`); warnings go to stderr. The JSON strictly follows `schema/result.schema.json` (version 1, the draft in `docs/proposals/results-format.md` with its recommended options, locked), so a later web viewer can read result files as a read-only data source. Kept headless and decoupled: no UI in the core |
| K34 | How the CLI runs (2026-11-16) | Option A: bundled with Vite (already installed with the test runner; now a direct devDependency) into `dist/cli.js` by `npm run build`, run with plain Node. Spike (Computed 2026-11-16): the bundle loads Fribbels and gives exactly the numbers the test path gives. Data files are read from the repository at run time through `src/paths.ts` (repo root found by walking up to the `nousr` package.json) |
| K35 | Reaction damage in the action log (Smitty, 2026-11-16) | Damage a unit books in reaction to an action (Tribbie's Zone Additional DMG, a reaction to that reaction) is credited to the action that set it off, so the log's damage sums to the run's total; per-member and per-ability totals do not change. A follow-up a listener performs is its own action with its own line. Damage with no triggering action (a Technique at battle start, a reaction to an enemy's turn) is the run's optional `unattributed` number, left out of the file when zero |
| K36 | Rules with a downed target are skipped (Smitty, 2026-11-16) | A policy rule whose `target` is downed or not on the field does not apply, exactly like an unmet condition, and the next rule is tried; if none applies the "no rule applies" error stands (S4). It is general policy evaluation, not per kit, so scenarios need no `hp_share` guard on targeted rules |
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

**Settled in game (Smitty, 2026-11-15):** Thunder Core's +30% does not apply to the Rainblade that grants it. Implemented as
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
  it names has an equipment module. Every set the 14 roster files name now has one (2026-11-14, written by Haiku
  and reviewed). Some still refuse cases the engine cannot model, and stop the run with an error: World-Remaking
  Deliverer 4-piece and Amphoreus for memosprite wearers, The Wondrous BananAmusement Park for memosprite wearers,
  Giant Tree's Outgoing Healing (at the wearer's first heal). Broken Keel's team buff
  uses out-of-combat Effect RES.
- **All 14 roster standard builds run** (2026-11-15; 4 could not when this was found). **Fixed 2026-11-15, later:** Sunday
  (Sacerdos' Relived Ordeal 4-piece) and Dan Heng • PT (Self-Enshrouded Recluse 4-piece), so the Acheron and Jing Yuan teams
  can run on standard builds. No event change (Smitty, 2026-11-15: "a buff lives on the unit that holds it"; proposal
  `docs/proposals/engine-ability-target-shield-source.md`). Sacerdos finds the ability's target from the buffs the wearer's own
  Skill or Ultimate put on one ally character (`modifierApplied`, matched to the action by `Battle.actionSerialInProgress`), and
  gives that ally the CRIT DMG stack as a modifier on the holder. Recluse reads the new `Party.shieldFrom(holder, source)`: the
  party now keeps each shield's source. Both pass their live values to Fribbels (`teamRelicSet` "Sacerdos' Relived Ordeal 1x/2x",
  "Self-Enshrouded Recluse"; the wearers' own switches). Real-kernel test: `src/kernel/fribbels/shieldAndTargetSets.integration.test.ts`.
  Readings to check are in `docs/in-game-checks.md` (Tier 1 #7, Tier 2 #19 to #23). Recluse's Shield Effect +10% / +12% is NOT
  MODELLED (Dan Heng PT's shields are 22% smaller than in game at 4 pieces; HP and shield duration only); Smitty put it on the
  roadmap. **Fixed earlier 2026-11-15:** Robin Summeretto and Cyrene. World-Remaking Deliverer and
  Amphoreus refused memosprite wearers with "memosprites are not built (K6)", written before memosprites existed; they now
  model the memosprite condition (WRD: live on the wearer's Basic ATK / Skill, Max HP kept in step on the party; Amphoreus:
  +8% SPD on every ally while the wearer's memosprite is on the field, one shared modifier). Robin's standard build runs
  through the real kernel (`src/kernel/fribbels/memospriteSets.integration.test.ts`). The same stale wording in Bone
  Collection's and Poet's headers was only wording: Fribbels applies their memosprite buffs itself. BananAmusement Park
  still refuses memosprite wearers (no roster member needs it).
- Equipment modules for every light cone and relic set the roster wears. K4 is built (`src/equipment/`) with
  Along the Passing Shore, Dance! Dance! Dance!, Pioneer Diver of Dead Waters, and three items registered as
  having no conditional behaviour. A light cone or set with no module stops the run with an error, because
  Fribbels' defaults count conditional buffs as always on.
- The period module (step 7): built 2026-11-16; see "Period modules".
- The other characters, and a results report.

## Castorice / HP loss

Following hsr-simulator: one HP-loss pipeline. Every point of HP lost by an ally or memosprite becomes 1 Newbud
(up to the cap), healing also charges Newbud (12% per target per action cap), technique HP costs use the same
pipeline, and an `on_hp_loss` event lets other effects react. Enemy targeting is split fractionally by aggro
(character + memosprite aggro; Taunt forces the target).

## Where things stand (2026-11-16)

Branch `castorice-team` (not pushed). `main` has everything through PR #3 (Jing Yuan's team). The three side branches (The Herta and Anaxa; Sunday's and Dan Heng PT's relic sets; the results-report draft) are merged in (2026-11-16). All 14 roster kits are registered, all 14 standard builds run, and all 1,823 tests pass.

- **Results report and command line built (2026-11-16, branch `cli-results`, K33/K34):** `nousr run | validate | version` (`npm run build`, then `node dist/cli.js`), writing `nousr-result` JSON that follows `schema/result.schema.json` (version 1) and printing the totals, ratios and per-member tables; the action log now carries action value, cycle, damage and Skill Points. The example scenario runs.
- **Kits registered and reviewed:** Acheron, Tribbie, Jing Yuan, Silver Wolf, Welt, Dan Heng • PT, Sunday, Fu Xuan,
  Robin • Summeretto.
- **Written and tested on this branch, not yet reviewed or registered:** **Hyacine** (+ The Story's Next Page) and
  **Castorice** (+ Make Farewells More Beautiful). **Cyrene** has not been started (the plumbing for her ally effects
  exists: `battle.cyreneEffect`).
- **Reviewed 2026-11-15** (one Sonnet reviewer each): no wrong numbers in either kit. Fixed: Castorice's Cyrene bounce
  rate used the text's rounded 0.26% / 0.53% (game data 0.264% / 0.528%); Netherwing's HP gain is now `Party.gainHp` (no
  `healed` event, so Robin no longer gets Vibes from it). Netherwing's Breath: both modes built (K25), the old
  `maxBreathsPerTurn` option is gone. Hyacine's fixes and missing tests were delegated; her Technique (skipped today) waits on
  Smitty: heal into the tally only, heal plus the +20% Max HP, or leave out.
- **Castorice notes:** max Newbud is Fribbels' 34,000 (the text gives no formula); her E1 follows the text's enemy-HP bands
  (120% below 80%, 140% below 50%) rather than Fribbels' flat bonus; E4's healing-received bonus for other healers is not
  modelled. Small open: `removeMemosprite` drops the memosprite's owner before `memospriteRemoved`, so the HP-out Wings
  Sweep's `actionUsed` has no `owner`.
- **New in-game checks from the reviews:** After Rain covering 2 or 3 actions after an out-of-turn Ultimate; whether her Technique
  heal on full-HP allies counts in Little Ica's tally; Take Sky in Hand in After Rain (two heals? Ica healing herself?). Settled by
  Smitty in game, 2026-11-15: Hyacine's Ultimate heals on her Max HP before After Rain's buff; Contained Dark Tide counts overheal.
- **Registered 2026-11-15:** Castorice and Hyacine, with Make Farewells More Beautiful and The Story's Next Page. Kit options
  (K27) are built; Castorice's runs end to end through the real kernel (a scratch 3-member run, Castorice / Hyacine / Tribbie on
  standard builds, finish turns 1 to 3 at 1, 3 and 5 enemies). That run is a wiring check, not the K25 experiment: no Cyrene,
  a placeholder policy, and Robin Summeretto and Sunday could not join (their standard builds' World-Remaking Deliverer and
  Sacerdos' 4-piece effects were refused then; both are modelled now).
- **Cyrene (2026-11-15):** written by a Sonnet agent, reviewed by another, registered with This Love, Forever. Demiurge's
  order is her kit option (K26/K27). The review found no wrong numbers. Open:
  - **Her standard build runs (fixed by K32, 2026-11-15):** the file's 18 SPD rolls were computed without the light cone;
    the loader now solves SPD for the equipped light cone (10 rolls with This Love, Forever).
  - **Non-heir Ode on a memosprite owner (Robin Summeretto):** Fribbels puts the +40% on its single-target entity, which for
    Robin (memo buff priority) is the Songbirds, so her own hits miss it (Computed by the reviewer: Basic ATK the same with
    the Ode on and off). The text says it "also applies on memosprites". Fix: inject the delta for the other entity (K15a).
  - Not modelled on the teammates' side: Hyacine's Ode to Sky (Ica's tally +72% of healing), Dan Heng PT's Ode to Earth
    beyond the 24% DMG. (Anaxa's Ode to Reason is in his kit since 2026-11-16.) Engine gaps: `performAction` reads a memosprite's owner after its body (a memosprite
    that leaves in its own action logs no owner); no quiet HP setter (the kit works around it).
  - **In-game checks** (the code has each as `IN-GAME CHECK`): whether the first Ode to Ego Minuet already has E6's DEF -20%;
    whether a teammate's Ultimate or follow-up consumes Future; whether a Max HP rise raises current HP. **Settled by Smitty in
    game, 2026-11-15:** Ode to Ego is always on; "This Ode, to All Lives" cannot target Cyrene herself; the first Ultimate needs
    24 Recollection and spends 12, Reunion at First Sight needs 12 and spends 12; her Recollection at the start of a Memory of Chaos
    battle is 0 + trace; the first Ultimate gives 2 Story; teammates' Ultimates come before Demiurge's extra turn.
  - **Ode to Ego (settled 2026-11-15): always on**, as Fribbels has it. Each Minuet gets 1 to 6 or more bounces from the first one
    (up to about 7x its damage at E0), Story and E1/E4/E6 work from the start, and her own key is not a valid `demiurge_order`
    entry (the loader and the kit both refuse it).
  - First end-to-end run (reviewer, on a scratch build with 10 SPD rolls; Cyrene, Castorice, Hyacine, Tribbie, standard relics,
    5 cycles): runs with no warnings with an order, with `kit-option-default-used` without one; her SPD 180.812 on both the
    timeline and the kernel; Castorice deals about 70% of the team's damage at 1 enemy.
- **The Herta and Anaxa (2026-11-16, branch `claude/practical-khayyam-2c2d55`, cut from `castorice-team` at 92e0c4b):** each
  written by a Sonnet agent, reviewed by another with mutation tests, registered, with The Great Cosmic Enterprise (22004). All
  1,768 tests pass and both typechecks are clean.
  - **Engine (K29):** the enemy profile has `control_res` (generic 0); `Enemies.skipNextTurn(enemy, 'sublimation')` skips the
    next turn without Freeze's thaw advance (Freeze on the same turn takes it and clears the skip).
  - **The Herta (K30):** Interpretation and Answer kept per enemy as expected values (cap 42 / 99); her Enhanced Skill aims at the
    most-stacked enemy. Her Skill is 3 widening instances (designated 3 hits, neighbours 2, outer 1) and the stack bonus is
    added once per enemy (Fribbels' reading); both are in-game checks. One difference from Fribbels: at E6 with exactly 2
    enemies the Ultimate gets +250% (the text), Fribbels +140%. Review: no wrong numbers; 118 mutations, all killed but 3
    equivalent ones.
  - **Anaxa (K28):** weakness types counted per enemy in his kit (`src/kits/weaknessTypes.ts`, which the light cone reads);
    Qualitative Disclosure is P(5+ types), K21-scaled; his talent's extra Skill is cast with that chance and priced given that it
    is cast (Disclosure certain on its target). The Skill's 4 added instances prefer enemies not yet hit (5 enemies: one each).
    Cyrene's Ode to Reason: 3 more instances for the turn and True Knowledge (ATK and Skill DMG for Erudition allies until his
    next turn). Skill energy is 6 per instance (30 per Skill, 48 with the Ode), by analogy with Welt and not yet checked for him.
    Review: no wrong numbers; 46 mutations, all killed.
  - **End to end** (temporary test, deleted; The Herta / Anaxa / Tribbie / Hyacine on standard builds, 5 cycles, Computed):
    every member's timeline SPD equals the kernel's (133.632, 133.532, 125.632, 201.332); no warnings, nobody downed; total
    2.74M / 7.45M / 12.77M at 1 / 3 / 5 enemies with all weaknesses, 2.36M / 6.50M / 12.56M with Ice/Fire/Lightning. Anaxa casts
    2 to 4 Ultimates. Solo, each is downed early at 3 and 5 enemies (no healer), as Robin Summeretto is.
  - **In-game checks:** `docs/in-game-checks.md` 7 and 8 (Tier 1: Anaxa's Skill energy; The Herta's stack bonus once or per
    hit) and 20 to 32 (Tier 2).
  - **Open for Smitty (small, not decided):** (1) The Herta's tie rules when the middle enemy is not among the tied (aim and
    Message stack: nearest the middle, then standing order); (2) Anaxa's own Wind RES and toughness after a Wind implant outside
    Sublimation (today only Sublimation removes it; matters only with a weakness list without Wind); (3) The Great Cosmic
    Enterprise on a non-Anaxa wearer reads the scenario's count, not Anaxa's per-enemy count.
- **Next:** settle the standard-build SPD question and fix 1415.json, then one PR for the Castorice team and this one for The
  Herta and Anaxa. The period module (step 7) is built; the results report (K8) is built.
- **How waves run:** one branch per wave; Sonnet agents (medium effort) write each kit in its own files, never
  touching battle.ts or the registries; a separate Sonnet reviewer checks each kit against the text and Fribbels,
  with mutation tests; the orchestrator verifies, registers, commits, opens a PR; CI runs on the PR; Auto-fix on.

## Planned experiments

Questions the simulator exists to answer, recorded so they are run once the pieces exist.

- **Is burning Netherwing a mistake?** (Smitty, 2026-11-15.) The game's auto-battle launches Breath into the finisher on Netherwing's
  first turn, as Fribbels' combo does. Holding above 25% HP until turn 2 or 3 trades West Wind stacks (reset each turn) and an
  earlier Wings Sweep for refilled HP paying for more Breaths and a longer Territory (-20% All-Type RES on every enemy) and backup.
  Method: one scenario, the Castorice team three times, differing only in `netherwing_finish_turn` (1, 2, 3), at 1, 3 and 5 enemies,
  E0 and Smitty's own eidolons. Read: total and per-cycle damage, Breaths launched, Territory uptime in action value, downed allies.
  Needs: Cyrene registered, the kit-options scenario field (K25), the results report (K8). The Contained Dark Tide check is settled (overheal
  counts, 2026-11-15); rerun once the Breath stopping rule comes back.
- **Best Demiurge order** for the Castorice team (K26). Every order of Odes over the team's members (plus attack), searched
  exhaustively by the optimizer once it exists; until then, a few hand-written orders as teams in one scenario. Read the same as above.

## Roadmap

**Principle (Smitty, 2026-11-15): never make a decision for the end user.** NouSR designs the options and ships its own
defaults; a user can run any legal build, however odd. The simulator refuses only what can't exist in the game (impossible
relic stats) or what it can't model yet, so nobody gets a confidently wrong number.

- **Local web companion** (Smitty, 2026-11-16: post-MVP). A local server that opens a browser UI over `nousr-result` files (tables, graphs, the action log). It reads result files as a read-only data source (K33), so the CLI and engine stay unchanged.
  Reference look (Smitty, 2026-11-16): KQM's gcsim result page, e.g. https://db.kqm.gg/db/kqm-cd23eebb-93f1-44ce-848f-2f3c527aff96
  (team cards; summary cards; damage over time and cumulative; damage by character, element, target; damage by named source;
  action counts; energy by source; reactions by source; aura uptime; the config). Already in `nousr-result`: team and build
  echo, totals and per cycle, per member and per ability, action counts, the action log with action value and damage
  (so damage over time and cumulative curves), warnings, the scenario. Gaps to record first, as OPTIONAL result fields:
  energy gained per member and source, healing and shields given and taken, damage per enemy, buff and debuff uptime
  (e.g. Netherwing's Territory), named damage sources finer than ability (a hit's own name), and per-kit counters
  (`kit_stats`: Breaths, Slashed Dream, Story, breaks). gcsim's min/max/std and DPS histogram come from its many random
  iterations; NouSR's equivalent is the stochastic mode on this roadmap.
- **One-click setup package** (Smitty, 2026-11-16). A download for non-technical users that bundles Node, the built CLI and the data, so nobody has to install anything by hand; the manual install stays for CLI users.
- **Named standard-build variants** (Smitty, 2026-11-15). Several default builds per character, picked by name in a
  scenario, e.g. "signature" (the current default), "f2p" or "budget" (cheaper light cones and sets). K32 already fits each
  build's SPD to the light cone equipped.
- **User-facing documentation of standard builds** (Smitty, 2026-11-13). A rendered page (a wiki or docs site)
  that shows, per character, the standard build's sets, main stats, roll split and SPD target with its reason,
  in a form a player can read without opening JSON. Generated from `data/standard-builds/` so it cannot drift.
- **Timeline-aware build optimizer** (after the MVP). Fribbels optimizes without a clock; NouSR can score a build
  by simulating it, so SPD breakpoints and rotation timing count. Constraints rather than "maximize damage" alone:
  - Turn order: a unit acts before or after another (a buffer ahead of its DPS, or a "-1 SPD" tune behind it).
  - Skill points: a rotation that needs a Skill never finds the team at 0 SP on that turn.
  - Breakpoints: maximize damage at a target turn count per cycle (e.g. 134 SPD for 2 turns in cycle 1).
  - Skill Points planned ahead across turns (Smitty, 2026-11-15): for example The Herta using Basic ATK on a turn so a
    teammate's Skill fits later. Not MVP: today a policy decides each turn from the current state (`team.skill_points`).
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
- **Shield Effect bonuses** (Smitty, 2026-11-15: roadmap, not MVP). Self-Enshrouded Recluse makes the wearer's shields
  bigger (Dan Heng • PT at 3,000 ATK: 1,000 → about 1,220). Not modelled: it changes HP and how long a shield lasts (which
  can end the set's +15% CRIT DMG a little early), not MVP damage. Needs a way for equipment to raise a kit's shields.
- **Per-enemy weaknesses in the engine** (Smitty, 2026-11-15; "of the same caliber as the optimizer"). Weakness implants
  (Anaxa's talent, Sublimation) become per-enemy weakness state, so teammates hitting an implanted element get the weak RES
  and break toughness (K28 keeps the count in Anaxa's kit until then). When it lands, report Anaxa two ways: warmed up (5+
  types, the bonus on), the number players care about, and including the warm-up.
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
