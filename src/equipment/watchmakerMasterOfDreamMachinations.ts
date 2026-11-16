import type { EquipmentInstance, SetModule } from './equipment'
import { onUltimateOnAlly } from './ultimateOnAlly'

/**
 * Watchmaker, Master of Dream Machinations (set 118), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 118`).
 * Summary: 2 pieces, Break Effect +16% (always on). 4 pieces: when the wearer uses its Ultimate on an ally, all allies' Break Effect
 * rises 30% for 2 turns. This effect cannot be stacked.
 *
 * Kind of each part:
 * - Break Effect +16%: always on. Fribbels adds it itself (`p2c`).
 * - All allies' Break Effect +30% for 2 turns: conditional on the trigger (`onUltimateOnAlly`; how an Ultimate on an ally is read is in
 *   `ultimateOnAlly.ts`). The timeline has no Break Effect, so the effect is a marker modifier `set.118.be` (no SPD) on every ally on
 *   the timeline, 2 turns of its own counted at the end of each (the turn it was given in does not count), one shared id so it
 *   does not stack. The kernel reads the marker for the attacker: the wearer's own attacks through Fribbels' switch
 *   `setConditionals['Watchmaker, Master of Dream Machinations']` (default OFF; the module always gives its live value), a
 *   teammate's through the team form `teamRelicSet`, which Fribbels applies as all-allies Break Effect +30% (and counts once if both
 *   forms are present). At 2 pieces nothing is given.
 *
 * IN-GAME CHECK: "uses their Ultimate on an ally": read as an Ultimate that has an ally effect and does not attack, including one on all
 *   allies, and not including one on the wearer alone.
 * IN-GAME CHECK: "for 2 turns" is each ally's next 2 turns, counted at the end of each of that ally's turns.
 * IN-GAME CHECK: whether the wearer itself gets the Break Effect (read as yes: "all allies" includes the wearer).
 * IN-GAME CHECK: whether a second Ultimate on an ally while the effect is up refreshes the 2 turns (read as yes).
 */

const NAME = 'Watchmaker, Master of Dream Machinations'
const MODIFIER = 'set.118.be'

export const WatchmakerMasterOfDreamMachinations: SetModule = {
  kind: 'set',
  type: 'relic',
  name: NAME,
  setId: '118',

  create(battle, wearer, pieces): EquipmentInstance {
    if (pieces !== 4) return {}

    const me = wearer.key
    const { timeline } = battle

    onUltimateOnAlly(battle, wearer, () => {
      for (const member of battle.members) {
        for (const unit of [member.key, ...battle.memospritesOf(member.key)]) {
          if (!timeline.has(unit)) continue
          timeline.modifiers.apply({ id: MODIFIER, target: unit, source: me, duration: { turns: 2, tick: 'turnEnd' } })
        }
      }
    })

    return {
      attackerState: () => ({ setConditionals: { [NAME]: timeline.modifiers.has(me, MODIFIER) } }),
      teammateState: (attacker) => (timeline.modifiers.has(attacker.key, MODIFIER) ? { teamRelicSet: NAME } : {}),
    }
  },
}
