import { describe, expect, it } from 'vitest'
import { Battle, CYRENE_KERNEL_ID } from '../battle/battle'
import type { BattleSetup, MemberSetup } from '../battle/battle'
import type { EngineEvents, TurnInfo } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import type { EnemyProfile } from '../enemy/profile'
import { fakeResult, ZERO_STATS } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Element } from '../scenario/types'
import { Anaxa, anaxaScalings } from './anaxa'
import type { Kit } from './kit'
import { MAX_WEAKNESS_TYPES, scenarioWeaknessTypes, weaknessTypesFor } from './weaknessTypes'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/**
 * A fake kernel. Anaxa's hits (BASIC, SKILL and ULT, one hit each, as Fribbels' ability list has it) cost 1000 per 100% ATK, times
 * (1 + 0.3 with Qualitative Disclosure on + the injected DMG%). The scaling it reports is arbitrary: the battle prices per 100%.
 * So a part of multiple m against an enemy in Disclosure costs 1300 m.
 */
function makeKernel(requests: DamageRequest[]): DamageKernel {
  return {
    actionDamage(request) {
      requests.push(request)
      const conditionals = request.attacker.characterConditionals ?? {}
      const injected = (request.injectedBuffs ?? []).filter((b) => b.stat === 'DMG_PERCENT').reduce((sum, b) => sum + b.value, 0)
      const price = 1000 * (1 + (conditionals.exposedNature === true ? 0.3 : 0) + injected)
      const hit = (scaling: number) => ({ damage: price * scaling, scaling })
      return fakeResult({ BASIC: [hit(1)], SKILL: [hit(0.7)], ULT: [hit(1.6)], FUA: [hit(1)], BREAK: [{ damage: 500 }] }, ZERO_STATS)
    },
  }
}

const anaxaMember = (eidolon = 0, extra: Partial<MemberSetup> = {}): MemberSetup => ({
  key: 'anaxa',
  kit: Anaxa,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: '1405', lightConeId: 'x', eidolon, superimposition: 1 }, build: noBuild },
  ...extra,
})

