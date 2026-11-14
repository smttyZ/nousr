import { probabilityAtLeastEnemiesHit } from '../battle/hitProbability'
import type { HitPart } from '../battle/battle'
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
 * capped at 5 (so they can be fractional). The SPD rise is the buff scaled by the chance the condition holds (K21):
 * P(3 or more distinct enemies hit) x the superimposition's SPD%, as the modifier's value, for its duration. The
 * probability comes from the action's own attacks (`attackResolved` parts) through `src/battle/hitProbability.ts`,
 * exactly, not from the expected count. Where the chance is 0 (one target), nothing is applied.
 * IN-GAME CHECK: whether the stacks are counted per distinct enemy hit (as implemented).
 */

const SPD_BY_SUPERIMPOSITION = [0.08, 0.1, 0.12, 0.14, 0.16] as const
const MAX_STACKS = 5
const SPD_THRESHOLD = 3
/** Below this chance the SPD rise is not applied at all (float noise). */
const NEGLIGIBLE = 1e-12

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
    /** The attacks (each one `Battle.attack` call) the wearer has made in the action in progress. */
    let attacks: HitPart[][] = []
    let field: { enemies: readonly string[], primary: string } | undefined

    timeline.bus.on('attackResolved', (attack) => {
      if (attack.attacker !== me) return
      attacks.push([...attack.parts])
      field = { enemies: [...battle.enemies.ids], primary: battle.primary }
    })

    timeline.bus.on('actionUsed', (action) => {
      if (action.actor !== me) return
      // K17: the expected number of distinct enemies hit, not every enemy a random hit could reach.
      stacks = Math.min(MAX_STACKS, action.expectedEnemiesHit)
      // K21: the SPD rise is scaled by the chance that 3 or more distinct enemies were hit, not cut off at an
      // expected count. No resolved attack means no enemy was hit.
      const chance = field === undefined ? 0 : probabilityAtLeastEnemiesHit({ attacks, ...field }, SPD_THRESHOLD)
      attacks = []
      field = undefined
      if (chance > NEGLIGIBLE) {
        timeline.modifiers.apply({ id, target: me, source: me, spdPct: spd * chance, duration: { turns: 1, tick: 'turnEnd' } })
      }
    })

    return {
      attackerState: () => ({ lightConeConditionals: { atkBuffStacks: stacks, spdBuff: timeline.modifiers.has(me, id) } }),
    }
  },
}
