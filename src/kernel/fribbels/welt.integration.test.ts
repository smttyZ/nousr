import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { Battle } from '../../battle/battle'
import type { BattleSetup, MemberSetup } from '../../battle/battle'
import type { EngineEvents } from '../../engine'
import { loadEnemyProfile } from '../../enemy/profile'
import { InTheNameOfTheWorld } from '../../equipment/inTheNameOfTheWorld'
import { Acheron } from '../../kits/acheron'
import { Welt, weltScalings, WELT_HITS } from '../../kits/welt'
import type { DamageRequest, KernelBuild, KernelTeammate } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Welt (buffed version 1, Fribbels' 1004b1) through the real kernel (DESIGN.md, K11): every hit NouSR deals is
 * priced as Fribbels prices that hit for the state the enemy is in. The expected numbers are built here from
 * Fribbels' own hit list and explicit switches written from the in-game text, not from the kit.
 *
 * Each test drives the actions by hand, one after another at time 0, so that the state of the enemy
 * (Slowed, Weightless, debuffed) and Welt's Retribution stacks are exactly what the test declares.
 */

const build: KernelBuild = {
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.SpaceSealingStation,
  body: Stats.CD,
  feet: Stats.ATK_P,
  planarSphere: Stats.Imaginary_DMG,
  linkRope: Stats.ATK_P,
  // EHR rolls so that the EHR-to-ATK trace (above 40%, +20% ATK per 10%) is in play.
  substatRolls: { [Stats.ATK_P]: 8, [Stats.CR]: 8, [Stats.CD]: 8, [Stats.EHR]: 12 },
}
const acheronBuild: KernelBuild = {
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.SpaceSealingStation,
  body: Stats.CD,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const profile = loadEnemyProfile('generic-moc')
const ALLY_MAX_HP = 1_000_000

const weltUnit = (eidolon: number, superimposition = 1) => ({ characterId: '1004b1', lightConeId: '23004', eidolon, superimposition })
const acheronUnit = { characterId: '1308', lightConeId: '23024', eidolon: 0, superimposition: 1 }

interface State {
  /** The enemy has an SPD reduction. */
  slowed: boolean
  weightless: boolean
  /** The wearer's Retribution stacks. */
  stacks: number
  /** The enemy has any debuff (the light cone's DMG bonus). */
  debuffed: boolean
}
const FRESH: State = { slowed: false, weightless: false, stacks: 0, debuffed: false }
const DEBUFFED: State = { slowed: true, weightless: false, stacks: 0, debuffed: true }
const WEIGHTLESS: State = { slowed: true, weightless: true, stacks: 0, debuffed: true }

const enemyOf = (count: number) => ({
  count,
  level: profile.level,
  maxToughness: profile.toughness,
  resistance: profile.res,
  elementalWeak: true,
  weaknessBroken: false,
})

/** Fribbels' request for Welt attacking an enemy in `state`, written from its switches and the text. */
const weltRequest = (eidolon: number, state: State, count = 1, teammates: KernelTeammate[] = [], superimposition = 1): DamageRequest => ({
  attacker: {
    ...weltUnit(eidolon, superimposition),
    characterConditionals: {
      // The Talent's hit stays in the list; the kit decides whether to deal it.
      enemySlowed: true,
      enemyWeightless: state.weightless,
      retributionDmgStacks: state.stacks,
      ehrToAtkBoost: true,
      traceAdditionalDmg: true,
      skillExtraHits: 4,
      e1WeightlessAdditionalDmg: true,
      e4WeightlessResPen: true,
      e6SlowedCrCdBoost: state.slowed,
    },
    lightConeConditionals: { enemyDebuffedDmgBoost: state.debuffed, skillAtkBoost: true, skillEhrBoost: true },
  },
  teammates,
  build,
  enemy: enemyOf(count),
})

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

const hitsOf = (r: DamageRequest, ability: string) => kernel.actionDamage(r).hits[ability]!
/** Fribbels' damage per 100% of the multiple, for one hit. */
const rate = (hit: { damage: number, scaling?: number }) => hit.damage / hit.scaling!

const weltMember = (eidolon: number, extra: Partial<MemberSetup> = {}): MemberSetup => ({
  key: 'welt',
  kit: Welt,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: ALLY_MAX_HP, def: 1000, baseSpd: 100 },
  kernel: { unit: weltUnit(eidolon), build },
  equipment: { lightCone: InTheNameOfTheWorld, sets: [] },
  ...extra,
})

const acheronMember: MemberSetup = {
  key: 'acheron',
  kit: Acheron,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: ALLY_MAX_HP, def: 1000, baseSpd: 100 },
  kernel: { unit: acheronUnit, build: acheronBuild },
}

