import { describe, expect, it } from 'vitest'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
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
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
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
            battle.attack({ attacker: self.key, ability: 'SKILL', parts: [{ shape: 'blast', scaling: 2, adjacent: 1, hit: 0 }] })
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
              parts: [{ shape: 'aoe', scaling: 3, hit: 0 }, { shape: 'bounce', scaling: 0.5, hits: 6, hit: 0 }],
            })
          }),
      },
    },
    quantities: { marked: () => battle.hasDebuff(battle.primary) },
    attackerState: (enemy) => ({
      characterConditionals: { targetMarked: battle.hasDebuff(enemy) },
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
    return fakeResult({
      BASIC: [{ damage: 1000 * boost, scaling: 1 }],
      SKILL: [{ damage: 2000 * boost, scaling: 2 }],
      ULT: [{ damage: 3000 * boost, scaling: 3 }],
    })
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
    expect(kernel.requests[0]!.enemy).toEqual({ count: 3, level: 95, maxToughness: 480, resistance: 0.2, elementalWeak: false })
    // Two distinct states in the whole battle: marked and not marked.
    expect(result.kernelCalls).toBe(2)
  })
})

/**
 * A made-up character whose Basic ATK is two hits with different buffs, as Tribbie's follow-up is: a main
 * hit (hit 0) and an Additional DMG hit (hit 1) that a Follow-up DMG bonus does not reach. Its Skill
 * names a hit and reads enemy HP, so the tests can check both.
 */
const Duo: Kit = {
  characterId: 'duo',
  path: 'Hunt',
  element: 'Fire',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'basic', 'basic', () => {
            battle.attack({
              attacker: self.key,
              ability: 'BASIC',
              parts: [{ shape: 'aoe', scaling: 1, hit: 0 }, { shape: 'single', scaling: 0.5, hit: 1 }],
            })
          }),
      },
      skill: {
        kind: 'skill',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'skill', 'skill', () => {
            // The enemy with the most HP left among those the first part reached gets the second part.
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'blast', scaling: 1, adjacent: 0.5, hit: 0 }] })
            const hit = battle.enemies.ids.filter((e) => battle.enemyHp(e).current < battle.enemyHp(e).max)
            const highest = hit.reduce((best, e) => (battle.enemyHp(e).current > battle.enemyHp(best).current ? e : best))
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, target: highest, hit: 1 }] })
          }),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
}

const duo = (kit: Kit = Duo): MemberSetup => ({ ...striker('a'), kit })

/** Hit 0 is worth 1,000 per 100% and hit 1 is worth 3,000 per 100%. */
const duoKernel: DamageKernel & { calls: number } = {
  calls: 0,
  actionDamage() {
    this.calls += 1
    return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }, { damage: 1500, scaling: 0.5 }] })
  },
}

/** A Basic ATK that is one single-target part naming `hit` of `ability`. */
const probe = (ability: string, hit: number, scaling = 1): Kit => ({
  ...Duo,
  create: (battle, self) => ({
    ...Duo.create(battle, self),
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'basic', 'basic', () => {
            battle.attack({ attacker: self.key, ability, parts: [{ shape: 'single', scaling, hit }] })
          }),
      },
    },
  }),
})

