import { describe, expect, it } from 'vitest'
import { Battle, IMPRISONED } from '../battle/battle'
import type { BattleSetup, HitPart, MemberSetup } from '../battle/battle'
import type { EngineEvents, TurnInfo } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { InTheNameOfTheWorld } from '../equipment/inTheNameOfTheWorld'
import { PioneerDiverOfDeadWaters } from '../equipment/pioneerDiverOfDeadWaters'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import { Acheron } from './acheron'
import { reachOfParts, Welt, weltScalings } from './welt'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/**
 * 1,000 damage per 100% ATK. Fribbels' hit lists: BASIC [hit, Judgment, Talent], SKILL [hit x5, Judgment, Talent x5,
 * E1], ULT [hit, Talent x2, E1]. The lists are always full, as the kit keeps the positions fixed.
 */
function makeKernel(requests: DamageRequest[]): DamageKernel {
  return {
    actionDamage(request) {
      requests.push(request)
      const flat = [{ damage: 1000, scaling: 1 }]
      if (request.attacker.characterId !== '1004b1') return fakeResult({ BASIC: flat, SKILL: flat, ULT: flat, FUA: flat, BREAK: [{ damage: 500 }] })
      const s = weltScalings(request.attacker.eidolon)
      const hit = (scaling: number) => ({ damage: 1000 * scaling, scaling })
      return fakeResult({
        BASIC: [hit(s.basic), hit(0.8 * s.basic), hit(s.talent)],
        SKILL: [hit(5 * s.skill), hit(1.2 * s.skill), hit(5 * s.talent), hit(0.4 * s.ult)],
        ULT: [hit(s.ult), hit(2 * s.talent), hit(0.4 * s.ult)],
        BREAK: [{ damage: 500 }],
      })
    },
  }
}

const weltMember = (eidolon = 0, extra: Partial<MemberSetup> = {}): MemberSetup => ({
  key: 'welt',
  kit: Welt,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: '1004b1', lightConeId: '23004', eidolon, superimposition: 1 }, build: noBuild },
  ...extra,
})

const acheronMember: MemberSetup = {
  key: 'acheron',
  kit: Acheron,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: '1308', lightConeId: '23024', eidolon: 0, superimposition: 1 }, build: noBuild },
}

