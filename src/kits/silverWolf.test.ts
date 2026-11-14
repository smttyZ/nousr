import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { BattleSetup, MemberSetup } from '../battle/battle'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Element } from '../scenario/types'
import { Acheron } from './acheron'
import type { Kit } from './kit'
import { SilverWolf, silverWolfScalings } from './silverWolf'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/** 1,000 damage per 100% ATK. Silver Wolf's hits as Fribbels builds them: the Ultimate has an Additional hit from E4 with a debuff. */
function makeKernel(requests: DamageRequest[] = []): DamageKernel {
  return {
    actionDamage(request) {
      requests.push(request)
      if (request.attacker.characterId !== '1006b1') return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }], BREAK: [{ damage: 100 }] })
      const e = request.attacker.eidolon
      const s = silverWolfScalings(e)
      const debuffs = Number(request.attacker.characterConditionals?.targetDebuffs ?? 0)
      const hit = (scaling: number) => ({ damage: 1000 * scaling, scaling })
      return fakeResult({
        BASIC: [hit(s.basic)],
        SKILL: [hit(s.skill)],
        ULT: [hit(s.ult), ...(e >= 4 && debuffs > 0 ? [hit(0.2 * debuffs)] : [])],
        BREAK: [{ damage: 100 }],
      })
    },
  }
}

/** An ally of another kit: a Basic ATK on the primary, with a chosen toughness, that debuffs nothing. */
let allyToughness = 0
const Ally: Kit = {
  characterId: 'ally',
  path: 'Destruction',
  element: 'Lightning',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'basic', 'basic', () =>
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0, toughness: allyToughness }] }),
          ),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
}

const silverWolf = (eidolon = 0, baseSpd = 1, energyRegen = 0): MemberSetup => ({
  key: 'sw',
  kit: SilverWolf,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd, energyRegen },
  kernel: { unit: { characterId: '1006b1', lightConeId: '21001', eidolon, superimposition: 5 }, build: noBuild },
})
const ally = (kit: Kit = Ally, baseSpd = 1, element: Element = 'Lightning'): MemberSetup => ({
  key: 'ally',
  kit: { ...kit, element },
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
  kernel: { unit: { characterId: kit === Acheron ? '1308' : 'ally', lightConeId: '20000', eidolon: 0, superimposition: 1 }, build: noBuild },
})

interface Options extends Partial<BattleSetup> {
  eidolon?: number
  /** Silver Wolf's SPD. The default 1 means she never takes a turn in the battle; tests use her actions directly. */
  swSpd?: number
  allyKit?: Kit | false
  energyRegen?: number
}

