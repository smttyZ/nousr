import { certain } from '../battle/battle'
import type { LightConeModule } from './equipment'

/**
 * Along the Passing Shore (23024), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs 23024`).
 * Summary: a CRIT DMG stat (always on, Fribbels adds it). When the wearer hits an enemy it puts Mirage
 * Fizzle on it for 1 turn, at most once per target per attack. The wearer deals more DMG to enemies with
 * Mirage Fizzle, and more again with its Ultimate (24% and 24% at superimposition 1).
 *
 * Mirage Fizzle is a debuff. That is why this module exists: a debuff the wearer puts on an enemy
 * feeds Acheron's talent (a Slashed Dream and a Crimson Knot per ability) and every "against debuffed
 * enemies" effect (Pioneer Diver, her E1). Fribbels has its `emptyBubblesDebuff` switch on by default,
 * which would also count the first hit of every attack as buffed.
 *
 * How it is modelled:
 * - On each of the wearer's `damageDealt` events, put Mirage Fizzle on that enemy (a debuff of the wearer, 1 turn counted
 *   on the enemy's own turns, refreshed if it is already there) with the event's `chance`: the probability the attack hit
 *   that enemy at least once (K22). An enemy a single, blast or AoE part reaches gets it for certain; an enemy only a
 *   bounce reaches gets it with the bounce's chance of landing there. Several attack calls in one action combine as
 *   independent applications, which is the chance that at least one of them hit (the text's "once per target per attack"
 *   is that one Fizzle, not a count). The debuff counts towards the action's `debuffed` list and `debuffChance`, so the
 *   wearer's kit and teammates' talents see it.
 * - The kernel's `emptyBubblesDebuff` is whether the enemy being priced has the wearer's Mirage Fizzle right now, a switch
 *   priced in each debuff state and weighted by the chance (K21, `Battle.kernelResult`).
 * - The debuff lands after the damage that applied it is priced, so that hit does not get the bonus; the
 *   later attack parts of the same action and the next action (until the enemy's turn ends) do.
 *
 * IN-GAME CHECK: does the hit that applies Mirage Fizzle already get the DMG bonus? The text says the
 * debuff is inflicted "when the wearer hits"; read literally, the bonus starts with the next hit. Fribbels
 * always has it on, which is the other reading. This changes every single-hit Basic ATK and Skill.
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
      attackerState: (enemy) => ({ lightConeConditionals: { emptyBubblesDebuff: certain(battle.presence(enemy, id)) } }),
    }
  },
}