describe('per-hit pricing', () => {
  const basicRule: Rule[] = [{ unit: 'a', use: 'basic', when: [] }]

  it('prices each part by its own hit: damage per 100% differs between the hits of one ability', () => {
    const { b, dealt } = battle({ members: [duo()], enemyCount: 3, kernel: duoKernel, policy: basicRule })
    b.run()
    // Hit 0 to all three at 100%: 1,000 each. Hit 1 to the middle enemy at 50%: 1,500.
    expect(Object.fromEntries(dealt.map((d) => [d.enemy, d.damage]))).toEqual({ enemy1: 1000, enemy2: 2500, enemy3: 1000 })
    expect(dealt.find((d) => d.enemy === 'enemy2')!.scaling).toBe(1.5)
  })

  it('one rate for the whole ability would have been wrong here', () => {
    // (1000 + 1500) / (1 + 0.5) = 1,666.7 per 100%. The off-target enemies would have taken 1,666.7, not 1,000.
    expect((1000 + 1500) / 1.5).not.toBeCloseTo(1000, 0)
  })

  it('scales a hit by the part\'s multiple, not by the multiple the kernel used', () => {
    const { b, dealt } = battle({ members: [duo(probe('BASIC', 1, 0.25))], kernel: duoKernel, policy: basicRule })
    b.run()
    expect(dealt.map((d) => d.damage)).toEqual([750]) // 3,000 per 100% x 25%
  })

  it('asks the kernel once for all hits of an attack, and reuses the answer', () => {
    duoKernel.calls = 0
    const { b } = battle({ members: [duo()], kernel: duoKernel, cycles: 3, policy: basicRule })
    const result = b.run()
    expect(result.kernelCalls).toBe(1)
    expect(duoKernel.calls).toBe(1)
  })

  const runWith = (answer: ReturnType<typeof fakeResult>, ability: string, hit: number) => {
    const { b } = battle({ members: [duo(probe(ability, hit))], kernel: { actionDamage: () => answer }, policy: basicRule })
    return () => b.run()
  }

  it('an ability the kernel does not have is an error that lists the abilities it has', () => {
    expect(runWith(fakeResult({ BASIC: [{ damage: 1, scaling: 1 }], SKILL: [] }), 'FUA', 0)).toThrow(/no ability "FUA" for a \(it has: BASIC, SKILL\)/)
  })

  it('a hit the kernel does not have is an error that says how many it has', () => {
    expect(runWith(fakeResult({ BASIC: [{ damage: 1, scaling: 1 }] }), 'BASIC', 1)).toThrow(/a's BASIC attack names hit 1, but the kernel has 1 hit for BASIC/)
    expect(runWith(fakeResult({ BASIC: [] }), 'BASIC', 0)).toThrow(/names hit 0, but the kernel has 0 hits for BASIC/)
  })

  it('a hit with no multiple from the kernel cannot be priced, and says so', () => {
    expect(runWith(fakeResult({ BASIC: [{ damage: 5 }] }), 'BASIC', 0)).toThrow(/BASIC hit 0 has no ATK, HP or DEF multiple/)
  })

  it('a negative or fractional hit position is an error', () => {
    const ok = fakeResult({ BASIC: [{ damage: 1, scaling: 1 }] })
    expect(runWith(ok, 'BASIC', -1)).toThrow(/names hit -1/)
    expect(runWith(ok, 'BASIC', 0.5)).toThrow(/names hit 0.5/)
  })
})

describe('enemy HP in a battle', () => {
  const small = { ...profile, hp: 3000 }
  const { hp: _hp, ...noHpProfile } = profile
  const basicRule: Rule[] = [{ unit: 'a', use: 'basic', when: [] }]

  it('every hit lowers the hit enemy\'s current HP by what it dealt, and max HP stays', () => {
    const { b, dealt } = battle({ members: [duo()], enemyCount: 3, kernel: duoKernel, profile: small, policy: basicRule })
    expect(b.enemyHp('enemy2')).toEqual({ current: 3000, max: 3000 })
    b.run()
    const taken = (enemy: string) => dealt.filter((d) => d.enemy === enemy).reduce((sum, d) => sum + d.damage, 0)
    expect(b.enemyHp('enemy1')).toEqual({ current: 3000 - taken('enemy1'), max: 3000 })
    expect(b.enemyHp('enemy2')).toEqual({ current: 3000 - taken('enemy2'), max: 3000 })
    expect(b.enemyHp('enemy2').current).toBe(500)
  })

  it('goes below 0 and nothing reacts: the battle runs on and damage is unchanged', () => {
    const { b, dealt } = battle({ members: [duo()], kernel: duoKernel, profile: small, cycles: 3, policy: basicRule })
    const result = b.run()
    // 3 turns of 1,000 + 1,500 against 3,000 HP.
    expect(b.enemyHp('enemy1').current).toBe(3000 - 3 * 2500)
    expect(b.enemyHp('enemy1').current).toBeLessThan(0)
    expect(dealt.map((d) => d.damage)).toEqual([2500, 2500, 2500])
    expect(result.totalDamage).toBe(7500)
    expect(result.downed).toEqual([])
  })

  it('a kit can read it: the Skill\'s second part goes to the enemy with the most HP among those it hit', () => {
    const { b, dealt } = battle({ members: [duo()], enemyCount: 3, kernel: duoKernel, profile: small, policy: [{ unit: 'a', use: 'skill', when: [] }] })
    b.run()
    // The blast hit all three: the middle one took 1,000 and each side 500 (0.5 x 1,000). The sides have the most
    // HP left, and the first of them is enemy1, so it takes the 3,000-per-100% hit.
    expect(dealt.filter((d) => d.enemy === 'enemy1').map((d) => d.damage)).toEqual([500, 3000])
    expect(dealt.filter((d) => d.enemy === 'enemy2').map((d) => d.damage)).toEqual([1000])
  })

  it('without HP in the profile the battle runs, and asking for HP is an error', () => {
    const { b } = battle({ members: [duo()], kernel: duoKernel, profile: noHpProfile, policy: basicRule })
    expect(() => b.run()).not.toThrow()
    expect(() => b.enemyHp('enemy1')).toThrow(/profile "generic-moc" has no "hp"/)
  })
})