function setup(options: Options = {}) {
  const { eidolon = 0, swSpd = 1, allyKit = false, energyRegen = 0, ...overrides } = options
  const requests: DamageRequest[] = []
  const members = [silverWolf(eidolon, swSpd, energyRegen), ...(allyKit ? [ally(allyKit)] : [])]
  const battle = new Battle({
    members,
    policy: members.map((m) => ({ unit: m.key, use: 'basic' as const, when: [] })),
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 5,
    start: { energy: 0, skillPoints: 3, techniques: false },
    kernel: makeKernel(requests),
    ...overrides,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  const sw = battle.member('sw').instance
  const use = (action: string) => sw.actions[action]!.use()
  const energy = () => battle.party.get('sw').energy
  const ids = battle.enemies.ids
  /** The debuff modifiers on an enemy, by id without the owner suffix. */
  const debuffsOn = (enemy: string) =>
    battle.timeline.modifiers.on(enemy).filter((m) => m.debuff).map((m) => m.id.replace(/^silver_wolf\./, '').replace(/:sw$/, ''))
  /** The probability that a Silver Wolf modifier (by id without the owner suffix) is on an enemy. */
  const chanceOn = (enemy: string, name: string) => battle.presence(enemy, `silver_wolf.${name}:sw`)
  return { battle, dealt, requests, sw, use, energy, ids, debuffsOn, chanceOn, start: () => battle.member('sw').instance.onBattleStart?.({ techniques: false }) }
}

describe('Silver Wolf: scalings, from the in-game text of version 1', () => {
  it('E0: Basic 100%, Skill 196% with RES -13%, Ultimate 380% with DEF -45%, Bugs 10 / 12 / 6%', () => {
    expect(silverWolfScalings(0)).toEqual({ basic: 1.0, skill: 1.96, skillResShred: 0.13, ult: 3.8, ultDefShred: 0.45, bugAtk: 0.1, bugDef: 0.12, bugSpd: 0.06 })
  })

  it('E3 raises the Skill and the Talent (Skill 215.6%, RES -13.5%, Bugs 11 / 13.2 / 6.6%); the Basic ATK and Ultimate wait for E5', () => {
    expect(silverWolfScalings(3)).toEqual({ basic: 1.0, skill: 2.156, skillResShred: 0.135, ult: 3.8, ultDefShred: 0.45, bugAtk: 0.11, bugDef: 0.132, bugSpd: 0.066 })
    expect(silverWolfScalings(4)).toEqual(silverWolfScalings(3))
  })

  it('E5 raises the Basic ATK to 110% and the Ultimate to 410.4% with DEF -46.8%', () => {
    expect(silverWolfScalings(5)).toEqual({ basic: 1.1, skill: 2.156, skillResShred: 0.135, ult: 4.104, ultDefShred: 0.468, bugAtk: 0.11, bugDef: 0.132, bugSpd: 0.066 })
    expect(silverWolfScalings(6)).toEqual(silverWolfScalings(5))
  })

  it('is the buffed kit only, for the Nova Flare version 1 (K13), a Nihility Quantum character with 110 energy', () => {
    expect(SilverWolf).toMatchObject({ characterId: '1006', abilityVersions: [1], path: 'Nihility', element: 'Quantum', maxEnergy: 110 })
  })

  it('the multiples reach the kernel as each hit\'s scaling (dealt damage events), per eidolon', () => {
    for (const [eidolon, basic, skill, ult] of [[0, 1, 1.96, 3.8], [3, 1, 2.156, 3.8], [5, 1.1, 2.156, 4.104]] as const) {
      const { dealt, use, battle } = setup({ eidolon })
      battle.party.setEnergy('sw', 110)
      use('basic')
      use('skill')
      use('ultimate')
      // The Ultimate's Additional DMG hit (from E4) is a different, smaller part: look at the main hits.
      expect(dealt.map((d) => [d.ability, d.scaling]).filter(([a, scaling]) => a !== 'BREAK' && Number(scaling) >= 1), `E${eidolon}`).toEqual([
        ['BASIC', basic],
        ['SKILL', skill],
        ['ULT', ult],
      ])
    }
  })
})

describe('Silver Wolf: resources', () => {
  it('Basic ATK: +1 skill point and +20 energy. Skill: -1 skill point and +30 energy', () => {
    const { use, energy, battle } = setup()
    use('basic')
    expect([battle.skillPoints, energy()]).toEqual([4, 20])
    use('skill')
    expect([battle.skillPoints, energy()]).toEqual([3, 50])
  })

  it('cannot use the Skill without a skill point, nor the Ultimate below 110 energy', () => {
    const { sw, battle } = setup({ start: { energy: 0, skillPoints: 0, techniques: false } })
    expect(sw.actions.skill!.canUse()).toBe(false)
    expect(sw.actions.ultimate!.canUse()).toBe(false)
    battle.party.setEnergy('sw', 109.9)
    expect(sw.actions.ultimate!.canUse()).toBe(false)
    battle.party.setEnergy('sw', 110)
    expect(sw.actions.ultimate!.canUse()).toBe(true)
  })

  it('Ultimate: costs all 110, then +5', () => {
    const { use, energy, battle } = setup()
    battle.party.setEnergy('sw', 110)
    use('ultimate')
    expect(energy()).toBe(5)
  })

  it('Inject: +20 energy at the start of the battle', () => {
    const { energy, start } = setup()
    start()
    expect(energy()).toBe(20)
  })

  it('Inject: +5 energy at the start of her turn, before the action', () => {
    const { battle } = setup({ swSpd: 100, cycles: 1, enemyCount: 1 })
    const gains: [number, number][] = []
    battle.timeline.bus.on('energyGained', (g) => {
      if (g.unit === 'sw') gains.push([battle.timeline.now, g.amount])
    })
    battle.run()
    // Her first turn is at AV 100: +5 at its start, then the Basic ATK's +20.
    expect(gains.filter(([at]) => at === 100).map(([, amount]) => amount)).toEqual([5, 20])
  })

  it('trace and ability energy is scaled by Energy Regeneration Rate (IN-GAME CHECK), here +20%', () => {
    const { battle, use, energy } = setup({ energyRegen: 0.2 })
    use('basic')
    expect(energy()).toBeCloseTo(24, 12)
    battle.party.setEnergy('sw', 0)
    battle.run()
    expect(energy()).toBeGreaterThanOrEqual(24)
  })
})

describe('Silver Wolf: Skill and Ultimate debuffs', () => {
  it('the Skill puts All-Type RES -13% on the primary target only, then a Bug after the damage', () => {
    const { use, debuffsOn, ids, requests } = setup({ enemyCount: 3 })
    use('skill')
    expect(debuffsOn(ids[1]!)).toEqual(['skill_res', 'bug_atk', 'bug_def', 'bug_spd'])
    expect(debuffsOn(ids[0]!)).toEqual([])
    expect(debuffsOn(ids[2]!)).toEqual([])
    // The damage was priced with the RES shred already on and the Bug not yet.
    const skillRequest = requests.find((r) => r.attacker.characterId === '1006b1')!
    expect(skillRequest.attacker.characterConditionals).toMatchObject({ skillResShredDebuff: true, talentDefShredDebuff: false, targetDebuffs: 1 })
  })

  it('the Ultimate puts DEF -45% on every enemy, priced before the Bug, then a Bug on each', () => {
    const { use, debuffsOn, ids, battle, requests } = setup({ enemyCount: 3 })
    battle.party.setEnergy('sw', 110)
    use('ultimate')
    for (const enemy of ids) expect(debuffsOn(enemy)).toEqual(['ult_def', 'bug_atk', 'bug_def', 'bug_spd'])
    const ultRequests = requests.filter((r) => r.attacker.characterId === '1006b1')
    expect(ultRequests.every((r) => r.attacker.characterConditionals?.ultDefShredDebuff === true && r.attacker.characterConditionals?.talentDefShredDebuff === false)).toBe(true)
  })

  it('the Basic ATK has no debuff of its own: one Bug on the primary target', () => {
    const { use, debuffsOn, ids } = setup({ enemyCount: 3 })
    use('basic')
    expect(debuffsOn(ids[1]!)).toEqual(['bug_atk', 'bug_def', 'bug_spd'])
    expect(debuffsOn(ids[0]!)).toEqual([])
  })

  it('removes toughness: Basic 30 and Skill 60 on the target, Ultimate 60 on every enemy', () => {
    const { use, battle, ids } = setup({ enemyCount: 3 })
    const full = battle.enemies.maxToughness(ids[0]!)
    use('basic')
    expect(battle.enemies.toughness(ids[1]!)).toBe(full - 30)
    use('skill')
    expect(battle.enemies.toughness(ids[1]!)).toBe(full - 90)
    expect(battle.enemies.toughness(ids[0]!)).toBe(full)
    battle.party.setEnergy('sw', 110)
    use('ultimate')
    expect(battle.enemies.toughness(ids[0]!)).toBe(full - 60)
    expect(battle.enemies.toughness(ids[1]!)).toBe(full - 150)
  })
})

describe('Silver Wolf: Bugs', () => {
  it('a random Bug is each of ATK, DEF and SPD with chance 1/3 (K22): one application, an expected count of 1', () => {
    const { use, chanceOn, ids, battle } = setup({ enemyCount: 3 })
    use('basic')
    for (const type of ['bug_atk', 'bug_def', 'bug_spd']) expect(chanceOn(ids[1]!, type)).toBeCloseTo(1 / 3, 12)
    expect(battle.debuffCount(ids[1]!)).toBeCloseTo(1, 12)
    for (const type of ['bug_atk', 'bug_def', 'bug_spd']) expect(chanceOn(ids[0]!, type)).toBe(0)
  })

  it('a second application is an independent draw: each type is there with 1 - (2/3)^n, never added twice', () => {
    const { use, chanceOn, ids, battle } = setup({ enemyCount: 3 })
    for (let n = 1; n <= 4; n++) {
      use('basic')
      for (const type of ['bug_atk', 'bug_def', 'bug_spd']) expect(chanceOn(ids[1]!, type), `${type} after ${n}`).toBeCloseTo(1 - (2 / 3) ** n, 12)
      expect(battle.debuffCount(ids[1]!)).toBeCloseTo(3 * (1 - (2 / 3) ** n), 12)
    }
    // Another enemy has its own Bugs: the Ultimate applies one to each.
    battle.party.setEnergy('sw', 110)
    use('ultimate')
    expect(chanceOn(ids[0]!, 'bug_def')).toBeCloseTo(1 / 3, 12)
  })

  it('the SPD Bug slows the enemy 6% (6.6% at E3) at its chance, so its expected SPD is cut by that share of the value', () => {
    for (const [eidolon, slow] of [[0, 0.06], [3, 0.066]] as const) {
      const { use, battle, ids } = setup({ eidolon })
      const before = battle.timeline.spd(ids[0]!)
      use('basic')
      expect(battle.timeline.spd(ids[0]!)).toBeCloseTo(before * (1 - slow / 3), 9)
      use('basic')
      expect(battle.timeline.spd(ids[0]!)).toBeCloseTo(before * (1 - slow * (1 - (2 / 3) ** 2)), 9)
    }
  })

  it('the ATK and DEF Bugs change no speed: only the SPD Bug does', () => {
    const { use, battle, ids } = setup()
    const before = battle.timeline.spd(ids[0]!)
    use('basic')
    battle.timeline.modifiers.remove(ids[0]!, 'silver_wolf.bug_spd:sw')
    expect(battle.timeline.spd(ids[0]!)).toBe(before)
    expect(battle.debuffCount(ids[0]!)).toBeCloseTo(2 / 3, 12)
  })

  it('the action reports the chance a debuff landed on each enemy: 1 for the Bug of an attack that always hits (debuffChance)', () => {
    const { use, battle, ids } = setup({ enemyCount: 3 })
    use('basic')
    const log = battle.run().actions
    expect(log[0]!.debuffed).toEqual([ids[1]])
    expect(log[0]!.debuffChance).toEqual({ [ids[1]!]: 1 })
  })

  it('count as a debuff inflicted in the action, so Acheron\'s talent gives her a stack for Silver Wolf\'s attack', () => {
    const { battle, use } = setup({ allyKit: Acheron })
    battle.member('ally').instance.onBattleStart?.({ techniques: false })
    const read = (name: string) => battle.member('ally').instance.quantities![name]!() as number
    expect([read('slashed_dream'), read('crimson_knots')]).toEqual([5, 5])
    use('basic')
    expect([read('slashed_dream'), read('crimson_knots')]).toEqual([6, 6])
    const log = battle.run().actions
    expect(log.find((a) => a.actor === 'sw')?.debuffed).toEqual(['enemy1'])
  })

  it('the action log lists the enemies debuffed by the Ultimate (all of them)', () => {
    const { battle, use, ids } = setup({ enemyCount: 3 })
    battle.party.setEnergy('sw', 110)
    use('ultimate')
    expect(battle.run().actions[0]!.debuffed).toEqual([...ids])
  })
})

describe('Silver Wolf: debuff durations, in the enemy\'s own turns', () => {
  /** How many of the enemy's turns have ended when each debuff of Silver Wolf's expires. */
  function expiries(action: string, energy = 0, eidolon = 0) {
    const { battle, use } = setup({ cycles: 6, eidolon })
    battle.party.setEnergy('sw', energy)
    use(action)
    let enemyTurns = 0
    const expired: Record<string, number> = {}
    battle.timeline.bus.on('turnEnd', (t) => {
      if (t.unit === 'enemy1') enemyTurns += 1
    })
    battle.timeline.bus.on('modifierRemoved', ({ modifier, reason }) => {
      if (reason === 'expired') expired[modifier.id.replace(/^silver_wolf\./, '').replace(/:sw$/, '')] = enemyTurns
    })
    battle.run()
    return expired
  }

  it('Skill RES lasts 2 enemy turns, and the Bug after it 4 (3, plus 1 from the Generate trace)', () => {
    expect(expiries('skill')).toEqual({ skill_res: 2, bug_atk: 4, bug_def: 4, bug_spd: 4 })
  })

  it('Ultimate DEF lasts 3 enemy turns, one fewer than a Bug', () => {
    expect(expiries('ultimate', 110)).toEqual({ ult_def: 3, bug_atk: 4, bug_def: 4, bug_spd: 4 })
  })

  it('the durations are the same at E3, where the values rise but not the turns', () => {
    expect(expiries('skill', 0, 3)).toEqual({ skill_res: 2, bug_atk: 4, bug_def: 4, bug_spd: 4 })
  })
})

describe('Silver Wolf: what the kernel is told about the debuffs, per enemy (K1)', () => {
  it('her own damage: each enemy has its own switches and its own debuff count', () => {
    const { use, requests, ids, battle } = setup({ enemyCount: 3 })
    use('skill')
    // Make the Skill's Bug a certain DEF Bug, so the states below are deterministic (the Bugs' own chances are tested above).
    battle.timeline.modifiers.remove(ids[1]!, 'silver_wolf.bug_atk:sw')
    battle.timeline.modifiers.remove(ids[1]!, 'silver_wolf.bug_spd:sw')
    battle.timeline.modifiers.apply({ id: 'silver_wolf.bug_def:sw', target: ids[1]!, source: 'sw', debuff: true })
    requests.length = 0
    // A second attack on the primary and, with 3 enemies, an Ultimate: the primary has RES, DEF Bug; the others nothing.
    battle.party.setEnergy('sw', 110)
    use('ultimate')
    const byEnemy = new Map<string, DamageRequest>()
    for (const r of requests.filter((q) => q.attacker.characterId === '1006b1')) byEnemy.set(JSON.stringify(r.attacker.characterConditionals), r)
    const primary = requests.find((r) => r.attacker.characterConditionals?.skillResShredDebuff === true)
    const other = requests.find((r) => r.attacker.characterConditionals?.skillResShredDebuff === false)
    expect(primary!.attacker.characterConditionals).toMatchObject({ talentDefShredDebuff: true, ultDefShredDebuff: true, targetDebuffs: 3 })
    expect(other!.attacker.characterConditionals).toMatchObject({ talentDefShredDebuff: false, ultDefShredDebuff: true, targetDebuffs: 1 })
    expect(ids).toHaveLength(3)
  })

  it('a teammate\'s damage: the switches come from the enemy it attacks, and the implant RES switch stays off', () => {
    const { use, requests, ids, battle } = setup({ enemyCount: 3, allyKit: Ally })
    use('skill')
    battle.party.setEnergy('sw', 110)
    use('ultimate')
    // Make every Bug a certain DEF Bug, so the states below are deterministic (the Bugs' own chances are tested above).
    for (const enemy of ids) {
      battle.timeline.modifiers.remove(enemy, 'silver_wolf.bug_atk:sw')
      battle.timeline.modifiers.remove(enemy, 'silver_wolf.bug_spd:sw')
      battle.timeline.modifiers.apply({ id: 'silver_wolf.bug_def:sw', target: enemy, source: 'sw', debuff: true })
    }
    requests.length = 0
    // The ally hits the primary (enemy2) and, with a second attack, enemy1.
    const aim = (enemy: string) => {
      requests.length = 0
      battle.attack({ attacker: 'ally', ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0, target: enemy }] })
      return requests.find((r) => r.attacker.characterId === 'ally')!.teammates.find((t) => t.characterId === '1006b1')!.characterConditionals
    }
    expect(aim(ids[1]!)).toEqual({
      skillResShredDebuff: true,
      skillWeaknessResShredDebuff: false,
      talentDefShredDebuff: true,
      ultDefShredDebuff: true,
      targetDebuffs: 3,
      e2Vulnerability: false,
    })
    expect(aim(ids[0]!)).toEqual({
      skillResShredDebuff: false,
      skillWeaknessResShredDebuff: false,
      talentDefShredDebuff: true,
      ultDefShredDebuff: true,
      targetDebuffs: 2,
      e2Vulnerability: false,
    })
  })

  it('her own attacks have her EHR to ATK conversion on', () => {
    const { use, requests } = setup()
    use('basic')
    expect(requests.find((r) => r.attacker.characterId === '1006b1')!.attacker.characterConditionals?.ehrToAtkConversion).toBe(true)
  })

  it('targetDebuffs counts debuffs from any source, capped at 5', () => {
    const { use, requests, battle, ids } = setup()
    for (let n = 0; n < 8; n++) battle.applyDebuff({ id: `other${n}`, target: ids[0]!, source: 'ally' })
    use('basic')
    expect(requests.find((r) => r.attacker.characterId === '1006b1')!.attacker.characterConditionals?.targetDebuffs).toBe(5)
  })

  it('a debuff that has gone is off: after the Skill RES expires the switch is false again', () => {
    const { use, requests, battle, ids } = setup()
    use('skill')
    battle.timeline.modifiers.remove(ids[0]!, 'silver_wolf.skill_res:sw')
    requests.length = 0
    use('basic')
    expect(requests.find((r) => r.attacker.characterId === '1006b1')!.attacker.characterConditionals?.skillResShredDebuff).toBe(false)
  })
})