function setup(members: MemberSetup[] = [weltMember()], overrides: Partial<BattleSetup> = {}) {
  const requests: DamageRequest[] = []
  const battle = new Battle({
    members,
    policy: [],
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 3,
    start: { energy: 0, skillPoints: 3, techniques: false },
    kernel: makeKernel(requests),
    ...overrides,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  const delays: Record<string, number> = {}
  const actions: EngineEvents['actionUsed'][] = []
  battle.timeline.bus.on('damageDealt', (d) => dealt.push(d))
  battle.timeline.bus.on('actionUsed', (a) => actions.push(a))
  battle.timeline.bus.on('gaugeChanged', (g) => {
    if (g.cause === 'delay') delays[g.unit] = (delays[g.unit] ?? 0) + (g.after - g.before) / 10_000
  })
  const use = (who: string, name: string) => battle.member(who).instance.actions[name]!.use()
  const welt = battle.member('welt').instance
  /** Forget the delay recorded so far. */
  const resetDelays = () => {
    for (const key of Object.keys(delays)) delete delays[key]
  }
  const turn = (unit: string, serial = 1000): TurnInfo => ({ unit, serial, index: 1, at: 0, cycle: 1 })
  /** One of the unit's turns ends: durations clocked on it count down. */
  const endTurn = (unit: string) => battle.timeline.modifiers.tick(turn(unit), 'turnEnd')
  return { battle, welt, requests, dealt, delays, actions, use, resetDelays, endTurn, turn }
}

const lastRequest = (requests: DamageRequest[], characterId: string) => [...requests].reverse().find((r) => r.attacker.characterId === characterId)!

describe('weltScalings', () => {
  it('E0 is the Lv6 / Lv10 / Lv10 / Lv10 text, E3 raises Basic ATK and Skill, E5 the Ultimate, Talent and Imprison', () => {
    expect(weltScalings(0)).toEqual({ basic: 1, skill: 0.72, ult: 1.5, talent: 1, imprisonDelay: 0.12 })
    expect(weltScalings(2)).toEqual(weltScalings(0))
    expect(weltScalings(3)).toEqual({ basic: 1.1, skill: 0.792, ult: 1.5, talent: 1, imprisonDelay: 0.12 })
    expect(weltScalings(4)).toEqual(weltScalings(3))
    expect(weltScalings(5)).toEqual({ basic: 1.1, skill: 0.792, ult: 1.62, talent: 1.1, imprisonDelay: 0.132 })
    expect(weltScalings(6)).toEqual(weltScalings(5))
  })
})

describe('Basic ATK', () => {
  it('+1 Skill Point, +20 energy, 100% + the Judgment trace (80% of that) on the target; no Talent hit on a fresh enemy', () => {
    const { battle, use, dealt } = setup()
    battle.party.setEnergy('welt', 0)
    const sp = battle.skillPoints
    use('welt', 'basic')
    expect(battle.skillPoints).toBe(sp + 1)
    expect(battle.party.get('welt').energy).toBe(20)
    expect(dealt.map((d) => d.scaling)).toEqual([1 + 0.8])
    expect(dealt[0]!.damage).toBeCloseTo(1800, 6)
  })

  it('E3: 110%; and a Slowed target takes the Talent\'s 100% (110% at E5) as well', () => {
    const { use, dealt, battle } = setup([weltMember(5)])
    battle.timeline.modifiers.apply({ id: 'other.slow', target: 'enemy1', source: 'x', spdPct: -0.1, debuff: true })
    use('welt', 'basic')
    expect(dealt[0]!.scaling).toBeCloseTo(1.1 + 0.88 + 1.1, 12)
  })

  it('removes 30 toughness from the target', () => {
    const { use, battle } = setup()
    use('welt', 'basic')
    expect(battle.enemies.toughness('enemy1')).toBe(profile.toughness - 30)
  })
})

describe('Skill (Edge of the Void)', () => {
  it('-1 Skill Point, +30 energy in all (IN-GAME CHECK: the data prints +6 per hit), 72% on the target and four more 72% hits: 360% and the Judgment 120% of 72%', () => {
    const { battle, use, dealt } = setup()
    battle.party.setEnergy('welt', 0)
    use('welt', 'skill')
    expect(battle.skillPoints).toBe(2)
    expect(battle.party.get('welt').energy).toBe(30)
    // Four of the five hits land on an enemy the first one slowed, so the Talent's 100% follows each (see below).
    expect(dealt.reduce((sum, d) => sum + d.scaling, 0)).toBeCloseTo(5 * 0.72 + 1.2 * 0.72 + 4 * 1.0, 12)
  })

  it('removes 30 toughness per hit: 150 from the one enemy', () => {
    const { use, battle } = setup()
    use('welt', 'skill')
    expect(battle.enemies.toughness('enemy1')).toBeCloseTo(profile.toughness - 150, 9)
  })

  it('slows each enemy at the chance a hit landed on it (K22), 10% for 2 turns, as a debuff the action reports', () => {
    const { battle, use, actions, endTurn } = setup([weltMember()], { enemyCount: 3 })
    const base = battle.timeline.spd('enemy1')
    use('welt', 'skill')
    // The designated enemy (enemy2) is hit for certain; each of the 4 random hits lands on another with 1/3.
    const random = 1 - (2 / 3) ** 4
    expect(actions[0]!.debuffed.sort()).toEqual(['enemy1', 'enemy2', 'enemy3'])
    expect(actions[0]!.debuffChance.enemy2).toBe(1)
    expect(actions[0]!.debuffChance.enemy1).toBeCloseTo(random, 12)
    expect(battle.presence('enemy2', 'welt.skill_slow')).toBe(1)
    expect(battle.presence('enemy1', 'welt.skill_slow')).toBeCloseTo(random, 12)
    expect(battle.debuffChance('enemy3') > 0).toBe(true)
    // The expected SPD: the slow counts at its chance.
    expect(battle.timeline.spd('enemy2')).toBeCloseTo(base * 0.9, 9)
    expect(battle.timeline.spd('enemy1')).toBeCloseTo(base * (1 - 0.1 * random), 9)
    endTurn('enemy2')
    expect(battle.timeline.spd('enemy2')).toBeCloseTo(base * 0.9, 9)
    endTurn('enemy2')
    expect(battle.timeline.spd('enemy2')).toBeCloseTo(base, 9)
    expect(battle.debuffChance('enemy2') > 0).toBe(false)
  })

  it('with 1 enemy every hit lands on it: the slow is certain', () => {
    const { battle, use, actions } = setup()
    use('welt', 'skill')
    expect(actions[0]!.debuffChance).toEqual({ enemy1: 1 })
    expect(battle.presence('enemy1', 'welt.skill_slow')).toBe(1)
  })

  it('later hits see the slow the earlier hits left: hits 2 to 5 already trigger the Talent, the first hit does not', () => {
    const { use, dealt } = setup()
    use('welt', 'skill')
    // One attack call per hit; the Judgment rides on the first, the Talent's 100% on each of the four that follow.
    expect(dealt.map((d) => d.scaling.toFixed(6))).toEqual([(0.72 + 1.2 * 0.72).toFixed(6), ...Array(4).fill((0.72 + 1.0).toFixed(6))])
    const first = dealt.reduce((sum, d) => sum + d.scaling, 0)
    dealt.length = 0
    use('welt', 'skill')
    const second = dealt.reduce((sum, d) => sum + d.scaling, 0)
    // The second Skill's first hit is on an enemy that is already Slowed too.
    expect(second - first).toBeCloseTo(1.0, 12)
  })

  it('the kernel is told E6 per hit: the first hit is priced as against an enemy that is not Slowed, the later ones as against a Slowed one', () => {
    const { use, requests } = setup([weltMember(6)])
    use('welt', 'skill')
    const e6 = requests.filter((r) => r.attacker.characterId === '1004b1').map((r) => r.attacker.characterConditionals!.e6SlowedCrCdBoost)
    expect(e6).toEqual([false, true])
  })

  it('on 3 enemies the Talent follows the chance each enemy is Slowed when a random hit lands on it', () => {
    const { use, dealt } = setup([weltMember()], { enemyCount: 3 })
    use('welt', 'skill')
    const by = (id: string) => dealt.filter((d) => d.enemy === id).reduce((sum, d) => sum + d.scaling, 0)
    // A hit j (1 to 4) lands on an enemy other than the designated one with 1/3; it was Slowed by the j-1 random hits before it
    // with chance 1 - (2/3)^(j-1). The designated enemy is Slowed from the first hit on.
    let others = 0
    for (let j = 1; j <= 4; j++) others += (1 / 3) * (1 - (2 / 3) ** (j - 1))
    expect(by('enemy1')).toBeCloseTo(0.72 * (4 / 3) + others, 12)
    expect(by('enemy3')).toBeCloseTo(0.72 * (4 / 3) + others, 12)
    expect(by('enemy2')).toBeCloseTo(0.72 * (1 + 4 / 3) + 1.2 * 0.72 + 4 / 3, 12)
  })

  it('E6 asks for the CRIT buff only against an enemy that is Slowed', () => {
    const { use, requests } = setup([weltMember(6)])
    use('welt', 'skill')
    use('welt', 'skill')
    const e6 = requests.filter((r) => r.attacker.characterId === '1004b1').map((r) => r.attacker.characterConditionals!.e6SlowedCrCdBoost)
    // Not Slowed for the first hit of the first Skill, Slowed for every other hit: the second Skill asks for nothing new.
    expect(e6).toEqual([false, true])
  })
})

describe('Ultimate (Synthetic Black Hole)', () => {
  it('costs 120 and is not available below it; +5 and the Punishment trace\'s +5 afterwards', () => {
    const { battle, welt, use } = setup()
    battle.party.setEnergy('welt', 119)
    expect(welt.actions.ultimate!.canUse()).toBe(false)
    battle.party.setEnergy('welt', 120)
    expect(welt.actions.ultimate!.canUse()).toBe(true)
    use('welt', 'ultimate')
    expect(battle.party.get('welt').energy).toBe(10)
  })

  it('150% to every enemy, 60 toughness each', () => {
    const { battle, use, dealt } = setup([weltMember()], { enemyCount: 3 })
    battle.party.setEnergy('welt', 120)
    use('welt', 'ultimate')
    expect(dealt).toHaveLength(3)
    for (const d of dealt) expect(d.scaling).toBeCloseTo(1.5, 12)
    for (const id of battle.enemies.ids) expect(battle.enemies.toughness(id)).toBe(profile.toughness - 60)
  })

  for (const [eidolon, delay] of [[0, 0.12], [5, 0.132]] as const) {
    it(`E${eidolon}: Imprison delays every enemy ${delay * 100}% once, SPD -10% for 1 turn`, () => {
      const { battle, use, delays, endTurn } = setup([weltMember(eidolon)], { enemyCount: 3 })
      battle.party.setEnergy('welt', 120)
      const base = battle.timeline.spd('enemy1')
      use('welt', 'ultimate')
      for (const id of battle.enemies.ids) expect(delays[id], id).toBeCloseTo(delay, 9)
      // Imprison (-10%) and Weightless (-5%) both cut SPD.
      expect(battle.timeline.spd('enemy1')).toBeCloseTo(base * 0.85, 9)
      endTurn('enemy1')
      // Imprison lasted 1 turn; Weightless has 1 more.
      expect(battle.timeline.spd('enemy1')).toBeCloseTo(base * 0.95, 9)
      endTurn('enemy1')
      expect(battle.timeline.spd('enemy1')).toBeCloseTo(base, 9)
    })
  }

  it('leaves every enemy Weightless for 2 turns, and reports both debuffs on the action', () => {
    const { battle, use, actions, endTurn } = setup([weltMember()], { enemyCount: 3 })
    battle.party.setEnergy('welt', 120)
    use('welt', 'ultimate')
    expect(actions[0]!.debuffed.sort()).toEqual(['enemy1', 'enemy2', 'enemy3'])
    expect(battle.debuffCount('enemy2')).toBe(2)
    endTurn('enemy2')
    expect(battle.timeline.modifiers.has('enemy2', 'welt.weightless')).toBe(true)
    endTurn('enemy2')
    expect(battle.timeline.modifiers.has('enemy2', 'welt.weightless')).toBe(false)
    expect(battle.debuffCount('enemy2')).toBe(0)
  })

  it('the Ultimate itself is not against a Weightless enemy: the kernel is told so, then told so for the next attack', () => {
    const { battle, use, requests } = setup()
    battle.party.setEnergy('welt', 120)
    use('welt', 'ultimate')
    expect(requests[0]!.attacker.characterConditionals!.enemyWeightless).toBe(false)
    use('welt', 'basic')
    expect(lastRequest(requests, '1004b1').attacker.characterConditionals!.enemyWeightless).toBe(true)
  })

  it('both of the Ultimate\'s hits are priced before the Imprison, so a fresh enemy gets no Talent hit from the second', () => {
    const { battle, use, dealt } = setup()
    battle.party.setEnergy('welt', 120)
    use('welt', 'ultimate')
    // One event: the two hits (10% and 90% of 150%) and nothing else.
    expect(dealt.map((d) => d.scaling)).toEqual([1.5])
  })

  it('a second Ultimate on a Weightless, Slowed enemy: the Talent twice and E1 once (E1)', () => {
    const { battle, use, dealt } = setup([weltMember(1)])
    battle.party.setEnergy('welt', 120)
    use('welt', 'ultimate')
    dealt.length = 0
    battle.party.setEnergy('welt', 120)
    use('welt', 'ultimate')
    expect(dealt.reduce((sum, d) => sum + d.scaling, 0)).toBeCloseTo(1.5 + 2 * 1.0 + 0.4 * 1.5, 12)
  })
})

describe('Weightless delays an attacked enemy 4%, at most 8 times per target per turn', () => {
  const afterUlt = (members: MemberSetup[] = [weltMember()], overrides: Partial<BattleSetup> = {}) => {
    const s = setup(members, overrides)
    s.battle.party.setEnergy('welt', 120)
    s.use('welt', 'ultimate')
    s.resetDelays()
    return s
  }

  it('a Basic ATK is one hit: 4%', () => {
    const { use, delays } = afterUlt()
    use('welt', 'basic')
    expect(delays.enemy1).toBeCloseTo(0.04, 9)
  })

  it('a Skill is five hits on one enemy: 20%; a second Skill hits the cap of 8 and adds only 3 hits: 32% in all', () => {
    const { use, delays } = afterUlt()
    use('welt', 'skill')
    expect(delays.enemy1).toBeCloseTo(0.2, 9)
    use('welt', 'skill')
    expect(delays.enemy1).toBeCloseTo(0.32, 9)
    use('welt', 'basic')
    expect(delays.enemy1).toBeCloseTo(0.32, 9)
  })

  it('the count starts again when the enemy\'s turn starts', () => {
    const { use, delays, battle, turn, resetDelays } = afterUlt()
    use('welt', 'skill')
    use('welt', 'skill')
    battle.timeline.bus.emit('turnStart', turn('enemy1'))
    resetDelays()
    use('welt', 'basic')
    expect(delays.enemy1).toBeCloseTo(0.04, 9)
  })

  it('an ally\'s attack counts too, per enemy it hits, and only Weightless enemies are delayed', () => {
    const { use, delays, battle } = afterUlt([weltMember(), acheronMember], { enemyCount: 3 })
    battle.timeline.modifiers.remove('enemy1', 'welt.weightless')
    use('acheron', 'skill')
    // Her Skill is a blast: 3 enemies hit once each (the primary is enemy2). enemy1 is no longer Weightless.
    expect(delays.enemy1 ?? 0).toBe(0)
    expect(delays.enemy2).toBeCloseTo(0.04, 9)
    expect(delays.enemy3).toBeCloseTo(0.04, 9)
  })

  it('nothing is delayed before the Ultimate', () => {
    const { use, delays } = setup()
    use('welt', 'skill')
    expect(delays.enemy1 ?? 0).toBe(0)
  })

  it('reachOfParts counts the expected hits and the chance of at least one, not counting parts flagged additional', () => {
    const { battle } = setup([weltMember()], { enemyCount: 5 })
    const parts: HitPart[] = [
      { shape: 'single', scaling: 1, hit: 0 },
      { shape: 'bounce', scaling: 1, hits: 4, hit: 0 },
      { shape: 'single', scaling: 1, hit: 1, additional: true },
      { shape: 'single', scaling: 1, hit: 0, additional: true },
    ]
    const primary = reachOfParts(battle, parts, battle.primary)
    expect(primary.hits).toBeCloseTo(1 + 4 / 5, 12)
    expect(primary.chance).toBe(1)
    const other = reachOfParts(battle, parts, 'enemy1')
    expect(other.hits).toBeCloseTo(4 / 5, 12)
    expect(other.chance).toBeCloseTo(1 - (4 / 5) ** 4, 12)
  })
})

describe('Retribution: allies that attack a Weightless enemy gain +10% DMG per stack, up to 10, for 2 turns', () => {
  it('Welt\'s own stacks go to the kernel as his own conditional, one per attack that hit a Weightless enemy', () => {
    const { battle, use, requests } = setup()
    battle.party.setEnergy('welt', 120)
    use('welt', 'ultimate')
    // The Ultimate hit nobody Weightless: no stack yet.
    expect(battle.timeline.modifiers.has('welt', 'welt.retribution')).toBe(false)
    use('welt', 'skill')
    expect(battle.timeline.modifiers.get('welt', 'welt.retribution')!.stacks).toBe(1)
    use('welt', 'basic')
    expect(battle.timeline.modifiers.get('welt', 'welt.retribution')!.stacks).toBe(2)
    use('welt', 'basic')
    // The kernel saw 0 stacks on the Skill (the one that earned the first), 1, then 2 on the Basic ATKs.
    const stacks = requests.filter((r) => r.attacker.characterId === '1004b1').map((r) => r.attacker.characterConditionals!.retributionDmgStacks)
    expect(stacks.at(-1)).toBe(2)
  })

  it('a teammate has its own stacks, and the kernel is told each ally\'s count when it attacks', () => {
    const { battle, use, requests } = setup([weltMember(), acheronMember])
    battle.party.setEnergy('welt', 120)
    use('welt', 'ultimate')
    use('acheron', 'basic')
    use('acheron', 'basic')
    use('welt', 'basic')
    const seen = (attackerId: string) =>
      requests.filter((r) => r.attacker.characterId === attackerId).map((r) => r.teammates.find((t) => t.characterId === '1004b1')?.characterConditionals ?? r.attacker.characterConditionals)
    // Acheron: 0 stacks on her first attack, 1 on her second.
    const acheron = seen('1308').map((c) => c!.retributionDmgStacks)
    expect(acheron).toEqual([0, 1])
    expect(seen('1308').every((c) => c!.enemyWeightless === true && c!.e4WeightlessResPen === true)).toBe(true)
    // Welt's own count is separate: his Basic ATK found 0.
    expect(battle.timeline.modifiers.get('welt', 'welt.retribution')!.stacks).toBe(1)
    expect(battle.timeline.modifiers.get('acheron', 'welt.retribution')!.stacks).toBe(2)
  })

  it('caps at 10 stacks and each stack refreshes the 2 turns, counted on the ally\'s own turns', () => {
    const { battle, use, endTurn } = setup()
    battle.party.setEnergy('welt', 120)
    use('welt', 'ultimate')
    for (let i = 0; i < 14; i++) use('welt', 'basic')
    expect(battle.timeline.modifiers.get('welt', 'welt.retribution')!.stacks).toBe(10)
    endTurn('welt')
    expect(battle.timeline.modifiers.has('welt', 'welt.retribution')).toBe(true)
    endTurn('welt')
    expect(battle.timeline.modifiers.has('welt', 'welt.retribution')).toBe(false)
  })

  it('an attack that hit no Weightless enemy earns nothing', () => {
    const { battle, use } = setup()
    use('welt', 'basic')
    expect(battle.timeline.modifiers.has('welt', 'welt.retribution')).toBe(false)
  })
})

describe('E1, E2, E4', () => {
  it('E1: a Skill on a Weightless enemy adds 40% of the Ultimate\'s multiple; E0 does not', () => {
    for (const [eidolon, extra] of [[0, 0], [1, 0.4 * 1.5]] as const) {
      const { battle, use, dealt } = setup([weltMember(eidolon)])
      battle.party.setEnergy('welt', 120)
      use('welt', 'ultimate')
      dealt.length = 0
      use('welt', 'skill')
      const s = weltScalings(eidolon)
      expect(dealt.reduce((sum, d) => sum + d.scaling, 0), `E${eidolon}`).toBeCloseTo(5 * s.skill + 1.2 * s.skill + 5 * s.talent + extra, 12)
    }
  })

  it('E2: 3 energy for every time the Talent triggers (once per Additional DMG instance), none before E2', () => {
    for (const [eidolon, gain] of [[1, 0], [2, 3 * 5]] as const) {
      const { battle, use } = setup([weltMember(eidolon)])
      use('welt', 'skill')
      // (Its own first Skill already triggered the Talent on hits 2 to 5: four instances at E2.)
      battle.party.setEnergy('welt', 0)
      use('welt', 'skill')
      // Slowed enemy: 5 Talent instances, plus the Skill's own 30.
      expect(battle.party.get('welt').energy, `E${eidolon}`).toBe(30 + gain)
    }
  })

  it('E2: a Basic ATK on a Slowed enemy is one trigger, an Ultimate two per Slowed enemy', () => {
    const { battle, use } = setup([weltMember(2)], { enemyCount: 3 })
    use('welt', 'skill')
    battle.party.setEnergy('welt', 0)
    use('welt', 'basic')
    expect(battle.party.get('welt').energy).toBe(20 + 3)
    battle.party.setEnergy('welt', 120)
    use('welt', 'ultimate')
    // The Skill left the designated enemy Slowed for certain and each other one with 1 - (2/3)^4; two triggers per Slowed enemy.
    const slowedEnemies = 1 + 2 * (1 - (2 / 3) ** 4)
    expect(battle.party.get('welt').energy).toBeCloseTo(10 + 3 * 2 * slowedEnemies, 9)
  })

  it('E4 is Fribbels\' own switch: the kit always passes it on, and the eidolon gates it', () => {
    const { use, requests } = setup([weltMember(4)])
    use('welt', 'basic')
    expect(requests[0]!.attacker.characterConditionals!.e4WeightlessResPen).toBe(true)
  })
})

describe('the kernel is told the live state', () => {
  it('keeps the Talent and Judgment hits in the list and passes the trace and light cone switches', () => {
    const { use, requests } = setup()
    use('welt', 'basic')
    expect(requests[0]!.attacker.characterConditionals).toEqual({
      enemySlowed: true,
      enemyWeightless: false,
      retributionDmgStacks: 0,
      ehrToAtkBoost: true,
      traceAdditionalDmg: true,
      skillExtraHits: 4,
      e1WeightlessAdditionalDmg: true,
      e4WeightlessResPen: true,
      e6SlowedCrCdBoost: false,
    })
  })
})

describe('start of battle', () => {
  it('Retribution trace: +30 energy, scaled by Energy Regeneration Rate', () => {
    const { welt, battle } = setup([weltMember(0, { stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100, energyRegen: 0.1 } })])
    welt.onBattleStart!({ techniques: false })
    expect(battle.party.get('welt').energy).toBeCloseTo(33, 9)
  })

  it('technique: every enemy Imprisoned on entering combat, delay 20%, SPD -10% for 1 turn', () => {
    const { battle, welt, delays, endTurn } = setup([weltMember()], { enemyCount: 3 })
    const base = battle.timeline.spd('enemy1')
    welt.onBattleStart!({ techniques: true })
    for (const id of battle.enemies.ids) {
      expect(delays[id], id).toBeCloseTo(0.2, 9)
      expect(battle.timeline.spd(id), id).toBeCloseTo(base * 0.9, 9)
      expect(battle.debuffChance(id) > 0).toBe(true)
    }
    endTurn('enemy3')
    expect(battle.timeline.spd('enemy3')).toBeCloseTo(base, 9)
  })

  it('no technique: nothing on the enemies', () => {
    const { battle, welt } = setup()
    welt.onBattleStart!({ techniques: false })
    expect(battle.debuffChance('enemy1') > 0).toBe(false)
  })

  it('a break\'s Imprisonment on the enemy is not stacked with Welt\'s: one shared Imprisoned state, one -10% SPD, both delays applied (K24)', () => {
    const { battle, use, delays } = setup()
    const base = battle.timeline.spd('enemy1')
    battle.imprison('enemy1', 'welt', 0.3, false)
    expect(battle.timeline.modifiers.get('enemy1', IMPRISONED)!.debuff).toBe(true)
    battle.party.setEnergy('welt', 120)
    use('welt', 'ultimate')
    // Imprisonment -10% (once) and Weightless -5%.
    expect(battle.timeline.spd('enemy1')).toBeCloseTo(base * 0.85, 9)
    expect(delays.enemy1).toBeCloseTo(0.3 + 0.12, 9)
    expect(battle.timeline.modifiers.on('enemy1').filter((m) => m.id === IMPRISONED)).toHaveLength(1)
  })

  it('and the other way round: Welt\'s Imprison, then a break\'s, refreshes the one state', () => {
    const { battle, welt, delays } = setup()
    const base = battle.timeline.spd('enemy1')
    welt.onBattleStart!({ techniques: true })
    battle.imprison('enemy1', 'acheron', 0.3, false)
    expect(battle.timeline.spd('enemy1')).toBeCloseTo(base * 0.9, 9)
    expect(delays.enemy1).toBeCloseTo(0.2 + 0.3, 9)
    expect(battle.timeline.modifiers.get('enemy1', IMPRISONED)!.source).toBe('acheron')
  })
})

describe('his debuffs feed other effects', () => {
  it('Acheron\'s talent: one Slashed Dream and one Crimson Knot per Welt action that debuffs, however many debuffs it puts on', () => {
    const { battle, use } = setup([weltMember(), acheronMember])
    const acheron = battle.member('acheron').instance
    expect(acheron.quantities!.slashed_dream!()).toBe(0)
    use('welt', 'skill')
    expect(acheron.quantities!.slashed_dream!()).toBe(1)
    expect(acheron.quantities!.crimson_knots!()).toBe(1)
    battle.party.setEnergy('welt', 120)
    use('welt', 'ultimate')
    // Imprison and Weightless: two debuffs, one action, one stack.
    expect(acheron.quantities!.slashed_dream!()).toBe(2)
    use('welt', 'basic')
    expect(acheron.quantities!.slashed_dream!()).toBe(2)
  })

  it('Pioneer Diver of Dead Waters on Welt: debuff count and the doubling follow his debuffs', () => {
    const { battle, use, requests } = setup([
      weltMember(0, { equipment: { lightCone: InTheNameOfTheWorld, sets: [{ module: PioneerDiverOfDeadWaters, pieces: 4 }] } }),
    ])
    const value = () => lastRequest(requests, '1004b1').setConditionals!['Pioneer Diver of Dead Waters']
    use('welt', 'basic')
    expect(value()).toBe(-1)
    use('welt', 'skill')
    use('welt', 'basic')
    // His Skill's slow: one debuff, doubled does not apply with fewer than 2.
    expect(value()).toBe(0)
    battle.party.setEnergy('welt', 120)
    use('welt', 'ultimate')
    use('welt', 'basic')
    // Slow, Imprison and Weightless: 3 debuffs, and the wearer just inflicted them: doubled.
    expect(battle.debuffCount('enemy1')).toBe(3)
    expect(value()).toBe(4)
  })
})
