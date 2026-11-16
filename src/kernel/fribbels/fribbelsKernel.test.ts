import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { StatCalculator } from '../../../vendor/hsr-optimizer/src/lib/relics/statCalculator'
import {
  generateE6S5Test,
  runTest,
  testCharacter,
  testMains,
  testSets,
  testStatSpread,
} from '../../../vendor/hsr-optimizer/src/lib/simulations/tests/simTestUtils'
import { getGameMetadata } from '../../../vendor/hsr-optimizer/src/lib/state/gameMetadata'
import { buildBattleSetup, runScenario } from '../../run/run'
import { loadScenarioFile } from '../../scenario/load'
import type { DamageRequest, InjectedBuff, KernelBuild, KernelTeammate, KernelUnit } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

// Fribbels ids. Characters: vendor/hsr-optimizer/src/lib/conditionals/character/**. Light cones: .../lightcone/**.
const ACHERON = '1308'
const JIAOQIU = '1218'
const SPARKLE_B1 = '1306b1'
const FU_XUAN = '1208'
const ANAXA = '1405'
const SUNDAY = '1313'
const ROBIN = '1309'
const HUOHUO_B1 = '1217b1'
const ALONG_THE_PASSING_SHORE = '23024'
const THOSE_MANY_SPRINGS = '23029'
const EARTHLY_ESCAPADE = '23021'
const SHE_ALREADY_SHUT_HER_EYES = '23011'
const LIFE_SHOULD_BE_CAST_TO_FLAMES = '23041'
const A_GROUNDED_ASCENT = '23034'
const FLOWING_NIGHTGLOW = '23026'
const NIGHT_OF_FRIGHT = '23017'

const e6s5 = (characterId: string, lightConeId: string): KernelUnit => ({
  characterId,
  lightConeId,
  eidolon: 6,
  superimposition: 5,
})

/** Ten max rolls of every substat Fribbels' test spread uses. */
const tenRollsEach: Record<string, number> = testStatSpread()

const acheronBuild: KernelBuild = {
  relicSet1: Sets.PioneerDiverOfDeadWaters,
  relicSet2: Sets.PioneerDiverOfDeadWaters,
  ornamentSet: Sets.IzumoGenseiAndTakamaDivineRealm,
  body: Stats.CD,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: tenRollsEach,
}

const acheronTeam: KernelTeammate[] = [
  e6s5(JIAOQIU, THOSE_MANY_SPRINGS),
  e6s5(SPARKLE_B1, EARTHLY_ESCAPADE),
  e6s5(FU_XUAN, SHE_ALREADY_SHUT_HER_EYES),
]

const acheronRequest = (): DamageRequest => ({
  attacker: e6s5(ACHERON, ALONG_THE_PASSING_SHORE),
  teammates: acheronTeam.map((t) => ({ ...t })),
  build: acheronBuild,
})

let kernel: FribbelsKernel

beforeAll(() => {
  kernel = new FribbelsKernel()
})