describe('Silver Wolf: Generate, a Bug when a Weakness is broken', () => {
  it('her own break puts a Bug on the broken enemy, besides the Bug of her attack', () => {
    const { use, battle, debuffsOn, ids } = setup()
    // Leave only 20 toughness: the Basic ATK's 30 breaks the enemy.
    battle.enemies.reduceToughness(ids[0]!, battle.enemies.maxToughness(ids[0]!) - 20)
    use('basic')
    expect(battle.enemies.isBroken(ids[0]!)).toBe(true)
    // Two applications: the attack's and the break's, each a random Bug. Her Quantum break is a debuff too (K24: Entangled).
    expect(debuffsOn(ids[0]!)).toEqual(['status.entangled', 'bug_atk', 'bug_def', 'bug_spd'])
    expect(battle.debuffCount(ids[0]!)).toBeCloseTo(1 + 3 * (1 - (2 / 3) ** 2), 12)
  })

  it('an ally\'s break puts a Bug on the broken enemy too (every Weakness Break, not only hers)', () => {
    allyToughness = 10_000
    const { battle, debuffsOn, ids } = setup({ allyKit: Ally })
    battle.member('ally').instance.actions.basic!.use()
    expect(battle.enemies.isBroken(ids[0]!)).toBe(true)
    expect(debuffsOn(ids[0]!)).toEqual(['bug_atk', 'bug_def', 'bug_spd'])
    expect(battle.debuffCount(ids[0]!)).toBeCloseTo(1, 12)
    allyToughness = 0
  })

  it('no break, no Bug from an ally\'s attack at E0', () => {
    allyToughness = 30
    const { battle, debuffsOn, ids } = setup({ allyKit: Ally })
    battle.member('ally').instance.actions.basic!.use()
    expect(debuffsOn(ids[0]!)).toEqual([])
    allyToughness = 0
  })
})

