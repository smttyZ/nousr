import { describe, expect, it } from 'vitest'
import { Battle } from './battle'
import type { MemberSetup } from './battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel } from '../kernel/types'
import type { Kit } from '../kits/kit'

/** `Battle.healAmount`: a heal hit's amount is read from the kernel's answer with the healer's live state. */

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

const Healer: Kit = {
  characterId: 'healer',
  path: 'Abundance',
  element: 'Wind',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: { basic: { kind: 'basic', canUse: () => true, use: () => battle.performAction(self.key, 'basic', 'basic', () => {}) } },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
}

const member = (key: string): MemberSetup => ({
  key,
  kit: Healer,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 10_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: 'healer', lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
})

/** BASIC is damage; SKILL_HEAL and ULT_HEAL are heal hits (no scaling), ULT_HEAL has two. */
const kernel: DamageKernel = {
  actionDamage: () =>
    fakeResult({
      BASIC: [{ damage: 1000, scaling: 1 }],
      SKILL_HEAL: [{ damage: 777, output: 'HEAL' }],
      ULT_HEAL: [{ damage: 100, output: 'HEAL' }, { damage: 200, output: 'HEAL' }],
    }),
}

const battleOf = () =>
  new Battle({
    members: [member('h'), member('a')],
    policy: [{ unit: 'h', use: 'basic', when: [] }],
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0, skillPoints: 0, techniques: false },
    kernel,
  })

describe('Battle.healAmount', () => {
  it('returns the heal hit the kernel prices, by ability and position, with no scaling needed', () => {
    const battle = battleOf()
    expect(battle.healAmount('h', 'SKILL_HEAL')).toBe(777)
    expect(battle.healAmount('h', 'ULT_HEAL')).toBe(100)
    expect(battle.healAmount('h', 'ULT_HEAL', 1)).toBe(200)
  })

  it('the amount goes through Party.heal as it is: healed up to the missing HP, the rest overheal', () => {
    const battle = battleOf()
    battle.party.takeDamage('a', 500, 'enemy1')
    const restored = battle.party.heal('a', battle.healAmount('h', 'SKILL_HEAL'), 'h')
    expect(restored).toBe(500)
    expect(battle.party.get('a').hp).toBe(10_000)
  })

  it('refuses a damage hit (it would be read as a heal), a missing hit and a missing ability', () => {
    const battle = battleOf()
    expect(() => battle.healAmount('h', 'BASIC')).toThrow(/not a heal hit/)
    expect(() => battle.healAmount('h', 'ULT_HEAL', 2)).toThrow(/no hit 2/)
    expect(() => battle.healAmount('h', 'FUA_HEAL')).toThrow(/no ability "FUA_HEAL"/)
  })
})

describe('Battle.healAmount with debuffs present by chance (K22)', () => {
  it('the heal amount is the mean over the debuff states and is still read as a heal hit', () => {
    // A kit that tells the kernel whether a debuff is on the enemy (read as a certain fact in each state), and a kernel whose heal
    // is 1000 with it and 0 without.
    let battle!: Battle
    const reader: Kit = {
      ...Healer,
      create: (b, self) => ({
        ...Healer.create(b, self),
        attackerState: () => ({ characterConditionals: { debuffed: b.presence('enemy1', 'd') === 1 } }),
      }),
    }
    battle = new Battle({
      members: [{ ...member('h'), kit: reader }, member('a')],
      policy: [{ unit: 'h', use: 'basic', when: [] }],
      profile,
      enemyCount: 1,
      weaknesses: 'all',
      cycles: 1,
      start: { energy: 0, skillPoints: 0, techniques: false },
      kernel: {
        actionDamage: (r) => fakeResult({ SKILL_HEAL: [{ damage: r.attacker.characterConditionals?.debuffed === true ? 1000 : 0, output: 'HEAL' }] }),
      },
    })
    battle.timeline.modifiers.apply({ id: 'd', target: 'enemy1', source: 'x', debuff: true, chance: 0.25 })
    expect(battle.healAmount('h', 'SKILL_HEAL')).toBeCloseTo(250, 9)
  })
})
