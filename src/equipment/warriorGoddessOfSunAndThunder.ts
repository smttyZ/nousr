import type { SetModule } from './equipment'

/**
 * Warrior Goddess of Sun and Thunder (set 125), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 125`).
 * Summary: 2 pieces +6% SPD. 4 pieces: when the wearer or their memosprite heals allies other than the wearer, the
 * wearer gains "Gentle Rain" for 2 turns, at most once per turn and without stacking. While the wearer has it: +6%
 * SPD for the wearer, and all allies' CRIT DMG +15%.
 *
 * Modelled as:
 * - Gentle Rain is a modifier on the wearer: SPD +6%, for 2 of the wearer's turns, counted down at the wearer's turn
 *   end, not counting the turn it was gained in (the same convention as Pioneer Diver's doubling).
 * - The wearer's own attacks: Fribbels' conditional for the set is the Gentle Rain flag. The module passes the live
 *   value (on while the modifier is up); Fribbels' default is off.
 * - A teammate's attack: while the wearer has Gentle Rain, the wearer gives the team the set's team effect, which is
 *   Fribbels' all-allies CRIT DMG 15%.
 * - The trigger reads the `healed` event. The party emits it with the healer as `source`. A heal counts when its target
 *   is an ally other than the wearer, including a heal that overheals.
 *
 * NOT MODELLED: memosprite healing. The engine has no memosprite (only untargetable summons, K6). A heal counts as the
 * memosprite's when its source is a summon whose id starts with the wearer's key and a dot, which is the summon id
 * convention in battle.ts. Nothing exercises it yet: no kit heals and no kit has a memosprite.
 *
 * IN-GAME CHECK: "can only trigger once per turn" is read as once per turn of the battle: the turn whose unit is acting
 * when the heal lands. The other reading is once per turn of the wearer.
 * IN-GAME CHECK: whether an overheal counts as "provides healing". Counted as yes.
 *
 * The 2-piece SPD +6% is not added here. The scenario's SPD is taken to include set SPD already, as it does for
 * Musketeer of Wild Wheat's 4-piece SPD.
 */

const NAME = 'Warrior Goddess of Sun and Thunder'
const GENTLE_RAIN = 'set.125.gentleRain'

export const WarriorGoddessOfSunAndThunder: SetModule = {
  kind: 'set',
  type: 'relic',
  name: NAME,
  setId: '125',

  create(battle, wearer, pieces) {
    const me = wearer.key
    const { timeline } = battle
    /** Serial of the last turn in which Gentle Rain was triggered. */
    let triggeredOnTurn: number | undefined

    timeline.bus.on('healed', ({ unit, amount, overheal, source }) => {
      if (pieces < 4) return
      if (unit === me || !battle.isAlly(unit)) return
      if (!(amount + overheal > 0)) return
      if (!(source === me || (battle.isSummon(source) && source.startsWith(`${me}.`)))) return
      const turn = timeline.activeTurn
      if (turn && turn.serial === triggeredOnTurn) return
      triggeredOnTurn = turn?.serial
      timeline.modifiers.apply({ id: GENTLE_RAIN, target: me, source: me, spdPct: 0.06, duration: { turns: 2, tick: 'turnEnd' } })
    })

    const up = () => timeline.modifiers.has(me, GENTLE_RAIN)
    return {
      attackerState: () => ({ setConditionals: { [NAME]: pieces >= 4 && up() } }),
      teammateState: () => (pieces >= 4 && up() ? { teamRelicSet: NAME } : {}),
    }
  },
}
