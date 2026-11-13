import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { BattleSetup, MemberSetup } from '../battle/battle'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel } from '../kernel/types'
import type { Rule } from '../scenario/types'
import { Acheron, acheronScalings } from './acheron'
import type { Kit } from './kit'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/**
 * The one hit Fribbels builds for each of her abilities, with the ATK multiple it uses when its Crimson
 * Knot and Thunder Core hit counters are 0 (the Ultimate and the follow-up are one hit made of many).
 */
function fribbelsMultiples(eidolon: number, enemyCount: number): Record<string, number> {
  const s = acheronScalings(eidolon)
  return {
    BASIC: s.basic,
    SKILL: s.skillMain,
    ULT: 3 * s.rainblade + 3 * s.knot + s.stygianResurge,
    FUA: 3.0 + (0.8 * 6) / enemyCount,
  }
}

/** 1,000 damage per 100% ATK, times 1 + 0.3 per Thunder Core stack, times 1.18 against a debuffed enemy. */
const kernel: DamageKernel = {
  actionDamage(request) {
    const c = request.attacker.characterConditionals ?? {}
    const multiples = request.attacker.characterId === '1308'
      ? fribbelsMultiples(request.attacker.eidolon, request.enemy?.count ?? 1)
      : { BASIC: 1 }
    const boost = (1 + 0.3 * Number(c.thunderCoreStacks ?? 0)) * (c.e1EnemyDebuffed ? 1.18 : 1)
    return fakeResult(
      Object.fromEntries(Object.entries(multiples).map(([ability, scaling]) => [ability, [{ damage: 1000 * scaling * boost, scaling }]])),
    )
  },
}

/** A made-up teammate: a 100% single-target Basic ATK that debuffs its target. `debuffs: false` turns that off. */
const helper = (debuffs: boolean): Kit => ({
  characterId: 'helper',
  path: 'Harmony',
  element: 'Ice',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'basic', 'basic', () => {
            battle.gainSkillPoints(1)
            if (debuffs) battle.applyDebuff({ id: 'helper.debuff', target: battle.primary, source: self.key })
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
          }),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
})

const acheron = (eidolon = 0, affinitiveEidolon = false): MemberSetup => ({
  key: 'acheron',
  kit: Acheron,
  eidolon,
  affinitiveEidolon,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: '1308', lightConeId: '23024', eidolon, superimposition: 1, ex: affinitiveEidolon ? 1 : 0 }, build: noBuild },
})

const teammate = (debuffs: boolean, baseSpd: number): MemberSetup => ({
  key: 'helper',
  kit: helper(debuffs),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
  kernel: { unit: { characterId: 'helper', lightConeId: 'none', eidolon: 0, superimposition: 1 }, build: noBuild },
})

const skillPolicy: Rule[] = [
  { unit: 'acheron', use: 'ultimate', when: [] },
  { unit: 'acheron', use: 'skill', when: [] },
  { unit: 'acheron', use: 'basic', when: [] },
  { unit: 'helper', use: 'basic', when: [] },
]
const basicPolicy: Rule[] = skillPolicy.filter((r) => r.use !== 'skill')

