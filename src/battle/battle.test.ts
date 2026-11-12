import { describe, expect, it } from 'vitest'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Kit } from '../kits/kit'
import type { Rule } from '../scenario/types'
import { Battle } from './battle'
import type { BattleSetup, MemberSetup } from './battle'

const profile = loadEnemyProfile('generic-moc')

/**
 * A made-up character: Basic 100% single (+1 skill point, +20 energy), Skill 200% blast with 100%
 * adjacent (-1 skill point, +30 energy, debuffs its target), Ultimate 300% to all at 100 energy.
 */
const Striker: Kit = {
  characterId: 'striker',
  path: 'Hunt',
  element: 'Fire',
  maxEnergy: 100,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'basic', 'basic', () => {
            battle.gainSkillPoints(1)
            battle.party.gainEnergy(self.key, 20)
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1 }] })
          }),
      },
      skill: {
        kind: 'skill',
        canUse: () => battle.skillPoints >= 1,
        use: () =>
          battle.performAction(self.key, 'skill', 'skill', () => {
            battle.spendSkillPoints(1)
            battle.party.gainEnergy(self.key, 30)
            battle.applyDebuff({ id: 'striker.mark', target: battle.primary, source: self.key })
            battle.attack({ attacker: self.key, ability: 'SKILL', parts: [{ shape: 'blast', scaling: 2, adjacent: 1 }] })
          }),
      },
      ultimate: {
        kind: 'ultimate',
        canUse: () => battle.party.get(self.key).energy >= 100,
        use: () =>
          battle.performAction(self.key, 'ultimate', 'ultimate', () => {
            battle.party.setEnergy(self.key, 0)
            battle.attack({
              attacker: self.key,
              ability: 'ULT',
              parts: [{ shape: 'aoe', scaling: 3 }, { shape: 'bounce', scaling: 0.5, hits: 6 }],
            })
          }),
      },
    },
    quantities: { marked: () => battle.hasDebuff(battle.primary) },
    attackerState: (enemy) => ({
      characterConditionals: { targetMarked: battle.hasDebuff(enemy) },
      scaling: { BASIC: 1, SKILL: 2, ULT: 3 },
    }),
    teammateState: () => ({}),
  }),
}

/** 1,000 damage per 100% ATK, doubled against a marked enemy. */
const kernel: DamageKernel & { requests: DamageRequest[] } = {
  requests: [],
  actionDamage(request) {
    this.requests.push(request)
    const boost = request.attacker.characterConditionals?.targetMarked ? 2 : 1
    return {
      damage: { BASIC: 1000 * boost, SKILL: 2000 * boost, ULT: 3000 * boost },
      stats: { ATK: 0, DEF: 0, HP: 0, SPD: 0, CR: 0, CD: 0, EHR: 0, RES: 0, BE: 0, ERR: 0, OHB: 0 },
    }
  },
}

const striker = (key: string, baseSpd = 100): MemberSetup => ({
  key,
  kit: Striker,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
  kernel: {
    unit: { characterId: 'striker', lightConeId: 'none', eidolon: 0, superimposition: 1 },
    build: { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} },
  },
})

const basicOnly: Rule[] = [{ unit: 'a', use: 'basic', when: [] }]