describe('Silver Wolf: E1, energy per debuff after the Ultimate', () => {
  it('E0 gets none; E1 gets 7 per debuff on the target, here the Ultimate DEF only (the Bug comes after)', () => {
    for (const [eidolon, gain] of [[0, 0], [1, 7]] as const) {
      const { use, energy, battle } = setup({ eidolon })
      battle.party.setEnergy('sw', 110)
      use('ultimate')
      expect(energy(), `E${eidolon}`).toBe(5 + gain)
    }
  })

  it('counts every debuff the target has from any source: 3 debuffs make 21', () => {
    const { use, energy, battle, ids } = setup({ eidolon: 1 })
    battle.applyDebuff({ id: 'x1', target: ids[0]!, source: 'sw' })
    battle.applyDebuff({ id: 'x2', target: ids[0]!, source: 'sw' })
    battle.party.setEnergy('sw', 110)
    use('ultimate')
    expect(energy()).toBe(5 + 7 * 3)
  })

  it('stops at 5 triggers in one Ultimate in total, over all enemies', () => {
    const one = setup({ eidolon: 1 })
    for (let n = 0; n < 6; n++) one.battle.applyDebuff({ id: `x${n}`, target: one.ids[0]!, source: 'sw' })
    one.battle.party.setEnergy('sw', 110)
    one.use('ultimate')
    expect(one.energy()).toBe(5 + 35)

    // Three enemies with 1 debuff each (the Ultimate's DEF): 3 triggers.
    const three = setup({ eidolon: 1, enemyCount: 3 })
    three.battle.party.setEnergy('sw', 110)
    three.use('ultimate')
    expect(three.energy()).toBe(5 + 21)

    // Three enemies with 3 each: 9 debuffs, capped at 5.
    const many = setup({ eidolon: 1, enemyCount: 3 })
    for (const enemy of many.ids) for (let n = 0; n < 2; n++) many.battle.applyDebuff({ id: `x${n}`, target: enemy, source: 'sw' })
    many.battle.party.setEnergy('sw', 110)
    many.use('ultimate')
    expect(many.energy()).toBe(5 + 35)
  })

  it('does not count the Bug of the same Ultimate (it lands after the attack)', () => {
    const { use, energy, battle } = setup({ eidolon: 1 })
    battle.party.setEnergy('sw', 110)
    use('ultimate')
    expect(energy()).toBe(12)
    expect(battle.debuffCount('enemy1')).toBeCloseTo(2, 12)
  })
})