describe('single actions match Fribbels', () => {
  // Expected values copied from Fribbels' own test at the pinned commit:
  // vendor/hsr-optimizer/src/lib/simulations/tests/statSim/statSim.test.ts ('Acheron sim')
  it('Acheron E6S5 with Jiaoqiu, Sparkle and Fu Xuan: Fribbels\' published numbers', () => {
    const { damage, stats } = kernel.actionDamage(acheronRequest())

    expect(damage.BASIC).toBeCloseTo(458704.4993477, 6)
    expect(damage.SKILL).toBeCloseTo(733927.1989564, 6)
    expect(damage.ULT).toBeCloseTo(2623275.5197605, 6)
    expect(damage.BREAK).toBeCloseTo(34608.8620462, 6)

    expect(stats.ATK).toBeCloseTo(5081.6889781, 6)
    expect(stats.DEF).toBeCloseTo(1283.574585, 6)
    expect(stats.HP).toBeCloseTo(4360.8474121, 6)
    expect(stats.SPD).toBeCloseTo(127, 6)
    expect(stats.EHR).toBeCloseTo(0.432, 6)
    expect(stats.BE).toBeCloseTo(0.648, 6)
  })

  // Same file, 'Anaxa sim'.
  it('Anaxa E6S5 with Sunday, Robin and Huohuo: Fribbels\' published numbers', () => {
    const { damage, stats } = kernel.actionDamage({
      attacker: e6s5(ANAXA, LIFE_SHOULD_BE_CAST_TO_FLAMES),
      teammates: [
        e6s5(SUNDAY, A_GROUNDED_ASCENT),
        e6s5(ROBIN, FLOWING_NIGHTGLOW),
        e6s5(HUOHUO_B1, NIGHT_OF_FRIGHT),
      ],
      build: {
        relicSet1: Sets.ScholarLostInErudition,
        relicSet2: Sets.ScholarLostInErudition,
        ornamentSet: Sets.RutilantArena,
        body: Stats.CD,
        feet: Stats.SPD,
        planarSphere: Stats.Wind_DMG,
        linkRope: Stats.ATK_P,
        substatRolls: tenRollsEach,
      },
    })

    expect(damage.BASIC).toBeCloseTo(352794.5246537, 6)
    expect(damage.SKILL).toBeCloseTo(1359471.2947962, 6)
    expect(damage.ULT).toBeCloseTo(564471.2394459, 6)
    // Fribbels' file lists BREAK and the stats for this case as 32-bit-rounded values (the engine
    // returns 46384.4667059 and 5822.3600758). Fribbels' own assertion is toBeCloseTo(value), two
    // decimals, so these lines use that.
    expect(damage.BREAK).toBeCloseTo(46384.46875, 2)
    expect(stats.ATK).toBeCloseTo(5822.3603516, 2)
    expect(stats.SPD).toBeCloseTo(175.1921082, 2)
    expect(stats.RES).toBeCloseTo(0.932, 2)
  })

  it('is bit-for-bit what Fribbels\' own test helper returns for the same setup', () => {
    const ours = kernel.actionDamage(acheronRequest()).damage

    const theirs = runTest(generateE6S5Test({
      character: testCharacter(ACHERON, ALONG_THE_PASSING_SHORE),
      teammate0: testCharacter(JIAOQIU, THOSE_MANY_SPRINGS),
      teammate1: testCharacter(SPARKLE_B1, EARTHLY_ESCAPADE),
      teammate2: testCharacter(FU_XUAN, SHE_ALREADY_SHUT_HER_EYES),
      sets: testSets(Sets.PioneerDiverOfDeadWaters, Sets.PioneerDiverOfDeadWaters, Sets.IzumoGenseiAndTakamaDivineRealm),
      mains: testMains(Stats.CD, Stats.ATK_P, Stats.Lightning_DMG, Stats.ATK_P),
      stats: testStatSpread(),
    })).actionDamage!

    expect(Object.keys(ours).sort()).toEqual(Object.keys(theirs).sort())
    for (const [ability, value] of Object.entries(theirs)) {
      expect(ours[ability], ability).toBe(value)
    }
  })

  it('gives the same answer when asked twice', () => {
    expect(kernel.actionDamage(acheronRequest())).toEqual(kernel.actionDamage(acheronRequest()))
  })
})

describe('live buff state reaches the kernel', () => {
  it('Acheron\'s Ultimate scales with Crimson Knot stacks exactly as her kit file says', () => {
    const full = kernel.actionDamage(acheronRequest()).damage
    const request = acheronRequest()
    request.attacker.characterConditionals = { crimsonKnotStacks: 0 }
    const none = kernel.actionDamage(request).damage

    // E6 Ultimate scaling from Acheron.ts: 3 Rainblades + 3 base knots + 1 knot per stack
    // + Stygian Resurge + 6 Thunder Core hits.
    const scaling = (knots: number) => 3 * 0.2592 + 3 * 0.162 + 0.162 * knots + 1.296 + 6 * 0.25
    expect(none.ULT! / full.ULT!).toBeCloseTo(scaling(0) / scaling(9), 10)
    expect(none.BASIC).toBe(full.BASIC)
    expect(none.SKILL).toBe(full.SKILL)
  })

  it('switching a teammate\'s buff off lowers the damage', () => {
    const on = kernel.actionDamage(acheronRequest()).damage
    const request = acheronRequest()
    request.teammates[0]!.characterConditionals = { ultFieldActive: false }
    const off = kernel.actionDamage(request).damage
    expect(off.ULT).toBeLessThan(on.ULT!)
  })

  it('switching a teammate\'s light cone effect off lowers the damage', () => {
    const on = kernel.actionDamage(acheronRequest()).damage
    const request = acheronRequest()
    request.teammates[1]!.lightConeConditionals = { maskActive: false }
    const off = kernel.actionDamage(request).damage
    expect(off.ULT).toBeLessThan(on.ULT!)
  })

  it('a set conditional reaches the kernel', () => {
    const on = kernel.actionDamage(acheronRequest()).damage
    const off = kernel.actionDamage({
      ...acheronRequest(),
      setConditionals: { [Sets.PioneerDiverOfDeadWaters]: -1 },
    }).damage
    expect(off.ULT).toBeLessThan(on.ULT!)
  })

  it('enemy settings reach the kernel', () => {
    const weak = kernel.actionDamage(acheronRequest()).damage
    const notWeak = kernel.actionDamage({ ...acheronRequest(), enemy: { elementalWeak: false } }).damage
    expect(notWeak.ULT).toBeLessThan(weak.ULT!)
  })
})

