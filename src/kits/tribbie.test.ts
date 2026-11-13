import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { BattleSetup, MemberSetup } from '../battle/battle'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, HitResult } from '../kernel/types'
import type { Rule } from '../scenario/types'
import type { Kit } from './kit'
import { Tribbie } from './tribbie'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/**
 * Damage per 100% of a hit's multiple, different for each kind of hit so that a part priced from the wrong
 * hit shows up as the wrong number: the ability's own hit, the Zone's Additional DMG hit built into her
 * Basic ATK, Ultimate and follow-up, and Fribbels' separate UNIQUE hit for an ally-triggered instance.
 */
const RATE = { main: 1000, additional: 400, unique: 250 }

/**
 * Tribbie's multiples written out from the in-game text, by eidolon, with no import from the kit: Basic ATK,
 * Ultimate and Talent follow-up (E3 and E5 raise them) and one Zone Additional DMG instance, which at E2
 * becomes two instances of 120% (E3 raises the base to 13.2%).
 */
function textNumbers(eidolon: number) {
  const base = eidolon >= 3 ? 0.132 : 0.12
  return {
    basic: eidolon >= 3 ? 0.33 : 0.3,
    ult: eidolon >= 3 ? 0.33 : 0.3,
    fua: eidolon >= 5 ? 0.198 : 0.18,
    additional: eidolon >= 2 ? base * 1.2 * 2 : base,
  }
}

/**
 * A stand-in for Fribbels that follows how its Tribbie is built: BASIC, ULT and FUA are the ability's hit
 * plus, while the Zone is up, a second hit for the Zone's Additional DMG; UNIQUE is a single Additional DMG
 * hit while the Zone is up. Every request is kept, so a test can read what the kit told the kernel.
 */
function fakeKernel() {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = {
    actionDamage(request) {
      requests.push(request)
      const hit = (scaling: number, rate: number): HitResult => ({ damage: rate * scaling, scaling })
      if (request.attacker.characterId !== '1403') {
        return fakeResult({ BASIC: [hit(1, 1000)], ULT: [hit(1, 1000)] })
      }
      const n = textNumbers(request.attacker.eidolon)
      const zone = request.attacker.characterConditionals?.ultZone === true
      const extra = zone ? [hit(n.additional, RATE.additional)] : []
      return fakeResult({
        BASIC: [hit(n.basic, RATE.main), ...extra],
        ULT: [hit(n.ult, RATE.main), ...extra],
        FUA: [hit(n.fua, RATE.main), ...extra],
        UNIQUE: zone ? [hit(n.additional, RATE.unique)] : [],
      })
    },
  }
  return { kernel, requests }
}

type Step = { shape: 'single', target?: string, scaling?: number } | { shape: 'aoe' } | { shape: 'none' }

/**
 * A made-up ally. Each Basic ATK it uses takes the next step of `script` (a single-target hit on the primary
 * target after the script runs out). Its Ultimate is usable while `allowance.n` is above 0 and hits one enemy.
 */
const ally = (allowance: { n: number }, script: Step[] = []): Kit => ({
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
            const step: Step = script.shift() ?? { shape: 'single' }
            if (step.shape === 'none') return
            battle.attack({
              attacker: self.key,
              ability: 'BASIC',
              parts: [
                step.shape === 'aoe'
                  ? { shape: 'aoe', scaling: 1, hit: 0 }
                  : { shape: 'single', scaling: step.scaling ?? 1, hit: 0, ...(step.target && { target: step.target }) },
              ],
            })
          }),
      },
      ultimate: {
        kind: 'ultimate',
        canUse: () => allowance.n > 0,
        use: () =>
          battle.performAction(self.key, 'ultimate', 'ultimate', () => {
            allowance.n -= 1
            battle.attack({ attacker: self.key, ability: 'ULT', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
          }),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
})

const noAllowance = { n: 0 }

const tribbie = (eidolon = 0, energyRegen = 0, baseSpd = 100): MemberSetup => ({
  key: 'tribbie',
  kit: Tribbie,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd, energyRegen },
  kernel: { unit: { characterId: '1403', lightConeId: 'none', eidolon, superimposition: 1 }, build: noBuild },
})

