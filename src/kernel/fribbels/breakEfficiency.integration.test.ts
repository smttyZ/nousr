import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import type { DamageRequest, KernelBuild } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/** Weakness Break Efficiency reaches the runner from the kernel's `StatKey.BREAK_EFFICIENCY_BOOST`. */
const build: KernelBuild = {
  relicSet1: Sets.PioneerDiverOfDeadWaters,
  relicSet2: Sets.PioneerDiverOfDeadWaters,
  ornamentSet: Sets.IzumoGenseiAndTakamaDivineRealm,
  body: Stats.CD,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}

// Fugue (1225): her E6 gives +50% Weakness Break Efficiency, behind a switch.
const fugue = (eidolon: number, e6BreakEfficiency: boolean): DamageRequest => ({
  attacker: { characterId: '1225', lightConeId: '23024', eidolon, superimposition: 1, characterConditionals: { e6BreakEfficiency } },
  teammates: [],
  build,
  enemy: { count: 1, level: 95, maxToughness: 360, resistance: 0.2, elementalWeak: true },
})

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

describe('Weakness Break Efficiency from the kernel', () => {
  it('is 0 for a character with none, and a fraction that follows the kernel switch for one with some', () => {
    const none = kernel.actionDamage({ ...fugue(0, true), attacker: { characterId: '1204', lightConeId: '24004', eidolon: 0, superimposition: 1 } })
    expect(none.stats.breakEfficiency).toBe(0)
    const off = kernel.actionDamage(fugue(6, false)).stats.breakEfficiency!
    const on = kernel.actionDamage(fugue(6, true)).stats.breakEfficiency!
    expect(on - off).toBeCloseTo(0.5, 12)
    expect(on).toBeGreaterThan(0.5 - 1e-12)
  })
})
