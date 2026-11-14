import type { LightConeModule } from './equipment'

/**
 * Trend of the Universal Market (21016), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs 21016`).
 * Summary: the wearer's DEF +16% (20, 24, 28, 32% at superimpositions 2 to 5). When the wearer is attacked, there is a 100% base
 * chance (105, 110, 115, 120%) to Burn the enemy: a damage-over-time debuff of 40% (50, 60, 70, 80%) of the wearer's DEF per turn,
 * for 2 turns.
 *
 * - The DEF bonus is always on and Fribbels adds it itself (its light cone has no conditional, `TrendOfTheUniversalMarket.ts`),
 *   so it is in the wearer's DEF in `BasicStats` and in the party's DEF for the damage the wearer takes. Nothing to supply.
 * - Burn is applied to the attacking enemy as a debuff (`Battle.applyDebuff`), so it counts for every debuff consumer. The base chance
 *   is not rolled: debuffs always land (DESIGN.md, decision 4), so the only chance is the chance the attack reached the wearer, which
 *   is the chance that the debuff is present (K22). It is read from the `allyHit` event the enemy turn emits for each ally it hits,
 *   whose `hits` is the expected number of times the wearer was attacked: for a single-target, blast or AoE attack that is the chance
 *   itself (a blast's splash on the wearer counts as an attack on the wearer); for a bounce it is hits x share, so the chance of at
 *   least one is 1 - (1 - share)^hits. That event already accounts for Taunt. A damage share Fu Xuan's Matrix moves onto the wearer
 *   is not an attack on the wearer and gives no `allyHit`.
 * - The debuff's id carries the wearer, so two wearers' Burns are separate debuffs (they are in the game, which keeps a Burn per
 *   source). Re-applying one by the same wearer unions the chances and takes the newer duration (K22).
 * - It lasts 2 of the enemy's turns, counted at the start of each (the usual damage-over-time count: the debuff ticks at the start
 *   of the enemy's turn).
 *
 * NOT MODELLED: the Burn's damage. Damage over time stays out of the simulator (DESIGN.md, K7b), so the 40% to 80% of DEF it deals
 * each turn does not reach the enemy's HP or anyone's damage.
 */

const KEY = 'lightcone.21016.burn'
const DURATION_TURNS = 2

export const TrendOfTheUniversalMarket: LightConeModule = {
  kind: 'lightCone',
  id: '21016',
  name: 'Trend of the Universal Market',

  create(battle, wearer) {
    const me = wearer.key
    const level = wearer.kernel.unit.superimposition
    if (!Number.isInteger(level) || level < 1 || level > 5) {
      throw new Error(`Trend of the Universal Market: superimposition must be 1 to 5, got ${level}`)
    }
    const id = `${KEY}:${me}`

    battle.timeline.bus.on('allyHit', ({ unit, enemy, attack, hits }) => {
      if (unit !== me || !(hits > 0)) return
      const profileAttack = battle.enemies.profile.attacks.find((a) => a.id === attack)
      if (!profileAttack) throw new Error(`Trend of the Universal Market: no enemy attack "${attack}" in the profile`)
      const chance =
        profileAttack.target === 'bounce'
          ? 1 - (1 - Math.min(1, hits / profileAttack.hits)) ** profileAttack.hits
          : Math.min(1, hits)
      battle.applyDebuff({
        id,
        target: enemy,
        source: me,
        chance: Math.min(1, chance),
        duration: { turns: DURATION_TURNS, tick: 'turnStart' },
      })
    })

    return {}
  },
}
