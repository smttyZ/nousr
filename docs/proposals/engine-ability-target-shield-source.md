# Proposal: the ally an action targets, and the source of each shield

Status: DECIDED by Smitty 2026-11-15 and BUILT. Section 1: none of the options below. "A buff lives on the unit that holds it":
Sacerdos reads the target from the `modifierApplied` events of the wearer's own Skill or Ultimate (matched by
`Battle.actionSerialInProgress`), with no change to any event (`src/equipment/sacerdosRelivedOrdeal.ts`). Section 2: built as
proposed (`Party.shieldFrom`). Section 4: decided, not built now: on the roadmap (it does not change MVP damage numbers). The options below are kept as the record of what was considered.
Serves: Sacerdos' Relived Ordeal (set 121) and Self-Enshrouded Recluse (set 128) 4-piece effects, which refuse today, so Sunday's and
Dan Heng • PT's standard builds cannot run (DESIGN.md, Step 6 notes, the ⚠ standard-builds bullet).

## 1. Ability target (changes a public event shape)

In-game text (`node tools/gamedata/lc-text.mjs --set 121`): "When using Skill or Ultimate on one ally target, increases the ability
target's CRIT DMG by 18%, lasting for 2 turn(s). This effect can stack up to 2 time(s)."

The kit already knows the target (`KitAction.use(target)`), but no event carries it. Actions that aim at one ally today:
Sunday's Skill and Ultimate, Robin Summeretto's Ultimate, Dan Heng PT's Skill (the Bondmate), and Demiurge's "This Ode, to All Lives"
(a memosprite Skill, action `ode:<key>`).

| Option | Shape | What it does to results |
|---|---|---|
| **A (recommended)** | `actionUsed.target?: UnitId`, set by the kit through a new optional last argument `performAction(actor, action, kind, body, { target })`. Absent for actions with no ally target. | A listener reacts after the action has resolved, as every other `actionUsed` listener does. None of the five actions deals damage, so the ally's next hit is the first to see the stacks. The action log records the target too. |
| B | A separate event, `allyTargeted { actor, target, action, kind, serial }`, emitted when the action starts. | Same results today (nothing in these actions deals damage). It is a second event to keep in step with `actionUsed`, and a listener that needs both has to pair them by `serial`. |
| C | A query, `battle.actionTarget(serial)`, with nothing new on the event. | Same results. Every listener has to make a second call for something the event could have carried. It also departs from K17/K22, where the event carries the action's context. |

Option A is purely additive: no existing listener changes, and `target` is optional.

## 2. Shield source (additive query, no event change)

`Party.setShield(id, key, amount, source)` already takes the source and puts it on `shieldGranted`, but the stored shield keeps only
its amount, so nothing can ask about the source later. The proposal: store `{ amount, source }` per key and add
`Party.shieldFrom(id, source): number`, the largest shield `id` holds from `source` (0 if none). "Holds a shield from X" is
`shieldFrom(id, X) > 0`. `shield`, `shieldOf` and `takeDamage` behave exactly as before.

Shields are expected values (an expected hit wears every shield down by its expected damage), so "holds a shield" is evaluated on the
expected amount. This is the documented threshold-on-expected-values approximation (DESIGN.md, Known approximations).

## 3. How the two sets would use them

- **Sacerdos 4-piece:** on `actionUsed` with `actor` the wearer, `kind` 'skill' or 'ultimate', and a `target`, the target gains a stack
  (up to 2), lasting 2 turns. Pricing: the wearer's own `setConditionals["Sacerdos' Relived Ordeal"]` is the number of stacks the wearer
  holds (0–2; Fribbels' self values). A teammate attacker holding stacks from this wearer gets `teamRelicSet` "Sacerdos' Relived Ordeal 1x"
  or "… 2x", +18% or +36% CRIT DMG, which is Fribbels' team form.
- **Recluse 4-piece:** the wearer's own switch (`enabledSelfEnshroudedRecluse`) is "the wearer holds a shield from itself". A teammate
  attacker that holds a shield from the wearer gets `teamRelicSet: 'Self-Enshrouded Recluse'` (+15% CRIT DMG). Both are read live at
  pricing time, so no event is needed.

## 4. Open: Recluse's Shield Effect +10% (2 pieces) / +12% (4 pieces)

Not modelled today: Dan Heng PT's kit computes shield amounts itself, and nothing passes the wearer's Shield Effect bonus to it.
Leaving it out makes his shields 22% smaller than in game. That affects HP lost and the shield cap (HP and aggro results), not damage.
Modelling it needs a channel from equipment to the kit (for example an equipment-supplied `shieldEffect` bonus that the kit multiplies in),
which is another interface decision. Smitty (2026-11-15): on the roadmap, not built now.
