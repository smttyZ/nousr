import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { generateContext } from '../../../vendor/hsr-optimizer/src/lib/optimization/context/calculateContext'
import { generateFullDefaultForm } from '../../../vendor/hsr-optimizer/src/lib/simulations/utils/benchmarkForm'
import type { CharacterId } from '../../../vendor/hsr-optimizer/src/types/character'
import type { LightConeId } from '../../../vendor/hsr-optimizer/src/types/lightCone'
import { Battle } from '../../battle/battle'
import type { MemberSetup } from '../../battle/battle'
import type { EngineEvents } from '../../engine'
import { loadEnemyProfile } from '../../enemy/profile'
import { EQUIPMENT, resolveEquipment } from '../../equipment/index'
import { JingYuan } from '../../kits/jingYuan'
import type { Rule } from '../../scenario/types'
import type { DamageRequest, KernelBuild } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Jing Yuan through the real kernel. What these pin:
 * - Each ability is priced as Fribbels prices it for the same state (Lightning-Lord's action is Fribbels' one FUA
 *   hit with the multiple times the hit count), and the hit count changes the price per hit the way Fribbels says
 *   (6 hits or more add CRIT DMG; the Ashblazing Grand Duke stacks follow the count).
 * - The Affinitive Eidolon on against off moves damage the way Fribbels' buff-only benchmark does.
 * - The two light cones' modules against Fribbels' defaults.
 */