function battle(overrides: Partial<BattleSetup> = {}) {
  const b = new Battle({
    members: [striker('a')],
    policy: basicOnly,
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0, skillPoints: 3, techniques: true },
    kernel,
    ...overrides,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  b.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  return { b, dealt }
}

describe('policy', () => {
  it('takes the first rule that applies on each turn', () => {
    const { b } = battle({
      cycles: 5,
      start: { energy: 0, skillPoints: 2, techniques: true },
      policy: [
        { unit: 'a', use: 'skill', when: [] },
        { unit: 'a', use: 'basic', when: [] },
      ],
    })
    // 2 skill points: skill, skill, then basic (+1) and skill alternate.
    expect(b.run().actions.map((x) => x.action)).toEqual(['skill', 'skill', 'basic', 'skill', 'basic'])
  })

  it('reads conditions on team, battle and member quantities', () => {
    const { b } = battle({
      cycles: 5,
      policy: [
        { unit: 'a', use: 'skill', when: [{ what: 'team.skill_points', min: 3 }, { what: 'battle.cycle', max: 2 }] },
        { unit: 'a', use: 'skill', when: [{ what: 'a.marked', is: false }] },
        { unit: 'a', use: 'basic', when: [] },
      ],
    })
    // Turn 1 (cycle 1, 3 points): first rule. After that the mark is on and points are below 3.
    expect(b.run().actions.map((x) => x.action)).toEqual(['skill', 'basic', 'basic', 'basic', 'basic'])
  })

  it('uses an Ultimate as soon as it is ready, between actions', () => {
    const { b } = battle({
      cycles: 3,
      start: { energy: 0.7, skillPoints: 0, techniques: true },
      policy: [{ unit: 'a', use: 'ultimate', when: [] }, ...basicOnly],
    })
    // 70 energy, +20 from the basic at AV 100 = 90, +10 x share from enemy hits pushes it over 100.
    const actions = b.run().actions.map((x) => x.action)
    expect(actions.slice(0, 2)).toEqual(['basic', 'ultimate'])
    expect(b.party.get('a').energy).toBeLessThan(100)
  })

  it('stops with an explanation when no rule applies on a turn', () => {
    const { b } = battle({ start: { energy: 0, skillPoints: 0, techniques: true }, policy: [{ unit: 'a', use: 'skill', when: [] }] })
    expect(() => b.run()).toThrow(/No policy rule applies on a's turn 1 .*0 skill points/)
  })

  it('rejects an action or quantity that does not exist, before the battle starts', () => {
    expect(() => battle({ policy: [{ unit: 'a', use: 'dance', when: [] }] })).toThrow(/a has no action "dance" \(it has: basic, skill, ultimate\)/)
    expect(() => battle({ policy: [{ unit: 'a', use: 'basic', when: [{ what: 'a.mood', min: 1 }] }] })).toThrow(/Unknown quantity "a.mood"/)
    expect(() => battle({ policy: [{ unit: 'z', use: 'basic', when: [] }] })).toThrow(/no member "z"/)
  })

  it('rejects "is" on a number and min/max on a yes/no value', () => {
    const number = battle({ policy: [{ unit: 'a', use: 'basic', when: [{ what: 'team.skill_points', is: true }] }] })
    expect(() => number.b.run()).toThrow(/cannot use "is"/)
    const flag = battle({ policy: [{ unit: 'a', use: 'basic', when: [{ what: 'a.marked', min: 1 }] }] })
    expect(() => flag.b.run()).toThrow(/needs "is"/)
  })
})

describe('damage by enemy count', () => {
  const skillOnce: Rule[] = [{ unit: 'a', use: 'skill', when: [] }]

  it.each([
    [1, { enemy1: 4000 }],
    [3, { enemy1: 1000, enemy2: 4000, enemy3: 1000 }],
    [5, { enemy2: 1000, enemy3: 4000, enemy4: 1000 }],
  ])('a blast with %d enemies hits the middle one and its neighbours', (enemyCount, expected) => {
    const { b, dealt } = battle({ enemyCount, policy: skillOnce })
    b.run()
    // The marked middle enemy takes double (K1: the mark is on that enemy only).
    expect(Object.fromEntries(dealt.map((d) => [d.enemy, d.damage]))).toEqual(expected)
  })

  it('an AoE hits every enemy and a bounce is split evenly', () => {
    const { b, dealt } = battle({
      enemyCount: 3,
      start: { energy: 1, skillPoints: 0, techniques: true },
      policy: [{ unit: 'a', use: 'ultimate', when: [] }, ...basicOnly],
    })
    b.run()
    const ult = dealt.filter((d) => d.ability === 'ULT')
    // 300% to each, plus 6 x 50% / 3 enemies = 100% each.
    expect(ult.map((d) => [d.enemy, d.scaling, d.damage])).toEqual([
      ['enemy1', 4, 4000],
      ['enemy2', 4, 4000],
      ['enemy3', 4, 4000],
    ])
  })

  it('totals by cycle and by member add up', () => {
    const { b, dealt } = battle({ members: [striker('a'), striker('b', 160)], cycles: 3, policy: [...basicOnly, { unit: 'b', use: 'basic', when: [] }] })
    const result = b.run()
    const sum = dealt.reduce((acc, d) => acc + d.damage, 0)
    expect(result.totalDamage).toBe(sum)
    expect(result.damageByCycle.reduce((x, y) => x + y, 0)).toBe(sum)
    expect(result.damageByMember.a! + result.damageByMember.b!).toBe(sum)
    // a acts at 100, 200, 300 (cycles 1, 2, 3). b acts at 62.5, 125 | 187.5, 250 | 312.5.
    expect(result.damageByCycle).toEqual([3000, 3000, 2000])
  })
})

describe('talking to the kernel', () => {
  it('passes the enemy setup and each enemy\'s own state, and reuses answers', () => {
    kernel.requests.length = 0
    const { b } = battle({ enemyCount: 3, cycles: 5, weaknesses: ['Ice'], policy: [{ unit: 'a', use: 'skill', when: [] }, ...basicOnly] })
    const result = b.run()
    expect(kernel.requests[0]!.enemy).toEqual({ count: 3, level: 95, maxToughness: 360, resistance: 0.2, elementalWeak: false })
    // Two distinct states in the whole battle: marked and not marked.
    expect(result.kernelCalls).toBe(2)
  })
})
