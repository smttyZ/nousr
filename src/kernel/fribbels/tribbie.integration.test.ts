import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { Battle } from '../../battle/battle'
import type { BattleSetup, MemberSetup } from '../../battle/battle'
import type { EngineEvents } from '../../engine'
import { loadEnemyProfile } from '../../enemy/profile'
import { Acheron } from '../../kits/acheron'
import type { Kit } from '../../kits/kit'
import { Tribbie } from '../../kits/tribbie'
import type { DamageRequest, KernelBuild, KernelTeammate } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

const build: KernelBuild = {
  relicSet1: Sets.PioneerDiverOfDeadWaters,
  relicSet2: Sets.PioneerDiverOfDeadWaters,
  ornamentSet: Sets.IzumoGenseiAndTakamaDivineRealm,
  body: Stats.CD,
  feet: Stats.HP_P,
  planarSphere: Stats.Quantum_DMG,
  linkRope: Stats.HP_P,
  substatRolls: { [Stats.HP_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const acheronBuild: KernelBuild = {
  relicSet1: Sets.PioneerDiverOfDeadWaters,
  relicSet2: Sets.PioneerDiverOfDeadWaters,
  ornamentSet: Sets.IzumoGenseiAndTakamaDivineRealm,
  body: Stats.CD,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const profile = loadEnemyProfile('generic-moc')
const ALLY_MAX_HP = 1_000_000

/** Tribbie with Dance! Dance! Dance! (21018). */
const tribbieUnit = (eidolon: number) => ({ characterId: '1403', lightConeId: '21018', eidolon, superimposition: 1 })
const acheronUnit = { characterId: '1308', lightConeId: '23024', eidolon: 0, superimposition: 1 }

type State = { numinosity?: boolean, zone?: boolean, lamb?: number }

/**
 * The request for one of Tribbie's own attacks, written from Fribbels' switches and the in-game text, not from
 * the kit: the Zone, Numinosity and Lamb stacks as given, Cyrene off (no Cyrene kit yet), E1's True DMG on
 * (Fribbels gates it on the eidolon and the Zone), and one UNIQUE instance per priced hit.
 */
const tribbieRequest = (
  eidolon: number,
  state: State,
  enemyCount = 1,
  teammates: KernelTeammate[] = [],
  alliesMaxHp = 0,
  e1TrueDmg = true,
): DamageRequest => ({
  attacker: {
    ...tribbieUnit(eidolon),
    characterConditionals: {
      numinosity: state.numinosity ?? false,
      ultZone: state.zone ?? false,
      alliesMaxHp,
      talentFuaStacks: state.lamb ?? 0,
      uniqueTickCoefficient: 1,
      cyreneSpecialEffect: false,
      e1TrueDmg,
      e2AdditionalDmg: true,
      e4DefPen: true,
      e6FuaScaling: true,
    },
  },
  teammates,
  build,
  enemy: { count: enemyCount, level: 95, maxToughness: 360, resistance: 0.2, elementalWeak: true },
})

/** Acheron as the team's other member, the way the runner presents her to Tribbie's attacks. */
const acheronAsTeammate: KernelTeammate = { ...acheronUnit, characterConditionals: { e4UltVulnerability: true } }

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

const tribbieMember = (eidolon: number, energyRegen = 0): MemberSetup => ({
  key: 'tribbie',
  kit: Tribbie,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 101, energyRegen },
  kernel: { unit: tribbieUnit(eidolon), build },
})

const acheronMember: MemberSetup = {
  key: 'acheron',
  kit: Acheron,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: ALLY_MAX_HP, def: 1000, baseSpd: 120 },
  kernel: { unit: acheronUnit, build: acheronBuild },
}

/**
 * A plain ally that Basic ATKs one enemy and, while `allowance.n` is above 0, uses an Ultimate on one enemy.
 * It carries Acheron's identity so that the real kernel prices its hits.
 */
const stubAlly = (allowance: { n: number }): Kit => ({
  characterId: 'stub',
  path: 'Harmony',
  element: 'Lightning',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'basic', 'basic', () => {
            battle.gainSkillPoints(1)
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
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
const stubMember = (key: string, allowance: { n: number }): MemberSetup => ({
  key,
  kit: stubAlly(allowance),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: ALLY_MAX_HP, def: 1000, baseSpd: 160 },
  kernel: { unit: acheronUnit, build: acheronBuild },
})
const stubTeammate: KernelTeammate = { ...acheronUnit }

const rule = (unit: string, use: string, when: BattleSetup['policy'][number]['when'] = []) => ({ unit, use, when })
/** Her Ultimate once: in the window before her first turn (her energy refills from hits, so she would use it again). */
const ultOnce = rule('tribbie', 'ultimate', [{ what: 'tribbie.zone', is: false }, { what: 'battle.cycle', max: 1 }])
const fullEnergy = { energy: 1, skillPoints: 0, techniques: false }

function battleOf(overrides: Partial<BattleSetup> & { members: MemberSetup[] }) {
  const battle = new Battle({
    policy: [],
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
  /** What one enemy took from one of an attacker's abilities, summed over the attack calls that made it up. */
  const took = (attacker: string, enemy: string, ability: string) =>
    dealt.filter((d) => d.attacker === attacker && d.enemy === enemy && d.ability === ability).reduce((sum, d) => sum + d.damage, 0)
  return { battle, dealt, took }
}

/** Tribbie alone. */
const solo = (eidolon: number, overrides: Partial<BattleSetup> = {}) => battleOf({ members: [tribbieMember(eidolon)], ...overrides })

const damageOf = (r: DamageRequest, ability: string) => kernel.actionDamage(r).hits[ability]!
const sum = (hits: { damage: number }[]) => hits.reduce((total, h) => total + h.damage, 0)

describe('Tribbie through the real kernel: one use, one enemy', () => {
  it('Basic ATK, Zone down: NouSR records Fribbels\' BASIC', () => {
    const { battle, took } = solo(0, { policy: [rule('tribbie', 'basic')] })
    battle.run()
    expect(took('tribbie', 'enemy1', 'BASIC')).toBeCloseTo(kernel.actionDamage(tribbieRequest(0, {})).damage.BASIC!, 6)
  })

  it('Ultimate at E3, Zone up for the hit: NouSR records Fribbels\' ULT with the Zone\'s additional hit', () => {
    const { battle, took } = solo(3, { start: fullEnergy, policy: [ultOnce, rule('tribbie', 'basic')] })
    battle.run()
    expect(took('tribbie', 'enemy1', 'ULT')).toBeCloseTo(kernel.actionDamage(tribbieRequest(3, { zone: true })).damage.ULT!, 6)
  })

  it('Numinosity from the Skill: her next Basic ATK is Fribbels\' BASIC with Numinosity on', () => {
    const { battle, took } = solo(0, {
      start: { energy: 0, skillPoints: 1, techniques: false },
      policy: [rule('tribbie', 'skill'), rule('tribbie', 'basic')],
      cycles: 2,
    })
    battle.run()
    expect(took('tribbie', 'enemy1', 'BASIC')).toBeCloseTo(kernel.actionDamage(tribbieRequest(0, { numinosity: true })).damage.BASIC!, 6)
  })

  it('E4: Numinosity also makes her own hit ignore 18% DEF, as Fribbels prices it', () => {
    const { battle, took } = solo(4, {
      start: { energy: 0, skillPoints: 1, techniques: false },
      policy: [rule('tribbie', 'skill'), rule('tribbie', 'basic')],
      cycles: 2,
    })
    battle.run()
    const withNuminosity = kernel.actionDamage(tribbieRequest(4, { numinosity: true })).damage.BASIC!
    expect(took('tribbie', 'enemy1', 'BASIC')).toBeCloseTo(withNuminosity, 6)
    expect(withNuminosity).toBeGreaterThan(kernel.actionDamage(tribbieRequest(3, { numinosity: true })).damage.BASIC!)
  })

  it('E6 follow-up after her Ultimate, Zone up: NouSR records Fribbels\' FUA, both hits', () => {
    const { battle, took } = solo(6, { start: fullEnergy, policy: [ultOnce, rule('tribbie', 'basic')] })
    battle.run()
    expect(took('tribbie', 'enemy1', 'FUA')).toBeCloseTo(kernel.actionDamage(tribbieRequest(6, { zone: true })).damage.FUA!, 6)
  })

  it('E1: the Zone\'s True DMG is in her own hit, and it is the only difference from E0', () => {
    const run = (eidolon: number) => {
      const { battle, took } = solo(eidolon, { start: fullEnergy, policy: [ultOnce, rule('tribbie', 'basic')] })
      battle.run()
      return took('tribbie', 'enemy1', 'ULT')
    }
    const e1 = run(1)
    expect(e1).toBeCloseTo(sum(damageOf(tribbieRequest(1, { zone: true }), 'ULT')), 6)
    // Fribbels' own switch: with it off the same E1 kit does less.
    expect(e1).toBeGreaterThan(sum(damageOf(tribbieRequest(1, { zone: true }, 1, [], 0, false), 'ULT')))
    // E0 has no True DMG, so the switch changes nothing there.
    expect(sum(damageOf(tribbieRequest(0, { zone: true }, 1, [], 0, true), 'ULT')))
      .toBeCloseTo(sum(damageOf(tribbieRequest(0, { zone: true }, 1, [], 0, false), 'ULT')), 6)
  })

  it('E2: the Zone\'s additional hit is Fribbels\' 2 x 120% of the base, and NouSR prices the Ultimate with it', () => {
    const hits = damageOf(tribbieRequest(2, { zone: true }), 'ULT')
    expect(hits[1]!.scaling).toBeCloseTo(0.12 * 2.4, 12)
    const { battle, took } = solo(2, { start: fullEnergy, policy: [ultOnce, rule('tribbie', 'basic')] })
    battle.run()
    expect(took('tribbie', 'enemy1', 'ULT')).toBeCloseTo(sum(hits), 6)
  })

  it('the Zone adds a second hit that Fribbels prices on its own: the Basic ATK with and without it', () => {
    const off = damageOf(tribbieRequest(0, { zone: false }), 'BASIC')
    const on = damageOf(tribbieRequest(0, { zone: true }), 'BASIC')
    expect(off).toHaveLength(1)
    expect(on).toHaveLength(2)
    // The Zone's own 30% damage taken applies to the whole ability, so hit 0 gains exactly that.
    expect(on[0]!.damage / off[0]!.damage).toBeCloseTo(1.3, 6)
  })

  it('one UNIQUE instance is the multiple of the text: the default tick coefficient of 8 would make it 8 times that', () => {
    expect(damageOf(tribbieRequest(0, { zone: true }), 'UNIQUE')[0]!.scaling).toBeCloseTo(0.12, 12)
    const asDefault = tribbieRequest(0, { zone: true })
    delete asDefault.attacker.characterConditionals!.uniqueTickCoefficient
    expect(kernel.actionDamage(asDefault).hits.UNIQUE![0]!.scaling).toBeCloseTo(0.12 * 8, 12)
  })

  it('with Cyrene on the team, the kit keeps her doubling of the Additional DMG off (no Cyrene kit yet)', () => {
    const cyrene = (): KernelTeammate => ({ characterId: '1415', lightConeId: '23024', eidolon: 0, superimposition: 1 })
    // Fribbels' default, Cyrene effect on, doubles the additional hit once she is a teammate.
    const doubled = tribbieRequest(0, { zone: true }, 1, [cyrene()])
    delete doubled.attacker.characterConditionals!.cyreneSpecialEffect
    expect(kernel.actionDamage(doubled).hits.ULT![1]!.scaling).toBeCloseTo(0.24, 12)

    const member: MemberSetup = {
      key: 'cyrene',
      kit: stubAlly({ n: 0 }),
      eidolon: 0,
      affinitiveEidolon: false,
      stats: { maxHp: ALLY_MAX_HP, def: 1000, baseSpd: 160 },
      kernel: { unit: cyrene(), build: acheronBuild },
    }
    const { battle, took } = battleOf({
      members: [tribbieMember(0), member],
      start: fullEnergy,
      policy: [ultOnce, rule('tribbie', 'basic'), rule('cyrene', 'basic')],
    })
    battle.run()
    const expected = sum(damageOf(tribbieRequest(0, { zone: true }, 1, [cyrene()], ALLY_MAX_HP), 'ULT'))
    expect(took('tribbie', 'enemy1', 'ULT')).toBeCloseTo(expected, 6)
  })
})

describe('Tribbie through the real kernel: 3 and 5 enemies, every hit priced for what it is (K11)', () => {
  for (const count of [3, 5]) {
    const primary = `enemy${Math.ceil(count / 2)}`
    /** The enemy with the most HP left after her Ultimate and the attack after it: the first of the untouched ones. */
    const spare = 'enemy1'

    it(`${count} enemies, Basic ATK with the Zone down: 3 targets, the neighbours at half`, () => {
      const { battle, dealt, took } = solo(0, { enemyCount: count, policy: [rule('tribbie', 'basic')] })
      battle.run()
      const main = damageOf(tribbieRequest(0, {}, count), 'BASIC')[0]!.damage
      expect(dealt.filter((d) => d.ability === 'BASIC')).toHaveLength(3)
      expect(took('tribbie', primary, 'BASIC')).toBeCloseTo(main, 6)
      const sides = [`enemy${Math.ceil(count / 2) - 1}`, `enemy${Math.ceil(count / 2) + 1}`]
      for (const side of sides) expect(took('tribbie', side, 'BASIC'), side).toBeCloseTo(main / 2, 6)
    })

    it(`${count} enemies, Ultimate: the main hit on all, then ${count} Additional DMG instances on the primary`, () => {
      const { battle, took } = solo(0, { enemyCount: count, start: fullEnergy, policy: [ultOnce, rule('tribbie', 'basic')] })
      battle.run()
      const [main, additional] = damageOf(tribbieRequest(0, { zone: true }, count), 'ULT')
      for (let i = 1; i <= count; i++) {
        const enemy = `enemy${i}`
        const expected = enemy === primary ? main!.damage + count * additional!.damage : main!.damage
        expect(took('tribbie', enemy, 'ULT'), enemy).toBeCloseTo(expected, 6)
      }
    })

    it(`${count} enemies, Basic ATK after it: 3 instances, all on the hit enemy with the most HP left`, () => {
      const { battle, took } = solo(0, { enemyCount: count, start: fullEnergy, policy: [ultOnce, rule('tribbie', 'basic')] })
      battle.run()
      const [main, additional] = damageOf(tribbieRequest(0, { zone: true }, count), 'BASIC')
      const first = `enemy${Math.ceil(count / 2) - 1}`
      // The primary already holds her Ultimate's instances, so the neighbours (tied) have more HP: the first one.
      expect(took('tribbie', first, 'BASIC')).toBeCloseTo(main!.damage / 2 + 3 * additional!.damage, 6)
      expect(took('tribbie', primary, 'BASIC')).toBeCloseTo(main!.damage, 6)
    })

    it(`${count} enemies, E6 follow-up: main hit ${count} times, ${count} instances at their own rate on one enemy`, () => {
      const { battle, took } = solo(6, { enemyCount: count, start: fullEnergy, policy: [ultOnce, rule('tribbie', 'basic')] })
      battle.run()
      const [main, additional] = damageOf(tribbieRequest(6, { zone: true }, count), 'FUA')
      // The E6 +729% reaches the follow-up's main hit and not the additional hit, so the two rates differ a lot.
      expect(main!.damage / main!.scaling!).toBeGreaterThan(2 * (additional!.damage / additional!.scaling!))
      for (let i = 1; i <= count; i++) {
        const enemy = `enemy${i}`
        const expected = enemy === spare ? main!.damage + count * additional!.damage : main!.damage
        expect(took('tribbie', enemy, 'FUA'), enemy).toBeCloseTo(expected, 6)
      }
    })
  }
})

describe('Tribbie with a teammate (Acheron): the Zone after another ally attacks', () => {
  /**
   * At the first UNIQUE (Zone) hit: each enemy's current HP just before it, and the enemies other allies'
   * attacks hit since the previous UNIQUE hit (Tribbie's own hits are not counted).
   */
  const trackFirstZoneHit = (battle: Battle) => {
    let hitSince = new Set<string>()
    let captured: { hp: Record<string, number>, hit: string[] } | undefined
    battle.timeline.bus.on('damageDealt', (d) => {
      if (d.ability !== 'UNIQUE') {
        if (d.attacker !== 'tribbie') hitSince.add(d.enemy)
        return
      }
      if (!captured) {
        // damageDealt fires after the hit lowered HP, so add this hit's damage back.
        const hp = Object.fromEntries(battle.enemies.ids.map((id) => [id, battle.enemyHp(id).current]))
        hp[d.enemy] = hp[d.enemy]! + d.damage
        captured = { hp, hit: [...hitSince] }
      }
      hitSince = new Set()
    })
    return () => captured
  }

  it('Acheron\'s Basic ATK: one UNIQUE instance on the enemy she hit, priced by Fribbels\' UNIQUE hit', () => {
    const { battle, dealt } = battleOf({
      members: [tribbieMember(1), acheronMember],
      enemyCount: 3,
      start: fullEnergy,
      policy: [ultOnce, rule('acheron', 'basic'), rule('tribbie', 'basic')],
    })
    battle.run()
    const unique = dealt.find((d) => d.ability === 'UNIQUE')!
    expect(unique.enemy).toBe('enemy2')
    const expected = damageOf(tribbieRequest(1, { zone: true }, 3, [acheronAsTeammate], ALLY_MAX_HP), 'UNIQUE')
    expect(expected).toHaveLength(1)
    expect(unique.damage).toBeCloseTo(expected[0]!.damage, 6)
  })

  it('Acheron\'s Skill on 3 and 5 enemies: one instance per enemy hit (3), all on the hit enemy with the most HP left', () => {
    for (const [count, target] of [[3, 'enemy1'], [5, 'enemy2']] as const) {
      const { battle, dealt } = battleOf({
        members: [tribbieMember(0), acheronMember],
        enemyCount: count,
        start: { energy: 1, skillPoints: 3, techniques: false },
        policy: [ultOnce, rule('acheron', 'skill'), rule('tribbie', 'basic')],
      })
      const zoneHit = trackFirstZoneHit(battle)
      battle.run()
      const uniques = dealt.filter((d) => d.ability === 'UNIQUE')
      expect(uniques.length, `${count} enemies`).toBeGreaterThan(0)
      const first = uniques[0]!
      const unit = damageOf(tribbieRequest(0, { zone: true }, count, [acheronAsTeammate], ALLY_MAX_HP), 'UNIQUE')[0]!
      // Her Ultimate left the primary behind, so the enemies beside it (tied) have the most HP: the first of them.
      expect(first.enemy, `${count} enemies`).toBe(target)
      expect(first.scaling).toBeCloseTo(3 * 0.12, 12)
      expect(first.damage).toBeCloseTo(3 * unit.damage, 6)
      // The same answer from the engine's own HP: the largest current HP among the enemies hit, before this damage.
      const seen = zoneHit()!
      expect(seen.hit, `${count} enemies`).toHaveLength(3)
      expect(seen.hp[first.enemy], `${count} enemies`).toBeCloseTo(Math.max(...seen.hit.map((id) => seen.hp[id]!)), 6)
    }
  })

  it('Acheron\'s own hit is priced with Tribbie\'s Zone and her E1 True DMG on, as Fribbels does for a teammate', () => {
    const acheronBasic = (zone: boolean, e1: boolean) =>
      kernel.actionDamage({
        attacker: {
          ...acheronUnit,
          characterConditionals: {
            crimsonKnotStacks: 0,
            stygianResurgeHitsOnTarget: 0,
            thunderCoreStacks: 0,
            nihilityTeammatesBuff: true,
            e1EnemyDebuffed: false,
            e4UltVulnerability: true,
            e6UltBuffs: true,
          },
        },
        teammates: [{ ...tribbieUnit(1), characterConditionals: { numinosity: false, ultZone: zone, e1TrueDmg: e1, e4DefPen: true } }],
        build: acheronBuild,
        enemy: { count: 1, level: 95, maxToughness: 360, resistance: 0.2, elementalWeak: true },
      }).hits.BASIC![0]!.damage
    const { battle, took } = battleOf({
      members: [tribbieMember(1), acheronMember],
      start: fullEnergy,
      policy: [ultOnce, rule('acheron', 'basic'), rule('tribbie', 'basic')],
    })
    battle.run()
    expect(took('acheron', 'enemy1', 'BASIC')).toBeCloseTo(acheronBasic(true, true), 6)
    expect(acheronBasic(true, true)).toBeGreaterThan(acheronBasic(true, false))
    expect(acheronBasic(true, false)).toBeGreaterThan(acheronBasic(false, false))
  })

  it('no instance with the Zone down', () => {
    const { battle, dealt } = battleOf({
      members: [tribbieMember(1), acheronMember],
      policy: [rule('acheron', 'basic'), rule('tribbie', 'basic')],
    })
    battle.run()
    expect(dealt.some((d) => d.ability === 'UNIQUE')).toBe(false)
  })

  it('Pebble at Crossroads: with Energy Regeneration Rate 19.4%, 30 at the start and 1.5 per enemy Acheron hits, both scaled', () => {
    const err = 0.194
    const { battle } = battleOf({
      members: [tribbieMember(0, err), acheronMember],
      enemyCount: 3,
      start: { energy: 0, skillPoints: 3, techniques: false },
      policy: [rule('acheron', 'skill'), rule('tribbie', 'basic')],
    })
    const gains: number[] = []
    battle.timeline.bus.on('energyGained', (e) => {
      if (e.unit === 'tribbie') gains.push(e.amount)
    })
    // Acheron has the first turn (higher SPD in the order of the first cycle is not assumed): find her skill.
    battle.run()
    expect(gains[0]).toBeCloseTo(30 * (1 + err), 9)
    // Her Skill is a blast on 3 of 3 enemies: 3 hits.
    expect(gains).toContainEqual(expect.closeTo(1.5 * 3 * (1 + err), 9))
  })
})

describe('Tribbie through the real kernel: the Lamb trace', () => {
  it('caps at 3 stacks, is priced as Fribbels\' talentFuaStacks, and is gone 3 of her turns later', () => {
    // E6 gives her a follow-up after her own Ultimate; three allies' Ultimates give three more: 4 follow-ups.
    const allowances = [{ n: 1 }, { n: 1 }, { n: 1 }]
    const stubs = allowances.map((a, i) => stubMember(`s${i + 1}`, a))
    const { battle, dealt } = battleOf({
      members: [tribbieMember(6), ...stubs],
      start: fullEnergy,
      cycles: 4,
      policy: [
        ultOnce,
        ...stubs.map((s) => rule(s.key, 'ultimate')),
        rule('tribbie', 'basic'),
        ...stubs.map((s) => rule(s.key, 'basic')),
      ],
    })
    const stacks: number[] = []
    battle.timeline.bus.on('actionUsed', (a) => {
      if (a.action === 'talent_follow_up') stacks.push(battle.member('tribbie').instance.quantities!.lamb_stacks!() as number)
    })
    const result = battle.run()
    expect(stacks).toEqual([1, 2, 3, 3])
    expect(result.actions.filter((a) => a.actor === 'tribbie' && a.kind === 'ultimate')).toHaveLength(1)

    const price = (zone: boolean, lamb: number) =>
      sum(damageOf(tribbieRequest(6, { zone, lamb }, 1, [stubTeammate, stubTeammate, stubTeammate], 3 * ALLY_MAX_HP), 'BASIC'))
    // Her Basic ATKs by turn: Zone up and 3 stacks; then the Zone has run out (2 of her turn starts) with 3 stacks
    // for her 2nd and 3rd turns; on her 4th the stacks are gone.
    const byTurn = new Map<number, number>()
    for (const d of dealt) {
      if (d.attacker === 'tribbie' && d.ability === 'BASIC') byTurn.set(d.at, (byTurn.get(d.at) ?? 0) + d.damage)
    }
    const basics = [...byTurn.entries()].sort((a, b) => a[0] - b[0]).map(([, damage]) => damage)
    expect(basics.length).toBeGreaterThanOrEqual(4)
    expect(basics[0]).toBeCloseTo(price(true, 3), 6)
    expect(basics[1]).toBeCloseTo(price(false, 3), 6)
    expect(basics[2]).toBeCloseTo(price(false, 3), 6)
    expect(basics[3]).toBeCloseTo(price(false, 0), 6)
    expect(price(false, 3)).toBeGreaterThan(price(false, 0))
  })
})
