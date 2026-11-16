import { describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { FribbelsKernel } from './fribbelsKernel'

/** The Great Cosmic Enterprise's numbers per superimposition through the real Fribbels kernel. */

describe('The Great Cosmic Enterprise through the real kernel (per superimposition)', () => {
  const kernel = new FribbelsKernel()
  const build = { relicSet1: Sets.ScholarLostInErudition, relicSet2: Sets.ScholarLostInErudition, ornamentSet: Sets.RutilantArena, body: Stats.CD, feet: Stats.SPD, planarSphere: Stats.Wind_DMG, linkRope: Stats.ATK_P, substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 } }
  const price = (superimposition: number, weaknessTypes: number) =>
    kernel.actionDamage({
      attacker: { characterId: '1405', lightConeId: '22004', eidolon: 0, superimposition, lightConeConditionals: { weaknessTypes }, characterConditionals: { enemyWeaknessTypes: 0, exposedNature: false } },
      teammates: [],
      build,
      enemy: { count: 1, level: 95, maxToughness: 360, resistance: 0.2, elementalWeak: true, weaknessBroken: false },
    })

  it('ATK +8 / 10 / 12 / 14 / 16% (2% of base ATK a step) and the DMG per Type 4 / 5 / 6 / 7 / 8%, linear in the Types (fractions too)', () => {
    const atk = [1, 2, 3, 4, 5].map((level) => price(level, 0).stats.ATK)
    const step = atk[1]! - atk[0]!
    for (let i = 1; i < 5; i++) expect(atk[i]! - atk[i - 1]!).toBeCloseTo(step, 2)
    const gain = (level: number, types: number) => price(level, types).damage.BASIC! / price(level, 0).damage.BASIC! - 1
    const perType = [1, 2, 3, 4, 5].map((level) => gain(level, 7) / 7)
    // DMG% is additive with the other boosts, so the gain per Type is d / (1 + the other boosts): the ratios between levels are d's.
    perType.forEach((g, i) => expect(g / perType[0]!).toBeCloseTo((0.04 + 0.01 * i) / 0.04, 6))
    for (const level of [1, 5]) expect(gain(level, 2.5)).toBeCloseTo((gain(level, 7) * 2.5) / 7, 6)
  })
})