function battleOf(members: MemberSetup[], enemyCount = 1, overrides: Partial<BattleSetup> = {}) {
  const battle = new Battle({
    members,
    policy: [],
    profile,
    enemyCount,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0, skillPoints: 5, techniques: false },
    kernel,
    ...overrides,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (d) => dealt.push(d))
  /** Uses one of a member's actions and returns what each enemy took from it (Break DMG left out). */
  const act = (who: string, name: string) => {
    const before = dealt.length
    battle.member(who).instance.actions[name]!.use()
    const by: Record<string, number> = {}
    for (const d of dealt.slice(before)) if (d.ability !== 'BREAK') by[d.enemy] = (by[d.enemy] ?? 0) + d.damage
    return by
  }
  return { battle, dealt, act }
}

const total = (by: Record<string, number>) => Object.values(by).reduce((a, b) => a + b, 0)
const sum = (hits: { damage: number }[], indices: number[]) => indices.reduce((acc, i) => acc + hits[i]!.damage, 0)

describe('Welt: the kernel\'s hit lists agree with the kit text (E0 and E5 multiples)', () => {
  for (const eidolon of [0, 3, 5]) {
    const s = weltScalings(eidolon)
    it(`E${eidolon}: BASIC [${s.basic}, ${(0.8 * s.basic).toFixed(3)}, ${s.talent}], SKILL, ULT`, () => {
      const state = WEIGHTLESS
      const basic = hitsOf(weltRequest(eidolon, state), 'BASIC')
      expect(basic.map((h) => h.scaling)).toEqual([s.basic, 0.8 * s.basic, s.talent].map((x) => expect.closeTo(x, 12)))
      const skill = hitsOf(weltRequest(eidolon, state), 'SKILL')
      const expected = [5 * s.skill, 1.2 * s.skill, 5 * s.talent, ...(eidolon >= 1 ? [0.4 * s.ult] : [])]
      expect(skill.map((h) => h.scaling)).toEqual(expected.map((x) => expect.closeTo(x, 12)))
      const ult = hitsOf(weltRequest(eidolon, state), 'ULT')
      const expectedUlt = [s.ult, 2 * s.talent, ...(eidolon >= 1 ? [0.4 * s.ult] : [])]
      expect(ult.map((h) => h.scaling)).toEqual(expectedUlt.map((x) => expect.closeTo(x, 12)))
    })
  }
})

