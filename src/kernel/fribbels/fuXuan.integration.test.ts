import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { Battle } from '../../battle/battle'
import type { BattleSetup, MemberSetup } from '../../battle/battle'
import type { EngineEvents } from '../../engine'
import { loadEnemyProfile } from '../../enemy/profile'
import { TrendOfTheUniversalMarket } from '../../equipment/trendOfTheUniversalMarket'
import { FuXuan, fuXuanScalings } from '../../kits/fuXuan'
import type { Kit } from '../../kits/kit'
import type { Rule } from '../../scenario/types'
import type { DamageRequest, KernelBuild, KernelUnit } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Fu Xuan through the real kernel. What these pin:
 * - Her own Basic ATK and Ultimate are Fribbels' own hits for the same state (K11), at several eidolons and enemy counts, with the
 *   Matrix up and down, and E6's tally passed as Fribbels' `e6TeamHpLostPercent`.
 * - Every buff the Knowledge effect gives a teammate reaches the teammate's price with its live value: CRIT Rate (12%, 13.2% at E3),
 *   CRIT DMG from E1, and the flat Max HP of 6% (6.6%) of her Max HP, which Fribbels takes as an input (`teammateHPValue`) and the kit
 *   fills with her real Max HP, read from the kernel with her own Knowledge off. An Acheron (ATK scaler) and a Tribbie (HP scaler) are the
 *   teammates.
 * - Her Ultimate's heal (Dunjia) is the number Fribbels gives for it.
 * - The light cone's DEF bonus is in the kernel's DEF, and a whole battle runs with the redirection, the Talent and the Burn.
 */

