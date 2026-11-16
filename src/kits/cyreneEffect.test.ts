import { describe, expect, it } from 'vitest'
import { Battle, CYRENE_KERNEL_ID } from '../battle/battle'
import type { BattleSetup, MemberSetup } from '../battle/battle'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, HitResult } from '../kernel/types'
import type { Rule } from '../scenario/types'
import { DanHengPT, danHengPTScalings } from './danHengPT'
import type { Kit } from './kit'
import { Tribbie } from './tribbie'

/**
 * Cyrene's ally-specific effects (`Battle.cyreneEffect` / `setCyreneEffect`), with a stub Cyrene that turns an ally's effect on,
 * and the two kits that read it: Tribbie (Ode to Passage) and Dan Heng PT (Ode to Earth). Fake kernels: what the kit tells Fribbels
 * (the `cyreneSpecialEffect` switch) and what the kit prices itself (Tribbie's further Zone instance) are the two things pinned.
 */

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/** A stand-in Cyrene: a member the kernel knows as Cyrene (1415) whose kit turns the effect on for `targets` at battle start. */
const stubCyrene = (targets: readonly string[], active = true): Kit => ({
  characterId: 'cyrene-stub',
  path: 'Remembrance',
  element: 'Ice',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: { kind: 'basic', canUse: () => true, use: () => battle.performAction(self.key, 'basic', 'basic', () => {}) },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
    onBattleStart: () => {
      for (const target of targets) battle.setCyreneEffect(target, active, self.key)
    },
  }),
})

const cyreneMember = (targets: readonly string[], eidolon = 0, active = true, characterId = CYRENE_KERNEL_ID): MemberSetup => ({
  key: 'cyrene',
  kit: stubCyrene(targets, active),
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 90 },
  kernel: { unit: { characterId, lightConeId: 'none', eidolon, superimposition: 1 }, build: noBuild },
})

/** A teammate with a Basic ATK of 100%. */
const Helper: Kit = {
  characterId: 'helper',
  path: 'Hunt',
  element: 'Lightning',
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
}

const helper = (key: string, baseSpd = 100): MemberSetup => ({
  key,
  kit: Helper,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
  kernel: { unit: { characterId: 'helper', lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
})

const rule = (unit: string, use: string, when: Rule['when'] = []): Rule => ({ unit, use, when })

function battleOf(members: MemberSetup[], kernel: DamageKernel, overrides: Partial<BattleSetup> = {}) {
  const battle = new Battle({
    members,
    policy: members.map((m) => rule(m.key, 'basic')),
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0, skillPoints: 3, techniques: false },
    kernel,
    ...overrides,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  return { battle, dealt }
}

const flatKernel = (requests: DamageRequest[] = []): DamageKernel => ({
  actionDamage(request) {
    requests.push(request)
    return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] })
  },
})

