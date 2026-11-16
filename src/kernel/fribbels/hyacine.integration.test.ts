import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { Battle } from '../../battle/battle'
import type { MemberSetup } from '../../battle/battle'
import type { EngineEvents } from '../../engine'
import { loadEnemyProfile } from '../../enemy/profile'
import { GiantTreeOfRaptBrooding } from '../../equipment/giantTreeOfRaptBrooding'
import { TheStorysNextPage } from '../../equipment/theStorysNextPage'
import { WarriorGoddessOfSunAndThunder } from '../../equipment/warriorGoddessOfSunAndThunder'
import { Hyacine, hyacineScalings, icaId } from '../../kits/hyacine'
import type { Kit } from '../../kits/kit'
import type { DamageKernel, DamageRequest, DamageResult, KernelBuild, KernelUnit } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Hyacine through the real kernel. What these pin:
 * - Her Basic ATK is Fribbels' BASIC hit 0; her Skill and Ultimate heals are Fribbels' SKILL_HEAL and ULT_HEAL hits (Little Ica's 1.25 and
 *   1.2 times them), per target, with the 25% Outgoing Healing trace on for a target at or under half HP only.
 * - Little Ica's Rainclouds is Fribbels' heal-tally hit (MEMO_SKILL hit 1) priced with the sim's live tally: damage = share x tally x every
 *   damage multiplier. The kernel reports that hit's multiple as its `healTallyScaling` (the engine
 *   change made for Hyacine), so the real kernel prices it directly.
 * - After Rain reaches every teammate's price with its live values (`clearSkies`, `e1HpBuff`, `e2SpdBuff`, `e6ResPen`), and the party's Max HP
 *   moves by the kernel's own HP difference.
 */

const profile = loadEnemyProfile('generic-moc')
const unitOf = (eidolon: number): KernelUnit => ({ characterId: '1409', lightConeId: '21054', eidolon, superimposition: 1 })
const enemy = { count: 1, level: profile.level, maxToughness: profile.toughness, resistance: profile.res, elementalWeak: true, weaknessBroken: false }

const build = (ornament: string, relic: string, spdRolls: number): KernelBuild => ({
  relicSet1: relic,
  relicSet2: relic,
  ornamentSet: ornament,
  body: Stats.OHB,
  feet: Stats.SPD,
  planarSphere: Stats.HP_P,
  linkRope: Stats.HP_P,
  substatRolls: { [Stats.HP_P]: 8, [Stats.CD]: 4, [Stats.SPD]: spdRolls },
})
const attackerBuild: KernelBuild = {
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.InertSalsotto,
  body: Stats.CD,
  feet: Stats.HP_P,
  planarSphere: Stats.Quantum_DMG,
  linkRope: Stats.HP_P,
  substatRolls: { [Stats.HP_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

/**
 * The real kernel, recording its requests. (It used to add a heal-tally hit's multiple, which the kernel now reports
 * itself: `hitScaling` returns a HealTally hit's `healTallyScaling`.) `eidolon` is kept for the call sites.
 */
const wrapped = (_eidolon: number, requests?: DamageRequest[]): DamageKernel => ({
  actionDamage: (request: DamageRequest): DamageResult => {
    requests?.push(request)
    return kernel.actionDamage(request)
  },
})

/** An ally that only Basic ATKs one enemy, carrying a real character's identity so the real kernel prices its hit 0 per 100%. */
const stub = (element: Kit['element']): Kit => ({
  characterId: 'stub',
  path: 'Harmony',
  element,
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'basic', 'basic', () =>
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] }),
          ),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
})
const tribbieUnit: KernelUnit = { characterId: '1403', lightConeId: '21018', eidolon: 0, superimposition: 1 }
const acheronUnit: KernelUnit = { characterId: '1308', lightConeId: '23024', eidolon: 0, superimposition: 1 }

interface Options {
  ornament?: string
  relic?: string
  spdRolls?: number
  wearsSets?: boolean
  requests?: DamageRequest[]
}