describe('Affinitive Eidolon', () => {
  const e0 = (ex: number, enemyCount: number): DamageRequest => ({
    attacker: { characterId: ACHERON, lightConeId: ALONG_THE_PASSING_SHORE, eidolon: 0, superimposition: 1, ex },
    teammates: [],
    build: acheronBuild,
    enemy: { count: enemyCount },
  })

  it('Acheron gains her extra attack only with the flag on', () => {
    expect(kernel.actionDamage(e0(0, 1)).damage.FUA).toBeUndefined()
    expect(kernel.actionDamage(e0(1, 1)).damage.FUA).toBeGreaterThan(0)
  })

  it('the extra attack is 300% ATK plus six 80% bounces split across the enemies', () => {
    const one = kernel.actionDamage(e0(1, 1)).damage.FUA!
    const three = kernel.actionDamage(e0(1, 3)).damage.FUA!
    const five = kernel.actionDamage(e0(1, 5)).damage.FUA!
    const scaling = (enemies: number) => 3.0 + (0.8 * 6) / enemies
    expect(three / one).toBeCloseTo(scaling(3) / scaling(1), 10)
    expect(five / one).toBeCloseTo(scaling(5) / scaling(1), 10)
  })
})

describe('game id and ability version to Fribbels id (DESIGN.md, S2)', () => {
  it('maps version 1 to the buffed id, version 0 to the original', () => {
    expect(kernel.characterId('1006', 1)).toBe('1006b1')
    expect(kernel.characterId('1004', 1)).toBe('1004b1')
    expect(kernel.characterId('1006', 0)).toBe('1006')
    expect(kernel.characterId('1308', 0)).toBe('1308')
  })

  it('takes the newest version when none is given', () => {
    expect(kernel.characterId('1006', undefined)).toBe('1006b1')
    expect(kernel.characterId('1308', undefined)).toBe('1308')
  })

  it('fails loudly when Fribbels has no such version or character', () => {
    expect(() => kernel.characterId('1308', 1)).toThrow(/no ability_version 1 of character 1308 \(no id "1308b1"\)\. Versions it has: 0$/)
    expect(() => kernel.characterId('1006', 2)).toThrow(/Versions it has: 0, 1$/)
    expect(() => kernel.characterId('9999', 0)).toThrow(/no character with game id 9999/)
    expect(() => kernel.characterId('1006b1', 1)).toThrow(/not a game character id/)
  })
})

describe('basic (out-of-combat) stats', () => {
  const unit: KernelUnit = { characterId: ACHERON, lightConeId: ALONG_THE_PASSING_SHORE, eidolon: 0, superimposition: 1 }
  /** No HP%, SPD or ERR from substats, so each check below sees one source only. */
  const plain: KernelBuild = { ...acheronBuild, substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 } }
  const metadata = () => getGameMetadata()
  // Fribbels keeps basic stats in a 32-bit array, so they match to about 4 decimals.
  const PRECISION = 4

  it('base SPD is the character\'s, and SPD boots add exactly their main stat value', () => {
    const atkBoots = kernel.basicStats(unit, plain)
    const spdBoots = kernel.basicStats(unit, { ...plain, feet: Stats.SPD })
    expect(atkBoots.baseSPD).toBe(metadata().characters[ACHERON].stats[Stats.SPD])
    expect(atkBoots.SPD).toBeCloseTo(atkBoots.baseSPD, PRECISION)
    expect(spdBoots.SPD - atkBoots.SPD).toBeCloseTo(StatCalculator.getMaxedStatValue(Stats.SPD), PRECISION)
  })

  it('HP% scales the character plus light cone base HP; an Energy Regeneration Rope adds its main stat', () => {
    const before = kernel.basicStats(unit, plain)
    const baseHp = metadata().characters[ACHERON].stats[Stats.HP] + metadata().lightCones[ALONG_THE_PASSING_SHORE].stats[Stats.HP]
    const hpRolls = kernel.basicStats(unit, { ...plain, substatRolls: { ...plain.substatRolls, [Stats.HP_P]: 10 } })
    expect(hpRolls.HP - before.HP).toBeCloseTo(baseHp * 10 * StatCalculator.getMaxedSubstatValue(Stats.HP_P) / 100, 2)

    expect(before.ERR).toBe(0)
    const errRope = kernel.basicStats(unit, { ...plain, linkRope: Stats.ERR })
    expect(errRope.ERR).toBeCloseTo(StatCalculator.getMaxedStatValue(Stats.ERR), PRECISION)
  })

  it('are not the in-combat stats that actionDamage returns: teammate buffs do not reach them', () => {
    const basic = kernel.basicStats({ ...unit, eidolon: 6, superimposition: 5 }, acheronBuild)
    const inCombat = kernel.actionDamage(acheronRequest()).stats
    expect(inCombat.ATK).toBeGreaterThan(basic.ATK)
  })

  it('do not depend on the order of calls (Fribbels reuses its buffers)', () => {
    const first = kernel.basicStats(unit, plain)
    kernel.actionDamage(acheronRequest())
    kernel.basicStats(unit, { ...plain, feet: Stats.SPD })
    expect(kernel.basicStats(unit, plain)).toEqual(first)
  })
})