const helper = (key: string, allowance: { n: number }, script: Step[] = [], baseSpd = 160): MemberSetup => ({
  key,
  kit: ally(allowance, script),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
  kernel: { unit: { characterId: 'helper', lightConeId: 'none', eidolon: 0, superimposition: 1 }, build: noBuild },
})

const rule = (unit: string, use: string, when: Rule['when'] = []): Rule => ({ unit, use, when })

function setup(overrides: Partial<BattleSetup> = {}) {
  const { kernel, requests } = fakeKernel()
  const battle = new Battle({
    members: [tribbie()],
    policy: [rule('tribbie', 'basic')],
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0, skillPoints: 0, techniques: false },
    kernel,
    ...overrides,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  const quantity = (name: string) => () => battle.member('tribbie').instance.quantities![name]!() as number | boolean
  /** What one enemy took from one of Tribbie's abilities, summed over the attack calls that made it up. */
  const took = (enemy: string, ability: string) =>
    dealt.filter((d) => d.attacker === 'tribbie' && d.enemy === enemy && d.ability === ability).reduce((sum, d) => sum + d.damage, 0)
  return { battle, dealt, quantity, took, requests }
}

/** Her Ultimate once, while the Zone is down (her energy refills from hits taken, so she would use it again). */
const ultOnce = rule('tribbie', 'ultimate', [{ what: 'tribbie.zone', is: false }])
/** Tribbie uses her Ultimate before anything else (energy full), then Basic ATKs; the helper Basic ATKs. */
const zoneThenHelper = [ultOnce, rule('tribbie', 'basic'), rule('h1', 'basic')]
const zoneThenBasic = [ultOnce, rule('tribbie', 'basic')]
const fullEnergy = { energy: 1, skillPoints: 0, techniques: false }

describe('energy and skill points', () => {
  // Energy from enemy hits and from the Pebble trace also lands in her total, so the energy each of her
  // own actions gives is measured as the change between her turn start and her action event.
  const gainPerAction = (battle: Battle) => {
    const gains: Record<string, number> = {}
    let before = 0
    battle.timeline.bus.on('turnStart', (t) => {
      if (t.unit === 'tribbie') before = battle.party.get('tribbie').energy
    })
    battle.timeline.bus.on('actionUsed', (a) => {
      if (a.actor === 'tribbie') gains[a.action] = battle.party.get('tribbie').energy - before
    })
    return gains
  }

  it('Basic ATK gives 20 energy and 1 skill point', () => {
    const { battle } = setup()
    const gains = gainPerAction(battle)
    battle.run()
    expect(gains.basic).toBeCloseTo(20, 9)
    expect(battle.skillPoints).toBe(1)
  })

  it('Skill gives 30 energy and costs 1 skill point', () => {
    const { battle } = setup({ start: { energy: 0, skillPoints: 3, techniques: false }, policy: [rule('tribbie', 'skill'), rule('tribbie', 'basic')] })
    const gains = gainPerAction(battle)
    const actions = battle.run().actions.map((a) => a.action)
    expect(actions).toEqual(['skill'])
    expect(gains.skill).toBeCloseTo(30, 9)
    expect(battle.skillPoints).toBe(2)
  })

  it('Skill needs a skill point, so with none she Basic ATKs instead', () => {
    const { battle } = setup({ start: { energy: 0, skillPoints: 0, techniques: false }, policy: [rule('tribbie', 'skill'), rule('tribbie', 'basic')] })
    expect(battle.run().actions.map((a) => a.action)).toEqual(['basic'])
  })

  it('the Ultimate is not used below 120 energy, and is used at 120 leaving 5', () => {
    // Starts at 60 plus 30 from the Pebble trace: 90, short of 120.
    const first = setup({ start: { energy: 0.5, skillPoints: 0, techniques: false }, policy: zoneThenBasic })
    expect(first.battle.run().actions[0]!.action).toBe('basic')

    const ready = setup({ start: fullEnergy, policy: zoneThenBasic })
    let atUltimate = -1
    ready.battle.timeline.bus.on('actionUsed', (a) => {
      if (a.action === 'ultimate') atUltimate = ready.battle.party.get('tribbie').energy
    })
    expect(ready.battle.run().actions[0]!.action).toBe('ultimate')
    expect(atUltimate).toBeCloseTo(5, 9)
  })

  it('Pebble at Crossroads: 30 energy at battle start, scaled by Energy Regeneration Rate', () => {
    for (const [regen, expected] of [[0, 30], [0.2, 36]] as const) {
      const { battle } = setup({ members: [tribbie(0, regen)] })
      const gains: number[] = []
      battle.timeline.bus.on('energyGained', (e) => {
        if (e.unit === 'tribbie') gains.push(e.amount)
      })
      battle.run()
      expect(gains[0], `regen ${regen}`).toBeCloseTo(expected, 9)
    }
  })

  it('Pebble at Crossroads: 1.5 energy per enemy another ally hits, scaled by Energy Regeneration Rate', () => {
    // The helper acts at AV 62.5 before her first turn, so its energy gain is the first one after the start.
    for (const [regen, step, perHit] of [[0, 'single', 1], [0.2, 'single', 1], [0.2, 'aoe', 3]] as const) {
      const { battle } = setup({
        members: [tribbie(0, regen), helper('h1', noAllowance, [{ shape: step }])],
        enemyCount: 3,
        policy: [rule('tribbie', 'basic'), rule('h1', 'basic')],
      })
      const gains: number[] = []
      battle.timeline.bus.on('energyGained', (e) => {
        if (e.unit === 'tribbie') gains.push(e.amount)
      })
      battle.run()
      expect(gains[1], `regen ${regen}, ${step}`).toBeCloseTo(1.5 * perHit * (1 + regen), 9)
    }
  })

  it('Pebble at Crossroads: an ally action that hits nothing gives no energy', () => {
    const { battle } = setup({ members: [tribbie(), helper('h1', noAllowance, [{ shape: 'none' }])], policy: [rule('tribbie', 'basic'), rule('h1', 'basic')] })
    let atStart = NaN
    let atEnd = NaN
    battle.timeline.bus.on('turnStart', (t) => {
      if (t.unit === 'h1' && Number.isNaN(atStart)) atStart = battle.party.get('tribbie').energy
    })
    battle.timeline.bus.on('turnEnd', (t) => {
      if (t.unit === 'h1' && Number.isNaN(atEnd)) atEnd = battle.party.get('tribbie').energy
    })
    battle.run()
    expect(atEnd).toBe(atStart)
  })
})

describe('Numinosity, Zone and Lamb', () => {
  it('the technique gives Numinosity for 3 turns, counted down at the start of each of her turns', () => {
    const { battle, quantity } = setup({ start: { energy: 0, skillPoints: 0, techniques: true }, cycles: 4 })
    const seen: boolean[] = []
    battle.timeline.bus.on('turnEnd', (t) => {
      if (t.unit === 'tribbie') seen.push(quantity('numinosity')() as boolean)
    })
    battle.run()
    // Her turns 1 and 2 have it, and it is gone at the start of turn 3.
    expect(seen.slice(0, 4)).toEqual([true, true, false, false])
  })

  it('the Skill gives Numinosity for 3 turns: up through the 3rd turn start after it', () => {
    const { battle, quantity } = setup({
      start: { energy: 0, skillPoints: 1, techniques: false },
      policy: [rule('tribbie', 'skill', [{ what: 'battle.cycle', max: 1 }]), rule('tribbie', 'basic')],
      cycles: 5,
    })
    const seen: boolean[] = []
    battle.timeline.bus.on('turnEnd', (t) => {
      if (t.unit === 'tribbie') seen.push(quantity('numinosity')() as boolean)
    })
    battle.run()
    expect(seen.slice(0, 5)).toEqual([true, true, true, false, false])
  })

  it('the Zone lasts 2 of her turn starts, and her Ultimate here is used in the window before her first turn', () => {
    const { battle, quantity } = setup({ start: fullEnergy, policy: [rule('tribbie', 'ultimate'), rule('tribbie', 'basic')], cycles: 4 })
    const seen: boolean[] = []
    battle.timeline.bus.on('turnEnd', (t) => {
      if (t.unit === 'tribbie') seen.push(quantity('zone')() as boolean)
    })
    battle.run()
    // Applied before turn 1, so turn 1 start takes it to 1 left and turn 2 start expires it.
    expect(seen.slice(0, 3)).toEqual([true, false, false])
  })

  it('Lamb Outside the Wall: stacks up to 3 and then holds; the kernel is told the stacks', () => {
    // E6 gives her a follow-up after her own Ultimate and each of three allies' Ultimates gives one more: 4 in all.
    const allowances = [{ n: 1 }, { n: 1 }, { n: 1 }]
    const { battle, requests } = setup({
      members: [tribbie(6), helper('h1', allowances[0]!), helper('h2', allowances[1]!), helper('h3', allowances[2]!)],
      start: fullEnergy,
      policy: [
        rule('tribbie', 'ultimate'),
        rule('h1', 'ultimate'),
        rule('h2', 'ultimate'),
        rule('h3', 'ultimate'),
        rule('tribbie', 'basic'),
        rule('h1', 'basic'),
        rule('h2', 'basic'),
        rule('h3', 'basic'),
      ],
      cycles: 1,
    })
    const stacksAfterFollowUp: number[] = []
    battle.timeline.bus.on('actionUsed', (a) => {
      if (a.action === 'talent_follow_up') stacksAfterFollowUp.push(battle.member('tribbie').instance.quantities!.lamb_stacks!() as number)
    })
    battle.run()
    expect(stacksAfterFollowUp).toEqual([1, 2, 3, 3])
    const sent = requests.filter((r) => r.attacker.characterId === '1403').map((r) => r.attacker.characterConditionals!.talentFuaStacks)
    expect(Math.max(...(sent as number[]))).toBe(3)
  })

  it('Lamb Outside the Wall: the stacks last 3 of her turns after the last follow-up, then are gone', () => {
    const { battle, quantity } = setup({
      members: [tribbie(), helper('h1', { n: 1 })],
      policy: [rule('h1', 'ultimate'), rule('tribbie', 'basic'), rule('h1', 'basic')],
      cycles: 5,
    })
    const atTurnStart: number[] = []
    battle.timeline.bus.on('turnStart', (t) => {
      if (t.unit === 'tribbie') atTurnStart.push(quantity('lamb_stacks')() as number)
    })
    battle.run()
    // The follow-up comes before her first turn. Counted down at the end of each of her turns.
    expect(atTurnStart.slice(0, 5)).toEqual([1, 1, 1, 0, 0])
  })
})

describe('Busy as Tribbie (talent)', () => {
  it('follows up once per ally Ultimate, and not twice for the same ally', () => {
    const { battle } = setup({
      members: [tribbie(), helper('h1', { n: 2 })],
      policy: [rule('h1', 'ultimate'), rule('tribbie', 'basic'), rule('h1', 'basic')],
    })
    const actions = battle.run().actions.map((x) => x.action)
    expect(actions.filter((x) => x === 'talent_follow_up')).toHaveLength(1)
  })

  it('her own Ultimate resets the trigger count, so the same ally triggers her again', () => {
    const a = { n: 1 }
    const { battle } = setup({
      members: [tribbie(), helper('h1', a)],
      start: fullEnergy,
      policy: [rule('h1', 'ultimate'), rule('tribbie', 'ultimate'), rule('tribbie', 'basic'), rule('h1', 'basic')],
    })
    // Her Ultimate gives the helper another use, so the helper goes again after her Ultimate.
    battle.timeline.bus.on('actionUsed', (x) => {
      if (x.actor === 'tribbie' && x.kind === 'ultimate') a.n += 1
    })
    const actions = battle.run().actions.map((x) => x.action)
    expect(actions.filter((x) => x === 'talent_follow_up')).toHaveLength(2)
  })

  it('without E6, her own Ultimate does not trigger the talent', () => {
    const { battle } = setup({ start: fullEnergy, policy: zoneThenBasic })
    expect(battle.run().actions.map((x) => x.action)).toEqual(['ultimate', 'basic'])
  })

  it('E6: her Ultimate is followed by a talent follow-up', () => {
    const { battle } = setup({ members: [tribbie(6)], start: fullEnergy, policy: zoneThenBasic })
    expect(battle.run().actions.map((x) => x.action).slice(0, 2)).toEqual(['ultimate', 'talent_follow_up'])
  })
})

describe('the Zone\'s Additional DMG on her own attacks', () => {
  // HP is read as the game does: the Additional DMG goes to the hit enemy with the MOST HP LEFT. Her Ultimate
  // already put its instances on the primary target, so on her next attack the primary has the least.

  it('Basic ATK, 3 enemies: 3 instances, all on the hit enemy with the most HP left, priced as the additional hit', () => {
    const { battle, took } = setup({ enemyCount: 3, start: fullEnergy, policy: zoneThenBasic })
    battle.run()
    // After her Ultimate, enemy 2 (primary) has the instances on it; enemies 1 and 3 are tied with more HP
    // left and neither is the primary, so the first in line, enemy 1, gets all 3 instances of 12%.
    expect(took('enemy2', 'BASIC')).toBeCloseTo(RATE.main * 0.3, 9)
    expect(took('enemy1', 'BASIC')).toBeCloseTo(RATE.main * 0.15 + RATE.additional * 3 * 0.12, 9)
    expect(took('enemy3', 'BASIC')).toBeCloseTo(RATE.main * 0.15, 9)
  })

  it('Basic ATK, 5 enemies: still 3 targets hit, so 3 instances, and none on the enemies it missed', () => {
    const { battle, took } = setup({ enemyCount: 5, start: fullEnergy, policy: zoneThenBasic })
    battle.run()
    expect(took('enemy2', 'BASIC')).toBeCloseTo(RATE.main * 0.15 + RATE.additional * 3 * 0.12, 9)
    expect(took('enemy3', 'BASIC')).toBeCloseTo(RATE.main * 0.3, 9)
    expect(took('enemy4', 'BASIC')).toBeCloseTo(RATE.main * 0.15, 9)
    expect(took('enemy1', 'BASIC')).toBe(0)
    expect(took('enemy5', 'BASIC')).toBe(0)
  })

  it('Basic ATK, 1 enemy: 1 instance', () => {
    const { battle, took } = setup({ enemyCount: 1, start: fullEnergy, policy: zoneThenBasic })
    battle.run()
    expect(took('enemy1', 'BASIC')).toBeCloseTo(RATE.main * 0.3 + RATE.additional * 0.12, 9)
  })

  it('Basic ATK without the Zone has no additional damage', () => {
    const { battle, took } = setup({ enemyCount: 3 })
    battle.run()
    expect(took('enemy2', 'BASIC')).toBeCloseTo(RATE.main * 0.3, 9)
  })

  it('reads HP after her main hit has landed, not before', () => {
    // 5 enemies. Her Ultimate gives enemy 3 (primary) 540 damage and the others 300. The helper then takes
    // enemies 2 and 4 to 630. Before her Basic ATK's main hit enemy 3 has the most HP left; after it (enemy 3
    // at 840, enemies 2 and 4 at 780) enemy 2 does. The extra instances go to enemy 2.
    const { battle, took } = setup({
      members: [tribbie(), helper('h1', noAllowance, [{ shape: 'single', target: 'enemy2', scaling: 0.3 }, { shape: 'single', target: 'enemy4', scaling: 0.3 }], 250)],
      enemyCount: 5,
      start: fullEnergy,
      policy: zoneThenHelper,
    })
    battle.run()
    expect(took('enemy2', 'BASIC')).toBeCloseTo(RATE.main * 0.15 + RATE.additional * 3 * 0.12, 9)
    expect(took('enemy3', 'BASIC')).toBeCloseTo(RATE.main * 0.3, 9)
  })

  it('Ultimate, 5 enemies: the Zone is up for her own hit, and 5 instances land on one enemy', () => {
    const { battle, took } = setup({ enemyCount: 5, start: fullEnergy, policy: zoneThenBasic })
    battle.run()
    // All five take the same main hit and are tied, so the primary target, enemy 3, gets all 5 instances.
    expect(took('enemy3', 'ULT')).toBeCloseTo(RATE.main * 0.3 + RATE.additional * 5 * 0.12, 9)
    for (const enemy of ['enemy1', 'enemy2', 'enemy4', 'enemy5']) expect(took(enemy, 'ULT'), enemy).toBeCloseTo(RATE.main * 0.3, 9)
  })

  it('E6 follow-up, 5 enemies: the main hit and the additional hit are priced apart; 5 instances at E2\'s size', () => {
    const { battle, took } = setup({ members: [tribbie(6)], enemyCount: 5, start: fullEnergy, policy: zoneThenBasic })
    battle.run()
    // E6 text numbers: follow-up 19.8% to everyone; an instance is 13.2% twice over at 120%. The Ultimate's own
    // instances left the primary (enemy 3) behind, so the follow-up's go to enemy 1, the first of the rest.
    expect(took('enemy3', 'FUA')).toBeCloseTo(RATE.main * 0.198, 9)
    expect(took('enemy4', 'FUA')).toBeCloseTo(RATE.main * 0.198, 9)
    expect(took('enemy1', 'FUA')).toBeCloseTo(RATE.main * 0.198 + RATE.additional * 5 * 0.132 * 1.2 * 2, 9)
  })

  it('the extra instances do not make her own attack hit more enemies', () => {
    const { battle } = setup({ enemyCount: 5, start: fullEnergy, policy: zoneThenBasic })
    const basic = battle.run().actions.find((a) => a.action === 'basic')!
    expect(basic.enemiesHit).toEqual(['enemy2', 'enemy3', 'enemy4'])
  })
})

describe('the Zone\'s Additional DMG after another ally attacks', () => {
  it('one instance on the enemy a single-target attack hit, priced as the UNIQUE hit', () => {
    const { battle, dealt } = setup({
      members: [tribbie(), helper('h1', noAllowance, [{ shape: 'single' }])],
      enemyCount: 3,
      start: fullEnergy,
      policy: zoneThenHelper,
    })
    battle.run()
    const unique = dealt.filter((d) => d.ability === 'UNIQUE')[0]!
    expect(unique.enemy).toBe('enemy2')
    expect(unique.scaling).toBeCloseTo(0.12, 12)
    expect(unique.damage).toBeCloseTo(RATE.unique * 0.12, 9)
  })

  it('one instance per enemy hit, all on one enemy: 5 enemies hit', () => {
    const { battle, dealt } = setup({
      members: [tribbie(), helper('h1', noAllowance, [{ shape: 'aoe' }])],
      enemyCount: 5,
      start: fullEnergy,
      policy: zoneThenHelper,
    })
    battle.run()
    const unique = dealt.filter((d) => d.ability === 'UNIQUE')
    // The helper acts twice in the first cycle; the first is the AoE, the second a single-target hit. Her
    // Ultimate left the primary (enemy 3) with the least HP, so the 5 instances go to enemy 1, the first
    // of the others, which are tied.
    expect(unique).toHaveLength(2)
    expect(unique[0]!.enemy).toBe('enemy1')
    expect(unique[0]!.scaling).toBeCloseTo(5 * 0.12, 12)
    expect(unique[0]!.damage).toBeCloseTo(RATE.unique * 5 * 0.12, 9)
  })

  it('ties go to the primary target when it is among the tied, even if another tied enemy stands first', () => {
    // She is too slow to act. Her Ultimate leaves enemy 3 (primary) at 540 damage and the others at 300; four
    // single-target hits of 21% (210 plus a 30 Additional DMG each) bring enemies 1, 2, 4 and 5 to 540 as well.
    // The AoE after that finds all five tied, and the primary, not enemy 1, gets all 5 instances.
    const hit = (target: string): Step => ({ shape: 'single', target, scaling: 0.21 })
    const { battle, dealt } = setup({
      members: [tribbie(0, 0, 10), helper('h1', noAllowance, [hit('enemy1'), hit('enemy2'), hit('enemy4'), hit('enemy5'), { shape: 'aoe' }], 400)],
      enemyCount: 5,
      start: fullEnergy,
      policy: zoneThenHelper,
    })
    battle.run()
    const unique = dealt.filter((d) => d.ability === 'UNIQUE')
    expect(unique.slice(0, 5).map((d) => d.enemy)).toEqual(['enemy1', 'enemy2', 'enemy4', 'enemy5', 'enemy3'])
    expect(unique[4]!.scaling).toBeCloseTo(5 * 0.12, 12)
  })

  it('goes to the hit enemy with the highest CURRENT HP, wherever it stands', () => {
    // Her Ultimate puts its additional damage on the primary (enemy 2). Then the helper hits the primary,
    // then enemy 3, then everyone: enemy 1, which has taken only her Ultimate's main hit, has the most HP left.
    const { battle, dealt } = setup({
      members: [tribbie(), helper('h1', noAllowance, [{ shape: 'single' }, { shape: 'single', target: 'enemy3' }, { shape: 'aoe' }])],
      enemyCount: 3,
      cycles: 2,
      start: fullEnergy,
      policy: zoneThenHelper,
    })
    battle.run()
    const unique = dealt.filter((d) => d.ability === 'UNIQUE')
    expect(unique.map((d) => d.enemy)).toEqual(['enemy2', 'enemy3', 'enemy1'])
    expect(unique.map((d) => +d.scaling.toFixed(6))).toEqual([0.12, 0.12, 0.36])
  })

  it('not when the Zone is down', () => {
    const { battle, dealt } = setup({ members: [tribbie(), helper('h1', noAllowance)], enemyCount: 3, policy: zoneThenHelper })
    battle.run()
    expect(dealt.filter((d) => d.ability === 'UNIQUE')).toHaveLength(0)
  })

  it('not after the Zone has expired', () => {
    // The Zone lasts to the start of her 2nd turn (AV 200); the helper acts at 62.5, 125, 187.5, 250 and 312.5.
    const { battle, dealt } = setup({ members: [tribbie(), helper('h1', noAllowance)], cycles: 3, start: fullEnergy, policy: zoneThenHelper })
    const result = battle.run()
    expect(result.actions.filter((a) => a.actor === 'h1')).toHaveLength(5)
    expect(dealt.filter((d) => d.ability === 'UNIQUE')).toHaveLength(3)
  })

  it('not when the ally\'s action hit no enemy', () => {
    const { battle, dealt } = setup({
      members: [tribbie(), helper('h1', noAllowance, [{ shape: 'none' }, { shape: 'none' }, { shape: 'none' }])],
      start: fullEnergy,
      policy: zoneThenHelper,
    })
    battle.run()
    expect(dealt.filter((d) => d.ability === 'UNIQUE')).toHaveLength(0)
  })

  it('not on her own attacks: those carry it in their own hit', () => {
    const { battle, dealt } = setup({ enemyCount: 3, start: fullEnergy, policy: zoneThenBasic })
    battle.run()
    expect(dealt.filter((d) => d.ability === 'UNIQUE')).toHaveLength(0)
  })

  it('is not an action: nothing is logged for it and no one else is triggered by it', () => {
    const { battle } = setup({
      members: [tribbie(), helper('h1', noAllowance, [{ shape: 'aoe' }, { shape: 'aoe' }])],
      enemyCount: 3,
      start: fullEnergy,
      policy: zoneThenHelper,
    })
    let events = 0
    battle.timeline.bus.on('actionUsed', () => (events += 1))
    const result = battle.run()
    expect(events).toBe(result.actions.length)
    expect(result.actions.map((a) => `${a.actor}:${a.action}`).slice(0, 3)).toEqual(['tribbie:ultimate', 'h1:basic', 'tribbie:basic'])
    // The ally's own record of what it hit is just what it attacked.
    expect(result.actions.find((a) => a.actor === 'h1')!.enemiesHit).toEqual(['enemy1', 'enemy2', 'enemy3'])
  })

  it('E2 prices each instance at 2.4 times the base', () => {
    const { battle, dealt } = setup({ members: [tribbie(2), helper('h1', noAllowance, [{ shape: 'aoe' }])], enemyCount: 3, start: fullEnergy, policy: zoneThenHelper })
    battle.run()
    const unique = dealt.find((d) => d.ability === 'UNIQUE')!
    expect(unique.scaling).toBeCloseTo(3 * 0.12 * 2.4, 12)
  })

  it('an ally Ultimate gives the Zone damage and then her follow-up', () => {
    const { battle } = setup({
      members: [tribbie(), helper('h1', { n: 1 })],
      start: fullEnergy,
      policy: [rule('tribbie', 'ultimate'), rule('h1', 'ultimate'), rule('tribbie', 'basic'), rule('h1', 'basic')],
    })
    const order: string[] = []
    battle.timeline.bus.on('damageDealt', (d) => order.push(`${d.attacker}:${d.ability}`))
    battle.run()
    const afterHelperUlt = order.slice(order.indexOf('h1:ULT'))
    expect(afterHelperUlt.slice(0, 3)).toEqual(['h1:ULT', 'tribbie:UNIQUE', 'tribbie:FUA'])
  })
})

describe('what she tells the kernel', () => {
  it('turns off Cyrene\'s effect, prices one instance per UNIQUE hit, and has E1 on, as attacker and teammate', () => {
    const { battle, requests } = setup({
      members: [tribbie(1), helper('h1', noAllowance)],
      enemyCount: 3,
      start: fullEnergy,
      policy: zoneThenHelper,
    })
    battle.run()
    const hers = requests.filter((r) => r.attacker.characterId === '1403')
    expect(hers.length).toBeGreaterThan(0)
    for (const r of hers) {
      expect(r.attacker.characterConditionals).toMatchObject({ cyreneSpecialEffect: false, uniqueTickCoefficient: 1, e1TrueDmg: true })
    }
    const helpers = requests.filter((r) => r.attacker.characterId === 'helper' && r.teammates.length > 0)
    expect(helpers.length).toBeGreaterThan(0)
    for (const r of helpers) expect(r.teammates[0]!.characterConditionals).toMatchObject({ e1TrueDmg: true })
  })

  it('teammateState reports Numinosity and the Zone as they are right now', () => {
    const { battle } = setup({ members: [tribbie(), helper('h1', noAllowance)], start: { energy: 0, skillPoints: 0, techniques: true }, policy: [rule('tribbie', 'basic'), rule('h1', 'basic')] })
    battle.run()
    const state = battle.member('tribbie').instance.teammateState(battle.member('h1'), 'enemy1')
    expect(state.characterConditionals).toMatchObject({ numinosity: true, ultZone: false, e4DefPen: true })
  })

  it('teammateState reports the Zone when it is up', () => {
    const { battle } = setup({ members: [tribbie(), helper('h1', noAllowance)], start: fullEnergy, policy: zoneThenHelper })
    battle.run()
    const state = battle.member('tribbie').instance.teammateState(battle.member('h1'), 'enemy1')
    expect(state.characterConditionals).toMatchObject({ numinosity: false, ultZone: true })
  })

  it('attackerState counts the Lamb stacks and the other allies\' Max HP, not her own', () => {
    const { battle } = setup({ members: [tribbie(), helper('h1', { n: 1 })], policy: [rule('h1', 'ultimate'), rule('tribbie', 'basic'), rule('h1', 'basic')] })
    battle.run()
    const state = battle.member('tribbie').instance.attackerState('enemy1')
    expect(state.characterConditionals).toMatchObject({ talentFuaStacks: 1, alliesMaxHp: 1_000_000, numinosity: false, ultZone: false })
  })
})

describe('eidolons, by the multiples in the text', () => {
  it('E3 raises the Basic ATK, Ultimate and Zone Additional DMG; E5 the follow-up', () => {
    const e3 = setup({ members: [tribbie(3)], start: fullEnergy, policy: zoneThenBasic })
    e3.battle.run()
    // 33% Ultimate and Basic ATK, each with one Zone instance of 13.2% at E2's size (2 x 120%).
    expect(e3.took('enemy1', 'ULT')).toBeCloseTo(RATE.main * 0.33 + RATE.additional * 0.132 * 2.4, 9)
    expect(e3.took('enemy1', 'BASIC')).toBeCloseTo(RATE.main * 0.33 + RATE.additional * 0.132 * 2.4, 9)

    const e5 = setup({ members: [tribbie(5), helper('h1', { n: 1 })], policy: [rule('h1', 'ultimate'), rule('tribbie', 'basic'), rule('h1', 'basic')] })
    e5.battle.run()
    expect(e5.took('enemy1', 'FUA')).toBeCloseTo(RATE.main * 0.198, 9)
  })

  it('E2: her Ultimate\'s Zone Additional DMG is 2.4 times the base instance', () => {
    const { battle, took } = setup({ members: [tribbie(2)], start: fullEnergy, policy: zoneThenBasic })
    battle.run()
    expect(took('enemy1', 'ULT')).toBeCloseTo(RATE.main * 0.3 + RATE.additional * 0.12 * 2.4, 9)
  })
})
