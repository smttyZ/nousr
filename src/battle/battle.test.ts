import { describe, expect, it } from 'vitest'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult, ZERO_STATS } from '../kernel/testing'
import type { DamageKernel, DamageRequest, ExtraHit, InjectedBuff } from '../kernel/types'
import type { Kit } from '../kits/kit'
import type { Rule } from '../scenario/types'
import { Battle, certain, HP_TIE } from './battle'
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
    quantities: { marked: () => (battle.debuffChance(battle.primary) > 0) },
    attackerState: (enemy) => ({
      characterConditionals: { targetMarked: certain(battle.debuffChance(enemy)) },
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

  it('skips a rule whose target is downed or not on the field, like an unmet condition (K36)', () => {
    const rules: Rule[] = [
      { unit: 'a', use: 'skill', target: 'b', when: [] },
      { unit: 'a', use: 'basic', when: [] },
    ]
    const alive = battle({ members: [striker('a'), striker('b', 50)], policy: rules, start: { energy: 0, skillPoints: 3, techniques: true } })
    expect(alive.b.run().actions[0]!.action).toBe('skill')

    const downedTarget = battle({ members: [striker('a'), striker('b', 50)], policy: rules, start: { energy: 0, skillPoints: 3, techniques: true } })
    downedTarget.b.party.takeDamage('b', 1e12, 'enemy1')
    expect(downedTarget.b.party.get('b').downed).toBe(true)
    expect(downedTarget.b.run().actions.map((x) => x.action)).toEqual(['basic'])

    const gone = battle({ policy: [{ unit: 'a', use: 'skill', target: 'nobody', when: [] }, ...basicOnly] })
    expect(gone.b.run().actions.map((x) => x.action)).toEqual(['basic'])
  })

  it('still stops when every rule is skipped for a downed target', () => {
    const { b } = battle({ members: [striker('a'), striker('b', 50)], policy: [{ unit: 'a', use: 'skill', target: 'b', when: [] }] })
    b.party.takeDamage('b', 1e12, 'enemy1')
    expect(() => b.run()).toThrow(/No policy rule applies on a's turn 1/)
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
    expect(kernel.requests[0]!.enemy).toEqual({ count: 3, level: 95, maxToughness: 480, resistance: 0.2, elementalWeak: false, weaknessBroken: false })
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

describe('highestHpAmong: the undecided tie-break is guarded', () => {
  // Three enemies, enemy2 is the primary. 1,000 damage per 100% on an enemy with no mark, 2,000 on a marked one
  // (the fake kernel above). Setting HP directly keeps the cases small.
  const ids = ['enemy1', 'enemy2', 'enemy3']
  const pricing = { attacker: 'a', ability: 'BASIC', hit: 0 }
  const setup = () => {
    kernel.requests.length = 0
    return battle({ enemyCount: 3 }).b
  }
  const mark = (b: Battle, enemy: string) => b.applyDebuff({ id: 'test.mark', target: enemy, source: 'a' })

  it('does no pricing when no enemy is tied for the highest HP', () => {
    const b = setup()
    b.enemies.takeDamage('enemy1', 10)
    b.enemies.takeDamage('enemy2', 20)
    expect(b.highestHpAmong(ids, pricing)).toBe('enemy3')
    expect(kernel.requests).toHaveLength(0)
    expect(b.run().warnings).toEqual([])
  })

  it('does no pricing when the primary is among the tied: that rule is decided', () => {
    const b = setup()
    mark(b, 'enemy1') // would price differently, if anyone asked
    expect(b.highestHpAmong(ids, pricing)).toBe('enemy2')
    expect(kernel.requests).toHaveLength(0)
    expect(b.run().warnings).toEqual([])
  })

  it('takes the first in standing order whatever order the candidates come in, and prices without a warning when the tied price the same', () => {
    const b = setup()
    b.enemies.takeDamage('enemy2', 100)
    expect(b.highestHpAmong(['enemy3', 'enemy2', 'enemy1'], pricing)).toBe('enemy1')
    expect(kernel.requests.length).toBeGreaterThan(0)
    expect(b.run().warnings).toEqual([])
  })

  it('ties are read within the HP tolerance, as a share of the top HP', () => {
    const b = setup()
    const top = b.enemyHp('enemy1').current
    b.enemies.takeDamage('enemy2', 100)
    b.enemies.takeDamage('enemy3', top * HP_TIE * 0.5)
    mark(b, 'enemy3')
    expect(b.highestHpAmong(ids, pricing)).toBe('enemy1')
    expect(b.run().warnings).toHaveLength(1)
  })

  it('warns once per attacker, ability, hit and tied set, with a count, when the tied price differently', () => {
    const b = setup()
    b.enemies.takeDamage('enemy2', 100)
    mark(b, 'enemy3')
    for (let i = 0; i < 3; i++) expect(b.highestHpAmong(ids, pricing)).toBe('enemy1')
    // Another hit of the same ability is another entry.
    b.highestHpAmong(ids, { ...pricing, hit: 0, ability: 'SKILL' })
    const { warnings } = b.run()
    expect(warnings).toHaveLength(2)
    expect(warnings.every((w) => w.severity === 'warning' && w.code === 'undecided-tie')).toBe(true)
    const basic = warnings[0]!.message
    expect(basic).toContain("a's BASIC hit 0")
    expect(basic).toContain('enemy1, enemy3 tied')
    expect(basic).toContain('enemy1 1000.000, enemy3 2000.000')
    expect(basic).toContain('went to enemy1')
    expect(basic).toMatch(/First at AV 0\.0, cycle 1; 3 times in this battle/)
    expect(basic).toContain('DESIGN.md, "Known approximations"')
    expect(warnings[1]!.message).toContain("a's SKILL hit 0")
    expect(warnings[1]!.message).toContain('1 time in this battle')
  })

  it('records the battle time of the first occurrence', () => {
    const b = battle({ enemyCount: 3, cycles: 2 }).b
    b.enemies.takeDamage('enemy2', 100)
    mark(b, 'enemy3')
    let at = Number.NaN
    b.timeline.bus.on('turnStart', (t) => {
      if (t.cycle === 2 && Number.isNaN(at)) {
        at = t.at
        b.highestHpAmong(ids, pricing)
      }
    })
    const { warnings } = b.run()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toContain(`First at AV ${at.toFixed(1)}, cycle 2; 1 time in this battle`)
  })
})

describe('existing battles are quiet', () => {
  it('a battle of identical enemies that never reaches an undecided tie has no warnings', () => {
    const { b } = battle({ enemyCount: 3, cycles: 5, policy: [{ unit: 'a', use: 'skill', when: [] }, ...basicOnly] })
    expect(b.run().warnings).toEqual([])
  })
})

describe('injected buffs in the kernel request (K15a)', () => {
  const buff = (stat: InjectedBuff['stat'], value: number, target: InjectedBuff['target']): InjectedBuff => ({ stat, value, target })
  /** A Striker whose states carry the given injected buffs. */
  const withBuffs = (own?: InjectedBuff[], asTeammate?: InjectedBuff[]): Kit => ({
    ...Striker,
    create: (b, self) => ({
      ...Striker.create(b, self),
      attackerState: () => ({ injectedBuffs: own }),
      teammateState: () => ({ injectedBuffs: asTeammate }),
    }),
  })
  const sent = (members: MemberSetup[]) => {
    const requests: DamageRequest[] = []
    const { b } = battle({ members, kernel: { actionDamage: (r) => (requests.push(r), kernel.actionDamage(r)) } })
    b.run()
    return requests
  }

  it('sends the attacker\'s own buffs, and a teammate\'s buffs aimed at the team', () => {
    const own = [buff('CRIT_RATE', -0.1, 'self')]
    const mate = [buff('TRUE_DMG', -0.12, 'team'), buff('HP', 480, 'team')]
    const requests = sent([{ ...striker('a'), kit: withBuffs(own) }, { ...striker('b', 1), kit: withBuffs(undefined, mate) }])
    expect(requests[0]!.injectedBuffs).toEqual([...own, ...mate])
  })

  it('drops a teammate\'s buff aimed at that teammate itself', () => {
    const mate = [buff('TRUE_DMG', 0.24, 'self'), buff('CRIT_DMG', 0.3, 'team')]
    const requests = sent([{ ...striker('a'), kit: withBuffs() }, { ...striker('b', 1), kit: withBuffs(undefined, mate) }])
    expect(requests[0]!.injectedBuffs).toEqual([buff('CRIT_DMG', 0.3, 'team')])
  })

  it('leaves the request without the field when nobody injects anything', () => {
    const requests = sent([striker('a'), striker('b', 1)])
    expect(requests[0]).not.toHaveProperty('injectedBuffs')
  })

  it('the buffs are part of the request JSON the cache keys on', () => {
    const requests = sent([{ ...striker('a'), kit: withBuffs([buff('DMG_PERCENT', 0.1, 'self')]) }])
    expect(JSON.stringify(requests[0])).toContain('"DMG_PERCENT"')
  })
})

describe('combatStats: the kernel\'s in-combat stats for a member', () => {
  const stats = { ...ZERO_STATS, ATK: 3210, HP: 40000, DEF: 900, SPD: 134, CR: 0.7, CD: 1.5, RES: 0.1, BE: 0.4 }
  const statKernel: DamageKernel & { requests: DamageRequest[] } = {
    requests: [],
    actionDamage(request) {
      this.requests.push(request)
      return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] }, request.attacker.characterConditionals?.big ? { ...stats, ATK: 9999 } : stats)
    },
  }

  it('returns the stats of the kernel result the runner prices with, as a copy, through the same cache', () => {
    statKernel.requests.length = 0
    const { b } = battle({ kernel: statKernel })
    const first = b.combatStats('a')
    expect(first).toEqual(stats)
    first.ATK = 1
    expect(b.combatStats('a').ATK).toBe(3210)
    b.member('a').instance.actions.basic!.use()
    expect(statKernel.requests).toHaveLength(1) // combatStats and the attack share one cached request
  })

  it('is for the member as the attacker: it carries that member\'s own state', () => {
    const big: Kit = { ...Striker, create: (bt, self) => ({ ...Striker.create(bt, self), attackerState: () => ({ characterConditionals: { big: true } }) }) }
    const { b } = battle({ members: [striker('a'), { ...striker('b', 90), kit: big }], kernel: statKernel })
    expect(b.combatStats('a').ATK).toBe(3210)
    expect(b.combatStats('b').ATK).toBe(9999)
    expect(() => b.combatStats('nobody')).toThrow(/No member/)
  })

  it('throws a clear error, not a loop, when a kit asks from its own attackerState or teammateState', () => {
    const fromAttackerState: Kit = {
      ...Striker,
      create: (bt, self) => {
        const base = Striker.create(bt, self)
        return { ...base, attackerState: () => ({ characterConditionals: { atk: bt.combatStats(self.key).ATK } }) }
      },
    }
    const { b } = battle({ members: [{ ...striker('a'), kit: fromAttackerState }], kernel: statKernel })
    expect(() => b.combatStats('a')).toThrow(/must not ask the kernel from its own attackerState or teammateState/)

    const fromTeammateState: Kit = {
      ...Striker,
      create: (bt, self) => ({ ...Striker.create(bt, self), teammateState: () => ({ characterConditionals: { atk: bt.combatStats(self.key).ATK } }) }),
    }
    const two = battle({ members: [striker('a'), { ...striker('b', 90), kit: fromTeammateState }], kernel: statKernel })
    expect(() => two.b.combatStats('a')).toThrow(/while the battle was collecting/)
    // The guard resets: asking from an action afterwards works for a kit that does not loop.
    const ok = battle({ kernel: statKernel })
    expect(ok.b.combatStats('a').ATK).toBe(3210)
  })
})

describe('extra hits for teammates (K23)', () => {
  const hit = (id: string, multiple = 1): ExtraHit => ({ id, damageType: 'ADDITIONAL', scalingStat: 'ATK', multiple })
  const giving = (hits: ExtraHit[] | undefined): Kit => ({
    ...Striker,
    create: (bt, self) => ({ ...Striker.create(bt, self), teammateState: () => ({ ...(hits && { extraHits: hits }) }) }),
  })
  /** 1,000 per 100% on the ordinary hit; the extra hits come back as ability EXTRA at 700 per 100%. */
  const extraKernel = (requests: DamageRequest[] = []): DamageKernel => ({
    actionDamage(request) {
      requests.push(request)
      return fakeResult({
        BASIC: [{ damage: 1000, scaling: 1 }],
        ...(request.extraHits && { EXTRA: request.extraHits.map((h) => ({ damage: 700 * h.multiple, scaling: h.multiple })) }),
      })
    },
  })

  it('merges every teammate\'s extra hits into the attacker\'s request, in teammate order; none leaves the field out', () => {
    const requests: DamageRequest[] = []
    const { b } = battle({
      members: [striker('a'), { ...striker('b', 90), kit: giving([hit('b.one'), hit('b.two', 0.5)]) }, { ...striker('c', 80), kit: giving([hit('c.one')]) }],
      kernel: extraKernel(requests),
    })
    b.member('a').instance.actions.basic!.use()
    expect(requests[0]!.extraHits!.map((h) => h.id)).toEqual(['b.one', 'b.two', 'c.one'])
    expect(b.extraHitIndex('a', 'b.two')).toBe(1)
    expect(b.extraHitIndex('a', 'c.one')).toBe(2)
    expect(() => b.extraHitIndex('a', 'nobody.one')).toThrow(/No extra hit "nobody.one" for a/)

    const plain = battle({ members: [striker('a'), striker('b', 90)], kernel: extraKernel(requests) })
    requests.length = 0
    plain.b.member('a').instance.actions.basic!.use()
    expect(requests[0]).not.toHaveProperty('extraHits')
  })

  it('a bare attack of ability EXTRA is priced per 100% from the named extra hit and credited to the attacker, with no action', () => {
    const { b, dealt } = battle({
      members: [striker('a'), { ...striker('b', 90), kit: giving([hit('b.one')]) }],
      kernel: extraKernel(),
    })
    const total = b.attack({ attacker: 'a', ability: 'EXTRA', parts: [{ shape: 'single', scaling: 0.8, hit: b.extraHitIndex('a', 'b.one'), additional: true }] })
    expect(total).toBeCloseTo(560, 9)
    expect(dealt).toHaveLength(1)
    expect(dealt[0]).toMatchObject({ attacker: 'a', ability: 'EXTRA', damage: expect.closeTo(560, 9) })
    expect(b.actionSerialInProgress).toBeUndefined()
  })

  it('the same id from two teammates is an error', () => {
    const { b } = battle({
      members: [striker('a'), { ...striker('b', 90), kit: giving([hit('x')]) }, { ...striker('c', 80), kit: giving([hit('x')]) }],
      kernel: extraKernel(),
    })
    expect(() => b.member('a').instance.actions.basic!.use()).toThrow(/extra hit with the id "x"/)
  })

  it('without an extra hit the kernel has no EXTRA ability: asking for it is the usual error', () => {
    const { b } = battle({ members: [striker('a'), striker('b', 90)], kernel: extraKernel() })
    expect(() => b.attack({ attacker: 'a', ability: 'EXTRA', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })).toThrow(/no ability "EXTRA"/)
  })

  it('extra hits are part of the request the cache keys on', () => {
    const requests: DamageRequest[] = []
    const { b } = battle({ members: [striker('a'), { ...striker('b', 90), kit: giving([hit('x', 0.8)]) }], kernel: extraKernel(requests) })
    b.member('a').instance.actions.basic!.use()
    expect(JSON.stringify(requests[0])).toContain('"extraHits"')
  })
})

describe('the additional flag on a part', () => {
  it('changes no number: a flagged part prices as the same unflagged one', () => {
    const run = (additional: boolean) => {
      const { b, dealt } = battle()
      b.attack({ attacker: 'a', ability: 'BASIC', parts: [{ shape: 'single', scaling: 0.5, hit: 0, ...(additional && { additional: true }) }] })
      return dealt[0]!.damage
    }
    expect(run(true)).toBe(run(false))
  })
})

describe('technique per member (K31)', () => {
  const told: Record<string, boolean> = {}
  const Spy: Kit = {
    ...Striker,
    create: (battle, self) => ({ ...Striker.create(battle, self), onBattleStart: ({ techniques }) => { told[self.key] = techniques } }),
  }
  const spy = (key: string, technique?: boolean): MemberSetup => ({ ...striker(key), kit: Spy, ...(technique !== undefined && { technique }) })

  it('a member without a setting gets the battle default; a member with one gets its own', () => {
    const members = [spy('a'), spy('b', true), spy('c', false)]
    for (const techniques of [true, false]) {
      battle({ members, policy: members.map((m) => ({ unit: m.key, use: 'basic' as const, when: [] })), start: { energy: 0, skillPoints: 3, techniques } }).b.run()
      expect(told).toEqual({ a: techniques, b: true, c: false })
    }
  })
})

describe('the action log carries when, how much and Skill Points (results format, decision 6)', () => {
  it('records the action value, cycle, damage and Skill Points before and after each action', () => {
    const { b } = battle({
      cycles: 2,
      start: { energy: 0, skillPoints: 1, techniques: true },
      policy: [
        { unit: 'a', use: 'skill', when: [{ what: 'team.skill_points', min: 1 }] },
        { unit: 'a', use: 'basic', when: [] },
      ],
    })
    const result = b.run()
    const [first, second] = result.actions
    // 100 SPD acts at action value 100. Skill: 200% blast, 1,000 per 100% doubled by the mark it applies first = 4,000. It spends the one point.
    expect(first).toMatchObject({ action: 'skill', kind: 'skill', at: 100, cycle: 1, damage: 4000, skillPointsBefore: 1, skillPointsAfter: 0 })
    // Basic gains a point and hits for 2,000 (the enemy is marked).
    expect(second).toMatchObject({ action: 'basic', damage: 2000, skillPointsBefore: 0, skillPointsAfter: 1 })
    expect(second!.at).toBeGreaterThan(first!.at)
    for (const a of result.actions) expect(a.cycle).toBe(a.at <= 150 ? 1 : 2)
    // Everything dealt inside an action is in some action's damage: here, all of it.
    expect(result.actions.reduce((sum, a) => sum + a.damage, 0)).toBeCloseTo(result.totalDamage, 6)
  })

  it('damage per ability sums to the member total', () => {
    const { b } = battle({ cycles: 5, start: { energy: 0, skillPoints: 1, techniques: true }, policy: [{ unit: 'a', use: 'skill', when: [{ what: 'team.skill_points', min: 1 }] }, { unit: 'a', use: 'basic', when: [] }] })
    const result = b.run()
    expect(Object.keys(result.damageByAbility.a!).sort()).toEqual(['BASIC', 'SKILL'])
    const sum = Object.values(result.damageByAbility.a!).reduce((x, y) => x + y, 0)
    expect(sum).toBeCloseTo(result.damageByMember.a!, 6)
  })

  it('downedAt lists the same allies as downed, with when', () => {
    const { b } = battle()
    const result = b.run()
    expect(result.downedAt.map((d) => d.member)).toEqual(result.downed)
  })
})

describe('reaction damage in the action log (K35)', () => {
  it('credits damage booked in reaction to an action to that action, and a reaction to a reaction to the original', () => {
    const { b } = battle({ cycles: 2 })
    // A made-up Zone: after each of a's actions, 500 Additional DMG; that damage triggers another 250 (a reaction to a reaction).
    let reacting = false
    b.timeline.bus.on('actionUsed', () => {
      b.attack({ attacker: 'a', ability: 'BASIC', parts: [{ shape: 'single', scaling: 0.5, hit: 0 }] })
    })
    b.timeline.bus.on('damageDealt', (e) => {
      if (reacting || e.scaling !== 0.5) return
      reacting = true
      b.attack({ attacker: 'a', ability: 'BASIC', parts: [{ shape: 'single', scaling: 0.25, hit: 0 }] })
      reacting = false
    })
    const r = b.run()
    expect(r.actions).toHaveLength(2)
    // Each basic: 1000 own + 500 reaction + 250 reaction to the reaction. The log carries all of it.
    for (const x of r.actions) expect(x.damage).toBeCloseTo(1750, 6)
    expect(r.actions.reduce((sum, x) => sum + x.damage, 0) + r.unattributedDamage).toBeCloseTo(r.totalDamage, 6)
    expect(r.unattributedDamage).toBe(0)
    // Per-member and per-ability totals are what they always were.
    expect(r.damageByMember.a).toBeCloseTo(3500, 6)
    expect(r.damageByAbility.a!.BASIC).toBeCloseTo(3500, 6)
  })

  it('gives a follow-up that a listener performs its own line, with its own reactions', () => {
    const { b } = battle({ cycles: 1 })
    let fired = false
    b.timeline.bus.on('actionUsed', (e) => {
      if (e.kind === 'followUp') {
        b.attack({ attacker: 'a', ability: 'BASIC', parts: [{ shape: 'single', scaling: 0.5, hit: 0 }] })
        return
      }
      if (fired) return
      fired = true
      b.performAction('a', 'fua', 'followUp', () => b.attack({ attacker: 'a', ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] }))
    })
    const r = b.run()
    const fua = r.actions.find((x) => x.kind === 'followUp')!
    expect(fua.damage).toBeCloseTo(1000 + 500, 6)
    expect(r.actions.filter((x) => x.kind === 'followUp')).toHaveLength(1)
    expect(r.actions.reduce((sum, x) => sum + x.damage, 0)).toBeCloseTo(r.totalDamage, 6)
  })

  it('reports damage that belongs to no action as unattributed', () => {
    const { b } = battle()
    b.attack({ attacker: 'a', ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] }) // before the battle: a Technique
    const r = b.run()
    expect(r.unattributedDamage).toBeCloseTo(1000, 6)
    expect(r.actions.reduce((sum, x) => sum + x.damage, 0) + r.unattributedDamage).toBeCloseTo(r.totalDamage, 6)
  })
})
