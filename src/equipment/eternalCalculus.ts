import type { LightConeModule } from './equipment'

/**
 * Eternal Calculus (24004), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs 24004`).
 * Summary: +ATK always (Fribbels adds it: the superimposition table in its game data, `AttackAddedRatio` 0.08 to 0.12). After the wearer uses an attack, +ATK per enemy target hit, up to 5
 * stacks, lasting until the wearer's next attack. If 3 or more enemy targets were hit, the wearer's SPD rises for
 * 1 turn (8% at superimposition 1, then 10, 12, 14, 16).
 *
 * The kernel's `atkBuffStacks` is read at every pricing: the stacks the wearer's previous attack left, so an
 * attack never benefits from its own hits (the text says "after using an attack"), and the first attack of the
 * battle has none (Fribbels' default is 5). `spdBuff` is whether the SPD modifier is up. The SPD rise is a
 * modifier on the wearer, 1 of the wearer's turns counted at the end of the turn, which with the engine's
 * default does not count the turn it was applied in.
 *
 * An attack here is one `actionUsed` of the wearer, so a follow-up that a summon performs for the wearer (Jing
 * Yuan's Lightning-Lord) counts, and replaces the stacks like any other.
 * IN-GAME CHECK: whether an attack by a summon counts as "the wearer's attack" for the stacks and the SPD.
 * Enemies hit are counted per distinct enemy, as an expected number (K17): a random-target attack counts each
 * enemy by its chance of being hit at least once (`actionUsed.expectedEnemiesHit`). The stacks are that number
 * capped at 5 (so they can be fractional). The SPD rise is a threshold on that expected value: it applies when
 * the expected count is 3 or more, which is not the same as 3 or more enemies being hit in any one real fight.
 * IN-GAME CHECK: whether the stacks are counted per distinct enemy hit (as implemented).
 */

const SPD_BY_SUPERIMPOSITION = [0.08, 0.1, 0.12, 0.14, 0.16] as const
const MAX_STACKS = 5
const SPD_THRESHOLD = 3

export const EternalCalculus: LightConeModule = {
  kind: 'lightCone',
  id: '24004',
  name: 'Eternal Calculus',

  create(battle, wearer) {
    const me = wearer.key
    const { timeline } = battle
    const level = wearer.kernel.unit.superimposition
    const spd = SPD_BY_SUPERIMPOSITION[level - 1]
    if (spd === undefined) throw new Error(`Eternal Calculus: superimposition must be 1 to 5, got ${level}`)
    const id = `lightcone.24004.spd:${me}`
    let stacks = 0

    timeline.bus.on('actionUsed', (action) => {
      if (action.actor !== me) return
      // K17: the expected number of distinct enemies hit, not every enemy a random hit could reach.
      stacks = Math.min(MAX_STACKS, action.expectedEnemiesHit)
      // A threshold on an expected value (DESIGN.md, Known approximations): read as expected count >= 3, with a
      // tolerance for the rounding of a sum of probabilities (three certain hits must reach 3).
      if (action.expectedEnemiesHit >= SPD_THRESHOLD - 1e-9) {
        timeline.modifiers.apply({ id, target: me, source: me, spdPct: spd, duration: { turns: 1, tick: 'turnEnd' } })
      }
    })

    return {
      attackerState: () => ({ lightConeConditionals: { atkBuffStacks: stacks, spdBuff: timeline.modifiers.has(me, id) } }),
    }
  },
}
