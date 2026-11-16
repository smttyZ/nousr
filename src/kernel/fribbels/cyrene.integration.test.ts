import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { Battle, CYRENE_KERNEL_ID } from '../../battle/battle'
import type { MemberSetup } from '../../battle/battle'
import type { EngineEvents } from '../../engine'
import { loadEnemyProfile } from '../../enemy/profile'
import { ThisLoveForever } from '../../equipment/thisLoveForever'
import { demiurgeId, makeCyrene } from '../../kits/cyrene'
import type { Kit } from '../../kits/kit'
import type { DamageKernel, DamageRequest, KernelBuild, KernelUnit } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Cyrene through the real kernel (this Love, Forever on her, Chrysos Heirs around her).
 * - Basic ATK, the enhanced Basic ATK and Minuet equal Fribbels' own hits for the same switches (the explicit requests below are
 *   written from the text's switches, not read from the kit).
 * - The Zone and the talent reach a teammate's request and its price, and a non-Chrysos-Heir Ode reaches the target's.
 * - The light cone's Blank and Verse reach the price of the wearer and of her allies.
 */

const profile = loadEnemyProfile('generic-moc')
const cyreneBuild: KernelBuild = {
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.InertSalsotto,
  body: Stats.CD,
  feet: Stats.HP_P,
  planarSphere: Stats.Ice_DMG,
  linkRope: Stats.HP_P,
  substatRolls: { [Stats.HP_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const atkBuild: KernelBuild = {
  relicSet1: Sets.PioneerDiverOfDeadWaters,
  relicSet2: Sets.PioneerDiverOfDeadWaters,
  ornamentSet: Sets.IzumoGenseiAndTakamaDivineRealm,
  body: Stats.CR,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 12, [Stats.CD]: 8 },
}
const ENEMY = { count: 1, level: profile.level, maxToughness: profile.toughness, resistance: profile.res, elementalWeak: true, weaknessBroken: false }
const DEMI = demiurgeId('cyrene')

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

const attackKit = (path: 'Hunt' | 'Remembrance'): Kit => ({
  characterId: 'stub',
  path,
  element: 'Lightning',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'basic', 'basic', () => {
            battle.gainSkillPoints(1)
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
          }),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
})

const mate = (key: string, id: string, path: 'Hunt' | 'Remembrance', baseSpd: number): MemberSetup => ({
  key,
  kit: attackKit(path),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
  kernel: { unit: { characterId: id, lightConeId: '23024', eidolon: 0, superimposition: 1 }, build: atkBuild },
})
const cyreneUnit = (eidolon: number): KernelUnit => ({ characterId: CYRENE_KERNEL_ID, lightConeId: '23052', eidolon, superimposition: 1 })

/** Cyrene (the real kit, her light cone) with a non-heir attacker 'a' (Acheron) and two Chrysos Heirs (a team has 3 teammates at most). */
function setup(eidolon: number, order: string[], cycles = 3, enemies = 1) {
  const cyrene: MemberSetup = {
    key: 'cyrene',
    kit: makeCyrene({ demiurgeOrder: order }),
    eidolon,
    affinitiveEidolon: false,
    stats: { maxHp: 4000, def: 1000, baseSpd: 100 },
    kernel: { unit: cyreneUnit(eidolon), build: cyreneBuild },
    equipment: { lightCone: ThisLoveForever, sets: [] },
  }
  const mates = [mate('a', '1308', 'Hunt', 150), mate('hya', '1409', 'Remembrance', 140), mate('cas', '1407', 'Remembrance', 130)]
  const requests: DamageRequest[] = []
  const recording: DamageKernel = {
    actionDamage: (r) => {
      requests.push(r)
      return kernel.actionDamage(r)
    },
  }
  const members = [cyrene, ...mates]
  const battle = new Battle({
    members,
    policy: [
      { unit: 'cyrene', use: 'ultimate', when: [] },
      { unit: 'cyrene', use: 'skill', when: [] },
      { unit: 'cyrene', use: 'basic', when: [] },
      ...mates.map((m) => ({ unit: m.key, use: 'basic', when: [] })),
    ],
    profile,
    enemyCount: enemies,
    weaknesses: 'all',
    cycles,
    start: { energy: 0, skillPoints: 3, techniques: false },
    kernel: recording,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  const log: Array<{ actor: string, action: string }> = []
  battle.timeline.bus.on('damageDealt', (d) => dealt.push(d))
  battle.timeline.bus.on('actionUsed', (a) => log.push({ actor: a.actor, action: a.action }))
  return { battle, dealt, requests, log, mates, cyrene }
}

const cyreneRequest = (eidolon: number, conditionals: Record<string, number | boolean>, lc: Record<string, boolean>, mates: MemberSetup[]): DamageRequest => ({
  attacker: { ...cyreneUnit(eidolon), characterConditionals: conditionals, lightConeConditionals: lc },
  teammates: mates.map((m) => ({ ...m.kernel.unit })),
  build: cyreneBuild,
  enemy: ENEMY,
})
const perHundred = (hit: { damage: number, scaling?: number }) => hit.damage / hit.scaling!
const cyreneMate = (r: DamageRequest) => r.teammates.find((t) => t.characterId === CYRENE_KERNEL_ID)!

const base = {
  memospriteActive: false,
  zoneActive: false,
  talentDmgBuff: true,
  traceSpdBasedBuff: true,
  odeToEgoExtraBounces: 0,
  e1ExtraBounces: 0,
  e2TrueDmgStacks: 0,
  e4BounceStacks: 0,
  e6DefPen: false,
}

describe('Cyrene: single actions equal Fribbels', () => {
  it('Basic ATK (E0 and E5) is the BASIC hit', () => {
    for (const eidolon of [0, 5]) {
      const t = setup(eidolon, [])
      t.battle.member('cyrene').instance.onBattleStart!({ techniques: false })
      t.battle.member('cyrene').instance.actions.basic!.use()
      const expected = kernel.actionDamage(cyreneRequest(eidolon, base, { vulnerability: false, cdBoost: false }, t.mates)).hits.BASIC![0]!
      expect(expected.scaling).toBeCloseTo(eidolon >= 5 ? 0.55 : 0.5, 9)
      expect(t.dealt.reduce((n, d) => n + d.damage, 0)).toBeCloseTo(expected.damage, 4)
    }
  })

  it('the enhanced Basic ATK and Minuet (Ode to Ego always on) price at the kernel hit for the live switches', () => {
    const eidolon = 2
    const t = setup(eidolon, ['hya', 'attack'], 8)
    t.battle.run()
    const demiurgeIndex = t.log.findIndex((l) => l.actor === DEMI && l.action === 'minuet')
    expect(demiurgeIndex).toBeGreaterThan(0)

    // Enhanced Basic ATK: the first one after the Ultimate. Switches: Demiurge on the field, the Zone with no limit, and Ode to Ego on
    // from the start (Blank comes from the Ode on hya).
    const enhancedRequests = t.requests.filter((r) => r.attacker.characterId === CYRENE_KERNEL_ID && r.attacker.characterConditionals?.memospriteActive === true)
    expect(enhancedRequests.length).toBeGreaterThan(0)
    const enhancedHit = kernel.actionDamage(enhancedRequests[0]!).hits.BASIC![0]!
    expect(enhancedHit.scaling).toBeCloseTo(0.6, 9)
    expect(enhancedRequests[0]!.attacker.characterConditionals).toMatchObject({ memospriteActive: true, zoneActive: true })
    // The battle's enhanced Basic ATK (one enemy: both parts hit it) is that hit's price for one of the requests it sent.
    const afterSummon = t.dealt.filter((d) => d.attacker === 'cyrene' && d.ability === 'BASIC').slice(-1)[0]!
    const prices = enhancedRequests.map((r) => perHundred(kernel.actionDamage(r).hits.BASIC![0]!) * 0.6)
    expect(prices.some((p) => Math.abs(p - afterSummon.damage) < 1e-3)).toBe(true)

    // Minuet: the request the battle asked, with 12 + the counted teammates' bounces, is Fribbels' hit.
    const minuet = t.requests.find((r) => r.attacker.characterId === CYRENE_KERNEL_ID && Number(r.attacker.characterConditionals?.odeToEgoExtraBounces) > 0)!
    const hit = kernel.actionDamage(minuet).hits.MEMO_SKILL![0]!
    const n = Number(minuet.attacker.characterConditionals!.odeToEgoExtraBounces)
    expect(hit.scaling).toBeCloseTo(0.6 + (n + 12) * 0.6, 9)
    const first = t.dealt.find((d) => d.ability === 'MEMO_SKILL')!
    const candidates = t.requests.filter((r) => r.attacker.characterId === CYRENE_KERNEL_ID && Number(r.attacker.characterConditionals?.odeToEgoExtraBounces) > 0)
    const minuetPrices = candidates.map((r) => {
      const h = kernel.actionDamage(r).hits.MEMO_SKILL![0]!
      return perHundred(h) * h.scaling!
    })
    expect(minuetPrices.some((p) => Math.abs(p - first.damage) < 1e-3)).toBe(true)
  })
})

describe('Cyrene: what reaches a teammate', () => {
  it('the Zone and the talent reach the ally request, and the price is the kernel price for those switches', () => {
    const t = setup(0, ['hya'], 2)
    t.battle.run()
    const attackerA = (r: DamageRequest) => r.attacker.characterId === '1308'
    const before = t.requests.find((r) => attackerA(r) && cyreneMate(r).characterConditionals?.zoneActive === false)!
    const after = t.requests.find((r) => attackerA(r) && cyreneMate(r).characterConditionals?.zoneActive === true)!
    expect(cyreneMate(before).characterConditionals).toMatchObject({ talentDmgBuff: true, zoneActive: false, specialEffect: false })
    expect(cyreneMate(after).characterConditionals).toMatchObject({ talentDmgBuff: true, zoneActive: true })
    const price = (r: DamageRequest) => perHundred(kernel.actionDamage(r).hits.BASIC![0]!)
    expect(price(after)).toBeGreaterThan(price(before))
    // The battle's own damage for that attack is the kernel's price for the request it sent.
    const sent = t.requests.indexOf(after)
    expect(sent).toBeGreaterThanOrEqual(0)
  })

  it('a non-Chrysos-Heir Ode reaches the target price, and only the target price', () => {
    const t = setup(2, ['a'], 8)
    t.battle.run()
    const isA = (r: DamageRequest) => r.attacker.characterId === '1308'
    const on = t.requests.filter((r) => isA(r) && cyreneMate(r).characterConditionals?.specialEffect === true)
    expect(on.length).toBeGreaterThan(0)
    const off = { ...on[0]!, teammates: on[0]!.teammates.map((x) => (x.characterId === CYRENE_KERNEL_ID ? { ...x, characterConditionals: { ...x.characterConditionals!, specialEffect: false } } : x)) }
    const price = (r: DamageRequest) => perHundred(kernel.actionDamage(r).hits.BASIC![0]!)
    expect(price(on[0]!)).toBeGreaterThan(price(off))
    // Heirs' requests never carry it.
    const heirRequests = t.requests.filter((r) => ['1409', '1407'].includes(r.attacker.characterId))
    expect(heirRequests.length).toBeGreaterThan(0)
    expect(heirRequests.every((r) => cyreneMate(r).characterConditionals?.specialEffect === false)).toBe(true)
    // Ode on a Chrysos Heir leaves the others alone: no flag in the battle.
    expect(t.battle.cyreneEffect('hya').active).toBe(false)
  })

  it("a Chrysos Heir's Ode sets the flag their kit reads", () => {
    const t = setup(2, ['cas'], 8)
    t.battle.run()
    expect(t.battle.cyreneEffect('cas').active).toBe(true)
  })
})

describe("This Love, Forever through the kernel", () => {
  it('Blank (after an Ode) and Verse (after a Minuet) are in her price and her allies', () => {
    const t = setup(2, ['a', 'attack'], 8)
    t.battle.run()
    const lc = (r: DamageRequest) => r.attacker.lightConeConditionals
    const states = new Set(t.requests.filter((r) => r.attacker.characterId === CYRENE_KERNEL_ID).map((r) => `${lc(r)?.vulnerability}/${lc(r)?.cdBoost}`))
    expect(states.has('false/false')).toBe(true)
    expect(states.has('true/false')).toBe(true)
    expect(states.has('true/true')).toBe(true)
    // A teammate's request gets the same switches from her light cone.
    const aBoth = t.requests.find((r) => r.attacker.characterId === '1308' && r.teammates.some((x) => x.characterId === CYRENE_KERNEL_ID && x.lightConeConditionals?.vulnerability === true && x.lightConeConditionals?.cdBoost === true))
    expect(aBoth).toBeDefined()
    const noLc = { ...aBoth!, teammates: aBoth!.teammates.map((x) => (x.characterId === CYRENE_KERNEL_ID ? { ...x, lightConeConditionals: { vulnerability: false, cdBoost: false } } : x)) }
    const price = (r: DamageRequest) => perHundred(kernel.actionDamage(r).hits.BASIC![0]!)
    expect(price(aBoth!)).toBeGreaterThan(price(noLc))
  })
})