describe('Battle.cyreneEffect / setCyreneEffect', () => {
  it('is off for everyone when no Cyrene turns it on (a team with no Cyrene included)', () => {
    const { battle } = battleOf([helper('a'), helper('b')], flatKernel())
    expect(battle.cyreneEffect('a')).toEqual({ active: false, upgraded: false })
    expect(battle.cyreneEffect('nobody')).toEqual({ active: false, upgraded: false })
  })

  it('a stub Cyrene turns it on for one ally and not another; upgraded follows her E3', () => {
    for (const [eidolon, upgraded] of [[0, false], [2, false], [3, true], [6, true]] as const) {
      const { battle } = battleOf([helper('a'), helper('b'), cyreneMember(['a'], eidolon)], flatKernel())
      battle.member('cyrene').instance.onBattleStart!({ techniques: false })
      expect(battle.cyreneEffect('a')).toEqual({ active: true, upgraded })
      expect(battle.cyreneEffect('b')).toEqual({ active: false, upgraded: false })
    }
  })

  it('can be turned off again', () => {
    const { battle } = battleOf([helper('a'), cyreneMember(['a'])], flatKernel())
    battle.setCyreneEffect('a', true, 'cyrene')
    expect(battle.cyreneEffect('a').active).toBe(true)
    battle.setCyreneEffect('a', false, 'cyrene')
    expect(battle.cyreneEffect('a')).toEqual({ active: false, upgraded: false })
  })

  it('refuses a source that is not Cyrene in the kernel, since Fribbels only has the effect with a Cyrene in the team', () => {
    expect(() => battleOf([helper('a'), cyreneMember(['a'], 0, true, 'not-cyrene')], flatKernel()).battle.run()).toThrow(
      /setCyreneEffect: cyrene is not Cyrene .* expected 1415/,
    )
  })

  it('refuses an effect on Cyrene herself and on a member that does not exist', () => {
    const { battle } = battleOf([helper('a'), cyreneMember([])], flatKernel())
    expect(() => battle.setCyreneEffect('cyrene', true, 'cyrene')).toThrow(/on a teammate, not on cyrene/)
    expect(() => battle.setCyreneEffect('ghost', true, 'cyrene')).toThrow()
  })

  it('the kernel cache keys on the request, so turning the effect on mid-battle changes the price', () => {
    // The effect reaches the kernel only through a kit's state; here a kit reading it shows the change in its request.
    const requests: DamageRequest[] = []
    const reader: Kit = {
      ...Helper,
      characterId: 'reader',
      create: (battle, self) => ({
        ...Helper.create(battle, self),
        attackerState: () => ({ characterConditionals: { cyreneSpecialEffect: battle.cyreneEffect(self.key).active } }),
      }),
    }
    const readerMember: MemberSetup = { ...helper('r'), kit: reader, kernel: { unit: { characterId: 'reader', lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild } }
    const { battle } = battleOf([readerMember, cyreneMember([])], flatKernel(requests))
    battle.combatStats('r')
    battle.setCyreneEffect('r', true, 'cyrene')
    battle.combatStats('r')
    expect(requests.map((r) => r.attacker.characterConditionals?.cyreneSpecialEffect)).toEqual([false, true])
  })
})

// ---------------------------------------------------------------- Tribbie

/** Damage per 100% of each Tribbie hit, so a part priced from the wrong hit shows. */
const RATE = { main: 1000, additional: 400, unique: 250 }

/** The kernel's Tribbie as Fribbels builds it: the ability's hit, then the Additional hit at twice the multiple while Cyrene's effect is on. */
function tribbieKernel(requests: DamageRequest[] = []): DamageKernel {
  return {
    actionDamage(request) {
      requests.push(request)
      if (request.attacker.characterId !== '1403') return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }], ULT: [{ damage: 1000, scaling: 1 }] })
      const zone = request.attacker.characterConditionals?.ultZone === true
      const cyrene = request.attacker.characterConditionals?.cyreneSpecialEffect === true
      // Fribbels' doubling: the hit's multiple doubles with the damage, so the rate per 100% does not change.
      const additional = (rate: number): HitResult[] => (zone ? [{ damage: rate * 0.12 * (cyrene ? 2 : 1), scaling: 0.12 * (cyrene ? 2 : 1) }] : [])
      return fakeResult({
        BASIC: [{ damage: RATE.main * 0.3, scaling: 0.3 }, ...additional(RATE.additional)],
        ULT: [{ damage: RATE.main * 0.3, scaling: 0.3 }, ...additional(RATE.additional)],
        FUA: [{ damage: RATE.main * 0.18, scaling: 0.18 }, ...additional(RATE.additional)],
        UNIQUE: additional(RATE.unique),
      })
    },
  }
}

const tribbie = (eidolon = 0): MemberSetup => ({
  key: 'tribbie',
  kit: Tribbie,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: '1403', lightConeId: 'none', eidolon, superimposition: 1 }, build: noBuild },
})