describe('Welt through the real kernel, one enemy: every hit at its own price', () => {
  for (const eidolon of [0, 1, 3, 4, 5, 6]) {
    it(`E${eidolon}: Ultimate, Skill, Skill, Basic ATK, each priced for the enemy as it stands`, () => {
      const { battle, act } = battleOf([weltMember(eidolon)])
      battle.party.setEnergy('welt', 120)

      // Ultimate on a fresh enemy: no talent hit (not Slowed), no E1 (not Weightless), no debuff bonus, no E6.
      const ult = act('welt', 'ultimate')
      expect(ult.enemy1).toBeCloseTo(hitsOf(weltRequest(eidolon, FRESH), 'ULT')[WELT_HITS.ULT.main]!.damage, 6)

      // The Ultimate left the enemy Imprisoned, Weightless and slowed. Skill: every hit gets the Talent; E1 from E1.
      const skill1 = act('welt', 'skill')
      const h1 = hitsOf(weltRequest(eidolon, WEIGHTLESS), 'SKILL')
      expect(skill1.enemy1).toBeCloseTo(sum(h1, [0, 1, 2, ...(eidolon >= 1 ? [3] : [])]), 6)

      // That Skill hit a Weightless enemy: one Retribution stack for Welt, so the next attack has 1.
      const skill2 = act('welt', 'skill')
      const h2 = hitsOf(weltRequest(eidolon, { ...WEIGHTLESS, stacks: 1 }), 'SKILL')
      expect(skill2.enemy1).toBeCloseTo(sum(h2, [0, 1, 2, ...(eidolon >= 1 ? [3] : [])]), 6)

      const basic = act('welt', 'basic')
      const h3 = hitsOf(weltRequest(eidolon, { ...WEIGHTLESS, stacks: 2 }), 'BASIC')
      expect(basic.enemy1).toBeCloseTo(sum(h3, [0, 1, 2]), 6)
    })
  }

  it('Basic ATK and Skill on a fresh enemy: no Talent hit, no debuff bonus, no E6; the second Skill has all three', () => {
    const { battle, act } = battleOf([weltMember(6)])
    const basic = act('welt', 'basic')
    // Welt's own Basic ATK put nothing on the enemy.
    expect(basic.enemy1).toBeCloseTo(sum(hitsOf(weltRequest(6, FRESH), 'BASIC'), [0, 1]), 6)
    const first = act('welt', 'skill')
    // The Skill is five hits, one attack call each, and a hit's slow is on the enemy for the next (K22, later hits see earlier hits):
    // the first hit and the Judgment are priced on the fresh enemy; the other four, each with the Talent, on the slowed and debuffed one.
    const fresh = hitsOf(weltRequest(6, FRESH), 'SKILL')
    const slowed = hitsOf(weltRequest(6, DEBUFFED), 'SKILL')
    const s6 = weltScalings(6)
    expect(first.enemy1).toBeCloseTo(
      rate(fresh[0]!) * s6.skill + fresh[1]!.damage + 4 * (rate(slowed[0]!) * s6.skill + rate(slowed[2]!) * s6.talent),
      6,
    )
    // The first Skill slowed and debuffed it, for 2 turns.
    expect(battle.enemies.ids.every((id) => battle.debuffChance(id) > 0)).toBe(true)
    const second = act('welt', 'skill')
    const hits = hitsOf(weltRequest(6, DEBUFFED), 'SKILL')
    expect(second.enemy1).toBeCloseTo(sum(hits, [0, 1, 2]), 6)
    // E6's CRIT buff is in the main hit only: the same hit priced without it is lower.
    const noE6 = hitsOf(weltRequest(6, { ...DEBUFFED, slowed: false }), 'SKILL')
    expect(hits[0]!.damage).toBeGreaterThan(noE6[0]!.damage)
    expect(hits[2]!.damage).toBeCloseTo(noE6[2]!.damage, 6)
  })

  it('E6 alone changes the Slowed price of the main hit and nothing else (E0 has no such buff)', () => {
    const e6 = hitsOf(weltRequest(6, DEBUFFED), 'SKILL')
    const e6Off = hitsOf(weltRequest(6, { ...DEBUFFED, slowed: false }), 'SKILL')
    expect(e6[0]!.damage / e6Off[0]!.damage).toBeGreaterThan(1.1)
    const e0 = hitsOf(weltRequest(0, DEBUFFED), 'SKILL')
    const e0Off = hitsOf(weltRequest(0, { ...DEBUFFED, slowed: false }), 'SKILL')
    expect(e0[0]!.damage).toBeCloseTo(e0Off[0]!.damage, 6)
  })

  it('In the Name of the World: the DMG bonus is live per enemy, the Skill gets ATK and EHR, other abilities do not', () => {
    const skillOn = hitsOf(weltRequest(0, DEBUFFED), 'SKILL')
    const skillOff = hitsOf(weltRequest(0, { ...DEBUFFED, debuffed: false }), 'SKILL')
    // The 24% adds to the wearer's other DMG bonuses, so the ratio is 1 + 24% / (1 + the rest).
    const gain1 = skillOn[0]!.damage / skillOff[0]!.damage - 1
    expect(gain1).toBeGreaterThan(0.1)
    expect(gain1).toBeLessThan(0.24)
    // skillAtkBoost / skillEhrBoost are Skill-only inside Fribbels: Basic ATK and Ultimate are identical with them off.
    for (const ability of ['BASIC', 'ULT']) {
      const on = weltRequest(0, DEBUFFED)
      const off = weltRequest(0, DEBUFFED)
      off.attacker.lightConeConditionals = { enemyDebuffedDmgBoost: true, skillAtkBoost: false, skillEhrBoost: false }
      expect(sum(hitsOf(on, ability), [0]), ability).toBeCloseTo(sum(hitsOf(off, ability), [0]), 6)
    }
    const skillNoAtk = weltRequest(0, DEBUFFED)
    skillNoAtk.attacker.lightConeConditionals = { enemyDebuffedDmgBoost: true, skillAtkBoost: false, skillEhrBoost: false }
    expect(skillOn[0]!.damage).toBeGreaterThan(hitsOf(skillNoAtk, 'SKILL')[0]!.damage * 1.05)
    // Superimposition 5: 40% DMG to debuffed enemies.
    const s5 = hitsOf(weltRequest(0, DEBUFFED, 1, [], 5), 'SKILL')
    const s5Off = hitsOf(weltRequest(0, { ...DEBUFFED, debuffed: false }, 1, [], 5), 'SKILL')
    // Superimposition 5 is 40% where superimposition 1 is 24%: the gain scales with the bonus.
    expect((s5[0]!.damage / s5Off[0]!.damage - 1) / gain1).toBeCloseTo(40 / 24, 6)
  })
})

