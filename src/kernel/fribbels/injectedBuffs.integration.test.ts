import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import type {
  ConditionalValues,
  DamageRequest,
  InjectedBuff,
  KernelBuild,
  KernelTeammate,
  KernelUnit,
  ScannedBuild,
  ScannedRelic,
} from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Injected buffs (DESIGN.md, K15a) through the real kernel. Each test compares an injected buff with
 * the same buff applied by Fribbels' own character code, which is the proof that the injection point
 * is right: a teammate's switch turned off plus the buff injected must equal the switch left on.
 */
const ACHERON = '1308'
const CYRENE = '1415'
const FU_XUAN = '1208'
const CASTORICE = '1407'
const ALONG_THE_PASSING_SHORE = '23024'
const CYRENE_CONE = '23052'
const FU_XUAN_CONE = '23011'

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

const acheron: KernelUnit = {
  characterId: ACHERON,
  lightConeId: ALONG_THE_PASSING_SHORE,
  eidolon: 0,
  superimposition: 1,
  characterConditionals: {
    crimsonKnotStacks: 0,
    stygianResurgeHitsOnTarget: 0,
    thunderCoreStacks: 3,
    nihilityTeammatesBuff: true,
    e1EnemyDebuffed: false,
    e4UltVulnerability: true,
    e6UltBuffs: true,
  },
}
const enemy = { count: 1, level: 95, maxToughness: 360, resistance: 0.2, elementalWeak: true }

const teammate = (characterId: string, lightConeId: string, conditionals: ConditionalValues = {}): KernelTeammate => ({
  characterId,
  lightConeId,
  eidolon: 0,
  superimposition: 1,
  characterConditionals: conditionals,
})

const cyrene = (conditionals: ConditionalValues = {}) => teammate(CYRENE, CYRENE_CONE, conditionals)
const fuXuan = (conditionals: ConditionalValues = {}) => teammate(FU_XUAN, FU_XUAN_CONE, conditionals)

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

const price = (
  attacker: KernelUnit,
  mate: KernelTeammate,
  injectedBuffs?: InjectedBuff[],
  relics: KernelBuild = build,
): Record<string, number> => {
  const request: DamageRequest = { attacker, teammates: [mate], build: relics, enemy, ...(injectedBuffs && { injectedBuffs }) }
  return kernel.actionDamage(request).damage
}

const ABILITIES = ['BASIC', 'SKILL', 'ULT', 'BREAK'] as const
const near = (a: Record<string, number>, b: Record<string, number>, kinds: readonly string[] = ABILITIES) => {
  for (const kind of kinds) {
    expect(a[kind], `${kind} exists`).toBeGreaterThan(0)
    expect(a[kind]!, kind).toBeCloseTo(b[kind]!, 6)
  }
}
const trueDmg = (value: number, extra: Partial<InjectedBuff> = {}): InjectedBuff => ({ stat: 'TRUE_DMG', value, target: 'team', ...extra })

