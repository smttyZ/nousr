import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { loadLevelTable, lockedMinorPoints, maxLevels } from '../../levels/levels'
import type { KernelBuild, KernelUnit } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Locked minor traces through the real kernel (K15): the unit's out-of-combat and in-combat stats lose exactly the locked nodes'
 * bonuses, teammates' locked traces are applied to their own forms, and Fribbels' process-global override store is put back.
 */

const build: KernelBuild = {
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.InertSalsotto,
  body: Stats.CD,
  feet: Stats.HP_P,
  planarSphere: Stats.Ice_DMG,
  linkRope: Stats.HP_P,
  substatRolls: { [Stats.HP_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const table = loadLevelTable('1415', 0)!
const unit = (deactivatedTraces?: string[]): KernelUnit => ({
  characterId: '1415',
  lightConeId: '23052',
  eidolon: 0,
  superimposition: 1,
  ...(deactivatedTraces !== undefined && { deactivatedTraces }),
})
/** S3, S4, S5, S7, S10: the locked ones in a real scan of this character (CRIT DMG x4, HP% x1). */
const locked = (): string[] => {
  const levels = maxLevels(table, 0)
  for (const n of [3, 4, 5, 7, 10]) levels.minorTraces[n - 1] = false
  return lockedMinorPoints(table, levels)
}

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

describe('locked minor traces in the real kernel', () => {
  it('the table lists the same locked nodes as ids Fribbels knows', () => {
    expect(locked()).toEqual(['1415203', '1415204', '1415205', '1415207', '1415210'])
  })

  it('out-of-combat CRIT DMG and Max HP drop by exactly the locked nodes (0.053 + 0.08 + 0.08 + 0.107, HP 4%)', () => {
    const full = kernel.basicStats(unit(), build)
    const some = kernel.basicStats(unit(locked()), build)
    expect(full.CD - some.CD).toBeCloseTo(0.053 + 0.08 + 0.08 + 0.107, 6)
    expect(some.HP).toBeLessThan(full.HP)
    expect(some.SPD).toBe(full.SPD)
    // Nothing leaked into the next call: the store was restored.
    expect(kernel.basicStats(unit(), build).CD).toBeCloseTo(full.CD, 12)
  })

  it('a locked SPD node lowers SPD by its value (S6: +3)', () => {
    const full = kernel.basicStats(unit(), build)
    expect(full.SPD - kernel.basicStats(unit(['1415206']), build).SPD).toBeCloseTo(3, 9)
  })

  it('in-combat stats and damage follow, and the unit with no locked trace is unchanged afterwards', () => {
    const request = { attacker: unit(), teammates: [], build }
    const before = kernel.actionDamage(request)
    const cut = kernel.actionDamage({ ...request, attacker: unit(locked()) })
    // Fribbels keeps these as float32 values (0.31999993), so six places.
    expect(before.stats.CD - cut.stats.CD).toBeCloseTo(0.053 + 0.08 + 0.08 + 0.107, 6)
    expect(cut.damage.BASIC).toBeLessThan(before.damage.BASIC!)
    expect(kernel.actionDamage(request).damage).toEqual(before.damage)
  })

  it('the store is restored even when the run throws', () => {
    const full = kernel.basicStats(unit(), build)
    expect(() => kernel.actionDamage({ attacker: { ...unit(locked()), lightConeId: 'no-such' }, teammates: [], build })).toThrow()
    expect(kernel.basicStats(unit(), build).CD).toBeCloseTo(full.CD, 12)
  })
})