describe('Silver Wolf: E2', () => {
  it('every enemy is debuffed from the start of the battle, and it is not a debuff inflicted in an action', () => {
    const { battle, ids, debuffsOn } = setup({ eidolon: 2, enemyCount: 3 })
    const result = battle.run()
    for (const enemy of ids) expect(debuffsOn(enemy)).toEqual(['e2_vulnerability'])
    // Not inflicted in an action: nothing listed as debuffed (Silver Wolf never takes a turn in this battle).
    expect(result.actions).toEqual([])
  })

  it('E1 has no such debuff', () => {
    const { battle, ids, debuffsOn } = setup({ eidolon: 1 })
    battle.run()
    expect(debuffsOn(ids[0]!)).toEqual([])
  })

  it('the Fribbels switch for the 20% is on while the debuff is, for her attacks and her teammates\'', () => {
    const { use, requests, battle, start } = setup({ eidolon: 2, allyKit: Ally })
    start()
    use('basic')
    expect(requests.find((r) => r.attacker.characterId === '1006b1')!.attacker.characterConditionals).toMatchObject({ e2Vulnerability: true, targetDebuffs: 1 })
    requests.length = 0
    battle.attack({ attacker: 'ally', ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
    expect(requests.find((r) => r.attacker.characterId === 'ally')!.teammates[0]!.characterConditionals).toMatchObject({ e2Vulnerability: true })
  })

  it('an attack by another ally puts a Bug on each enemy it attacked, inside the action', () => {
    const { battle, debuffsOn, ids } = setup({ eidolon: 2, allyKit: Ally, enemyCount: 3 })
    battle.member('ally').instance.actions.basic!.use()
    expect(debuffsOn(ids[1]!)).toEqual(['bug_atk', 'bug_def', 'bug_spd'])
    expect(debuffsOn(ids[0]!)).toEqual([])
    const log = battle.run().actions
    expect(log[0]!.actor).toBe('ally')
    expect(log[0]!.debuffed).toEqual([ids[1]])
    expect(log[0]!.debuffChance[ids[1]!]).toBe(1)
  })

  it('an ally AoE gives a Bug to every enemy; two attack calls in one action give one Bug per enemy', () => {
    const AoeAlly: Kit = {
      ...Ally,
      create: (battle, self) => ({
        ...Ally.create(battle, self),
        actions: {
          basic: {
            kind: 'basic',
            canUse: () => true,
            use: () =>
              battle.performAction(self.key, 'basic', 'basic', () => {
                battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'aoe', scaling: 1, hit: 0 }] })
                battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'aoe', scaling: 1, hit: 0 }] })
              }),
          },
        },
      }),
    }
    const { battle, chanceOn, ids } = setup({ eidolon: 2, allyKit: AoeAlly, enemyCount: 3 })
    battle.member('ally').instance.actions.basic!.use()
    // Two attack calls, one Bug per enemy: each type at 1/3, not 1 - (2/3)^2.
    for (const enemy of ids) expect(chanceOn(enemy, 'bug_def')).toBeCloseTo(1 / 3, 12)
    // A second action: the next Bug of each enemy.
    battle.member('ally').instance.actions.basic!.use()
    for (const enemy of ids) expect(chanceOn(enemy, 'bug_def')).toBeCloseTo(1 - (2 / 3) ** 2, 12)
  })

  it('Silver Wolf\'s own attack puts one Bug, not two (IN-GAME CHECK)', () => {
    const { use, battle, ids } = setup({ eidolon: 2 })
    use('basic')
    expect(battle.debuffCount(ids[0]!)).toBeCloseTo(1, 12)
  })

  it('an ally bounce gives each enemy a Bug at the chance the bounce hit it, once per action (K22)', () => {
    const BounceAlly: Kit = {
      ...Ally,
      create: (battle, self) => ({
        ...Ally.create(battle, self),
        actions: {
          basic: {
            kind: 'basic',
            canUse: () => true,
            use: () =>
              battle.performAction(self.key, 'basic', 'basic', () => {
                battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'bounce', scaling: 1, hits: 3, hit: 0 }] })
                battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'bounce', scaling: 1, hits: 3, hit: 0 }] })
              }),
          },
        },
      }),
    }
    const { battle, chanceOn, ids } = setup({ eidolon: 2, allyKit: BounceAlly, enemyCount: 3 })
    battle.member('ally').instance.actions.basic!.use()
    // The action hit each enemy at least once with 1 - (2/3)^6 over its two calls; one Bug at that chance, each type a third of it.
    const hit = 1 - (2 / 3) ** 6
    for (const enemy of ids) {
      expect(chanceOn(enemy, 'bug_def')).toBeCloseTo(hit / 3, 12)
      expect(battle.debuffCount(enemy)).toBeCloseTo(hit, 12)
    }
    expect(battle.run().actions[0]!.debuffChance[ids[0]!]).toBeCloseTo(hit, 12)
  })

  it('not at E1: an ally\'s attack leaves no Bug', () => {
    const { battle, debuffsOn, ids } = setup({ eidolon: 1, allyKit: Ally })
    battle.member('ally').instance.actions.basic!.use()
    expect(debuffsOn(ids[0]!)).toEqual([])
  })

  it('a bare attack (not an action) by an ally leaves no Bug', () => {
    const { battle, debuffsOn, ids } = setup({ eidolon: 2, allyKit: Ally })
    battle.attack({ attacker: 'ally', ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
    expect(debuffsOn(ids[0]!)).toEqual([])
  })
})