function setup(eidolon: number, options: Options = {}) {
  const hBuild = build(options.ornament ?? Sets.InertSalsotto, options.relic ?? Sets.MusketeerOfWildWheat, options.spdRolls ?? 20)
  const basic = kernel.basicStats(unitOf(eidolon), hBuild)
  const hy: MemberSetup = {
    key: 'hy',
    kit: Hyacine,
    eidolon,
    affinitiveEidolon: false,
    stats: { maxHp: basic.HP, def: basic.DEF, baseSpd: basic.baseSPD, spdFlat: basic.SPD - basic.baseSPD },
    kernel: { unit: unitOf(eidolon), build: hBuild },
    equipment: {
      lightCone: TheStorysNextPage,
      sets: options.wearsSets ? [{ module: WarriorGoddessOfSunAndThunder, pieces: 4 }, { module: GiantTreeOfRaptBrooding, pieces: 2 }] : [],
    },
  }
  const tribbie: MemberSetup = {
    key: 'tribbie', kit: stub('Quantum'), eidolon: 0, affinitiveEidolon: false,
    stats: { maxHp: 1_000_000, def: 1000, baseSpd: 110 },
    kernel: { unit: tribbieUnit, build: attackerBuild },
  }
  const acheron: MemberSetup = {
    key: 'acheron', kit: stub('Lightning'), eidolon: 0, affinitiveEidolon: false,
    stats: { maxHp: 1_000_000, def: 1000, baseSpd: 120 },
    kernel: { unit: acheronUnit, build: { ...attackerBuild, feet: Stats.ATK_P } },
  }
  const battle = new Battle({
    members: [hy, tribbie, acheron],
    policy: [{ unit: 'hy', use: 'basic', when: [] }, { unit: 'tribbie', use: 'basic', when: [] }, { unit: 'acheron', use: 'basic', when: [] }],
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 3,
    start: { energy: 0, skillPoints: 5, techniques: false },
    kernel: wrapped(eidolon, options.requests),
  })
  const dealt: EngineEvents['damageDealt'][] = []
  const healed: EngineEvents['healed'][] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  battle.timeline.bus.on('healed', (e) => healed.push(e))
  return { battle, hy, tribbie, acheron, dealt, healed, act: battle.member('hy').instance.actions }
}

/** The request for her own prices, written from the text and the kernel's switch names, not from the kit. */
const request = (hy: MemberSetup, conditionals: Record<string, number | boolean>, ohbBuff = false): DamageRequest => ({
  attacker: { ...hy.kernel.unit, characterConditionals: conditionals, lightConeConditionals: { ohbBuff } },
  teammates: [{ ...tribbieUnit }, { ...acheronUnit }],
  build: hy.kernel.build,
  enemy,
})
const own = (e: number, extra: Record<string, number | boolean> = {}) => ({
  clearSkies: false, e1HpBuff: e >= 1, e2SpdBuff: false, e6ResPen: false, healTargetHp50: false, spd200HpBuff: true,
  e4CdBuff: e >= 4, healingDmgStacks: 0, healTallyMultiplier: 1, ...extra,
})
const amounts = (healed: EngineEvents['healed'][], unit: string, source = 'hy') =>
  healed.filter((h) => h.unit === unit && h.source === source).map((h) => h.amount + h.overheal)