describe('Welt through the real kernel, 3 and 5 enemies', () => {
  for (const count of [3, 5]) {
    const primary = `enemy${Math.ceil(count / 2)}`
    const ids = Array.from({ length: count }, (_, i) => `enemy${i + 1}`)

    it(`${count} enemies, fresh Skill: the primary takes 1 + 4/${count} hits, the others 4/${count}, Judgment on the primary, each hit priced against the slow the earlier ones left`, () => {
      const { act } = battleOf([weltMember(0)], count)
      const by = act('welt', 'skill')
      const s = weltScalings(0)
      const fresh = hitsOf(weltRequest(0, FRESH, count), 'SKILL')
      const slowed = hitsOf(weltRequest(0, DEBUFFED, count), 'SKILL')
      for (const id of ids) {
        // The designated hit (the primary only), priced fresh; its Judgment too.
        let expected = id === primary ? rate(fresh[0]!) * s.skill + fresh[1]!.damage : 0
        // Each of the 4 random hits lands here with 1/count. The enemy was already slowed by the earlier ones with chance
        // 1 - (1 - 1/count)^(hits before), and the primary by the designated hit for certain. The main hit's price is the mean of the
        // two states; the Talent's hit exists only where it is slowed, so it is priced slowed.
        for (let j = 1; j <= 4; j++) {
          const before = id === primary ? 1 : 1 - (1 - 1 / count) ** (j - 1)
          const main = (1 - before) * rate(fresh[0]!) + before * rate(slowed[0]!)
          expected += (1 / count) * (s.skill * main + before * s.talent * rate(slowed[2]!))
        }
        expect(by[id], id).toBeCloseTo(expected, 6)
      }
    })

    it(`${count} enemies, Skill after the Ultimate: Talent on every hit, E1 once per Weightless enemy hit (E1 reading)`, () => {
      const { battle, act } = battleOf([weltMember(1)], count)
      battle.party.setEnergy('welt', 120)
      const ult = act('welt', 'ultimate')
      const ultHits = hitsOf(weltRequest(1, FRESH, count), 'ULT')
      for (const id of ids) expect(ult[id], id).toBeCloseTo(ultHits[0]!.damage, 6)

      const by = act('welt', 'skill')
      const s = weltScalings(1)
      const [main, judgment, talent, e1] = hitsOf(weltRequest(1, WEIGHTLESS, count), 'SKILL')
      const reached = 1 - (1 - 1 / count) ** 4
      for (const id of ids) {
        const hits = (id === primary ? 1 : 0) + 4 / count
        const expected =
          rate(main!) * s.skill * hits +
          (id === primary ? judgment!.damage : 0) +
          rate(talent!) * s.talent * hits +
          rate(e1!) * 0.4 * s.ult * (id === primary ? 1 : reached)
        expect(by[id], id).toBeCloseTo(expected, 6)
      }
    })

    it(`${count} enemies, Ultimate on Slowed enemies: the Talent twice on each, E1 on the Weightless ones`, () => {
      const { battle, act } = battleOf([weltMember(1)], count)
      battle.party.setEnergy('welt', 120)
      act('welt', 'ultimate')
      battle.party.setEnergy('welt', 120)
      const by = act('welt', 'ultimate')
      const s = weltScalings(1)
      const hits = hitsOf(weltRequest(1, WEIGHTLESS, count), 'ULT')
      for (const id of ids) {
        expect(by[id], id).toBeCloseTo(hits[0]!.damage + rate(hits[1]!) * 2 * s.talent + rate(hits[2]!) * 0.4 * s.ult, 6)
      }
    })
  }
})

