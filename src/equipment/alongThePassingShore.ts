import type { LightConeModule } from './equipment'

/**
 * Along the Passing Shore (23024), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs 23024`).
 * Summary: a CRIT DMG stat (always on, Fribbels adds it). When the wearer hits an enemy it puts Mirage
 * Fizzle on it for 1 turn, at most once per target per attack. The wearer deals more DMG to enemies with
 * Mirage Fizzle, and more again with its Ultimate (24% and 24% at superimposition 1).
 *
 * Mirage Fizzle is a debuff. That is why this module exists: a debuff the wearer puts on an enemy
 * feeds Acheron's talent (a Slashed Dream and a Crimson Knot per ability) and every "against debuffed
 * enemies" effect (Pioneer Diver, her E1). The DMG bonus itself is Fribbels' `emptyBubblesDebuff` switch, which is on for
 * every hit of the wearer's.
 *
 * How it is modelled:
 * - On each of the wearer's `damageDealt` events, put Mirage Fizzle on that enemy (a debuff of the wearer, 1 turn counted
 *   on the enemy's own turns, refreshed if it is already there) with the event's `chance`: the probability the attack hit
 *   that enemy at least once (K22). An enemy a single, blast or AoE part reaches gets it for certain; an enemy only a
 *   bounce reaches gets it with the bounce's chance of landing there. Several attack calls in one action combine as
 *   independent applications, which is the chance that at least one of them hit (the text's "once per target per attack"
 *   is that one Fizzle, not a count). The debuff counts towards the action's `debuffed` list and `debuffChance`, so the
 *   wearer's kit and teammates' talents see it.
 * - The kernel's `emptyBubblesDebuff` is on for every hit the wearer deals (Fribbels' default): the hit that applies Mirage Fizzle
 *   already gets the DMG bonus, so there is no priced "without" state to weight by the debuff's chance. The debuff itself is
 *   still applied after the damage event (so it counts for the action's `debuffed` list, Acheron's talent and the like); only
 *   the DMG bonus ignores whether it was up beforehand.
 *
 * Settled by Smitty in game, 2026-11-15: the hit that applies Mirage Fizzle already gets the bonus (Fribbels' reading). Non-crit
 * 2,028, then 2,842 with Sunday's +53%: 2,842 / 2,028 = 1.4014, matching 1.85 / 1.32 = 1.4015.
 * IN-GAME CHECK: does applying it again to an enemy that already has it count as "inflicting a debuff" for
 * Acheron's talent? Read as yes (a refresh is an application).
 */

const MIRAGE_FIZZLE = 'lightcone.23024.mirage_fizzle'

export const AlongThePassingShore: LightConeModule = {
  kind: 'lightCone',
  id: '23024',
  name: 'Along the Passing Shore',

  create(battle, wearer) {
    const me = wearer.key
    const { timeline } = battle
    const id = `${MIRAGE_FIZZLE}:${me}`

    timeline.bus.on('damageDealt', (hit) => {
      if (hit.attacker !== me || !(hit.chance > 0)) return
      battle.applyDebuff({ id, target: hit.enemy, source: me, chance: hit.chance, duration: { turns: 1, tick: 'turnEnd' } })
    })

    return {
      attackerState: () => ({ lightConeConditionals: { emptyBubblesDebuff: true } }),
    }
  },
}