/** A teammate with a Basic ATK, of any path, so that its requests carry Anaxa's teammate conditionals. */
const allyKit = (path: Kit['path']): Kit => ({
  characterId: 'ally',
  path,
  element: 'Fire',
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
const allyMember = (key: string, path: Kit['path'] = 'Hunt'): MemberSetup => ({
  key,
  kit: allyKit(path),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 90 },
  kernel: { unit: { characterId: 'ally', lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
})
/** A stand-in for Cyrene (kernel character 1415): `setCyreneEffect` accepts it as the source of Ode to Reason. */
const cyreneStub: MemberSetup = {
  key: 'cyrene',
  kit: { ...allyKit('Remembrance'), characterId: 'cyrene-stub' },
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 80 },
  kernel: { unit: { characterId: CYRENE_KERNEL_ID, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
}

interface Options {
  eidolon?: number
  enemies?: number
  weaknesses?: 'all' | Element[]
  techniques?: boolean
  members?: MemberSetup[]
  profile?: EnemyProfile
  energyRegen?: number
}

function setup(o: Options = {}) {
  const requests: DamageRequest[] = []
  const eidolon = o.eidolon ?? 0
  const members: MemberSetup[] = o.members ?? [anaxaMember(eidolon, o.energyRegen !== undefined ? { stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100, energyRegen: o.energyRegen } } : {})]
  const battleSetup: BattleSetup = {
    members,
    policy: [],
    profile: o.profile ?? profile,
    enemyCount: o.enemies ?? 1,
    weaknesses: o.weaknesses ?? 'all',
    cycles: 3,
    start: { energy: 0, skillPoints: 3, techniques: o.techniques ?? false },
    kernel: makeKernel(requests),
  }
  const battle = new Battle(battleSetup)
  const dealt: EngineEvents['damageDealt'][] = []
  /** The damage events of each action, in order. */
  const byAction: EngineEvents['damageDealt'][][] = []
  const actions: EngineEvents['actionUsed'][] = []
  let pending: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (d) => {
    dealt.push(d)
    pending.push(d)
  })
  battle.timeline.bus.on('actionUsed', (a) => {
    actions.push(a)
    byAction.push(pending)
    pending = []
  })
  const skipped: EngineEvents['enemyTurnSkipped'][] = []
  battle.timeline.bus.on('enemyTurnSkipped', (s) => skipped.push(s))
  const act = battle.member('anaxa').instance.actions
  const q = (name: string) => battle.member('anaxa').instance.quantities![name]!()
  let serial = 100
  const turn = (unit: string): TurnInfo => ({ unit, serial: ++serial, index: 1, at: 0, cycle: 1 })
  /** One of the unit's turns ends: durations clocked on it count down, and listeners to turnEnd see it. */
  const endTurn = (unit: string) => {
    const t = turn(unit)
    battle.timeline.bus.emit('turnEnd', t)
    battle.timeline.modifiers.tick(t, 'turnEnd')
  }
  /** One of the unit's turns starts (modifiers "until the start of the turn" end, listeners to turnStart run). */
  const startTurn = (unit: string) => {
    const t = turn(unit)
    battle.timeline.bus.emit('turnStart', t)
    battle.timeline.modifiers.tick(t, 'turnStart')
  }
  const start = () => battle.member('anaxa').instance.onBattleStart?.({ techniques: o.techniques ?? false })
  const types = (enemy = 'enemy1') => weaknessTypesFor(battle, 'anaxa', enemy)
  /** The scaling each enemy got in one action's damage events, summed over the calls. */
  const scalingByEnemy = (events: readonly EngineEvents['damageDealt'][]) => {
    const out: Record<string, number> = {}
    for (const d of events) out[d.enemy] = (out[d.enemy] ?? 0) + d.scaling
    return out
  }
  const anaxaRequests = () => requests.filter((r) => r.attacker.characterId === '1405')
  return { battle, requests, dealt, byAction, actions, skipped, act, q, endTurn, startTurn, start, types, scalingByEnemy, anaxaRequests }
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `enemy${i + 1}`)
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0)

describe('anaxaScalings', () => {
  it('E0 is the Lv6 / Lv10 / Lv10 / Lv10 text, E3 raises Basic ATK and Ultimate, E5 the Skill and the Talent', () => {
    expect(anaxaScalings(0)).toEqual({ basic: 1, skill: 0.7, ult: 1.6, disclosure: 0.3 })
    expect(anaxaScalings(2)).toEqual(anaxaScalings(0))
    expect(anaxaScalings(3)).toEqual({ basic: 1.1, skill: 0.7, ult: 1.76, disclosure: 0.3 })
    expect(anaxaScalings(4)).toEqual(anaxaScalings(3))
    expect(anaxaScalings(5)).toEqual({ basic: 1.1, skill: 0.77, ult: 1.76, disclosure: 0.324 })
    expect(anaxaScalings(6)).toEqual(anaxaScalings(5))
  })
})

describe('the Weakness Type count (K28): weaknessTypes.ts', () => {
  it('the scenario count is 7 for "all", else the length of the list (a repeated element counts once)', () => {
    const count = (weaknesses: 'all' | Element[]) => scenarioWeaknessTypes(setup({ weaknesses }).battle)
    expect(count('all')).toBe(MAX_WEAKNESS_TYPES)
    expect(count(['Ice'])).toBe(1)
    expect(count(['Ice', 'Fire', 'Wind'])).toBe(3)
    expect(count(['Ice', 'Ice'])).toBe(1)
    expect(count([])).toBe(0)
  })

  it('a member with no registered count reads the scenario count', () => {
    const { battle } = setup({ weaknesses: ['Ice', 'Fire'], members: [anaxaMember(), allyMember('a')] })
    expect(weaknessTypesFor(battle, 'a', 'enemy1')).toBe(2)
    expect(weaknessTypesFor(battle, 'anaxa', 'enemy1')).toBe(2)
  })
})

describe('Qualitative Disclosure and Qualitative Shift under the default "all"', () => {
  it.each([1, 3, 5])('with %i enemies every enemy has 7 Types from the start: the DEF ignore and Disclosure are on in every request', (enemies) => {
    const { act, anaxaRequests, q, types } = setup({ enemies })
    expect(q('weakness_types')).toBe(7)
    expect(q('disclosure')).toBe(1)
    act.skill!.use()
    for (const request of anaxaRequests()) {
      expect(request.attacker.characterConditionals).toMatchObject({ enemyWeaknessTypes: 7, exposedNature: true, eruditionTeammateBuffs: true })
      expect(request.injectedBuffs).toBeUndefined()
      expect(request.enemy?.count).toBe(enemies)
    }
    for (const id of ids(enemies)) expect(types(id)).toBe(7)
  })

  it('a Skill is followed by the Talent\'s extra Skill, which costs no Skill Point; both price at Disclosure (1300 per 100%)', () => {
    const { battle, act, actions, dealt } = setup()
    battle.party.setEnergy('anaxa', 0)
    act.skill!.use()
    expect(actions.map((a) => [a.actor, a.action, a.kind])).toEqual([['anaxa', 'skill', 'skill'], ['anaxa', 'skill_extra', 'skill']])
    expect(battle.skillPoints).toBe(2)
    // 5 instances x 0.7 at 1300 per 100%, twice.
    expect(sum(dealt.map((d) => d.damage))).toBeCloseTo(2 * 5 * 0.7 * 1300, 6)
    // +6 energy per instance: 30 for the Skill, 30 for the extra Skill (IN-GAME CHECK).
    expect(battle.party.get('anaxa').energy).toBeCloseTo(60, 9)
  })

  it('the extra Skill is not followed by another, and a Basic ATK is followed by one', () => {
    const { battle, act, actions } = setup()
    act.basic!.use()
    expect(actions.map((a) => a.action)).toEqual(['basic', 'skill_extra'])
    expect(battle.skillPoints).toBe(4)
  })
})

describe('Skill: where the instances land (exact expected values)', () => {
  it('1 enemy: all five instances on it', () => {
    const { act, byAction, scalingByEnemy, actions } = setup({ enemies: 1, weaknesses: ['Ice'] })
    act.skill!.use()
    expect(scalingByEnemy(byAction[0]!)).toEqual({ enemy1: expect.closeTo(5 * 0.7, 12) })
    expect(actions[0]!.hitChance).toEqual({ enemy1: 1 })
  })

  it('3 enemies: the designated and the two covering instances reach each enemy once, the other two land at 1/3 each', () => {
    const { act, byAction, scalingByEnemy, actions } = setup({ enemies: 3, weaknesses: ['Ice'] })
    act.skill!.use()
    // Each enemy: 0.7 once, plus 2 free instances x 0.7 / 3. Total 3.5.
    const per = 0.7 + (2 * 0.7) / 3
    const by = scalingByEnemy(byAction[0]!)
    for (const id of ids(3)) expect(by[id]).toBeCloseTo(per, 12)
    expect(sum(Object.values(by))).toBeCloseTo(3.5, 12)
    // Every enemy is hit for certain (the covering instances reach the two others), so 3 enemies are hit in expectation.
    for (const id of ids(3)) expect(actions[0]!.hitChance[id]).toBeCloseTo(1, 12)
    expect(actions[0]!.expectedEnemiesHit).toBeCloseTo(3, 12)
  })

  it('5 enemies: each enemy is hit exactly once, with no instance left over', () => {
    const { act, byAction, scalingByEnemy, actions } = setup({ enemies: 5, weaknesses: ['Ice'] })
    act.skill!.use()
    const by = scalingByEnemy(byAction[0]!)
    for (const id of ids(5)) expect(by[id]).toBeCloseTo(0.7, 12)
    expect(actions[0]!.expectedEnemiesHit).toBeCloseTo(5, 12)
  })

  it('7 enemies (more than the instances can cover): the four added instances reach each of the 6 others with probability 4/6', () => {
    const { act, byAction, scalingByEnemy, actions } = setup({ enemies: 7, weaknesses: ['Ice'] })
    act.skill!.use()
    const by = scalingByEnemy(byAction[0]!)
    expect(by.enemy4).toBeCloseTo(0.7, 12) // the primary of 7 is the middle one
    expect(by.enemy1).toBeCloseTo((0.7 * 4) / 6, 12)
    expect(sum(Object.values(by))).toBeCloseTo(3.5, 12)
    expect(actions[0]!.hitChance.enemy1).toBeCloseTo(4 / 6, 12)
    expect(actions[0]!.hitChance.enemy4).toBe(1)
  })

  it('E5: 77% an instance; E0: 70%', () => {
    for (const [eidolon, multiple] of [[0, 0.7], [5, 0.77]] as const) {
      const { act, byAction, scalingByEnemy } = setup({ eidolon, enemies: 5, weaknesses: ['Ice'] })
      act.skill!.use()
      expect(scalingByEnemy(byAction[0]!).enemy3).toBeCloseTo(multiple, 12)
    }
  })

  it('toughness: the designated hit 30, each added instance 15 (Fribbels\' 10 + 5 per hit, times 3), whatever the enemy count', () => {
    // 1 enemy: 30 + 4 x 15 = 90, and the extra Skill (Disclosure after 5 implants) removes another 90.
    const one = setup({ enemies: 1, weaknesses: 'all' })
    one.act.skill!.use()
    expect(one.battle.enemies.toughness('enemy1')).toBe(profile.toughness - 180)
    // 5 enemies: the primary loses 30, each other enemy one instance of 15 (Disclosure is off: 2 Types).
    const five = setup({ enemies: 5, weaknesses: ['Wind'] })
    five.act.skill!.use()
    expect(five.battle.enemies.toughness('enemy3')).toBe(profile.toughness - 30)
    expect(five.battle.enemies.toughness('enemy1')).toBe(profile.toughness - 15)
  })

  it('the kernel is told the Skill has one more instance than the added ones (skillHits), and the enemy count', () => {
    const { act, anaxaRequests } = setup({ enemies: 3, weaknesses: ['Ice'] })
    act.skill!.use()
    expect(anaxaRequests()[0]!.attacker.characterConditionals!.skillHits).toBe(4)
    expect(anaxaRequests()[0]!.enemy?.count).toBe(3)
  })

  it('-1 Skill Point and +6 energy per instance (30); it cannot be used with none', () => {
    const { battle, act } = setup({ weaknesses: ['Ice'], enemies: 5 })
    battle.party.setEnergy('anaxa', 0)
    act.skill!.use()
    expect(battle.skillPoints).toBe(2)
    expect(battle.party.get('anaxa').energy).toBeCloseTo(30, 9)
    battle.spendSkillPoints(2)
    expect(act.skill!.canUse()).toBe(false)
  })
})

describe('Weakness implants (the Talent): the count of Types as an expected value', () => {
  it('3 enemies, [Ice]: each enemy ends the Skill at 1 + 1 (the designated or covering instance) + 2/3 (two free instances at 1/3) Types; Disclosure stays off', () => {
    const { act, types, q, actions } = setup({ enemies: 3, weaknesses: ['Ice'] })
    expect(types()).toBe(1)
    act.skill!.use()
    for (const id of ids(3)) expect(types(id)).toBeCloseTo(1 + 1 + 2 / 3, 12)
    expect(q('disclosure')).toBe(0)
    expect(actions.map((a) => a.action)).toEqual(['skill'])
  })

  it('5 enemies, [Ice]: one implant each, 2 Types', () => {
    const { act, types } = setup({ enemies: 5, weaknesses: ['Ice'] })
    act.skill!.use()
    for (const id of ids(5)) expect(types(id)).toBe(2)
  })

  it('1 enemy, [Ice]: the Skill leaves 5 implants (6 Types), which puts the enemy in Disclosure and casts the extra Skill; the Types cap at 7', () => {
    const { act, types, q, actions } = setup({ enemies: 1, weaknesses: ['Ice'] })
    act.skill!.use()
    expect(actions.map((a) => a.action)).toEqual(['skill', 'skill_extra'])
    expect(types()).toBe(MAX_WEAKNESS_TYPES)
    expect(q('disclosure')).toBe(1)
  })

  it('1 enemy: the instances see the Types the earlier ones implanted; the fifth instance (5 Types) is the first in Disclosure', () => {
    const { act, anaxaRequests } = setup({ enemies: 1, weaknesses: ['Ice'] })
    act.skill!.use()
    const seen = anaxaRequests().map((r) => [r.attacker.characterConditionals!.enemyWeaknessTypes, r.attacker.characterConditionals!.exposedNature])
    expect(seen.slice(0, 5)).toEqual([[1, false], [2, false], [3, false], [4, false], [5, true]])
    // Qualitative Shift: the DEF ignore is 4% a Type (the kernel's `enemyWeaknessTypes`), read at its own count each time.
    expect(seen[5]).toEqual([6, true])
  })

  it('a fraction of a Type is kept: each instance of 3 enemies [Ice, Fire, Lightning] is priced at the state the earlier ones left', () => {
    const { act, anaxaRequests } = setup({ enemies: 3, weaknesses: ['Ice', 'Fire', 'Lightning'] })
    act.skill!.use()
    const priced = anaxaRequests().map((r) => ({
      types: r.attacker.characterConditionals!.enemyWeaknessTypes as number,
      disclosure: (r.injectedBuffs ?? []).find((b) => b.stat === 'DMG_PERCENT')?.value ?? 0,
      on: r.attacker.characterConditionals!.exposedNature,
    }))
    // The designated hit and the covering call: 3 Types. The first free instance: 3 + 1 implant = 4, no Disclosure (needs 5).
    // The second free instance: 4 + 1/3, and Disclosure at the chance the first free instance landed on the enemy: 1/3 of 30%.
    // The extra Skill after the Skill (cast at 1 - (2/3)^2 = 5/9) is priced given the cast: its designated enemy has 4 + Bin(2, 1/3) Types,
    // so given 5 or more (5 with 4/5, 6 with 1/5) it is in Disclosure for certain with 5.2 Types, and no partial bonus.
    expect(priced[0]).toEqual({ types: 3, disclosure: 0, on: false })
    expect(priced[1]).toEqual({ types: 4, disclosure: 0, on: false })
    expect(priced[2]!.types).toBeCloseTo(4 + 1 / 3, 12)
    expect(priced[2]!.disclosure).toBeCloseTo(0.3 / 3, 12)
    expect(priced[3]!.types).toBeCloseTo(5.2, 12)
    expect(priced[3]!.disclosure).toBe(0)
    expect(priced[3]!.on).toBe(true)
  })

  it('the extra Skill is priced in the state that triggers it (3 enemies, 3 Types, w = 5/9): the designated enemy in Disclosure for certain, E[Types | 5+] = 5.2, 6.2 after its own implant; the others unconditioned', () => {
    const { act, byAction, anaxaRequests } = setup({ enemies: 3, weaknesses: ['Ice', 'Fire', 'Lightning'] })
    act.skill!.use()
    const w = 5 / 9
    const primary = anaxaRequests().map((r) => r.attacker.characterConditionals!).filter((c) => c.exposedNature === true)
    // The designated enemy's requests in the extra Skill: 5.2 Types, then 6.2 (the designated hit's implant lands with certainty given the cast).
    expect(primary.map((c) => c.enemyWeaknessTypes as number).slice(0, 2)).toEqual([expect.closeTo(5.2, 12), expect.closeTo(6.2, 12)])
    // Its damage in the extra Skill: w x (0.7 + 2 x 0.7 / 3) at 1300 per 100% (no 30% x w shortfall). The enemy has no earlier Disclosure at 5 Types.
    const extra = byAction[1]!.filter((d) => d.enemy === 'enemy2')
    expect(sum(extra.map((d) => d.damage))).toBeCloseTo(w * (0.7 + (2 * 0.7) / 3) * 1300, 6)
    // The others keep their own chance of being in Disclosure (5/9 of 30%): priced at 1000 x (1 + 0.3 x 5/9) per 100%.
    const other = byAction[1]!.filter((d) => d.enemy === 'enemy1')
    expect(sum(other.map((d) => d.damage)) / sum(other.map((d) => d.scaling))).toBeLessThan(1300)
  })

  it('the extra Skill is cast at the Disclosure chance (K21): 5/9 of the damage, toughness, energy and implants, and its hit chance is 5/9 everywhere', () => {
    const { battle, act, actions, byAction, scalingByEnemy, requests } = setup({ enemies: 3, weaknesses: ['Ice', 'Fire', 'Lightning'] })
    battle.party.setEnergy('anaxa', 0)
    act.skill!.use()
    expect(actions.map((a) => a.action)).toEqual(['skill', 'skill_extra'])
    const w = 5 / 9
    const by = scalingByEnemy(byAction[1]!)
    for (const id of ids(3)) expect(by[id]).toBeCloseTo(w * (0.7 + (2 * 0.7) / 3), 12)
    // All or nothing: every enemy is hit exactly when the extra Skill is cast, not at independent chances per instance.
    for (const id of ids(3)) expect(actions[1]!.hitChance[id]).toBeCloseTo(w, 12)
    expect(battle.party.get('anaxa').energy).toBeCloseTo(30 + 30 * w, 9)
    expect(battle.skillPoints).toBe(2)
    // The first Skill's own hits: 3 Types, no Disclosure, no injected bonus; the first Skill hit in the kernel at price 1000.
    const first = requests.find((r) => r.attacker.characterId === '1405')!
    expect(first.attacker.characterConditionals).toMatchObject({ enemyWeaknessTypes: 3, exposedNature: false })
    expect(first.injectedBuffs).toBeUndefined()
  })

  it('a partial Disclosure is its DMG bonus times the chance, injected (exposedNature stays off)', () => {
    // 7 enemies, 4 Types: after one Skill an enemy that is not the primary has an implant with probability 4/6, so it is in
    // Disclosure (5 Types) with that chance: a bonus of 0.3 x 4/6 = 0.2.
    const { act, anaxaRequests } = setup({ enemies: 7, weaknesses: ['Ice', 'Fire', 'Lightning', 'Quantum'] })
    act.skill!.use()
    const injected = anaxaRequests().filter((r) => (r.injectedBuffs ?? []).some((b) => b.stat === 'DMG_PERCENT'))
    expect(injected.length).toBeGreaterThan(0)
    const buff = injected[0]!.injectedBuffs!.find((b) => b.stat === 'DMG_PERCENT')!
    expect(buff.value).toBeCloseTo(0.3 * (4 / 6), 12)
    expect(buff.target).toBe('self')
    expect(injected[0]!.attacker.characterConditionals!.exposedNature).toBe(false)
  })

  it('an implant lasts for 3 of its enemy\'s turns, counted at the end of each', () => {
    const { act, types, endTurn } = setup({ enemies: 5, weaknesses: ['Ice'] })
    act.skill!.use()
    expect(types('enemy1')).toBe(2)
    expect(types('enemy2')).toBe(2)
    endTurn('enemy1')
    endTurn('enemy1')
    expect(types('enemy1')).toBe(2)
    endTurn('enemy1')
    expect(types('enemy1')).toBe(1)
    // Another enemy's turns count for that enemy only.
    expect(types('enemy2')).toBe(2)
  })

  it('an implant put on during its own enemy turn (an Ultimate between its action and its end) does not count that turn: 3 more turns follow', () => {
    const { battle, act, types, endTurn } = setup({ enemies: 1, weaknesses: ['Ice'] })
    const during = { unit: 'enemy1', serial: 777, index: 1, at: 0, cycle: 1 } satisfies TurnInfo
    Object.defineProperty(battle.timeline, 'activeTurn', { get: () => during })
    act.basic!.use()
    expect(types()).toBe(2)
    battle.timeline.bus.emit('turnEnd', during)
    endTurn('enemy1')
    endTurn('enemy1')
    expect(types()).toBe(2)
    endTurn('enemy1')
    expect(types()).toBe(1)
  })

  it('the E1-less Basic ATK implants 1 Type on its target (chance 1)', () => {
    const { act, types } = setup({ enemies: 3, weaknesses: ['Ice'] })
    act.basic!.use()
    expect(types('enemy2')).toBe(2)
    expect(types('enemy1')).toBe(1)
  })

  it('implants count as a debuff on the enemy (one marker each); a hit at a chance leaves it at that chance', () => {
    const { act, actions, battle } = setup({ enemies: 7, weaknesses: ['Ice'] })
    act.skill!.use()
    expect(actions[0]!.debuffed).toHaveLength(7)
    expect(actions[0]!.debuffChance.enemy4).toBe(1)
    expect(actions[0]!.debuffChance.enemy1).toBeCloseTo(4 / 6, 12)
    expect(battle.debuffChance('enemy4')).toBe(1)
  })
})

describe('Sublimation (the Ultimate) and the Control RES rule (K29)', () => {
  const ultimate = (o: Options = {}) => {
    const s = setup(o)
    s.battle.party.setEnergy('anaxa', 140)
    s.act.ultimate!.use()
    return s
  }

  it('costs 140 energy, gives 5 back, and deals 160% to all enemies (E3: 176%), 60 toughness each, before any Disclosure matters', () => {
    const { battle, act, byAction, scalingByEnemy } = ultimate({ enemies: 3, weaknesses: ['Ice'] })
    expect(battle.party.get('anaxa').energy).toBeCloseTo(5, 9)
    expect(act.ultimate!.canUse()).toBe(false)
    const by = scalingByEnemy(byAction[0]!)
    for (const id of ids(3)) expect(by[id]).toBeCloseTo(1.6, 12)
    // The scenario's weakness list has no Wind, but Sublimation gives every Type, so the toughness is removed.
    for (const id of ids(3)) expect(battle.enemies.toughness(id)).toBe(profile.toughness - 60)
    const e3 = ultimate({ eidolon: 3, enemies: 3, weaknesses: ['Ice'] })
    expect(e3.scalingByEnemy(e3.byAction[0]!).enemy1).toBeCloseTo(1.76, 12)
  })

  it('the hit already sees 7 Types and Disclosure (Sublimation first); a scenario list without Wind loses no Wind RES on it', () => {
    const { anaxaRequests } = ultimate({ enemies: 3, weaknesses: ['Ice'] })
    const request = anaxaRequests()[0]!
    expect(request.attacker.characterConditionals).toMatchObject({ enemyWeaknessTypes: 7, exposedNature: true })
    // The profile's RES (0.2) is cancelled with an injected RES PEN, because the enemy is weak to Wind in Sublimation.
    expect(request.injectedBuffs).toEqual([expect.objectContaining({ stat: 'RES_PEN', value: profile.res, target: 'self' })])
    // A list with Wind already has no RES to lose: nothing is injected.
    const windy = ultimate({ enemies: 3, weaknesses: ['Wind'] })
    expect(windy.anaxaRequests()[0]!.injectedBuffs).toBeUndefined()
  })

  it('Sublimation is a debuff on every enemy, until the start of that enemy\'s turn; all seven Types hold until then', () => {
    const { battle, actions, types, startTurn } = ultimate({ enemies: 3, weaknesses: ['Ice'] })
    expect(actions[0]!.debuffed).toEqual(ids(3))
    for (const id of ids(3)) {
      expect(battle.timeline.modifiers.get(id, 'anaxa.sublimation')!.debuff).toBe(true)
      expect(types(id)).toBe(7)
    }
    startTurn('enemy2')
    expect(battle.timeline.modifiers.has('enemy2', 'anaxa.sublimation')).toBe(false)
    expect(battle.timeline.modifiers.has('enemy1', 'anaxa.sublimation')).toBe(true)
    // After it ends: 1 Type of the scenario plus the Ultimate hit's implant, which is a new Type with the chance that the random
    // one is a Type the enemy lacks (6 of the 7).
    expect(types('enemy2')).toBeCloseTo(1 + 6 / 7, 12)
    expect(types('enemy1')).toBe(7)
  })

  it('an enemy with no Control RES cannot act in Sublimation: its next turn passes with no attack (reason sublimation)', () => {
    const { battle, skipped } = ultimate({ enemies: 2 })
    expect(battle.enemies.willSkipTurn('enemy1')).toBe(true)
    expect(battle.enemies.willSkipTurn('enemy2')).toBe(true)
    const attacks: string[] = []
    battle.timeline.bus.on('enemyAttack', (a) => attacks.push(a.enemy))
    battle.enemies.takeTurn({ unit: 'enemy1', serial: 900, index: 1, at: 0, cycle: 1 })
    expect(skipped).toEqual([{ enemy: 'enemy1', reason: 'sublimation' }])
    expect(attacks).toEqual([])
    expect(battle.enemies.willSkipTurn('enemy1')).toBe(false)
  })

  it('an enemy with any Control RES acts normally (IN-GAME CHECK): 0.5 is above 0', () => {
    const controlled: EnemyProfile = { ...profile, controlRes: 0.5 }
    const { battle, skipped, actions } = ultimate({ enemies: 2, profile: controlled })
    expect(battle.enemies.willSkipTurn('enemy1')).toBe(false)
    // It still has the Sublimation weaknesses and the debuff.
    expect(actions[0]!.debuffed).toEqual(ids(2))
    battle.enemies.takeTurn({ unit: 'enemy1', serial: 900, index: 1, at: 0, cycle: 1 })
    expect(skipped).toEqual([])
  })

  it('the Ultimate is not followed by an extra Skill', () => {
    const { actions } = ultimate()
    expect(actions.map((a) => a.action)).toEqual(['ultimate'])
  })
})

describe('Traces', () => {
  it('Roaming Signifier: Basic ATK +20 and +10 energy, scaled by Energy Regeneration Rate', () => {
    const plain = setup({ weaknesses: ['Ice'], enemies: 5 })
    plain.battle.party.setEnergy('anaxa', 0)
    plain.act.basic!.use()
    expect(plain.battle.party.get('anaxa').energy).toBeCloseTo(30, 9)
    const err = setup({ weaknesses: ['Ice'], enemies: 5, energyRegen: 0.1 })
    err.battle.party.setEnergy('anaxa', 0)
    err.act.basic!.use()
    expect(err.battle.party.get('anaxa').energy).toBeCloseTo(33, 9)
  })

  it('Roaming Signifier: at the start of his turn +30 energy when no enemy is in Disclosure, none when one is (and none under "all")', () => {
    const off = setup({ weaknesses: ['Ice'], enemies: 3 })
    off.battle.party.setEnergy('anaxa', 0)
    off.startTurn('anaxa')
    expect(off.battle.party.get('anaxa').energy).toBeCloseTo(30, 9)
    const all = setup({ enemies: 3 })
    all.battle.party.setEnergy('anaxa', 0)
    all.startTurn('anaxa')
    expect(all.battle.party.get('anaxa').energy).toBe(0)
    // Another unit's turn does nothing.
    const other = setup({ weaknesses: ['Ice'], members: [anaxaMember(), allyMember('a')] })
    other.battle.party.setEnergy('anaxa', 0)
    other.startTurn('a')
    expect(other.battle.party.get('anaxa').energy).toBe(0)
  })

  it('Roaming Signifier with a fractional Disclosure: 30 x the chance that no enemy is in it', () => {
    const { battle, act, startTurn } = setup({ enemies: 3, weaknesses: ['Ice', 'Fire', 'Lightning'] })
    act.skill!.use()
    // After the Skill and its extra Skill the chance per enemy is 1 - the chance of fewer than the Types needed; read it from the kit.
    battle.party.setEnergy('anaxa', 0)
    const chance = battle.member('anaxa').instance.quantities!.disclosure!() as number
    expect(chance).toBeGreaterThan(5 / 9)
    startTurn('anaxa')
    // All three enemies share one chance (the kit treats them as independent).
    expect(battle.party.get('anaxa').energy).toBeCloseTo(30 * (1 - chance) ** 3, 9)
  })

  it('Imperative Hiatus: the kernel is told to apply it; the kit counts the Erudition characters by path', () => {
    const solo = setup({ members: [anaxaMember(), allyMember('a', 'Hunt')] })
    expect(solo.q('erudition_members')).toBe(1)
    const duo = setup({ members: [anaxaMember(), allyMember('a', 'Erudition')] })
    expect(duo.q('erudition_members')).toBe(2)
    duo.act.skill!.use()
    expect(duo.anaxaRequests()[0]!.attacker.characterConditionals!.eruditionTeammateBuffs).toBe(true)
    duo.battle.member('a').instance.actions.basic!.use()
    const teammate = duo.requests.find((r) => r.attacker.characterId === 'ally')!.teammates.find((t) => t.characterId === '1405')!
    expect(teammate.characterConditionals).toMatchObject({ eruditionTeammateBuffs: true })
  })

  it('Qualitative Shift: the kernel gets the enemy\'s expected Type count for the 4% a Type DEF ignore', () => {
    const { act, anaxaRequests } = setup({ enemies: 3, weaknesses: ['Ice'] })
    act.skill!.use()
    const counts = anaxaRequests().map((r) => r.attacker.characterConditionals!.enemyWeaknessTypes as number)
    // Designated hit: 1 Type. The covering call: 1 (they are not touched before). The free instances see 1 + 1 (+ a third at 1/3).
    expect(counts[0]).toBe(1)
    expect(counts.some((c) => c > 1 && c < 3)).toBe(true)
  })
})

describe('Technique', () => {
  it('on, with a list without Wind: every enemy gets a Wind implant, 1 more Type for 3 turns; off or with Wind weak: nothing', () => {
    const on = setup({ enemies: 3, weaknesses: ['Ice'], techniques: true })
    on.start()
    for (const id of ids(3)) expect(on.types(id)).toBe(2)
    const off = setup({ enemies: 3, weaknesses: ['Ice'], techniques: false })
    off.start()
    for (const id of ids(3)) expect(off.types(id)).toBe(1)
    const wind = setup({ enemies: 3, weaknesses: ['Ice', 'Wind'], techniques: true })
    wind.start()
    for (const id of ids(3)) expect(wind.types(id)).toBe(2)
    const all = setup({ enemies: 3, techniques: true })
    all.start()
    for (const id of ids(3)) expect(all.types(id)).toBe(7)
  })

  it('it lasts 3 of the enemy\'s turns', () => {
    const { types, start, endTurn } = setup({ enemies: 1, weaknesses: ['Ice'], techniques: true })
    start()
    endTurn('enemy1')
    endTurn('enemy1')
    expect(types()).toBe(2)
    endTurn('enemy1')
    expect(types()).toBe(1)
  })
})

describe('Eidolons', () => {
  it('E1: after the first Skill +1 Skill Point (once); Skill hits lower DEF 16% for 2 turns, a debuff, for him and the team', () => {
    const { battle, act, anaxaRequests, requests, endTurn } = setup({ eidolon: 1, enemies: 3, weaknesses: ['Ice'], members: [anaxaMember(1), allyMember('a')] })
    act.skill!.use()
    // 3 - 1 + 1.
    expect(battle.skillPoints).toBe(3)
    act.skill!.use()
    expect(battle.skillPoints).toBe(2)
    for (const id of ids(3)) {
      const marker = battle.timeline.modifiers.get(id, 'anaxa.e1_def_down')!
      expect(marker.debuff).toBe(true)
      expect(marker.chance).toBe(1)
      expect(marker.turnsLeft).toBe(2)
    }
    // The next requests see the debuff: his own and a teammate's.
    battle.member('a').instance.actions.basic!.use()
    const ally = requests.filter((r) => r.attacker.characterId === 'ally').at(-1)!
    expect(ally.teammates.find((t) => t.characterId === '1405')!.characterConditionals).toMatchObject({ e1DefPen: true })
    expect(anaxaRequests()[0]!.attacker.characterConditionals!.e1DefPen).toBe(false) // the very first hit, before any debuff
    endTurn('enemy1')
    endTurn('enemy1')
    expect(battle.timeline.modifiers.has('enemy1', 'anaxa.e1_def_down')).toBe(false)
    expect(battle.timeline.modifiers.has('enemy2', 'anaxa.e1_def_down')).toBe(true)
  })

  it('E1: the DEF debuff builds hit by hit: with 1 enemy the instances after the first are priced with it', () => {
    const { act, anaxaRequests } = setup({ eidolon: 1, enemies: 1, weaknesses: ['Ice'] })
    act.skill!.use()
    const flags = anaxaRequests().slice(0, 5).map((r) => r.attacker.characterConditionals!.e1DefPen)
    expect(flags).toEqual([false, true, true, true, true])
  })

  it('E1: a hit at a chance is a debuff at that chance (7 enemies: 4/6 on those the added instances may miss)', () => {
    const { act, battle } = setup({ eidolon: 1, enemies: 7, weaknesses: ['Ice'] })
    act.skill!.use()
    expect(battle.timeline.modifiers.get('enemy4', 'anaxa.e1_def_down')!.chance).toBe(1)
    expect(battle.timeline.modifiers.get('enemy1', 'anaxa.e1_def_down')!.chance).toBeCloseTo(4 / 6, 12)
  })

  it('E1: without it nothing of the kind', () => {
    const { act, battle, anaxaRequests } = setup({ eidolon: 0, enemies: 3, weaknesses: ['Ice'] })
    act.skill!.use()
    expect(battle.timeline.modifiers.has('enemy1', 'anaxa.e1_def_down')).toBe(false)
    expect(battle.skillPoints).toBe(2)
    expect(anaxaRequests()[0]!.attacker.characterConditionals!.e1DefPen).toBe(false)
  })

  it('E1: when the first Skill is an extra Skill cast at a chance, the Skill Point comes at that chance, and the rest later', () => {
    // 3 enemies, 3 Types: a Basic ATK implants 1 on the target (4 Types), no Disclosure; the first Skill ... use a setup where the
    // extra Skill fires from a Basic ATK with certainty: 1 enemy, 4 Types.
    const { battle, act } = setup({ eidolon: 1, enemies: 1, weaknesses: ['Ice', 'Fire', 'Lightning', 'Quantum'] })
    act.basic!.use() // +1 Skill Point, then the Basic's implant (5 Types) triggers the extra Skill, which is the first Skill: +1
    expect(battle.skillPoints).toBe(3 + 1 + 1)
    act.skill!.use() // -1, and the first-Skill point is spent already
    expect(battle.skillPoints).toBe(4)
  })

  it('E2: enemies get one implant and All-Type RES -20% (a debuff) at the start of battle; E1 alone does not', () => {
    const e2 = setup({ eidolon: 2, enemies: 3, weaknesses: ['Ice'], members: [anaxaMember(2), allyMember('a')] })
    e2.start()
    for (const id of ids(3)) {
      expect(e2.types(id)).toBe(2)
      expect(e2.battle.timeline.modifiers.get(id, 'anaxa.e2_res_down')!.debuff).toBe(true)
    }
    e2.battle.member('a').instance.actions.basic!.use()
    const ally = e2.requests.find((r) => r.attacker.characterId === 'ally')!
    expect(ally.teammates.find((t) => t.characterId === '1405')!.characterConditionals).toMatchObject({ e2ResPen: true })
    e2.act.basic!.use()
    expect(e2.anaxaRequests()[0]!.attacker.characterConditionals!.e2ResPen).toBe(true)
    const e1 = setup({ eidolon: 1, enemies: 3, weaknesses: ['Ice'] })
    e1.start()
    expect(e1.types('enemy1')).toBe(1)
    expect(e1.battle.timeline.modifiers.has('enemy1', 'anaxa.e2_res_down')).toBe(false)
  })

  it('E2 with the Technique: the Wind implant adds a Type only when E2\'s random implant did not take Wind (5/6 with 1 Type known)', () => {
    const { types, start } = setup({ eidolon: 2, enemies: 1, weaknesses: ['Ice'], techniques: true })
    start()
    // 1 + 1 (E2, certain) + 5/6 (the Technique's Wind, unless E2's random implant was Wind: 1 of the 6 lacking Types).
    expect(types()).toBeCloseTo(1 + 1 + 5 / 6, 12)
  })

  it('E2 under "all": nothing changes the 7 Types', () => {
    const { types, start } = setup({ eidolon: 2, enemies: 3, techniques: true })
    start()
    expect(types('enemy2')).toBe(7)
  })

  it('E3: Basic ATK 110% and Ultimate 176%; E5: Skill 77% and Disclosure 32.4%', () => {
    const e3 = setup({ eidolon: 3, enemies: 5, weaknesses: ['Ice'] })
    e3.act.basic!.use()
    expect(e3.dealt[0]!.scaling).toBeCloseTo(1.1, 12)
    const e5 = setup({ eidolon: 5, enemies: 3, weaknesses: ['Ice', 'Fire', 'Lightning'], members: [anaxaMember(5)] })
    e5.act.skill!.use()
    // The second free instance is in Disclosure at 1/3 (see the test of fractional Types): 32.4% x 1/3.
    const buff = e5.anaxaRequests().flatMap((r) => r.injectedBuffs ?? []).find((b) => b.stat === 'DMG_PERCENT')
    expect(buff!.value).toBeCloseTo(0.324 / 3, 12)
  })

  it('E4: each Skill gives ATK +30% for 2 turns, 2 stacks, and the Skill that gives it is priced with it', () => {
    const { battle, act, anaxaRequests, endTurn, q } = setup({ eidolon: 4, enemies: 5, weaknesses: ['Ice'], members: [anaxaMember(4)] })
    expect(q('e4_stacks')).toBe(0)
    act.skill!.use()
    expect(q('e4_stacks')).toBe(1)
    expect(anaxaRequests()[0]!.attacker.characterConditionals!.e4AtkBuffStacks).toBe(1)
    act.skill!.use()
    expect(q('e4_stacks')).toBe(2)
    battle.gainSkillPoints(5)
    act.skill!.use()
    expect(q('e4_stacks')).toBe(2)
    // 2 turns of his own, counted at the end of each (not the turn it was applied in, which is outside any turn here).
    endTurn('anaxa')
    expect(q('e4_stacks')).toBe(2)
    endTurn('anaxa')
    expect(q('e4_stacks')).toBe(0)
  })

  it('E4: the extra Skill, cast at a chance, adds that share of a stack (3 enemies, 3 Types: 5/9)', () => {
    const { act, q } = setup({ eidolon: 4, enemies: 3, weaknesses: ['Ice', 'Fire', 'Lightning'], members: [anaxaMember(4)] })
    act.skill!.use()
    expect(q('e4_stacks')).toBeCloseTo(1 + 5 / 9, 12)
  })

  it('E4: below E4 the kernel gets no stacks', () => {
    const { act, anaxaRequests } = setup({ eidolon: 3, enemies: 5, weaknesses: ['Ice'], members: [anaxaMember(3)] })
    act.skill!.use()
    expect(anaxaRequests()[0]!.attacker.characterConditionals!.e4AtkBuffStacks).toBe(0)
  })

  it('E6: his DMG x1.3 and both Hiatus effects are on for him and the team', () => {
    const e6 = setup({ eidolon: 6, enemies: 5, weaknesses: ['Ice'], members: [anaxaMember(6), allyMember('a')] })
    e6.act.skill!.use()
    expect(e6.anaxaRequests()[0]!.attacker.characterConditionals).toMatchObject({ e6Buffs: true })
    e6.battle.member('a').instance.actions.basic!.use()
    const ally = e6.requests.find((r) => r.attacker.characterId === 'ally')!
    expect(ally.teammates.find((t) => t.characterId === '1405')!.characterConditionals).toMatchObject({ e6Buffs: true })
    const e5 = setup({ eidolon: 5, enemies: 5, weaknesses: ['Ice'] })
    e5.act.skill!.use()
    expect(e5.anaxaRequests()[0]!.attacker.characterConditionals!.e6Buffs).toBe(false)
  })
})

describe('Cyrene: Ode to Reason (the SP and the advance are Cyrene\'s kit)', () => {
  const withOde = (o: Options = {}) => {
    const s = setup({ members: [anaxaMember(o.eidolon ?? 0), allyMember('a', 'Erudition'), cyreneStub], ...o })
    s.battle.setCyreneEffect('anaxa', true, 'cyrene')
    return s
  }

  it('the Skill has 3 more instances (8 in all): 5 enemies get 0.7 once, the 3 leftover instances land at 1/5 each', () => {
    const { act, byAction, scalingByEnemy, anaxaRequests } = withOde({ enemies: 5, weaknesses: ['Ice'] })
    act.skill!.use()
    const by = scalingByEnemy(byAction[0]!)
    // 0.7 + 3 x 0.7 / 5 = 1.12 on every enemy; the total is 8 x 0.7 = 5.6.
    for (const id of ids(5)) expect(by[id]).toBeCloseTo(1.12, 12)
    expect(sum(Object.values(by))).toBeCloseTo(5.6, 12)
    expect(anaxaRequests()[0]!.attacker.characterConditionals!.skillHits).toBe(7)
  })

  it('Skill energy is 6 per instance: 48 with the Ode (8 instances), 30 without (IN-GAME CHECK, Welt\'s settled result)', () => {
    // Read the energy when the Skill itself resolves (the Talent's extra Skill, at a chance, comes after).
    const afterFirst = (s: ReturnType<typeof setup>) => {
      let energy = NaN
      s.battle.timeline.bus.on('actionUsed', () => { if (Number.isNaN(energy)) energy = s.battle.party.get('anaxa').energy })
      s.battle.party.setEnergy('anaxa', 0)
      s.act.skill!.use()
      return energy
    }
    expect(afterFirst(withOde({ enemies: 5, weaknesses: ['Ice'] }))).toBeCloseTo(48, 9)
    expect(afterFirst(setup({ enemies: 5, weaknesses: ['Ice'] }))).toBeCloseTo(30, 9)
  })

  it('without the Ode a Skill has 5 instances again', () => {
    const { act, byAction, scalingByEnemy, battle } = withOde({ enemies: 5, weaknesses: ['Ice'] })
    battle.setCyreneEffect('anaxa', false, 'cyrene')
    act.skill!.use()
    expect(sum(Object.values(scalingByEnemy(byAction[0]!)))).toBeCloseTo(3.5, 12)
  })

  it('the first Basic ATK or Skill gives True Knowledge (also to the action that gives it), until the start of his next turn', () => {
    const { act, battle, anaxaRequests, q, startTurn } = withOde({ enemies: 5, weaknesses: ['Ice'] })
    expect(q('true_knowledge')).toBe(false)
    act.basic!.use()
    expect(q('true_knowledge')).toBe(true)
    // The Basic ATK's own request already carries the effect (IN-GAME CHECK).
    expect(anaxaRequests()[0]!.attacker.characterConditionals!.cyreneSpecialEffect).toBe(true)
    // Cyrene's kit ends the effect after his turn; True Knowledge stays until his next turn starts.
    battle.setCyreneEffect('anaxa', false, 'cyrene')
    expect(q('true_knowledge')).toBe(true)
    startTurn('anaxa')
    expect(q('true_knowledge')).toBe(false)
  })

  it('it reaches the Erudition teammates through his teammate state, and only while it holds', () => {
    const { act, battle, startTurn } = withOde({ enemies: 5, weaknesses: ['Ice'] })
    const allyHit = () => battle.member('anaxa').instance.teammateState(battle.member('a'), 'enemy1').characterConditionals!
    expect(allyHit().cyreneSpecialEffect).toBe(false)
    act.skill!.use()
    expect(allyHit().cyreneSpecialEffect).toBe(true)
    startTurn('anaxa')
    expect(allyHit().cyreneSpecialEffect).toBe(false)
  })

  it('True Knowledge is given once per Ode window: a second action in the same turn does not renew it; a new window gives it again', () => {
    const { act, battle, q, startTurn } = withOde({ enemies: 5, weaknesses: ['Ice'] })
    const t1 = { unit: 'anaxa', serial: 500, index: 1, at: 0, cycle: 1 } satisfies TurnInfo
    battle.timeline.bus.emit('turnStart', t1)
    act.basic!.use()
    const first = battle.timeline.modifiers.get('anaxa', 'anaxa.true_knowledge')
    expect(first).toBeDefined()
    act.basic!.use()
    expect(battle.timeline.modifiers.get('anaxa', 'anaxa.true_knowledge')).toBe(first)
    battle.setCyreneEffect('anaxa', false, 'cyrene')
    startTurn('anaxa')
    expect(q('true_knowledge')).toBe(false)
    act.basic!.use() // prices with the effect off: the window is seen to be closed
    battle.setCyreneEffect('anaxa', true, 'cyrene')
    act.basic!.use()
    expect(q('true_knowledge')).toBe(true)
  })

  it('the Talent\'s extra Skill in the Ode turn also has the 3 more instances (IN-GAME CHECK)', () => {
    const { act, byAction } = withOde({ enemies: 1 })
    act.basic!.use()
    // The extra Skill: 8 instances on the one enemy.
    expect(sum(byAction[1]!.map((d) => d.scaling))).toBeCloseTo(8 * 0.7, 12)
  })
})

describe('Anaxa: other facts', () => {
  it('Basic ATK: +1 Skill Point, 100% on the primary target, toughness 30', () => {
    const { battle, act, dealt } = setup({ enemies: 3, weaknesses: ['Wind'] })
    act.basic!.use()
    expect(battle.skillPoints).toBe(4)
    expect(dealt[0]!.enemy).toBe('enemy2')
    expect(dealt[0]!.scaling).toBe(1)
    expect(battle.enemies.toughness('enemy2')).toBe(profile.toughness - 30)
  })

  it('he is Erudition, Wind, 140 energy, written for the original kit only', () => {
    expect(Anaxa.path).toBe('Erudition')
    expect(Anaxa.element).toBe('Wind')
    expect(Anaxa.maxEnergy).toBe(140)
    expect(Anaxa.abilityVersions).toEqual([0])
  })

  it('Disclosure is off while he is downed: no bonus, no extra Skill', () => {
    const { battle, q } = setup({ enemies: 1, members: [anaxaMember(), allyMember('a')] })
    expect(q('disclosure')).toBe(1)
    battle.party.takeDamage('anaxa', 10_000_000, 'enemy1')
    expect(battle.party.get('anaxa').downed).toBe(true)
    expect(q('disclosure')).toBe(0)
  })
})