describe('her Basic ATK and heals, priced as Fribbels prices them', () => {
  for (const eidolon of [0, 1, 3, 5, 6]) {
    it(`E${eidolon}: Basic ATK is BASIC hit 0; Skill heals are SKILL_HEAL per target (Ica's 1.25 times), the 25% trace only for a target at or under half HP`, () => {
      const { battle, hy, dealt, healed, act } = setup(eidolon)
      const s = hyacineScalings(eidolon)
      act.basic!.use()
      const k = kernel.actionDamage(request(hy, own(eidolon)))
      expect(dealt.filter((d) => d.ability === 'BASIC').reduce((t, d) => t + d.damage, 0)).toBeCloseTo(k.damage.BASIC!, 6)
      expect(k.hits.BASIC![0]!.scaling).toBeCloseTo(s.basic, 12)

      battle.party.takeDamage('tribbie', 600_000, 'enemy1')
      battle.party.takeDamage('acheron', 400_000, 'enemy1')
      healed.length = 0
      act.skill!.use()
      const high = kernel.actionDamage(request(hy, own(eidolon, { healTargetHp50: false }))).hits.SKILL_HEAL![0]!
      const low = kernel.actionDamage(request(hy, own(eidolon, { healTargetHp50: true }))).hits.SKILL_HEAL![0]!
      expect(high.output).toBe('HEAL')
      expect(low.damage).toBeGreaterThan(high.damage)
      // Tribbie is at 40% (under half): low; Acheron at 60% and Hyacine at full HP: high.
      expect(amounts(healed, 'tribbie')).toEqual([expect.closeTo(low.damage, 6)])
      expect(amounts(healed, 'acheron')).toEqual([expect.closeTo(high.damage, 6)])
      expect(amounts(healed, 'hy')).toEqual([expect.closeTo(high.damage, 6)])
      expect(amounts(healed, icaId('hy'))).toEqual([expect.closeTo(1.25 * high.damage, 6)])
      // The base heal is the text's: share of her in-combat Max HP + flat, times (1 + Outgoing Healing).
      const stats = k.stats
      expect(high.damage).toBeCloseTo((s.skillHeal.pct * stats.HP + s.skillHeal.flat) * (1 + stats.OHB), 4)
    })
  }

  it('the Ultimate heals every ally but Ica with ULT_HEAL and Ica with 1.2 times it, summons Ica, and starts After Rain', () => {
    for (const eidolon of [0, 3]) {
      const { battle, hy, healed, act } = setup(eidolon)
      battle.party.setEnergy('hy', 140)
      act.ultimate!.use()
      // The heal is priced before After Rain's buff (settled in game, 2026-11-15): clearSkies is off in its request.
      const request2 = request(hy, own(eidolon, { clearSkies: false }))
      const k = kernel.actionDamage(request2)
      const ult = k.hits.ULT_HEAL![0]!
      expect(amounts(healed, 'tribbie')).toEqual([expect.closeTo(ult.damage, 6)])
      expect(amounts(healed, icaId('hy'))).toEqual([expect.closeTo(1.2 * ult.damage, 6)])
      expect(battle.timeline.modifiers.has('hy', 'hyacine.after_rain')).toBe(true)
      expect(battle.isMemosprite(icaId('hy'))).toBe(true)
      const s = hyacineScalings(eidolon)
      expect(ult.damage).toBeCloseTo((s.ultHeal.pct * k.stats.HP + s.ultHeal.flat) * (1 + k.stats.OHB), 4)
    }
  })
})

describe("After Rain: the teammates' buffs and the party's Max HP", () => {
  const tribbieRequest = (e: number, hy: MemberSetup, tribbie: MemberSetup, conditionals: Record<string, number | boolean>): DamageRequest => ({
    attacker: { ...tribbie.kernel.unit },
    teammates: [{ ...hy.kernel.unit, characterConditionals: { e1HpBuff: e >= 1, e2SpdBuff: false, e6ResPen: false, ...conditionals } }, { ...acheronUnit }],
    build: tribbie.kernel.build,
    enemy,
  })

  it("moves each ally's Max HP by the kernel's own HP difference, at E0 and E1 (the extra 50%), and gives it back when the Rain ends", () => {
    let e0Delta = 0
    for (const eidolon of [0, 1]) {
      const { battle, tribbie, hy, act } = setup(eidolon)
      const before = battle.party.get('tribbie').maxHp
      battle.party.setEnergy('hy', 140)
      act.ultimate!.use()
      const delta =
        kernel.actionDamage(tribbieRequest(eidolon, hy, tribbie, { clearSkies: true })).stats.HP -
        kernel.actionDamage(tribbieRequest(eidolon, hy, tribbie, { clearSkies: false })).stats.HP
      expect(delta).toBeGreaterThan(600)
      expect(battle.party.get('tribbie').maxHp - before).toBeCloseTo(delta, 6)
      if (eidolon === 0) e0Delta = delta
      else expect(delta).toBeGreaterThan(e0Delta)
      expect(battle.party.get(icaId('hy')).maxHp).toBeGreaterThan(0)
      battle.timeline.modifiers.remove('hy', 'hyacine.after_rain')
      expect(battle.party.get('tribbie').maxHp).toBeCloseTo(before, 6)
    }
  })

  it("a teammate's price carries the live Rain switches: E6's 20% RES PEN needs Ica on the field, and the Rain raises the price", () => {
    const e = 6
    const { battle, tribbie, hy, dealt, act } = setup(e)
    const total = () => dealt.filter((d) => d.attacker === 'tribbie').reduce((t, d) => t + d.damage, 0)
    const perHundred = (r: DamageRequest) => { const h = kernel.actionDamage(r).hits.BASIC![0]!; return h.damage / h.scaling! }
    battle.member('tribbie').instance.actions.basic!.use()
    const off = total()
    expect(off).toBeCloseTo(perHundred(tribbieRequest(e, hy, tribbie, { clearSkies: false })), 6)
    battle.party.setEnergy('hy', 140)
    act.ultimate!.use()
    dealt.length = 0
    battle.member('tribbie').instance.actions.basic!.use()
    const on = total()
    expect(on).toBeCloseTo(perHundred(tribbieRequest(e, hy, tribbie, { clearSkies: true, e6ResPen: true })), 6)
    expect(on).toBeGreaterThan(off)
  })

  it("E2: an ally that lost HP has SPD +30% on the timeline and Fribbels' `e2SpdBuff` on in its price", () => {
    const requests: DamageRequest[] = []
    const { battle } = setup(2, { requests })
    battle.party.takeDamage('tribbie', 1000, 'enemy1')
    expect(battle.timeline.modifiers.has('tribbie', 'hyacine.e2_spd')).toBe(true)
    requests.length = 0
    battle.member('tribbie').instance.actions.basic!.use()
    expect(requests.some((r) => r.attacker.characterId === '1403' && r.teammates.some((t) => t.characterId === '1409' && t.characterConditionals?.e2SpdBuff === true))).toBe(true)
    requests.length = 0
    battle.member('acheron').instance.actions.basic!.use()
    expect(requests.some((r) => r.attacker.characterId === '1308' && r.teammates.some((t) => t.characterId === '1409' && t.characterConditionals?.e2SpdBuff === false))).toBe(true)
  })
})

