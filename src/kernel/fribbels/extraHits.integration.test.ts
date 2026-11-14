import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { EXTRA_ABILITY } from '../types'
import type { DamageRequest, ExtraHit, KernelBuild, KernelUnit } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * K23, extra hits for teammates: `DamageRequest.extraHits` goes through the adapter as standard Additional DMG hits of the
 * ATTACKER (Fribbels' `HitDefinitionBuilder.standardAdditional()`), returned as ability kind 'EXTRA'.
 *
 * Evidence, per hit, against Fribbels' own Additional DMG hits at the same state:
 * - Hidden Shadow (light cone 20018) puts a plain `standardAdditional()` hit of ATK on the wearer's Basic ATK. The
 *   same number as an extra hit on a wearer without the effect must be the same price.
 * - Tribbie's UNIQUE hit (the Zone's Additional DMG, 12% Max HP, Quantum) against an extra hit of HP.
 */

const jingYuanBuild: KernelBuild = {
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.InertSalsotto,
  body: Stats.CD,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const tribbieBuild: KernelBuild = {
  relicSet1: Sets.PioneerDiverOfDeadWaters,
  relicSet2: Sets.PioneerDiverOfDeadWaters,
  ornamentSet: Sets.IzumoGenseiAndTakamaDivineRealm,
  body: Stats.CD,
  feet: Stats.HP_P,
  planarSphere: Stats.Quantum_DMG,
  linkRope: Stats.HP_P,
  substatRolls: { [Stats.HP_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const enemy = { count: 1, level: 95, maxToughness: 360, resistance: 0.2, elementalWeak: true }

const HIDDEN_SHADOW = '20018'
const HIDDEN_SHADOW_S1 = 0.6
const jingYuan = (lightConeId: string): KernelUnit => ({ characterId: '1204', lightConeId, eidolon: 0, superimposition: 1 })
/** Hidden Shadow is a Nihility light cone: its effect only exists on a wearer of that path, so Pela wears it. */
const pela = (basicAtkBuff: boolean): KernelUnit => ({
  characterId: '1106',
  lightConeId: HIDDEN_SHADOW,
  eidolon: 0,
  superimposition: 1,
  lightConeConditionals: { basicAtkBuff },
})
const dhpt: KernelUnit = { characterId: '1414', lightConeId: '24002', eidolon: 0, superimposition: 5 }

const atkHit = (id: string, multiple: number, extra: Partial<ExtraHit> = {}): ExtraHit => ({ id, damageType: 'ADDITIONAL', scalingStat: 'ATK', multiple, ...extra })

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

const request = (attacker: KernelUnit, extraHits?: ExtraHit[], build = jingYuanBuild): DamageRequest => ({
  attacker,
  teammates: [dhpt],
  build,
  enemy,
  ...(extraHits && { extraHits }),
})

describe('an extra Additional hit is priced as the attacker\'s own Additional DMG hit', () => {
  it('equals Fribbels\' standard Additional hit of the same multiple (Hidden Shadow on Pela, ATK, Basic ATK), per 100% and in total', () => {
    const own = kernel.actionDamage(request(pela(true)))
    const ownHit = own.hits.BASIC![1]!
    expect(ownHit.scaling).toBeCloseTo(HIDDEN_SHADOW_S1, 12)

    const extra = kernel.actionDamage(request(pela(false), [atkHit('x', HIDDEN_SHADOW_S1)]))
    expect(extra.hits.BASIC).toHaveLength(1) // the effect is off and the extra hit is not in the Basic ATK's list
    expect(extra.hits[EXTRA_ABILITY]).toHaveLength(1)
    const price = extra.hits[EXTRA_ABILITY]![0]!
    expect(price.scaling).toBeCloseTo(HIDDEN_SHADOW_S1, 12)
    console.log(`Hidden Shadow: Fribbels' own Additional hit ${ownHit.damage}, extra hit ${price.damage}`)
    expect(price.damage).toBeCloseTo(ownHit.damage, 6)

    // An extra hit of 1.0 x ATK is the price per 100%, the number the runner multiplies a part's multiple by.
    const unit = kernel.actionDamage(request(pela(false), [atkHit('x', 1)])).hits[EXTRA_ABILITY]![0]!
    console.log(`1.0 x ATK extra hit ${unit.damage}; Fribbels' own hit per 100% ${ownHit.damage / HIDDEN_SHADOW_S1}`)
    expect(unit.scaling).toBe(1)
    expect(unit.damage).toBeCloseTo(ownHit.damage / HIDDEN_SHADOW_S1, 6)
  })

  it('equals Tribbie\'s own UNIQUE Additional hit when it scales on HP, with her element (Quantum)', () => {
    const tribbie = (conditionals: Record<string, number | boolean>): KernelUnit => ({
      characterId: '1403',
      lightConeId: '21018',
      eidolon: 0,
      superimposition: 1,
      characterConditionals: {
        numinosity: false,
        ultZone: true,
        alliesMaxHp: 0,
        talentFuaStacks: 0,
        uniqueTickCoefficient: 1,
        cyreneSpecialEffect: false,
        e1TrueDmg: true,
        e2AdditionalDmg: true,
        e4DefPen: true,
        e6FuaScaling: true,
        ...conditionals,
      },
    })
    const own = kernel.actionDamage(request(tribbie({}), undefined, tribbieBuild)).hits.UNIQUE![0]!
    expect(own.scaling).toBeCloseTo(0.12, 12)
    const hp = kernel.actionDamage(request(tribbie({}), [{ id: 'hp', damageType: 'ADDITIONAL', scalingStat: 'HP', multiple: 0.12 }], tribbieBuild))
    console.log(`Tribbie UNIQUE ${own.damage}, extra HP hit ${hp.hits[EXTRA_ABILITY]![0]!.damage}`)
    expect(hp.hits[EXTRA_ABILITY]![0]!.damage).toBeCloseTo(own.damage, 6)
    // The same hit on ATK is another number, so the stat is really read.
    const atk = kernel.actionDamage(request(tribbie({}), [atkHit('atk', 0.12)], tribbieBuild)).hits[EXTRA_ABILITY]![0]!
    expect(atk.damage).not.toBeCloseTo(own.damage, 0)
  })
})

describe('what the request does to the rest of the result', () => {
  it('leaves every ordinary ability, hit list and stat as it was without the extra hits', () => {
    const plain = kernel.actionDamage(request(jingYuan('23024')))
    const withExtra = kernel.actionDamage(request(jingYuan('23024'), [atkHit('a', 0.8), atkHit('b', 0.4)]))
    expect(withExtra.hits.EXTRA).toHaveLength(2)
    const { EXTRA: _hits, ...restHits } = withExtra.hits
    const { EXTRA: _damage, ...restDamage } = withExtra.damage
    expect(restHits).toEqual(plain.hits)
    expect(restDamage).toEqual(plain.damage)
    expect(withExtra.stats).toEqual(plain.stats)
    expect(plain.hits.EXTRA).toBeUndefined()
    // Price per 100% is the same whatever the multiple: the hits are in request order.
    const [a, b] = withExtra.hits.EXTRA!
    expect(a!.damage / 0.8).toBeCloseTo(b!.damage / 0.4, 6)
    expect(withExtra.damage.EXTRA).toBeCloseTo(a!.damage + b!.damage, 6)
  })

  it('is not left behind: a request after one with extra hits has none, and the character is unchanged', () => {
    kernel.actionDamage(request(jingYuan('23024'), [atkHit('a', 1)]))
    const after = kernel.actionDamage(request(jingYuan('23024')))
    expect(after.hits.EXTRA).toBeUndefined()
    const twice = kernel.actionDamage(request(jingYuan('23024'), [atkHit('a', 1)]))
    expect(twice.hits.EXTRA).toHaveLength(1)
  })

  it('takes the attacker\'s element unless the hit names one, and the hit-level buffs aimed at Additional DMG reach it', () => {
    const base = kernel.actionDamage(request(jingYuan('23024'), [atkHit('own', 1), atkHit('physical', 1, { element: 'Physical' })]))
    const [own, physical] = base.hits.EXTRA!
    // Jing Yuan is Lightning with a Lightning DMG sphere: the Lightning hit is boosted, the Physical one is not.
    expect(own!.damage).toBeGreaterThan(physical!.damage)
    const buffed = kernel.actionDamage({
      ...request(jingYuan('23024'), [atkHit('own', 1)]),
      injectedBuffs: [{ stat: 'DMG_PERCENT', value: 0.5, target: 'self', damageType: 'ADDITIONAL', label: 'test' }],
    })
    expect(buffed.hits.EXTRA![0]!.damage).toBeGreaterThan(own!.damage)
    // ... and an Additional-only buff does not touch the ordinary hits.
    expect(buffed.hits.BASIC![0]!.damage).toBeCloseTo(base.hits.BASIC![0]!.damage, 6)
  })

  it('rejects a bad hit by its id', () => {
    expect(() => kernel.actionDamage(request(jingYuan('23024'), [atkHit('a', 0)]))).toThrow(/Extra hit "a".*multiple/)
    expect(() => kernel.actionDamage(request(jingYuan('23024'), [atkHit('a', 1), atkHit('a', 1)]))).toThrow(/Extra hit "a".*twice/)
    expect(() => kernel.actionDamage(request(jingYuan('23024'), [atkHit('a', 1, { element: 'Sound' as never })]))).toThrow(/unknown element/)
  })
})