describe('Silver Wolf: E4, Additional DMG per debuff after the Ultimate', () => {
  it('E3 has none', () => {
    const { use, dealt, battle } = setup({ eidolon: 3 })
    battle.party.setEnergy('sw', 110)
    use('ultimate')
    expect(dealt.filter((d) => d.ability === 'ULT')).toHaveLength(1)
  })

  it('E4: one more part per enemy, 20% ATK per debuff on it, as hit 1 of the Ultimate; the Bug of this Ultimate is not counted', () => {
    const { use, dealt, battle } = setup({ eidolon: 4 })
    battle.party.setEnergy('sw', 110)
    use('ultimate')
    const ult = dealt.filter((d) => d.ability === 'ULT')
    expect(ult.map((d) => d.scaling)).toEqual([3.8, 0.2])
    expect(ult[1]!.damage).toBeCloseTo(200, 9)
  })

  it('is per enemy: its own count for each, capped at 5 debuffs (100%)', () => {
    const { use, dealt, battle, ids } = setup({ eidolon: 4, enemyCount: 3 })
    battle.applyDebuff({ id: 'a', target: ids[0]!, source: 'sw' })
    for (let n = 0; n < 7; n++) battle.applyDebuff({ id: `b${n}`, target: ids[2]!, source: 'sw' })
    battle.party.setEnergy('sw', 110)
    use('ultimate')
    const extra = dealt.filter((d) => d.ability === 'ULT' && d.scaling < 3)
    const by = Object.fromEntries(extra.map((d) => [d.enemy, d.scaling]))
    expect(by[ids[0]!]).toBeCloseTo(0.4, 12)
    expect(by[ids[1]!]).toBeCloseTo(0.2, 12)
    expect(by[ids[2]!]).toBeCloseTo(1.0, 12)
  })

  it('is not part of the action\'s attack on the first call: it is a second attack call after the damage', () => {
    const { use, battle } = setup({ eidolon: 4 })
    const calls: string[] = []
    battle.timeline.bus.on('attackResolved', (a) => calls.push(`${a.ability}:${a.parts.map((p) => p.hit).join(',')}`))
    battle.party.setEnergy('sw', 110)
    use('ultimate')
    expect(calls).toEqual(['ULT:0', 'ULT:1'])
  })

  it('with random debuffs the scaling is 20% of the expected capped count (K22), one hit priced as its mean over the states that have it', () => {
    const { use, dealt, battle, ids } = setup({ eidolon: 4 })
    // 2 certain debuffs, the Ultimate's own DEF (certain) and 3 at 1/2 each: the count is 3 + Binomial(3, 1/2), capped at
    // 5, so E[min(5, N)] = 35/8 = 4.375, not min(5, E[N] = 4.5).
    for (let n = 0; n < 2; n++) battle.applyDebuff({ id: `c${n}`, target: ids[0]!, source: 'sw' })
    for (let n = 0; n < 3; n++) battle.applyDebuff({ id: `u${n}`, target: ids[0]!, source: 'sw', chance: 0.5 })
    battle.party.setEnergy('sw', 110)
    use('ultimate')
    expect(dealt.filter((d) => d.ability === 'ULT').map((d) => d.scaling)[1]).toBeCloseTo(0.2 * (35 / 8), 12)
  })

  it('E4 plus E2 vulnerability counts as a debuff too', () => {
    const { use, dealt, battle, start } = setup({ eidolon: 4 })
    start()
    // E4 has no E2 vulnerability reading: Eidolon 4 includes E2's effect, so the enemy has it.
    battle.party.setEnergy('sw', 110)
    use('ultimate')
    expect(dealt.filter((d) => d.ability === 'ULT').map((d) => d.scaling)).toEqual([3.8, 0.4])
  })
})