describe('a scenario file end to end (src/run)', () => {
  const FIXTURES = resolve(import.meta.dirname, '../../run/fixtures')
  // Stand-in for the "standard" build until the rule for Fribbels' benchmark build is chosen:
  // Fribbels' own Acheron test build (BiS sets, 10 max rolls each of ATK%, CRIT Rate, CRIT DMG).
  const standIn: KernelBuild = { ...acheronBuild, substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 } }
  // The fixture's enemy is test-dummy, the generic MoC enemy with a 0% attack: against generic-moc
  // a lone Acheron, with her real HP, is downed in cycle 1.
  const options = () => ({ kernel, standardBuild: () => standIn, profileDir: FIXTURES })
  const scenario = () => loadScenarioFile(resolve(FIXTURES, 'acheron-solo.scenario.json'))

  it('Acheron alone at 1, 3 and 5 enemies: damage in every cycle, and more in total with more enemies', () => {
    const runs = runScenario(scenario(), options())

    expect(runs.map((r) => [r.team, r.enemyCount])).toEqual([['acheron_solo', 1], ['acheron_solo', 3], ['acheron_solo', 5]])
    for (const { result } of runs) {
      expect(result.damageByCycle).toHaveLength(5)
      for (const damage of result.damageByCycle) expect(damage).toBeGreaterThan(0)
      expect(result.downed).toEqual([])
    }
    const [one, three, five] = runs.map((r) => r.result.totalDamage)
    expect(three).toBeGreaterThan(one!)
    expect(five).toBeGreaterThan(one!)
  })

  it('the member\'s stats are the kernel\'s basic stats for that build', () => {
    const member = buildBattleSetup(scenario(), 'acheron_solo', 1, options()).members[0]!
    const basic = kernel.basicStats(member.kernel.unit, standIn)
    expect(member.stats).toEqual({
      maxHp: basic.HP,
      def: basic.DEF,
      baseSpd: basic.baseSPD,
      spdFlat: basic.SPD - basic.baseSPD,
      energyRegen: basic.ERR,
      effectRes: basic.RES,
    })
    expect(member.kernel.unit).toEqual({ characterId: ACHERON, eidolon: 0, ex: 0, lightConeId: ALONG_THE_PASSING_SHORE, superimposition: 1 })
  })
})

describe('bad input is refused', () => {
  it('unknown conditional keys', () => {
    const request = acheronRequest()
    request.attacker.characterConditionals = { crimsonKnotStack: 3 }
    expect(() => kernel.actionDamage(request)).toThrow(/Unknown conditional "crimsonKnotStack".*crimsonKnotStacks/)
  })

  it('a conditional the character only has as the attacker, set on it as a teammate', () => {
    const request = acheronRequest()
    request.teammates[2] = { ...e6s5(ACHERON, ALONG_THE_PASSING_SHORE), characterConditionals: { crimsonKnotStacks: 3 } }
    request.attacker = e6s5(FU_XUAN, SHE_ALREADY_SHUT_HER_EYES)
    expect(() => kernel.actionDamage(request)).toThrow(/as teammate/)
  })

  it('unknown ids and sets, and too many teammates', () => {
    expect(() => kernel.actionDamage({ ...acheronRequest(), attacker: e6s5('9999', ALONG_THE_PASSING_SHORE) }))
      .toThrow(/Unknown character id/)
    expect(() => kernel.actionDamage({ ...acheronRequest(), attacker: e6s5(ACHERON, '99999') }))
      .toThrow(/Unknown light cone id/)
    expect(() => kernel.actionDamage({ ...acheronRequest(), setConditionals: { 'Not A Set': true } }))
      .toThrow(/Unknown set/)
    expect(() => kernel.actionDamage({ ...acheronRequest(), teammates: [...acheronTeam, ...acheronTeam] }))
      .toThrow(/at most 3/)
  })
})