describe("Little Ica: Rainclouds is Fribbels' heal-tally hit priced with the live tally", () => {
  for (const eidolon of [0, 3, 6]) {
    it(`E${eidolon}: after her Ultimate Ica takes an extra turn; the damage is Fribbels' hit for the live tally, and ${eidolon >= 6 ? 12 : 50}% of the tally is cleared`, () => {
      const { battle, hy, dealt, healed, act } = setup(eidolon)
      const s = hyacineScalings(eidolon)
      const log: string[] = []
      battle.timeline.bus.on('actionUsed', (a) => log.push(`${a.actor}:${a.action}`))
      let tallyAtAction: number | undefined
      battle.timeline.bus.on('actionUsed', (a) => {
        if (a.actor === icaId('hy') && tallyAtAction === undefined) tallyAtAction = battle.member('hy').instance.quantities!.tally!() as number
      })
      battle.party.setEnergy('hy', 140)
      act.ultimate!.use()
      const tallyBefore = battle.member('hy').instance.quantities!.tally!() as number
      // Every heal of hers and Ica's so far, per target (a full-HP target's heal is all overheal).
      expect(tallyBefore).toBeCloseTo(healed.filter((h) => h.source === 'hy' || h.source === icaId('hy')).reduce((t, h) => t + h.amount + h.overheal, 0), 6)
      expect(battle.timeline.pendingExtraTurns()).toEqual([icaId('hy')])
      battle.run()
      expect(log[0]).toBe('hy:ultimate')
      expect(log[1]).toBe(`${icaId('hy')}:memo_skill`)
      const first = dealt.find((d) => d.attacker === 'hy' && d.ability === 'MEMO_SKILL')!
      // Fribbels' price for that tally: its heal-tally hit with the multiplier that makes it exactly the tally (stack 1, Rain up, the light cone's 12% not yet on).
      const conditionals = own(eidolon, { clearSkies: true, healingDmgStacks: 1, e6ResPen: eidolon >= 6 })
      const base = request(hy, conditionals)
      const refHeal = kernel.actionDamage(base).hits.MEMO_SKILL![0]!.damage
      const priced = kernel.actionDamage({ ...base, attacker: { ...base.attacker, characterConditionals: { ...conditionals, healTallyMultiplier: tallyBefore / refHeal } } })
      expect(priced.hits.MEMO_SKILL![1]!.scaling).toBeGreaterThan(0)
      expect(first.damage).toBeCloseTo(priced.hits.MEMO_SKILL![1]!.damage, 3)
      // The tally after Ica's action: what was left (1 - share cleared) plus what Hyacine and Ica healed in between (E1's restore).
      expect(s.tallyClear).toBe(eidolon >= 6 ? 0.12 : 0.5)
      expect(tallyAtAction).toBeDefined()
      const restores = eidolon >= 1 ? 1 : 0
      expect(tallyAtAction!).toBeGreaterThan(tallyBefore * (1 - s.tallyClear) - 1e-6)
      if (restores === 0) expect(tallyAtAction!).toBeCloseTo(tallyBefore * (1 - s.tallyClear), 6)
    })
  }

  it('with the real kernel (no wrapper), Rainclouds is priced: the kernel reports its heal-tally multiple', () => {
    const { hy, tribbie, acheron } = setup(0)
    const battle = new Battle({
      members: [hy, tribbie, acheron],
      policy: (['hy', 'tribbie', 'acheron'] as const).map((unit) => ({ unit, use: 'basic' as const, when: [] })),
      profile, enemyCount: 1, weaknesses: 'all', cycles: 1,
      start: { energy: 0, skillPoints: 5, techniques: false }, kernel,
    })
    battle.party.setEnergy('hy', 140)
    battle.member('hy').instance.actions.ultimate!.use()
    expect(() => battle.run()).not.toThrow()
  })
})