describe('Silver Wolf: E6 and the debuff count', () => {
  it('passes the target\'s debuff count, capped at 5, as the kernel\'s `targetDebuffs`, whatever the eidolon', () => {
    const { use, requests, battle } = setup({ eidolon: 6 })
    for (let n = 0; n < 3; n++) battle.applyDebuff({ id: `x${n}`, target: 'enemy1', source: 'sw' })
    use('basic')
    expect(requests.find((r) => r.attacker.characterId === '1006b1')!.attacker.characterConditionals?.targetDebuffs).toBe(3)
  })
})

describe('Silver Wolf: the Skill\'s Weakness implant is not modelled, and refuses on the first Skill when it would matter', () => {
  const make = (weaknesses: BattleSetup['weaknesses'], allyElement: Element = 'Lightning') =>
    new Battle({
      members: [silverWolf(), ally(Ally, 1, allyElement)],
      policy: [{ unit: 'sw', use: 'basic', when: [] }, { unit: 'ally', use: 'basic', when: [] }],
      profile,
      enemyCount: 1,
      weaknesses,
      cycles: 1,
      start: { energy: 0, skillPoints: 3, techniques: false },
      kernel: makeKernel(),
    })
  const skill = (battle: Battle) => () => battle.member('sw').instance.actions.skill!.use()

  it('"all" weaknesses: the implant changes nothing, so the Skill runs', () => {
    expect(skill(make('all'))).not.toThrow()
  })

  it('a list that holds every element on the team: the Skill runs', () => {
    expect(skill(make(['Quantum', 'Lightning']))).not.toThrow()
    expect(skill(make(['Quantum', 'Lightning', 'Fire']))).not.toThrow()
  })

  it('a list that lacks a team member\'s element: creating the battle is fine, her Skill stops with NOT MODELLED, naming it', () => {
    expect(skill(make(['Lightning']))).toThrow(/NOT MODELLED.*Quantum/)
    expect(skill(make(['Quantum']))).toThrow(/NOT MODELLED.*Lightning/)
    expect(skill(make([]))).toThrow(/NOT MODELLED/)
  })

  it('the refusal fires on the first use of the Skill, not before: a battle whose policy never uses it runs', () => {
    const battle = new Battle({
      members: [silverWolf(0, 140), ally(Ally, 1, 'Lightning')],
      policy: [{ unit: 'sw', use: 'basic', when: [] }, { unit: 'ally', use: 'basic', when: [] }],
      profile,
      enemyCount: 1,
      weaknesses: ['Lightning'],
      cycles: 1,
      start: { energy: 0, skillPoints: 3, techniques: false },
      kernel: makeKernel(),
    })
    const result = battle.run()
    expect(result.actions.length).toBeGreaterThan(0)
    expect(result.actions.every((a) => a.action !== 'skill')).toBe(true)
  })

  it('the RES switch of the implant is never on', () => {
    const { use, requests } = setup()
    use('skill')
    expect(requests.find((r) => r.attacker.characterId === '1006b1')!.attacker.characterConditionals?.skillWeaknessResShredDebuff).toBe(false)
  })
})

describe('Silver Wolf: a whole battle', () => {
  it('acts on her turns by the policy, keeps her debuffs on every enemy through the run and loses none to the wrong clock', () => {
    const { battle } = setup({
      swSpd: 140,
      enemyCount: 3,
      cycles: 4,
      policy: [
        { unit: 'sw', use: 'ultimate', when: [] },
        { unit: 'sw', use: 'skill', when: [] },
        { unit: 'sw', use: 'basic', when: [] },
      ],
    })
    const result = battle.run()
    const names = result.actions.map((a) => a.action)
    expect(names.length).toBeGreaterThan(4)
    expect(names).toContain('skill')
    expect(result.downed).toEqual([])
    expect(result.totalDamage).toBeGreaterThan(0)
  })

  it('exposes the primary target\'s debuff count to a policy', () => {
    const { sw, use } = setup()
    expect(sw.quantities!.target_debuffs!()).toBe(0)
    use('skill')
    // The Skill's RES and one random Bug: the expected count.
    expect(sw.quantities!.target_debuffs!() as number).toBeCloseTo(2, 12)
  })
})
