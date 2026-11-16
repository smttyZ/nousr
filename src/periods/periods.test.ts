import { describe, expect, it } from 'vitest'
import { Battle, type BattleSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult, ZERO_STATS } from '../kernel/testing'
import type { Kit } from '../kits/kit'
import { createPeriodRegistry, MOC_2026_11_SURVIVAL_OF_THE_FITTEST, PERIODS, resolvePeriod, SurvivalOfTheFittest } from './index'

const kit = (path: Kit['path']): Kit => ({
  characterId: 'x',
  path,
  element: 'Fire',
  maxEnergy: 100,
  create: () => ({ actions: {}, attackerState: () => ({}), teammateState: () => ({}) }),
})

function setup(paths: Kit['path'][]): BattleSetup {
  return {
    members: paths.map((path, i) => ({ key: `m${i}`, kit: kit(path), eidolon: 0, affinitiveEidolon: false, technique: false, stats: { ...ZERO_STATS, maxHp: 1000, def: 100, baseSpd: 100 + i }, kernel: { unit: {} as never, build: {} as never } })),
    policy: [],
    profile: loadEnemyProfile('generic-moc'),
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0.5, skillPoints: 3, techniques: false },
    kernel: { damage: () => fakeResult({}) } as never,
    period: SurvivalOfTheFittest,
  }
}

describe('the period registry', () => {
  it('knows the current period by its id', () => {
    expect(resolvePeriod(MOC_2026_11_SURVIVAL_OF_THE_FITTEST, PERIODS)).toBe(SurvivalOfTheFittest)
    expect(MOC_2026_11_SURVIVAL_OF_THE_FITTEST).toBe('moc-2026-11-survival-of-the-fittest')
  })

  it('stops on an unknown id and lists the known ones', () => {
    const two = createPeriodRegistry([SurvivalOfTheFittest, { id: 'other', name: 'Other', create: () => {} }])
    expect(() => resolvePeriod('nope', two)).toThrow('unknown period "nope" (known periods: moc-2026-11-survival-of-the-fittest, other)')
    expect(() => resolvePeriod('nope', createPeriodRegistry([]))).toThrow('known periods: none')
  })

  it('refuses a duplicate id', () => {
    expect(() => createPeriodRegistry([SurvivalOfTheFittest, SurvivalOfTheFittest])).toThrow(/registered twice/)
  })
})

describe('Survival of the Fittest', () => {
  it('reports nothing for a team with no Elation-path member', () => {
    const paths: Kit['path'][] = ['Destruction', 'Hunt', 'Harmony', 'Nihility', 'Preservation', 'Abundance', 'Remembrance', 'Erudition']
    expect(SurvivalOfTheFittest.check!(setup(paths).members)).toEqual([])
  })

  it('names every Elation-path member', () => {
    const problems = SurvivalOfTheFittest.check!(setup(['Hunt', 'Elation', 'Elation']).members)
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/^member "m1".*Elation's Punchlines and Aha are not modelled yet; this period would change the result$/)
    expect(problems[1]).toMatch(/^member "m2"/)
  })

  it('a battle built directly with an Elation member throws when the period is attached; without one it is built', () => {
    expect(() => new Battle(setup(['Hunt', 'Elation']))).toThrow(/member "m1".*not modelled yet/)
    expect(() => new Battle(setup(['Hunt', 'Harmony']))).not.toThrow()
  })
})