describe('her standard build: Warrior Goddess and Giant Tree through a whole battle', () => {
  it('runs with the sets on at SPD near 200, prices every heal with Giant Tree\'s Outgoing Healing, and takes the Ultimate window', () => {
    const { battle, hy, healed, act } = setup(0, { wearsSets: true, relic: Sets.WarriorGoddessOfSunAndThunder, ornament: Sets.GiantTreeOfRaptBrooding, spdRolls: 12 })
    battle.party.takeDamage('tribbie', 900_000, 'enemy1')
    act.skill!.use()
    const stats = battle.combatStats('hy')
    expect(stats.OHB).toBeGreaterThan(0.2)
    const toTribbie = healed.find((h) => h.unit === 'tribbie' && h.source === 'hy')!
    expect(toTribbie.amount + toTribbie.overheal).toBeGreaterThan(0)
    expect(hy.stats.baseSpd).toBeGreaterThan(0)
  })
})

describe('her Technique with the real kernel (K31)', () => {
  it('heals every character for 30% of her Max HP + 600 times her Outgoing Healing, and raises each Max HP by the HP% difference the kernel gives', () => {
    const { battle, hy, tribbie, healed } = setup(0)
    const before = { hy: battle.party.get('hy').maxHp, tribbie: battle.party.get('tribbie').maxHp, acheron: battle.party.get('acheron').maxHp }
    battle.member('hy').instance.onBattleStart!({ techniques: true })

    const k = kernel.actionDamage(request(hy, own(0)))
    const expected = (0.3 * k.stats.HP + 600) * (1 + k.stats.OHB)
    for (const unit of ['hy', 'tribbie', 'acheron']) expect(amounts(healed, unit), unit).toEqual([expect.closeTo(expected, 4)])
    expect(amounts(healed, icaId('hy'))).toEqual([])

    const tribbieRequest = (injected: boolean): DamageRequest => ({
      attacker: { ...tribbie.kernel.unit },
      teammates: [{ ...hy.kernel.unit, characterConditionals: { e1HpBuff: false, e2SpdBuff: false, e6ResPen: false } }, { ...acheronUnit }],
      build: tribbie.kernel.build,
      enemy,
      ...(injected && { injectedBuffs: [{ stat: 'HP_PERCENT' as const, value: 0.2, target: 'team' as const }] }),
    })
    const delta = kernel.actionDamage(tribbieRequest(true)).stats.HP - kernel.actionDamage(tribbieRequest(false)).stats.HP
    expect(delta).toBeGreaterThan(0)
    expect(battle.party.get('tribbie').maxHp - before.tribbie).toBeCloseTo(delta, 6)
    expect(battle.party.get('hy').maxHp).toBeGreaterThan(before.hy)
    expect(battle.party.get('acheron').maxHp).toBeGreaterThan(before.acheron)

    battle.timeline.modifiers.remove('tribbie', 'hyacine.technique_max_hp')
    expect(battle.party.get('tribbie').maxHp).toBeCloseTo(before.tribbie, 6)
  })
})