describe('Welt as a teammate: Weightless shreds DEF, E4 its RES, Retribution adds DMG per ally', () => {
  const acheronBasic = (weltEidolon: number, state: { weightless: boolean, stacks: number }, e1Debuffed = true) =>
    kernel.actionDamage({
      attacker: {
        ...acheronUnit,
        characterConditionals: {
          crimsonKnotStacks: 0,
          stygianResurgeHitsOnTarget: 0,
          thunderCoreStacks: 0,
          nihilityTeammatesBuff: true,
          e1EnemyDebuffed: e1Debuffed,
          e4UltVulnerability: true,
          e6UltBuffs: true,
        },
      },
      teammates: [{
        ...weltUnit(weltEidolon),
        characterConditionals: { enemyWeightless: state.weightless, retributionDmgStacks: state.stacks, e4WeightlessResPen: true },
      }],
      build: acheronBuild,
      enemy: enemyOf(1),
    }).hits.BASIC![0]!.damage

  for (const eidolon of [0, 4]) {
    it(`E${eidolon}: Acheron's Basic ATK after his Ultimate, then again with the stack her first one earned`, () => {
      const { battle, act } = battleOf([weltMember(eidolon), acheronMember])
      // No Welt Ultimate yet: Weightless is not up, no stacks, and nothing is debuffed.
      const before = act('acheron', 'basic')
      expect(before.enemy1).toBeCloseTo(acheronBasic(eidolon, { weightless: false, stacks: 0 }, false), 6)

      battle.party.setEnergy('welt', 120)
      act('welt', 'ultimate')
      const first = act('acheron', 'basic')
      expect(first.enemy1).toBeCloseTo(acheronBasic(eidolon, { weightless: true, stacks: 0 }), 6)
      const second = act('acheron', 'basic')
      expect(second.enemy1).toBeCloseTo(acheronBasic(eidolon, { weightless: true, stacks: 1 }), 6)
      expect(second.enemy1!).toBeGreaterThan(first.enemy1!)
      expect(first.enemy1!).toBeGreaterThan(before.enemy1!)
      if (eidolon === 4) {
        // E4: the Weightless RES shred is part of the price.
        const noE4 = acheronBasic(0, { weightless: true, stacks: 0 })
        expect(first.enemy1!).toBeGreaterThan(noE4 * 1.0)
      }
    })
  }

  it('E4 versus E0: the RES shred raises the teammate\'s price by about 30% of a 20% RES', () => {
    const e0 = acheronBasic(0, { weightless: true, stacks: 0 })
    const e4 = acheronBasic(4, { weightless: true, stacks: 0 })
    expect(e4).toBeGreaterThan(e0)
  })
})
