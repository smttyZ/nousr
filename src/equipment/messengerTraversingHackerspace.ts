import type { EquipmentInstance, SetModule } from './equipment'
import { onUltimateOnAlly } from './ultimateOnAlly'

/**
 * Messenger Traversing Hackerspace (set 114), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 114`).
 * Summary: 2 pieces, SPD +6% (always on). 4 pieces: when the wearer uses its Ultimate on an ally, all allies' SPD rises 12% for
 * 1 turn. This effect cannot be stacked.
 *
 * Kind of each part:
 * - SPD +6%: always on. Fribbels adds it itself (`p2c`), so the scenario's SPD already has it.
 * - All allies' SPD +12% for 1 turn: conditional on the trigger, in two places that have to agree (the way Amphoreus, The Eternal Land does it):
 *   - The timeline: when the wearer's Ultimate on an ally resolves (`onUltimateOnAlly`: how it is read is in `ultimateOnAlly.ts`),
 *     every ally on the timeline gets the modifier `set.114.spd` (`spdPct` 0.12) for 1 turn of its own, counted at the end of its turn
 *     (the turn it was given in does not count). One shared id, so a second application refreshes it and two wearers cannot stack it.
 *     Allies are characters and memosprites that are on the timeline when it is applied: a memosprite that joins later does not get it.
 *   - The kernel: Fribbels' switch `setConditionals['Messenger Traversing Hackerspace']` gives the wearer its own 12% (its own attack),
 *     and a teammate's attack reads the team form `teamRelicSet` ('Messenger Traversing Hackerspace' is a teammate set in Fribbels
 *     although its equipment detection leaves it out). Both are on exactly when the attacker holds the modifier, so the timeline's SPD
 *     and the kernel's SPD agree for the wearer and every teammate; that keeps the checks that compare them quiet (Fleet of the
 *     Ageless's 120 SPD threshold, Giant Tree of Rapt Brooding, a kit's `checkSpd`). Fribbels counts the effect once when both forms
 *     are present, which is "cannot be stacked" in the kernel, as the shared modifier id is on the timeline. Fribbels' default for the
 *     switch is OFF, and the module gives its live value anyway.
 *   At 2 pieces nothing is given.
 *
 * NOT MODELLED: nothing is refused; an Ultimate on an ally that leaves no trace in the events (see `ultimateOnAlly.ts`) does not trigger.
 *
 * IN-GAME CHECK: "uses their Ultimate on an ally": read as an Ultimate that has an ally effect and does not attack, including one on all
 *   allies (Hyacine's) and not including one on the wearer alone (Sunday's Ultimate on himself).
 * IN-GAME CHECK: "for 1 turn" is each ally's next turn (the buff ends at the end of that turn). The engine puts every Ultimate between turns.
 * IN-GAME CHECK: whether the wearer itself gets the SPD (read as yes: "all allies" includes the wearer).
 */

const NAME = 'Messenger Traversing Hackerspace'
const MODIFIER = 'set.114.spd'
const SPD_PCT = 0.12

export const MessengerTraversingHackerspace: SetModule = {
  kind: 'set',
  type: 'relic',
  name: NAME,
  setId: '114',

  create(battle, wearer, pieces): EquipmentInstance {
    if (pieces !== 4) return {}

    const me = wearer.key
    const { timeline } = battle

    onUltimateOnAlly(battle, wearer, () => {
      for (const member of battle.members) {
        for (const unit of [member.key, ...battle.memospritesOf(member.key)]) {
          if (!timeline.has(unit)) continue
          timeline.modifiers.apply({ id: MODIFIER, target: unit, source: me, spdPct: SPD_PCT, duration: { turns: 1, tick: 'turnEnd' } })
        }
      }
    })

    return {
      attackerState: () => ({ setConditionals: { [NAME]: timeline.modifiers.has(me, MODIFIER) } }),
      teammateState: (attacker) => (timeline.modifiers.has(attacker.key, MODIFIER) ? { teamRelicSet: NAME } : {}),
    }
  },
}