describe('injected buffs: bad requests are errors that name the buff (K15a)', () => {
  const withBuff = (buff: unknown) => () =>
    kernel.actionDamage({ ...acheronRequest(), injectedBuffs: [buff as InjectedBuff] })

  it('an unknown stat', () => {
    expect(withBuff({ stat: 'LUCK', value: 0.1, target: 'self', label: 'Luck buff' })).toThrow(/Injected buff "Luck buff".*unknown stat "LUCK"/)
  })

  it('an unknown ability kind', () => {
    expect(withBuff({ stat: 'TRUE_DMG', value: 0.1, target: 'team', abilityKind: 'ULTIMATE' })).toThrow(/unknown ability kind "ULTIMATE"/)
  })

  it('an unknown damage type', () => {
    expect(withBuff({ stat: 'TRUE_DMG', value: 0.1, target: 'team', damageType: 'SPECIAL' })).toThrow(/unknown damage type "SPECIAL"/)
  })

  it('a damage type on a stat Fribbels keeps per action', () => {
    for (const stat of ['ATK_PERCENT', 'HP_PERCENT', 'DEF_PERCENT', 'SPD_PERCENT', 'UNCONVERTIBLE_HP', 'UNCONVERTIBLE_CRIT_DMG']) {
      expect(withBuff({ stat, value: 0.1, target: 'team', damageType: 'ULT' }), stat).toThrow(new RegExp(`${stat}.*per action, not per hit`))
    }
  })

  it('a value that is not a finite number, and a target that is neither self nor team', () => {
    expect(withBuff({ stat: 'TRUE_DMG', value: Number.NaN, target: 'team' })).toThrow(/value must be a finite number/)
    expect(withBuff({ stat: 'TRUE_DMG', value: '0.1', target: 'team' })).toThrow(/value must be a finite number/)
    expect(withBuff({ stat: 'TRUE_DMG', value: 0.1, target: 'enemy' })).toThrow(/target must be 'self', 'team' or 'selfAndMemosprite'/)
  })

  it('a stat name that is an Object prototype key is unknown, not a crash', () => {
    expect(withBuff({ stat: 'constructor', value: 0.1, target: 'team' })).toThrow(/unknown stat "constructor"/)
  })

  it('maps every NouSR stat to a Fribbels key: a +0 and a non-zero buff of each both run', () => {
    const stats = [
      'DMG_PERCENT', 'CRIT_RATE', 'CRIT_DMG', 'RES_PEN', 'DEF_PEN', 'VULNERABILITY', 'TRUE_DMG', 'FINAL_DMG', 'BREAK_EFFECT',
      'EFFECT_HIT_RATE', 'ATK_PERCENT', 'HP_PERCENT', 'DEF_PERCENT', 'SPD_PERCENT', 'ATK', 'HP', 'DEF', 'SPD', 'UNCONVERTIBLE_ATK',
      'UNCONVERTIBLE_HP', 'UNCONVERTIBLE_DEF', 'UNCONVERTIBLE_SPD', 'UNCONVERTIBLE_CRIT_RATE', 'UNCONVERTIBLE_CRIT_DMG',
      'UNCONVERTIBLE_BREAK_EFFECT', 'UNCONVERTIBLE_EFFECT_HIT_RATE',
    ] as const
    const base = kernel.actionDamage(acheronRequest())
    for (const stat of stats) {
      const zero = kernel.actionDamage({ ...acheronRequest(), injectedBuffs: [{ stat, value: 0, target: 'team' }] })
      expect(zero.damage, stat).toEqual(base.damage)
      expect(() => kernel.actionDamage({ ...acheronRequest(), injectedBuffs: [{ stat, value: 0.05, target: 'team' }] }), stat).not.toThrow()
    }
    // Each stat reaches Fribbels' own number it names: a few that change an Acheron Ultimate.
    for (const [stat, key] of [['ATK_PERCENT', 'ATK'], ['CRIT_DMG', 'CD'], ['SPD_PERCENT', 'SPD']] as const) {
      const up = kernel.actionDamage({ ...acheronRequest(), injectedBuffs: [{ stat, value: 0.05, target: 'self' }] })
      expect(up.stats[key], stat).toBeGreaterThan(base.stats[key])
    }
  })
})
