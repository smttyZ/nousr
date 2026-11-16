import { describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import type { DamageRequest } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/** Anaxa's kit switches through the real Fribbels kernel (the kit's own tests use a fake kernel). */

describe('Anaxa through the real kernel, with Fribbels own switches', () => {
  const kernel = new FribbelsKernel()
  const build = { relicSet1: Sets.ScholarLostInErudition, relicSet2: Sets.ScholarLostInErudition, ornamentSet: Sets.RutilantArena, body: Stats.CD, feet: Stats.SPD, planarSphere: Stats.Wind_DMG, linkRope: Stats.ATK_P, substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 } }
  const cyrene = { characterId: '1415', lightConeId: '21018', eidolon: 0, superimposition: 1 }
  const price = (conditionals: Record<string, unknown>, o: { teammates?: DamageRequest['teammates'], injectedBuffs?: DamageRequest['injectedBuffs'], eidolon?: number } = {}) => {
    const r = kernel.actionDamage({
      attacker: { characterId: '1405', lightConeId: '21018', eidolon: o.eidolon ?? 0, superimposition: 1, characterConditionals: { enemyWeaknessTypes: 0, exposedNature: false, e1DefPen: false, e2ResPen: false, e4AtkBuffStacks: 0, e6Buffs: false, cyreneSpecialEffect: false, ...conditionals } },
      teammates: o.teammates ?? [],
      build,
      ...(o.injectedBuffs && { injectedBuffs: o.injectedBuffs }),
      enemy: { count: 3, level: 95, maxToughness: 360, resistance: 0.2, elementalWeak: true, weaknessBroken: false },
    })
    return { skill: r.hits.SKILL![0]!, atk: r.stats.ATK }
  }
  const perUnit = (p: { skill: { damage: number, scaling?: number } }) => p.skill.damage / p.skill.scaling!

  it('a partial Disclosure injected as DMG% equals the Fribbels switch at the same value: injecting 0.3 is exposedNature on', () => {
    const on = perUnit(price({ exposedNature: true }))
    const injected = perUnit(price({}, { injectedBuffs: [{ stat: 'DMG_PERCENT', value: 0.3, target: 'self' }] }))
    expect(injected).toBeCloseTo(on, 6)
    expect(on).toBeGreaterThan(perUnit(price({})))
  })

  it('the Skill is priced per 100%: skillHits changes the scaling, not the price per unit', () => {
    expect(perUnit(price({ skillHits: 7 }))).toBeCloseTo(perUnit(price({ skillHits: 4 })), 6)
    expect(price({ skillHits: 7 }).skill.scaling).toBeCloseTo(0.7 * 8, 9)
  })

  it('his own E1, E2, E6 and Ode switches change his own damage, and the Ode needs a Cyrene in the team (Cyrene E3 upgrades 60/40 to 66/44)', () => {
    const base = perUnit(price({}, { eidolon: 6 }))
    expect(perUnit(price({ e1DefPen: true }, { eidolon: 6 }))).toBeGreaterThan(base)
    expect(perUnit(price({ e2ResPen: true }, { eidolon: 6 }))).toBeGreaterThan(base)
    expect(perUnit(price({ e6Buffs: true }, { eidolon: 6 }))).toBeGreaterThan(base)
    const noCyrene = price({ cyreneSpecialEffect: true }, { eidolon: 6 })
    expect(perUnit(noCyrene)).toBeCloseTo(base, 6)
    const e0 = price({ cyreneSpecialEffect: true }, { eidolon: 6, teammates: [cyrene] })
    const e3 = price({ cyreneSpecialEffect: true }, { eidolon: 6, teammates: [{ ...cyrene, eidolon: 3 }] })
    const off = price({}, { eidolon: 6, teammates: [cyrene] })
    expect((e3.atk - off.atk) / (e0.atk - off.atk)).toBeCloseTo(1.1, 3)
    expect(e0.atk).toBeGreaterThan(off.atk)
    expect(e3.atk).toBeGreaterThan(e0.atk)
    expect(perUnit(e3)).toBeGreaterThan(perUnit(e0))
  })
})
