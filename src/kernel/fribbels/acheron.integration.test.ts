import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { Battle } from '../../battle/battle'
import type { EngineEvents } from '../../engine'
import { loadEnemyProfile } from '../../enemy/profile'
import { Acheron, acheronReferenceScaling } from '../../kits/acheron'
import type { DamageRequest, KernelBuild } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

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
const unit = { characterId: '1308', lightConeId: '23024', eidolon: 0, superimposition: 1 }
const profile = loadEnemyProfile('generic-moc')

/** The request the battle runner sends for solo Acheron against one generic enemy. */
const request = (conditionals: Record<string, number | boolean>): DamageRequest => ({
  attacker: {
    ...unit,
    characterConditionals: {
      crimsonKnotStacks: 0,
      stygianResurgeHitsOnTarget: 0,
      thunderCoreStacks: 0,
      nihilityTeammatesBuff: true,
      e1EnemyDebuffed: false,
      e4UltVulnerability: true,
      e6UltBuffs: true,
      ...conditionals,
    },
  },
  teammates: [],
  build,
  enemy: { count: 1, level: 95, maxToughness: 360, resistance: 0.2, elementalWeak: true },
})

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

describe('Acheron through the real kernel', () => {
  it('Fribbels\' damage is proportional to the ATK multiple, so per-part scaling is exact', () => {
    const reference = acheronReferenceScaling(0, 1).ULT!
    const bare = kernel.actionDamage(request({ thunderCoreStacks: 3 })).damage.ULT!
    const full = kernel.actionDamage(request({ thunderCoreStacks: 3, crimsonKnotStacks: 9, stygianResurgeHitsOnTarget: 6 })).damage.ULT!
    const fullScaling = 3 * 0.24 + 3 * 0.15 + 0.15 * 9 + 1.2 + 6 * 0.25
    expect(full / fullScaling).toBeCloseTo(bare / reference, 6)
  })

  it('a solo battle: the Skill matches Fribbels, and the Ultimate sits between no Thunder Core and full Thunder Core', () => {
    const battle = new Battle({
      members: [{
        key: 'acheron',
        kit: Acheron,
        eidolon: 0,
        affinitiveEidolon: false,
        stats: { maxHp: 1_000_000, def: 1000, baseSpd: 101 },
        kernel: { unit, build },
      }],
      policy: [
        { unit: 'acheron', use: 'ultimate', when: [] },
        { unit: 'acheron', use: 'skill', when: [] },
        { unit: 'acheron', use: 'basic', when: [] },
      ],
      profile,
      enemyCount: 1,
      weaknesses: 'all',
      cycles: 5,
      start: { energy: 0.5, skillPoints: 3, techniques: true },
      kernel,
    })
    const dealt: EngineEvents['damageDealt'][] = []
    battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
    const result = battle.run()

    expect(result.actions.map((a) => a.action)).toEqual(['skill', 'skill', 'skill', 'basic', 'skill', 'ultimate'])

    const firstSkill = dealt.find((d) => d.ability === 'SKILL')!
    expect(firstSkill.damage).toBeCloseTo(kernel.actionDamage(request({})).damage.SKILL!, 6)

    const ultimate = dealt.filter((d) => d.ability === 'ULT').reduce((sum, d) => sum + d.damage, 0)
    const fribbels = (thunderCoreStacks: number) =>
      kernel.actionDamage(request({ thunderCoreStacks, crimsonKnotStacks: 9, stygianResurgeHitsOnTarget: 6 })).damage.ULT!
    expect(ultimate).toBeGreaterThan(fribbels(0))
    expect(ultimate).toBeLessThan(fribbels(3))

    expect(result.totalDamage).toBeGreaterThan(0)
    expect(result.downed).toEqual([])
  })
})