const fxBuild: KernelBuild = {
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.InertSalsotto,
  body: Stats.HP_P,
  feet: Stats.SPD,
  planarSphere: Stats.HP_P,
  linkRope: Stats.HP_P,
  substatRolls: { [Stats.HP_P]: 10, [Stats.SPD]: 5, [Stats.DEF_P]: 5 },
}
const acheronBuild: KernelBuild = {
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
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.InertSalsotto,
  body: Stats.CD,
  feet: Stats.HP_P,
  planarSphere: Stats.Quantum_DMG,
  linkRope: Stats.HP_P,
  substatRolls: { [Stats.HP_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const profile = loadEnemyProfile('generic-moc')
const TREND = '21016'

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

/** An ally that only Basic ATKs one enemy, carrying a real character's identity so the real kernel prices its hit 0 per 100%. */
const stub = (path: Kit['path'], element: Kit['element']): Kit => ({
  characterId: 'stub',
  path,
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

const fxUnit = (eidolon: number, superimposition = 1): KernelUnit => ({ characterId: '1208', lightConeId: TREND, eidolon, superimposition })
const acheronUnit: KernelUnit = { characterId: '1308', lightConeId: '23024', eidolon: 0, superimposition: 1 }
const tribbieUnit: KernelUnit = { characterId: '1403', lightConeId: '21018', eidolon: 0, superimposition: 1 }

const fxMember = (eidolon: number, superimposition = 1): MemberSetup => ({
  key: 'fx',
  kit: FuXuan,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 134 },
  kernel: { unit: fxUnit(eidolon, superimposition), build: fxBuild },
  equipment: { lightCone: TrendOfTheUniversalMarket, sets: [] },
})
const acheronMember: MemberSetup = {
  key: 'acheron',
  kit: stub('Nihility', 'Lightning'),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 120 },
  kernel: { unit: acheronUnit, build: acheronBuild },
}
const tribbieMember: MemberSetup = {
  key: 'tribbie',
  kit: stub('Harmony', 'Quantum'),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 110 },
  kernel: { unit: tribbieUnit, build: tribbieBuild },
}

const basicPolicy: Rule[] = [
  { unit: 'fx', use: 'basic', when: [] },
  { unit: 'acheron', use: 'basic', when: [] },
  { unit: 'tribbie', use: 'basic', when: [] },
]

function setup(eidolon: number, options: { enemies?: number, policy?: Rule[], cycles?: number } = {}) {
  const members = [fxMember(eidolon), acheronMember, tribbieMember]
  const setupOptions: BattleSetup = {
    members,
    policy: options.policy ?? basicPolicy,
    profile,
    enemyCount: options.enemies ?? 1,
    weaknesses: 'all',
    cycles: options.cycles ?? 3,
    start: { energy: 0, skillPoints: 5, techniques: false },
    kernel,
  }
  const battle = new Battle(setupOptions)
  const dealt: EngineEvents['damageDealt'][] = []
  const healed: EngineEvents['healed'][] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  battle.timeline.bus.on('healed', (e) => healed.push(e))
  return { battle, members, dealt, healed, act: battle.member('fx').instance.actions }
}

/** What Fribbels is told about Fu Xuan: her Matrix switch and the Max HP the HP buff is 6% of. */
interface FxState {
  skillActive: boolean
  teammateHPValue?: number
  e6?: number
}

/** The request the runner sends for `attacker` against one enemy, written from the in-game text, not from the kit. */
function requestFor(members: MemberSetup[], attacker: string, state: FxState, enemies = 1): DamageRequest {
  const me = members.find((m) => m.key === attacker)!
  const fxEidolon = members.find((m) => m.key === 'fx')!.eidolon
  const own = attacker === 'fx'
  return {
    attacker: {
      ...me.kernel.unit,
      ...(own && {
        characterConditionals: {
          skillActive: state.skillActive,
          talentActive: true,
          ...(fxEidolon >= 6 && { e6TeamHpLostPercent: state.e6 ?? 0 }),
        },
      }),
    },
    teammates: members
      .filter((m) => m.key !== attacker)
      .map((m) => ({
        ...m.kernel.unit,
        ...(m.key === 'fx' && {
          characterConditionals: { skillActive: state.skillActive, talentActive: true, teammateHPValue: state.skillActive ? state.teammateHPValue ?? 0 : 0 },
        }),
      })),
    build: me.kernel.build,
    enemy: { count: enemies, level: profile.level, maxToughness: profile.toughness, resistance: profile.res, elementalWeak: true, weaknessBroken: false },
  }
}

const sum = (dealt: EngineEvents['damageDealt'][], ability: string, attacker: string) =>
  dealt.filter((d) => d.ability === ability && d.attacker === attacker).reduce((total, d) => total + d.damage, 0)

/** Her Max HP before her own Knowledge, from the kernel, for a given eidolon: what `teammateHPValue` must be. */
const baseHp = (members: MemberSetup[], eidolon: number) =>
  kernel.actionDamage(requestFor(members, 'fx', { skillActive: false })).stats.HP + 0 * eidolon

describe('her own hits, priced as Fribbels prices them', () => {
  it('Basic ATK and Ultimate equal the kernel number for the same state, with the Matrix down and up, at E0, E1, E3, E5 and E6, on 1, 3 and 5 enemies', () => {
    for (const eidolon of [0, 1, 3, 5, 6]) {
      for (const enemies of [1, 3, 5]) {
        const { battle, members, dealt, act } = setup(eidolon, { enemies })
        const s = fuXuanScalings(eidolon)
        const tag = `E${eidolon} x${enemies}`

        act.basic!.use()
        const down = kernel.actionDamage(requestFor(members, 'fx', { skillActive: false }, enemies))
        expect(sum(dealt, 'BASIC', 'fx'), `basic down ${tag}`).toBeCloseTo(down.damage.BASIC!, 6)
        expect(down.hits.BASIC![0]!.scaling).toBeCloseTo(s.basic, 12)

        battle.party.setEnergy('fx', 135)
        dealt.length = 0
        act.ultimate!.use()
        expect(sum(dealt, 'ULT', 'fx'), `ult down ${tag}`).toBeCloseTo(down.hits.ULT![0]!.damage * enemies, 6)
        expect(down.hits.ULT![0]!.scaling).toBeCloseTo(s.ult, 12)

        act.skill!.use()
        const hp = baseHp(members, eidolon)
        const up = kernel.actionDamage(requestFor(members, 'fx', { skillActive: true, teammateHPValue: hp }, enemies))
        dealt.length = 0
        act.basic!.use()
        expect(sum(dealt, 'BASIC', 'fx'), `basic up ${tag}`).toBeCloseTo(up.damage.BASIC!, 6)
        // Her own Knowledge is on her: more CRIT, more HP, more damage than with the Matrix down.
        expect(up.damage.BASIC!).toBeGreaterThan(down.damage.BASIC!)
        battle.party.setEnergy('fx', 135)
        dealt.length = 0
        act.ultimate!.use()
        expect(sum(dealt, 'ULT', 'fx'), `ult up ${tag}`).toBeCloseTo(up.hits.ULT![0]!.damage * enemies, 6)
      }
    }
  })

  it("the Knowledge on herself is Fribbels' own: +6% (6.6% at E3) of her HP before it, +12% (13.2%) CRIT Rate, and +30% CRIT DMG from E1", () => {
    for (const eidolon of [0, 1, 3]) {
      const { battle, act } = setup(eidolon)
      const before = battle.combatStats('fx')
      act.skill!.use()
      const after = battle.combatStats('fx')
      const s = fuXuanScalings(eidolon)
      expect(after.HP, `E${eidolon}`).toBeCloseTo(before.HP * (1 + s.knowledgeHp), 6)
      expect(after.CR - before.CR).toBeCloseTo(s.knowledgeCritRate, 9)
      expect(after.CD - before.CD).toBeCloseTo(eidolon >= 1 ? 0.3 : 0, 9)
    }
  })

  it('E6: the Ultimate carries the live tally as Fribbels\' e6TeamHpLostPercent, and prices at 108% + 200% of it', () => {
    for (const enemies of [1, 3]) {
      const { battle, members, dealt, act } = setup(6, { enemies })
      act.skill!.use()
      // The team loses HP: the tally is what the party lost after the Matrix moved its share.
      battle.party.takeDamage('acheron', 2000, 'enemy1')
      battle.party.takeDamage('tribbie', 3000, 'enemy1')
      const share = battle.member('fx').instance.quantities!.e6_tally_share!() as number
      expect(share).toBeGreaterThan(0)
      expect(share).toBeLessThan(1.2)
      battle.party.setEnergy('fx', 135)
      dealt.length = 0
      act.ultimate!.use()
      const expected = kernel.actionDamage(requestFor(members, 'fx', { skillActive: true, teammateHPValue: baseHp(members, 6), e6: share }, enemies))
      expect(expected.hits.ULT![0]!.scaling).toBeCloseTo(1.08 + 2 * share, 9)
      expect(sum(dealt, 'ULT', 'fx'), `x${enemies}`).toBeCloseTo(expected.hits.ULT![0]!.damage * enemies, 6)
      expect(dealt.filter((d) => d.ability === 'ULT')[0]!.scaling).toBeCloseTo(1.08 + 2 * share, 9)
    }
  })
})

describe('every Knowledge buff reaches a teammate with its live value', () => {
  it("an attack-scaling teammate (Acheron) gets CRIT Rate, CRIT DMG from E1 and HP; her price is Fribbels' for the same state", () => {
    for (const eidolon of [0, 1, 3]) {
      for (const enemies of [1, 3]) {
        const { battle, members, dealt, act } = setup(eidolon, { enemies })
        const tag = `E${eidolon} x${enemies}`
        battle.member('acheron').instance.actions.basic!.use()
        const down = kernel.actionDamage(requestFor(members, 'acheron', { skillActive: false }, enemies))
        expect(sum(dealt, 'BASIC', 'acheron'), `down ${tag}`).toBeCloseTo(down.damage.BASIC!, 6)
        const statsDown = battle.combatStats('acheron')

        act.skill!.use()
        dealt.length = 0
        battle.member('acheron').instance.actions.basic!.use()
        const hp = baseHp(members, eidolon)
        const up = kernel.actionDamage(requestFor(members, 'acheron', { skillActive: true, teammateHPValue: hp }, enemies))
        expect(sum(dealt, 'BASIC', 'acheron'), `up ${tag}`).toBeCloseTo(up.damage.BASIC!, 6)
        expect(up.damage.BASIC!).toBeGreaterThan(down.damage.BASIC!)

        const s = fuXuanScalings(eidolon)
        const statsUp = battle.combatStats('acheron')
        expect(statsUp.CR - statsDown.CR, `CR ${tag}`).toBeCloseTo(s.knowledgeCritRate, 9)
        expect(statsUp.CD - statsDown.CD, `CD ${tag}`).toBeCloseTo(eidolon >= 1 ? 0.3 : 0, 9)
        expect(statsUp.HP - statsDown.HP, `HP ${tag}`).toBeCloseTo(s.knowledgeHp * hp, 6)
      }
    }
  })

  it("an HP-scaling teammate (Tribbie) is priced with her real Max HP in the buff, not Fribbels' default of 8000", () => {
    const { battle, members, dealt, act } = setup(1)
    act.skill!.use()
    battle.member('tribbie').instance.actions.basic!.use()
    const hp = baseHp(members, 1)
    expect(hp).not.toBeCloseTo(8000, 0)
    const live = kernel.actionDamage(requestFor(members, 'tribbie', { skillActive: true, teammateHPValue: hp }))
    const fallback = kernel.actionDamage(requestFor(members, 'tribbie', { skillActive: true, teammateHPValue: 8000 }))
    // The stub deals 100% of hit 0, so the expected number is the kernel's price per 100% of that hit.
    const per100 = (r: typeof live) => r.hits.BASIC![0]!.damage / r.hits.BASIC![0]!.scaling!
    expect(sum(dealt, 'BASIC', 'tribbie')).toBeCloseTo(per100(live), 6)
    expect(per100(live)).not.toBeCloseTo(per100(fallback), 3)
    // The HP buff is flat: 6% of her Max HP, added to Tribbie's HP.
    expect(battle.combatStats('tribbie').HP - kernel.actionDamage(requestFor(members, 'tribbie', { skillActive: false })).stats.HP).toBeCloseTo(0.06 * hp, 6)
  })

  it('the buffs end with the Matrix: after it expires an ally is priced as with no Fu Xuan buff', () => {
    const { battle, members, dealt, act } = setup(1)
    act.skill!.use()
    battle.timeline.modifiers.remove('fx', 'fuxuan.matrix')
    battle.member('acheron').instance.actions.basic!.use()
    const down = kernel.actionDamage(requestFor(members, 'acheron', { skillActive: false }))
    expect(sum(dealt, 'BASIC', 'acheron')).toBeCloseTo(down.damage.BASIC!, 6)
  })
})

describe('Dunjia: the Ultimate heal', () => {
  it("is Fribbels' own heal number for the Ultimate (5% of her Max HP + 133, no Outgoing Healing Boost on this build), to every other ally", () => {
    for (const matrix of [false, true]) {
      const { battle, members, healed, act } = setup(0)
      battle.party.takeDamage('acheron', 3000, 'enemy1')
      battle.party.takeDamage('tribbie', 3000, 'enemy1')
      if (matrix) act.skill!.use()
      battle.party.setEnergy('fx', 135)
      healed.length = 0
      act.ultimate!.use()
      const expected = kernel.actionDamage(
        requestFor(members, 'fx', matrix ? { skillActive: true, teammateHPValue: baseHp(members, 0) } : { skillActive: false }),
      ).hits.TALENT_HEAL![0]!.damage
      const toAllies = healed.filter((h) => h.unit !== 'fx')
      expect(toAllies.map((h) => h.unit).sort()).toEqual(['acheron', 'tribbie'])
      for (const h of toAllies) expect(h.amount + h.overheal, `matrix ${matrix}`).toBeCloseTo(expected, 6)
    }
  })
})

describe('the light cone and a whole battle', () => {
  it("Trend of the Universal Market's DEF is in the kernel's DEF and rises with the superimposition (16% at S1, 32% at S5)", () => {
    const def = (superimposition: number) => kernel.basicStats(fxUnit(0, superimposition), fxBuild).DEF
    const steps = [1, 2, 3, 4, 5].map(def)
    // DEF = base x (1 + other% + lightcone%) + flat: each superimposition adds 4% of the same base.
    const step = steps[1]! - steps[0]!
    for (let i = 1; i < steps.length; i++) expect(steps[i]! - steps[i - 1]!).toBeCloseTo(step, 2)
    // S1 to S5 adds 16 points of percent: 4 steps of 4%, so the base is step / 0.04.
    expect((steps[4]! - steps[0]!) / (step / 0.04)).toBeCloseTo(0.16, 5)
  })

  it('a 5-cycle battle with enemy attacks runs: the Matrix redirects, Misfortune Avoidance and HP Restore work, the Burn is on the enemy, and allies deal more with her Knowledge', () => {
    const run = (policy: Rule[]) => {
      const { battle } = setup(0, { enemies: 3, cycles: 5, policy })
      const redirected: EngineEvents['damageRedirected'][] = []
      battle.timeline.bus.on('damageRedirected', (e) => redirected.push(e))
      let burned = 0
      battle.timeline.bus.on('allyHit', () => {
        if (battle.enemies.ids.some((id) => battle.timeline.modifiers.has(id, 'lightcone.21016.burn:fx'))) burned += 1
      })
      const result = battle.run()
      return { result, redirected, burned, battle }
    }
    const withMatrix = run([{ unit: 'fx', use: 'skill', when: [{ what: 'fx.matrix', is: false }] }, ...basicPolicy])
    const without = run(basicPolicy)
    expect(withMatrix.redirected.length).toBeGreaterThan(0)
    expect(withMatrix.redirected.every((r) => r.to === 'fx')).toBe(true)
    expect(without.redirected).toHaveLength(0)
    expect(withMatrix.burned).toBeGreaterThan(0)
    expect(withMatrix.result.downed).toEqual([])
    expect(withMatrix.result.damageByMember.acheron!).toBeGreaterThan(without.result.damageByMember.acheron!)
    expect(withMatrix.result.damageByMember.tribbie!).toBeGreaterThan(without.result.damageByMember.tribbie!)
  })
})