describe('Tribbie: Cyrene\'s Ode to Passage', () => {
  // E6, so her own Ultimate is followed by a follow-up. One enemy, Zone up for the follow-up and the allies' attacks.
  const run = (cyreneOn: boolean) => {
    const requests: DamageRequest[] = []
    const members = [tribbie(6), helper('h', 60), ...(cyreneOn !== undefined ? [cyreneMember(['tribbie'], 0, cyreneOn)] : [])]
    const { battle, dealt } = battleOf(members, tribbieKernel(requests), {
      start: { energy: 1, skillPoints: 0, techniques: false },
      policy: [rule('tribbie', 'ultimate', [{ what: 'tribbie.zone', is: false }]), rule('tribbie', 'basic'), rule('h', 'basic'), rule('cyrene', 'basic')],
      cycles: 2,
    })
    battle.run()
    const took = (ability: string, from = 'tribbie') => dealt.filter((d) => d.attacker === from && d.ability === ability).reduce((sum, d) => sum + d.damage, 0)
    return { requests, took, dealt }
  }

  it('with no Cyrene effect the kit tells the kernel the switch is off (also with a Cyrene in the team that did not turn it on)', () => {
    const { requests } = run(false)
    const hers = requests.filter((r) => r.attacker.characterId === '1403')
    expect(hers.length).toBeGreaterThan(0)
    for (const r of hers) expect(r.attacker.characterConditionals).toMatchObject({ cyreneSpecialEffect: false })
  })

  it('with the effect on the kit passes the switch on, so Fribbels adds its DEF ignore', () => {
    const { requests } = run(true)
    const hers = requests.filter((r) => r.attacker.characterId === '1403')
    expect(hers.length).toBeGreaterThan(0)
    for (const r of hers) expect(r.attacker.characterConditionals).toMatchObject({ cyreneSpecialEffect: true })
    expect(hers[0]!.teammates.map((t) => t.characterId)).toContain(CYRENE_KERNEL_ID)
  })

  it('her follow-up\'s Zone Additional DMG gets one further instance of the same size: twice the damage, the main hit and the others unchanged', () => {
    const off = run(false)
    const on = run(true)
    const additionalFua = (r: ReturnType<typeof run>) => r.took('FUA') - RATE.main * 0.198
    expect(additionalFua(off)).toBeGreaterThan(0)
    expect(additionalFua(on)).toBeCloseTo(2 * additionalFua(off), 9)
    // E6, one enemy: 1 instance of E2's size at E3 (2.4 x 13.2%) at the additional rate; with the effect, 2.
    expect(additionalFua(off)).toBeCloseTo(RATE.additional * 0.132 * 2.4, 9)
    // Text: only the follow-up. Her Basic ATK's, Ultimate's and the allies' Zone instances keep their number.
    expect(on.took('ULT')).toBeCloseTo(off.took('ULT'), 9)
    expect(on.took('BASIC')).toBeCloseTo(off.took('BASIC'), 9)
    expect(on.took('UNIQUE')).toBeCloseTo(off.took('UNIQUE'), 9)
    expect(on.took('UNIQUE')).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------- Dan Heng PT

const ATK = 3000

function dhptKernel(requests: DamageRequest[] = []): DamageKernel {
  return {
    actionDamage(request) {
      requests.push(request)
      if (request.attacker.characterId !== '1414') return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] })
      const s = danHengPTScalings(request.attacker.eidolon)
      return fakeResult(
        { BASIC: [{ damage: 1000 * s.basic, scaling: s.basic }] },
        { ATK, DEF: 0, HP: 0, SPD: 0, CR: 0, CD: 0, EHR: 0, RES: 0, BE: 0, ERR: 0, OHB: 0 },
      )
    },
  }
}

const dhpt = (): MemberSetup => ({
  key: 'dhpt',
  kit: DanHengPT,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: '1414', lightConeId: '24002', eidolon: 0, superimposition: 5 }, build: noBuild },
})

describe('Dan Heng PT: Cyrene\'s Ode to Earth', () => {
  const teammateConditionals = (requests: DamageRequest[], attacker: string) => {
    const mine = requests.filter((r) => r.attacker.characterId === 'helper' && r.attacker.lightConeId === attacker)
    return mine[mine.length - 1]!.teammates.find((t) => t.characterId === '1414')!.characterConditionals
  }
  const withCyrene = (on: boolean) => {
    const requests: DamageRequest[] = []
    const dps: MemberSetup = { ...helper('dps'), kernel: { unit: { characterId: 'helper', lightConeId: 'dps', eidolon: 0, superimposition: 1 }, build: noBuild } }
    const sup: MemberSetup = { ...helper('sup'), kernel: { unit: { characterId: 'helper', lightConeId: 'sup', eidolon: 0, superimposition: 1 }, build: noBuild } }
    const { battle } = battleOf([dhpt(), dps, sup, cyreneMember(['dhpt'], 0, on)], dhptKernel(requests), { policy: [] as Rule[] })
    battle.member('cyrene').instance.onBattleStart!({ techniques: false })
    battle.member('dhpt').instance.actions.skill!.use('dps')
    battle.member('dps').instance.actions.basic!.use()
    battle.member('sup').instance.actions.basic!.use()
    return requests
  }

  it('with the effect on, only the Bondmate\'s attacks carry the switch', () => {
    const requests = withCyrene(true)
    expect(teammateConditionals(requests, 'dps')).toMatchObject({ bondmate: true, cyreneSpecialEffect: true })
    expect(teammateConditionals(requests, 'sup')).toMatchObject({ bondmate: false, cyreneSpecialEffect: false })
  })

  it('with the effect off, nobody carries it', () => {
    const requests = withCyrene(false)
    expect(teammateConditionals(requests, 'dps')).toMatchObject({ bondmate: true, cyreneSpecialEffect: false })
    expect(teammateConditionals(requests, 'sup')).toMatchObject({ cyreneSpecialEffect: false })
  })
})