const build: KernelBuild = {
  relicSet1: Sets.TheAshblazingGrandDuke,
  relicSet2: Sets.TheAshblazingGrandDuke,
  ornamentSet: Sets.InertSalsotto,
  body: Stats.CD,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const profile = loadEnemyProfile('generic-moc')
const TODAY = '21034'
const ETERNAL_CALCULUS = '24004'

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

const jy = (eidolon: number, ex: boolean, lightConeId = TODAY, baseSpd = 134): MemberSetup => ({
  key: 'jy',
  kit: JingYuan,
  eidolon,
  affinitiveEidolon: ex,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
  kernel: { unit: { characterId: '1204', lightConeId, eidolon, superimposition: lightConeId === TODAY ? 4 : 1, ex: ex ? 1 : 0 }, build },
})

function battleOf(member: MemberSetup, options: { enemies?: number, policy?: Rule[], cycles?: number, techniques?: boolean } = {}) {
  const battle = new Battle({
    members: [member],
    policy: options.policy ?? [{ unit: 'jy', use: 'basic', when: [] }],
    profile,
    enemyCount: options.enemies ?? 1,
    weaknesses: 'all',
    cycles: options.cycles ?? 3,
    start: { energy: 0, skillPoints: 3, techniques: options.techniques ?? false },
    kernel,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  return { battle, dealt }
}

/** The request the runner sends for solo Jing Yuan against `enemies` generic enemies, not broken. */
function request(member: MemberSetup, conditionals: Record<string, number | boolean>, enemies = 1): DamageRequest {
  return {
    attacker: {
      ...member.kernel.unit,
      characterConditionals: {
        skillCritBuff: false,
        talentHitsPerAction: 3,
        talentAttacks: 3,
        e2DmgBuff: false,
        e6FuaVulnerabilityStacks: 0,
        ex1EnhancedState: false,
        ...conditionals,
      },
    },
    teammates: [],
    build,
    enemy: { count: enemies, level: profile.level, maxToughness: profile.toughness, resistance: profile.res, elementalWeak: true, weaknessBroken: false },
  }
}

const sum = (dealt: EngineEvents['damageDealt'][], ability: string) =>
  dealt.filter((d) => d.ability === ability).reduce((total, d) => total + d.damage, 0)

/** Damage of the first Lightning-Lord action in the events, which share one timestamp. */
function firstLordAction(dealt: EngineEvents['damageDealt'][], from = 0): number {
  const fua = dealt.slice(from).filter((d) => d.ability === 'FUA')
  const at = fua[0]!.at
  return fua.filter((d) => d.at === at).reduce((total, d) => total + d.damage, 0)
}

describe('Jing Yuan per action, priced as Fribbels prices it (one enemy)', () => {
  it('Basic ATK, Skill and Ultimate equal the kernel number for the same state, at E0, E3, E5 and E6', () => {
    for (const eidolon of [0, 3, 5, 6]) {
      const m = jy(eidolon, false)
      const { battle, dealt } = battleOf(m)
      const instance = battle.member('jy').instance
      instance.actions.basic!.use()
      const first = kernel.actionDamage(request(m, {}))
      expect(sum(dealt, 'BASIC'), `basic E${eidolon}`).toBeCloseTo(first.damage.BASIC!, 6)
      instance.actions.skill!.use()
      expect(sum(dealt, 'SKILL'), `skill E${eidolon}`).toBeCloseTo(first.damage.SKILL!, 6)
      battle.party.setEnergy('jy', 130)
      instance.actions.ultimate!.use()
      // After the Skill, War Marshal is up: the Ultimate sees +10% CRIT Rate, and Lightning-Lord has 5 hits.
      const afterSkill = kernel.actionDamage(request(m, { skillCritBuff: true, talentHitsPerAction: 5, talentAttacks: 5 }))
      expect(sum(dealt, 'ULT'), `ult E${eidolon}`).toBeCloseTo(afterSkill.damage.ULT!, 6)
      // The kernel's own multiples: 1.0 / 1.1, 1.0 / 1.1, 2.0 / 2.16.
      expect(first.hits.BASIC![0]!.scaling).toBeCloseTo(eidolon >= 3 ? 1.1 : 1.0, 12)
      expect(first.hits.SKILL![0]!.scaling).toBeCloseTo(eidolon >= 5 ? 1.1 : 1.0, 12)
      expect(afterSkill.hits.ULT![0]!.scaling).toBeCloseTo(eidolon >= 3 ? 2.16 : 2.0, 12)
    }
  })

  it("Lightning-Lord's action is Fribbels' one FUA hit for 3, 6, 9 and 10 hits (the cap without the Affinitive Eidolon)", () => {
    const cases: [number, number][] = [[0, 3], [1, 6], [2, 9], [3, 10]]
    for (const [ultimates, hits] of cases) {
      const m = jy(0, false)
      const { battle, dealt } = battleOf(m, { cycles: 2 })
      for (let i = 0; i < ultimates; i++) {
        battle.party.setEnergy('jy', 130)
        battle.member('jy').instance.actions.ultimate!.use()
      }
      const before = dealt.length
      battle.run()
      // Ultimates leave War Marshal off (only the Skill sets it), so the request has no CRIT Rate buff.
      const fribbels = kernel.actionDamage(request(m, { talentHitsPerAction: hits, talentAttacks: hits }))
      expect(firstLordAction(dealt, before), `${hits} hits`).toBeCloseTo(fribbels.damage.FUA!, 6)
      expect(fribbels.hits.FUA).toHaveLength(1)
      expect(fribbels.hits.FUA![0]!.scaling).toBeCloseTo(0.66 * hits, 12)
    }
  })

  it('the price per hit changes with the hit count: 6 hits or more add 25% CRIT DMG, and the Ashblazing stacks follow', () => {
    const m = jy(0, false)
    const perHit = (hits: number) => {
      const r = kernel.actionDamage(request(m, { talentHitsPerAction: hits, talentAttacks: hits }))
      return r.hits.FUA![0]!.damage / r.hits.FUA![0]!.scaling!
    }
    expect(perHit(6) / perHit(5)).toBeGreaterThan(1.05)
    expect(perHit(10)).toBeGreaterThan(perHit(6))
    expect(perHit(30)).toBeGreaterThanOrEqual(perHit(10))
  })

  it("E6's Vulnerable stacks follow the order the hits land (3 hits on one enemy: 0, 1, 2 stacks)", () => {
    const m = jy(6, false)
    const { battle, dealt } = battleOf(m, { cycles: 2 })
    battle.run()
    const total = firstLordAction(dealt)
    const perHit = (s: number) =>
      kernel.actionDamage(request(m, { e6FuaVulnerabilityStacks: s, talentHitsPerAction: 3, talentAttacks: 3 })).damage.FUA! / 3
    expect(total).toBeCloseTo(perHit(0) + perHit(1) + perHit(2), 6)
    expect(total).toBeLessThan(perHit(3) * 3)
    expect(total).toBeGreaterThan(perHit(0) * 3)
  })
})

describe("toughness is Fribbels' toughnessDmg times 3", () => {
  it('Basic 10, Skill 10, Ultimate 20 and 5 per Lightning-Lord hit', () => {
    const form = generateFullDefaultForm('1204' as CharacterId, TODAY as LightConeId, 0, 4, false, 0)
    const context = generateContext(form)
    const t: Record<string, number> = {}
    for (const action of context.defaultActions) {
      const first = action.hits?.[0]?.toughnessDmg
      if (first !== undefined) t[action.actionType] = first
    }
    expect(t).toMatchObject({ BASIC: 10, SKILL: 10, ULT: 20, FUA: 50 }) // 50 = 5 x the default 10 hits

    const bar = (b: Battle) => b.enemies.toughness(b.primary)
    const fresh = () => battleOf(jy(0, false), { enemies: 3 }).battle
    const basic = fresh()
    basic.member('jy').instance.actions.basic!.use()
    expect(profile.toughness - bar(basic)).toBe(t.BASIC! * 3)
    const skill = fresh()
    skill.member('jy').instance.actions.skill!.use()
    expect(profile.toughness - bar(skill)).toBe(t.SKILL! * 3)
    const ult = fresh()
    ult.party.setEnergy('jy', 130)
    ult.member('jy').instance.actions.ultimate!.use()
    expect(profile.toughness - bar(ult)).toBe(t.ULT! * 3)
  })

  it('one enemy: a 10-hit Lightning-Lord action removes 15 per hit (Fribbels 5 per hit, times 3)', () => {
    const { battle } = battleOf(jy(0, false), { enemies: 1, cycles: 2 })
    for (let i = 0; i < 3; i++) {
      battle.party.setEnergy('jy', 130)
      battle.member('jy').instance.actions.ultimate!.use()
    }
    let before = NaN
    let after = NaN
    battle.timeline.bus.on('turnStart', (turn) => {
      if (turn.unit === 'jy.lightning_lord' && Number.isNaN(before)) before = battle.enemies.toughness(battle.primary)
    })
    battle.timeline.bus.on('actionUsed', (action) => {
      if (action.action === 'lightning_lord' && Number.isNaN(after)) after = battle.enemies.toughness(battle.primary)
    })
    battle.run()
    expect(before - after).toBeCloseTo(15 * 10, 9)
  })
})

describe('the Affinitive Eidolon, on against off', () => {
  const policy: Rule[] = [
    { unit: 'jy', use: 'ultimate', when: [] },
    { unit: 'jy', use: 'skill', when: [] },
    { unit: 'jy', use: 'basic', when: [] },
  ]
  const run = (ex: boolean, enemies = 1) => {
    const { battle } = battleOf(jy(0, ex), { policy, cycles: 5, techniques: true, enemies })
    return battle.run()
  }

  it('Fribbels itself: one Lightning-Lord action at the cap, on against off, is several times higher (buff-only)', () => {
    const on = kernel.actionDamage(request(jy(0, true), { talentHitsPerAction: 30, talentAttacks: 30, ex1EnhancedState: true })).damage.FUA!
    const off = kernel.actionDamage(request(jy(0, false), { talentHitsPerAction: 10, talentAttacks: 10 })).damage.FUA!
    // 3 times the hits, and +240% DMG in the same additive DMG bucket as the other boosts: not a plain 3 x 3.4.
    console.log(`Fribbels buff-only, one Lightning-Lord action, AE on (30 hits, enhanced) / off (10 hits): ${(on / off).toFixed(3)}`)
    expect(on / off).toBeGreaterThan(5)
  })

  it('the timeline run: more damage with it on (about 4 to 5 times with the technique, against 4.52 in the CLAUDE.md buff-only benchmark)', () => {
    for (const enemies of [1, 3, 5]) {
      const on = run(true, enemies)
      const off = run(false, enemies)
      const ratio = on.totalDamage / off.totalDamage
      console.log(`AE on/off, E0, 5 cycles, ${enemies} enemies, technique on: ${on.totalDamage.toFixed(0)} / ${off.totalDamage.toFixed(0)} = ${ratio.toFixed(3)}`)
      expect(ratio).toBeGreaterThan(1)
      expect(on.actions.filter((a) => a.action === 'lightning_lord').length).toBeGreaterThan(0)
    }
  })
})

describe('light cones', () => {
  const gear = (id: string, hasSets = false) =>
    resolveEquipment(
      { characterId: '1204', lightConeId: id, eidolon: 0, superimposition: 1 },
      hasSets ? build : { ...build, relicSet1: Sets.MusketeerOfWildWheat, relicSet2: Sets.MusketeerOfWildWheat, ornamentSet: Sets.IzumoGenseiAndTakamaDivineRealm },
      EQUIPMENT,
    )

  it('both are registered', () => {
    expect(gear(TODAY).lightCone.name).toBe('Today Is Another Peaceful Day')
    expect(gear(ETERNAL_CALCULUS).lightCone.name).toBe('Eternal Calculus')
  })

  it("Today Is Another Peaceful Day: Fribbels' default (on) is the right state, 130 Max Energy at 0.35% per point", () => {
    const off = kernel.actionDamage(request({ ...jy(0, false), kernel: { ...jy(0, false).kernel, unit: { ...jy(0, false).kernel.unit, lightConeConditionals: { maxEnergyDmgBoost: false } } } }, {}))
    const on = kernel.actionDamage(request(jy(0, false), {}))
    // 130 x 0.35% = 45.5% more DMG, in the same multiplicative bucket as the other DMG boosts.
    expect(on.damage.BASIC! / off.damage.BASIC!).toBeGreaterThan(1.1)
    expect(on.damage.BASIC!).toBeGreaterThan(off.damage.BASIC!)
  })

  it('Eternal Calculus: the stacks a first attack sees are 0, and each attack leaves one stack per enemy hit (Basic: 1)', () => {
    const m = { ...jy(0, false, ETERNAL_CALCULUS), equipment: gear(ETERNAL_CALCULUS) }
    const { battle, dealt } = battleOf(m, { enemies: 3 })
    const instance = battle.member('jy').instance
    instance.actions.basic!.use() // priced with 0 stacks
    instance.actions.basic!.use() // priced with 1 stack: 1 enemy hit
    instance.actions.skill!.use() // AoE: 3 enemies hit
    instance.actions.basic!.use() // priced with 3 stacks
    const basics = dealt.filter((d) => d.ability === 'BASIC').map((d) => d.damage)
    const price = (stacks: number, extra: Record<string, number | boolean> = {}) =>
      kernel.actionDamage({ ...request(m, {}, 3), attacker: { ...request(m, {}, 3).attacker, lightConeConditionals: { atkBuffStacks: stacks, spdBuff: false }, characterConditionals: { ...request(m, {}, 3).attacker.characterConditionals!, ...extra } } }).damage.BASIC!
    expect(basics[0]!).toBeCloseTo(price(0), 6)
    expect(basics[1]!).toBeCloseTo(price(1), 6)
    // The Skill hit 3 enemies: 3 stacks, and the SPD rise is on for the next turn.
    expect(basics[2]!).toBeCloseTo(price(3, { skillCritBuff: true, talentHitsPerAction: 5, talentAttacks: 5 }), 6)
    expect(battle.timeline.modifiers.spdPct('jy')).toBeCloseTo(0.08, 12)
  })
})
