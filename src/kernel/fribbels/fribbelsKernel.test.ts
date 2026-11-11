import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import {
  generateE6S5Test,
  runTest,
  testCharacter,
  testMains,
  testSets,
  testStatSpread,
} from '../../../vendor/hsr-optimizer/src/lib/simulations/tests/simTestUtils'
import type { DamageRequest, KernelBuild, KernelTeammate, KernelUnit } from '../types'
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
