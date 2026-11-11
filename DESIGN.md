# NouSR — design

Status: pre-code. Pinned target: Honkai: Star Rail 4.7.

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

**Scenario — NouSR JSON (draft):** teams, eidolon and light cone overrides, per-team priority scripts,
enemy setup, cycle count, MoC period modifiers.

## Known approximations (documented on purpose)

- **Threshold effects on expected values.** "Energy full → Ult", stack thresholds and similar are evaluated on
  expected-value state. The average over real fights can differ (a threshold on an average is not the average
  of thresholds). If in-game results disagree, fix the model and log it here.
- **Debuffs always land.** Effect Hit Rate keeps its stat value but never fails a roll.

## Period modules

A MoC period (Memory Turbulence) is a module with the same hook interface as a kit: it subscribes to events
(cycle start, Ult used, SP spent …) and registers modifiers. A scenario selects one by ID
(`"period": "moc-2026-11-survival-of-the-fittest"`). Swapping periods means adding a file and changing one field.

## Enemy profiles

JSON, modelled on hsr-simulator's format: level, HP, ATK, DEF, SPD, toughness, RES per element, and an
attack list (multiplier × ATK, target type single/blast/bounce, debuffs, energy given, priority).
v1 ships one generic MoC-level profile. Real stage bosses (summons, phases) are roadmap items that reuse
the same schema plus a behaviour module where needed. Enemy stats source: the Dimbreath datamine used by Fribbels.

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
