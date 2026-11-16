import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import { Anaxa } from '../kits/anaxa'
import type { Kit } from '../kits/kit'
import type { Element } from '../scenario/types'
import { TheGreatCosmicEnterprise } from './theGreatCosmicEnterprise'

/**
 * The Great Cosmic Enterprise: the kernel's `weaknessTypes` is the enemy's number of Weakness Types, from Anaxa's kit when he wears
 * it (his implants and Sublimation, K28) and from the scenario's weaknesses otherwise.
 */

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

const Wearer: Kit = {
  characterId: 'wearer',
  path: 'Erudition',
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
}

const kernelFor = (requests: DamageRequest[]): DamageKernel => ({
  actionDamage(request) {
    requests.push(request)
    const flat = [{ damage: 1000, scaling: 1 }]
    return fakeResult({ BASIC: flat, SKILL: flat, ULT: flat, BREAK: [{ damage: 500 }] })
  },
})

const wearing = (kit: Kit, characterId: string, superimposition = 1): MemberSetup => ({
  key: 'w',
  kit,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId, lightConeId: '22004', eidolon: 0, superimposition }, build: noBuild },
  equipment: { lightCone: TheGreatCosmicEnterprise, sets: [] },
})

const plainAnaxa = (key: string): MemberSetup => ({
  key,
  kit: Anaxa,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: '1405', lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
})

function setup(member: MemberSetup, weaknesses: 'all' | Element[], enemies = 1, others: MemberSetup[] = []) {
  const requests: DamageRequest[] = []
  const battle = new Battle({
    members: [member, ...others],
    policy: [],
    profile,
    enemyCount: enemies,
    weaknesses,
    cycles: 3,
    start: { energy: 0, skillPoints: 3, techniques: false },
    kernel: kernelFor(requests),
  })
  const act = battle.member(member.key).instance.actions
  const counts = () => requests.filter((r) => r.attacker.characterId === member.kernel.unit.characterId).map((r) => r.attacker.lightConeConditionals!.weaknessTypes)
  return { battle, act, requests, counts }
}

describe('The Great Cosmic Enterprise', () => {
  it('is light cone 22004', () => {
    expect(TheGreatCosmicEnterprise.id).toBe('22004')
    expect(TheGreatCosmicEnterprise.kind).toBe('lightCone')
  })

  it('a wearer with no weakness tracking of its own reads the scenario: 7 for "all", else the length of the list', () => {
    const cases: Array<['all' | Element[], number]> = [['all', 7], [['Ice'], 1], [['Ice', 'Fire', 'Wind'], 3], [['Ice', 'Ice'], 1], [[], 0]]
    for (const [weaknesses, expected] of cases) {
      const { act, counts } = setup(wearing(Wearer, 'wearer'), weaknesses)
      act.basic!.use()
      expect(counts()).toEqual([expected])
    }
  })

  it('is the same for every enemy count', () => {
    for (const enemies of [1, 3, 5]) {
      const { act, counts } = setup(wearing(Wearer, 'wearer'), ['Ice', 'Fire'], enemies)
      act.basic!.use()
      expect(counts()).toEqual([2])
    }
  })

  it('Anaxa wearing it under "all": every enemy has 7 Types from the start', () => {
    const { act, counts } = setup(wearing(Anaxa, '1405'), 'all', 3)
    act.skill!.use()
    expect(new Set(counts())).toEqual(new Set([7]))
  })

  it('Anaxa wearing it, [Ice] on one enemy: the count rises with each implant (1 to 5 for the Skill, then 6 and 7 on the extra Skill, capped at 7)', () => {
    const { act, counts } = setup(wearing(Anaxa, '1405'), ['Ice'], 1)
    act.skill!.use()
    // The 5th instance sees 5 Types and so is in Disclosure, which casts the extra Skill; its first instances see 6 and 7.
    expect(counts().slice(0, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('Anaxa wearing it, [Ice] on 3 enemies: a fractional count (expected Types) reaches the kernel', () => {
    const { act, counts } = setup(wearing(Anaxa, '1405'), ['Ice'], 3)
    act.skill!.use()
    // The designated and covering instances see 1; the first free instance 2; the second 2 + 1/3 (one more implant at 1/3).
    expect(counts()).toEqual([1, 2, expect.closeTo(2 + 1 / 3, 12)])
  })

  it('Anaxa wearing it: his Ultimate prices the hit at 7 Types (Sublimation first), whatever the scenario says', () => {
    const { battle, act, counts } = setup(wearing(Anaxa, '1405'), ['Ice'], 3)
    battle.party.setEnergy('w', 140)
    act.ultimate!.use()
    expect(counts()).toEqual([7])
  })

  it('another character wearing it reads the scenario, not the implants Anaxa put on the enemy (K28)', () => {
    const other: MemberSetup = { ...wearing(Wearer, 'wearer'), key: 'o' }
    const { battle, act, requests } = setup(plainAnaxa('a'), ['Ice'], 5, [other])
    act.skill!.use()
    battle.member('o').instance.actions.basic!.use()
    const request = requests.find((r) => r.attacker.characterId === 'wearer')!
    expect(request.attacker.lightConeConditionals).toEqual({ weaknessTypes: 1 })
  })

  it('gives nothing to a teammate\'s request: it is the wearer\'s own effect', () => {
    const { act, requests } = setup(wearing(Wearer, 'wearer'), 'all', 1, [plainAnaxa('a')])
    act.basic!.use()
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((r) => r.teammates.every((t) => t.lightConeConditionals === undefined))).toBe(true)
  })

  it('refuses a superimposition outside 1 to 5', () => {
    for (const bad of [0, 6, 1.5]) {
      expect(() => setup(wearing(Wearer, 'wearer', bad), 'all')).toThrow(/superimposition must be 1 to 5/)
    }
  })
})