describe("injected buffs match Fribbels' own buffs (real kernel)", () => {
  it('(a) Cyrene zoneActive on = off + injected +0.24 True DMG for the team, on BASIC, SKILL, ULT and BREAK', () => {
    const on = price(acheron, cyrene({ zoneActive: true }))
    const off = price(acheron, cyrene({ zoneActive: false }))
    const injected = price(acheron, cyrene({ zoneActive: false }), [trueDmg(0.24)])
    console.log('(a) on', JSON.stringify(on), '\n    off', JSON.stringify(off), '\n    off+0.24', JSON.stringify(injected))
    near(injected, on)
    // The switch matters, so the match is not vacuous.
    for (const kind of ABILITIES) expect(off[kind]!, kind).toBeLessThan(on[kind]!)
  })

  it('(b) delta injection: on + injected -0.12 = off + injected +0.12 (the level-1 Zone)', () => {
    const delta = price(acheron, cyrene({ zoneActive: true }), [trueDmg(-0.12)])
    const level1 = price(acheron, cyrene({ zoneActive: false }), [trueDmg(0.12)])
    console.log('(b) on-0.12', JSON.stringify(delta), '\n    off+0.12', JSON.stringify(level1))
    near(delta, level1)
    const on = price(acheron, cyrene({ zoneActive: true }))
    for (const kind of ABILITIES) expect(delta[kind]!, kind).toBeLessThan(on[kind]!)
  })

  it('(c) a DMG% buff limited to ULT changes the ULT and nothing else', () => {
    const base = price(acheron, cyrene())
    const ultOnly = price(acheron, cyrene(), [{ stat: 'DMG_PERCENT', value: 0.2, target: 'self', abilityKind: 'ULT' }])
    const everything = price(acheron, cyrene(), [{ stat: 'DMG_PERCENT', value: 0.2, target: 'self' }])
    console.log('(c) base', JSON.stringify(base), '\n    ULT only', JSON.stringify(ultOnly), '\n    all', JSON.stringify(everything))
    expect(ultOnly.ULT!).toBeGreaterThan(base.ULT!)
    near(ultOnly, everything, ['ULT'])
    for (const kind of ['BASIC', 'SKILL', 'BREAK']) expect(ultOnly[kind]!, kind).toBeCloseTo(base[kind]!, 9)
    expect(everything.BASIC!).toBeGreaterThan(base.BASIC!)
  })

  it('(c2) a damage-type filter works on a hit stat, and is an error on a per-action stat', () => {
    const base = price(acheron, cyrene())
    const ultOnly = price(acheron, cyrene(), [{ stat: 'DMG_PERCENT', value: 0.2, target: 'self', damageType: 'ULT' }])
    expect(ultOnly.ULT!).toBeGreaterThan(base.ULT!)
    expect(ultOnly.SKILL!).toBeCloseTo(base.SKILL!, 9)
    expect(() => price(acheron, cyrene(), [{ stat: 'ATK_PERCENT', value: 0.2, target: 'self', damageType: 'ULT', label: 'test buff' }])).toThrow(
      /Injected buff "test buff".*ATK_PERCENT.*per action, not per hit/,
    )
  })

  it("(d) a negative CRIT Rate: Fu Xuan's skill on + injected -0.12 CR = skill off", () => {
    // Fribbels' Fu Xuan gives the team +12% CRIT Rate at E0 with her skill active (FuXuan.ts, skillCrBuffValue).
    const skillOn = price(acheron, fuXuan({ skillActive: true }))
    const skillOff = price(acheron, fuXuan({ skillActive: false }))
    const cancelled = price(acheron, fuXuan({ skillActive: true }), [{ stat: 'CRIT_RATE', value: -0.12, target: 'team' }])
    const added = price(acheron, fuXuan({ skillActive: false }), [{ stat: 'CRIT_RATE', value: 0.12, target: 'team' }])
    console.log('(d) on', JSON.stringify(skillOn), '\n    off', JSON.stringify(skillOff), '\n    on-0.12', JSON.stringify(cancelled))
    near(cancelled, skillOff)
    near(added, skillOn)
    expect(skillOn.ULT!).toBeGreaterThan(skillOff.ULT!)
  })

  it("(e) a teammate HP buff with its UNCONVERTIBLE companion = Fu Xuan's own skill buff, for an HP-scaling attacker", () => {
    // Fu Xuan's teammate-side HP buff is flat: 6% of her HP value (default 8000) = 480, written to HP and to
    // UNCONVERTIBLE_HP_BUFF (FuXuan.ts, precomputeTeammateEffectsContainer); her CRIT Rate buff is the same switch.
    const castorice: KernelUnit = { characterId: CASTORICE, lightConeId: ALONG_THE_PASSING_SHORE, eidolon: 0, superimposition: 1 }
    const mate = (skillActive: boolean) => fuXuan({ skillActive, teammateHPValue: 8000 })
    const hpValue = 0.06 * 8000
    const on = price(castorice, mate(true))
    const off = price(castorice, mate(false))
    const buffs: InjectedBuff[] = [
      { stat: 'CRIT_RATE', value: 0.12, target: 'team' },
      { stat: 'HP', value: hpValue, target: 'team' },
      { stat: 'UNCONVERTIBLE_HP', value: hpValue, target: 'team' },
    ]
    const injected = price(castorice, mate(false), buffs)
    const crOnly = price(castorice, mate(false), buffs.slice(0, 1))
    const noCompanion = price(castorice, mate(false), buffs.slice(0, 2))
    console.log('(e) without the UNCONVERTIBLE companion', JSON.stringify(noCompanion))
    console.log('(e) on', JSON.stringify(on), '\n    off', JSON.stringify(off), '\n    injected', JSON.stringify(injected), '\n    CR only', JSON.stringify(crOnly))
    const kinds = Object.keys(on).filter((k) => on[k]! > 0)
    expect(kinds.length).toBeGreaterThan(0)
    near(injected, on, kinds)
    // The HP part is not vacuous: without it the numbers are lower.
    expect(Math.max(...kinds.map((k) => on[k]! - crOnly[k]!))).toBeGreaterThan(0)
  })

  it('a value of 0 is a no-op', () => {
    const base = price(acheron, cyrene())
    near(price(acheron, cyrene(), [trueDmg(0), { stat: 'CRIT_RATE', value: 0, target: 'self' }]), base)
  })

  it("self and team targets both reach the attacker's damage", () => {
    near(price(acheron, cyrene(), [trueDmg(0.1, { target: 'self' })]), price(acheron, cyrene(), [trueDmg(0.1)]))
  })

  it('the scanned-relic path takes the same injection: Zone on = off + 0.24', () => {
    const scan = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../run/fixtures/scan-reliquary-archiver.json'), 'utf8')) as {
      source: string
      relics: ScannedRelic[]
    }
    const scanned: ScannedBuild = { source: scan.source, relics: scan.relics.filter((r) => r.location === ACHERON) }
    expect(scanned.relics.length).toBeGreaterThan(0)
    const on = price(acheron, cyrene({ zoneActive: true }), undefined, scanned)
    const off = price(acheron, cyrene({ zoneActive: false }), undefined, scanned)
    const injected = price(acheron, cyrene({ zoneActive: false }), [trueDmg(0.24)], scanned)
    near(injected, on)
    expect(off.ULT!).toBeLessThan(on.ULT!)
  })
})