function setup(overrides: Partial<BattleSetup> = {}) {
  const battle = new Battle({
    members: [acheron()],
    policy: skillPolicy.filter((r) => r.unit === 'acheron'),
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 5,
    start: { energy: 0.5, skillPoints: 3, techniques: true },
    kernel,
    ...overrides,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  const read = (name: string) => battle.member('acheron').instance.quantities![name]!() as number
  return { battle, dealt, read }
}

describe('Slashed Dream and Crimson Knot', () => {
  it('starts with 5 of each and one Quadrivalent Ascendance from the technique', () => {
    const { battle, read } = setup({ cycles: 1, policy: [{ unit: 'acheron', use: 'basic', when: [] }] })
    battle.run()
    expect([read('slashed_dream'), read('crimson_knots'), read('quadrivalent_ascendance')]).toEqual([5, 5, 1])
    expect(battle.hasDebuff('enemy1')).toBe(false) // a knot is a mark, not a debuff
  })

  it('without the technique there is no Quadrivalent Ascendance', () => {
    const { battle, read } = setup({ cycles: 1, start: { energy: 0.5, skillPoints: 3, techniques: false } })
    battle.run()
    expect(read('quadrivalent_ascendance')).toBe(0)
  })

  it('alone: Skill gives 1 each, so the first Ultimate comes on her 5th turn with 3 starting skill points', () => {
    const { battle, read } = setup()
    const actions = battle.run().actions.map((a) => a.action)
    // 5 -> 6, 7, 8 on three Skills, a Basic ATK to refund a point, a 4th Skill to reach 9.
    expect(actions).toEqual(['skill', 'skill', 'skill', 'basic', 'skill', 'ultimate'])
    // After the Ultimate, Quadrivalent Ascendance gives 1 back.
    expect([read('slashed_dream'), read('crimson_knots'), read('quadrivalent_ascendance')]).toEqual([1, 1, 0])
  })

  it('her talent: a teammate\'s debuff gives 1 of each, once per action', () => {
    const { battle, read } = setup({ members: [acheron(), teammate(true, 160)], policy: basicPolicy, cycles: 1 })
    // The helper acts at 62.5 and 125, Acheron at 100: two debuffing actions.
    battle.run()
    expect([read('slashed_dream'), read('crimson_knots')]).toEqual([7, 7])
  })

  it('a teammate who does not debuff gives nothing', () => {
    const { battle, read } = setup({ members: [acheron(), teammate(false, 160)], policy: basicPolicy, cycles: 1 })
    battle.run()
    expect(read('slashed_dream')).toBe(5)
  })

  it('points past 9 become Quadrivalent Ascendance, up to 3, and knots stop at 9', () => {
    const { battle, read } = setup({
      members: [acheron(), teammate(true, 160)],
      cycles: 4,
      // Never use the Ultimate, so the points pile up.
      policy: basicPolicy.filter((r) => r.use !== 'ultimate'),
    })
    battle.run()
    expect([read('slashed_dream'), read('crimson_knots'), read('quadrivalent_ascendance')]).toEqual([9, 9, 3])
  })

  it('E2 adds 1 of each at the start of her turn', () => {
    const { battle, read } = setup({ members: [acheron(2)], cycles: 1, policy: [{ unit: 'acheron', use: 'basic', when: [] }] })
    battle.run() // one turn at AV 100
    expect([read('slashed_dream'), read('crimson_knots')]).toEqual([6, 6])
  })
})

describe('the Ultimate', () => {
  it('with 9 knots on one enemy: three Rainblades each detonate 3 knots, then Stygian Resurge and 6 Thunder Core hits', () => {
    const { battle, dealt, read } = setup()
    battle.run()
    const ult = dealt.filter((d) => d.ability === 'ULT')
    expect(ult.map((d) => +d.scaling.toFixed(4))).toEqual([0.24, 0.6, 0.24, 0.6, 0.24, 0.6, 1.2, 1.5])
    // The same total Fribbels uses for 9 knots and 6 Thunder Core hits on the target.
    expect(ult.reduce((sum, d) => sum + d.scaling, 0)).toBeCloseTo(3 * 0.24 + 3 * 0.15 + 0.15 * 9 + 1.2 + 6 * 0.25, 12)
    // Thunder Core: +30% from the hit after each Rainblade that struck a knotted enemy.
    const boost = ult.map((d) => +(d.damage / (1000 * d.scaling)).toFixed(4))
    expect(boost).toEqual([1, 1.3, 1.3, 1.6, 1.6, 1.9, 1.9, 1.9])
    expect(read('thunder_core')).toBe(3)
  })

  it('with 3 enemies: detonations and Stygian Resurge hit all three, Rainblades only the knotted one', () => {
    const { battle, dealt } = setup({ enemyCount: 3 })
    battle.run()
    const ult = dealt.filter((d) => d.ability === 'ULT')
    const total = (enemy: string) => ult.filter((d) => d.enemy === enemy).reduce((sum, d) => sum + d.scaling, 0)
    const shared = 3 * 0.6 + 1.2 + (6 * 0.25) / 3
    expect(total('enemy2')).toBeCloseTo(3 * 0.24 + shared, 12) // the primary target, in the middle
    expect(total('enemy1')).toBeCloseTo(shared, 12)
    expect(total('enemy3')).toBeCloseTo(shared, 12)
  })

  it('a Rainblade on an enemy with no knots detonates nothing and gives no Thunder Core', () => {
    const { battle, dealt, read } = setup({
      members: [acheron(2)],
      cycles: 4,
      start: { energy: 0.5, skillPoints: 0, techniques: true },
      policy: [{ unit: 'acheron', use: 'ultimate', when: [] }, { unit: 'acheron', use: 'basic', when: [] }],
    })
    battle.run()
    // E2 only: 6, 7, 8, 9 at her turn starts, so the 1st Ultimate (turn 4) has 9 knots. Stop there.
    const firstUlt = dealt.filter((d) => d.ability === 'ULT').slice(0, 8)
    expect(firstUlt).toHaveLength(8)
    expect(read('thunder_core')).toBe(3)

    // A second battle where the knots are stripped before the Ultimate.
    const bare = setup({ members: [acheron(2)], cycles: 4, start: { energy: 0.5, skillPoints: 0, techniques: true }, policy: [{ unit: 'acheron', use: 'ultimate', when: [] }, { unit: 'acheron', use: 'basic', when: [] }] })
    bare.battle.timeline.bus.on('turnStart', (turn) => {
      if (turn.unit === 'acheron' && turn.index === 4) bare.battle.timeline.modifiers.remove('enemy1', 'acheron.crimson_knot')
    }, { priority: -1 })
    bare.battle.run()
    const ult = bare.dealt.filter((d) => d.ability === 'ULT')
    expect(ult.map((d) => +d.scaling.toFixed(4))).toEqual([0.24, 0.24, 0.24, 1.2, 1.5])
    expect(bare.read('thunder_core')).toBe(0)
  })

  it('E3 raises the Ultimate\'s multipliers', () => {
    const { battle, dealt } = setup({ members: [acheron(3)] })
    battle.run()
    const ult = dealt.filter((d) => d.ability === 'ULT').slice(0, 8)
    expect(ult.reduce((sum, d) => sum + d.scaling, 0)).toBeCloseTo(3 * 0.2592 + 12 * 0.162 + 1.296 + 1.5, 12)
  })
})

describe('Affinitive Eidolon', () => {
  const withHelper = (ex: boolean, enemyCount = 1) =>
    setup({ members: [acheron(0, ex), teammate(false, 160)], policy: basicPolicy, cycles: 2, enemyCount })

  it('follows up after a teammate attacks a knotted enemy, once per turn of hers', () => {
    const { battle, dealt, read } = withHelper(true)
    const actions = battle.run().actions.map((a) => `${a.actor} ${a.action}`)
    // The helper acts at 62.5 and 125; Acheron's own turn at 100 in between resets the once-per-turn limit.
    expect(actions.slice(0, 5)).toEqual([
      'helper basic',
      'acheron affinitive_follow_up',
      'acheron basic',
      'helper basic',
      'acheron affinitive_follow_up',
    ])
    const followUps = dealt.filter((d) => d.ability === 'FUA')
    expect(followUps[0]!.scaling).toBeCloseTo(3 + 0.8 * 6, 12)
    // 5 at the start, +1 per follow-up.
    expect(read('slashed_dream')).toBeGreaterThanOrEqual(7)
  })

  it('does not trigger twice between her turns', () => {
    const { battle } = withHelper(true)
    const actions = battle.run().actions
    // Helper acts at 125 and 187.5 with no Acheron turn in between (she acts at 100 and 200).
    const afterTurnOne = actions.filter((a) => a.serial > 3)
    const order = afterTurnOne.map((a) => `${a.actor} ${a.action}`).slice(0, 3)
    expect(order).toEqual(['helper basic', 'acheron affinitive_follow_up', 'helper basic'])
  })

  it('with 3 enemies the 300% hits all and the six 80% hits are split evenly', () => {
    const { battle, dealt } = withHelper(true, 3)
    battle.run()
    const first = dealt.filter((d) => d.ability === 'FUA').slice(0, 3)
    expect(first.map((d) => [d.enemy, +d.scaling.toFixed(4)])).toEqual([['enemy1', 4.6], ['enemy2', 4.6], ['enemy3', 4.6]])
  })

  it('does nothing without the flag', () => {
    const { battle, dealt } = withHelper(false)
    battle.run()
    expect(dealt.some((d) => d.ability === 'FUA')).toBe(false)
  })
})

describe('E4', () => {
  it('puts a debuff on every enemy at the start, without giving a talent stack', () => {
    const { battle, read } = setup({ members: [acheron(4)], enemyCount: 3, cycles: 1, policy: [{ unit: 'acheron', use: 'basic', when: [] }] })
    battle.run()
    expect(battle.enemies.ids.map((enemy) => battle.hasDebuff(enemy))).toEqual([true, true, true])
    // E2's turn-start stack only: 5 + 1. Nothing from the E4 debuff.
    expect(read('slashed_dream')).toBe(6)
    expect(battle.member('acheron').instance.attackerState('enemy1').characterConditionals).toMatchObject({ e1EnemyDebuffed: true })
  })

  it('below E4 the enemies start without it', () => {
    const { battle } = setup({ members: [acheron(3)], enemyCount: 3, cycles: 1, policy: [{ unit: 'acheron', use: 'basic', when: [] }] })
    battle.run()
    expect(battle.enemies.ids.some((enemy) => battle.hasDebuff(enemy))).toBe(false)
  })
})

describe('what she tells the kernel', () => {
  it('reports each enemy\'s debuff state separately, and zeroes Fribbels\' own knot and Thunder Core counters', () => {
    const { battle } = setup({ enemyCount: 3 })
    battle.applyDebuff({ id: 'test.debuff', target: 'enemy1', source: 'acheron' })
    const state = (enemy: string) => battle.member('acheron').instance.attackerState(enemy)
    expect(state('enemy1').characterConditionals).toMatchObject({ e1EnemyDebuffed: true, crimsonKnotStacks: 0, stygianResurgeHitsOnTarget: 0 })
    expect(state('enemy2').characterConditionals).toMatchObject({ e1EnemyDebuffed: false })
    expect(state('enemy2')).not.toHaveProperty('scaling') // the kernel's own hit multiples are used, not the kit's
  })
})
