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
 * - On each of the wearer's `damageDealt` events, if Mirage Fizzle has not yet been put on that enemy during
 *   this action, put it on (a debuff of the wearer, 1 turn counted on the enemy's own turns, refreshed if it
 *   is already there). The debuff counts towards the action's `debuffed` list, so the wearer's kit and
 *   teammates' talents see it.
 * - The kernel's `emptyBubblesDebuff` is whether the enemy being priced has the wearer's Mirage Fizzle right now.
 * - The debuff lands after the damage that applied it is priced, so that hit does not get the bonus; the
 *   later attack parts of the same action and the next action (until the enemy's turn ends) do.
 *
 * IN-GAME CHECK: does the hit that applies Mirage Fizzle already get the DMG bonus? The text says the
 * debuff is inflicted "when the wearer hits"; read literally, the bonus starts with the next hit. Fribbels
 * always has it on, which is the other reading. This changes every single-hit Basic ATK and Skill.
 * IN-GAME CHECK: does applying it again to an enemy that already has it count as "inflicting a debuff" for
 * Acheron's talent? Read as yes (a refresh is an application).
 * Approximation: a bounce that splits its hits across enemies in expectation puts the debuff on every enemy
 * it can reach, not on a fraction of them.
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

    // The enemies already fizzled during the action in progress. An attack that is not inside an action
    // (a bare attack) is its own attack each time.
    let actionSerial: number | undefined
    let fizzledThisAction = new Set<string>()

    timeline.bus.on('damageDealt', (hit) => {
      if (hit.attacker !== me) return
      const serial = battle.actionSerialInProgress
      if (serial === undefined) fizzledThisAction = new Set()
      else if (serial !== actionSerial) {
        actionSerial = serial
        fizzledThisAction = new Set()
      }
      if (fizzledThisAction.has(hit.enemy)) return
      fizzledThisAction.add(hit.enemy)
      battle.applyDebuff({ id, target: hit.enemy, source: me, duration: { turns: 1, tick: 'turnEnd' } })
    })

    return {
      attackerState: (enemy) => ({ lightConeConditionals: { emptyBubblesDebuff: timeline.modifiers.has(enemy, id) } }),
    }
  },
}
