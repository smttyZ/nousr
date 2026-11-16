import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { AmphoreusTheEternalLand } from './amphoreusTheEternalLand'
import { lightConeWithoutBehaviour } from './equipment'
import type { MemberEquipment } from './equipment'

const profile = loadEnemyProfile('generic-moc')
const noBuild: KernelBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const NAME = 'Amphoreus, The Eternal Land'
const MODIFIER = 'set.323.spd'
const BASE_SPD = 100

function recordingKernel() {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = {
    actionDamage(request) {
      requests.push(request)
      const hit = [{ damage: 1000, scaling: 1 }]
      return fakeResult({ BASIC: hit, SKILL: hit, ULT: hit, FUA: hit })
    },
  }
  return { kernel, requests }
}

/** A kit with a Basic ATK. `key.memo` is the id of the memosprite the tests add (with `baseSpd` unless it has none). */
const basicKit = (characterId: string): Kit => ({
  characterId,
  path: 'Remembrance',
  element: 'Fire',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'basic', 'basic', () => {
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
          }),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
})

const worn: MemberEquipment = {
  lightCone: lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' }),
  sets: [{ module: AmphoreusTheEternalLand, pieces: 2 }],
}

/** `characterId` is the Fribbels id. */
const member = (key: string, characterId: string, equipment: MemberEquipment | undefined): MemberSetup => ({
  key,
  kit: basicKit(characterId),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: BASE_SPD },
  kernel: { unit: { characterId, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
  ...(equipment && { equipment }),
})

const ACHERON = '1308'
const ROBIN = '1512'
const CASTORICE = '1407'

function setup(members: MemberSetup[]) {
  const { kernel, requests } = recordingKernel()
  const battle = new Battle({
    members, policy: members.map((m) => ({ unit: m.key, use: 'basic', when: [] })), profile, enemyCount: 1, weaknesses: 'all',
    cycles: 1, start: { energy: 0.5, skillPoints: 3, techniques: false }, kernel,
  })
  const addMemo = (owner: string, options: { spd?: number | null, id?: string } = {}) =>
    battle.addMemosprite({
      id: options.id ?? `${owner}.memo`, owner, name: 'x', maxHp: 500, baseAggro: 4,
      ...(options.spd !== null && { baseSpd: options.spd ?? 100 }), takeTurn: () => {},
    })
  const spd = (unit: string) => battle.timeline.spd(unit)
  const mods = battle.timeline.modifiers
  return { battle, requests, addMemo, spd, mods }
}

describe('Amphoreus, The Eternal Land', () => {
  it('is an ornament with the game id 323 and the name Fribbels uses', () => {
    expect(AmphoreusTheEternalLand).toMatchObject({ kind: 'set', type: 'ornament', name: NAME, setId: '323' })
  })

  describe('a wearer with no memosprite', () => {
    it('passes the switch OFF, gives no team flag and no SPD', () => {
      const { battle, requests, spd } = setup([member('a', ACHERON, worn), member('b', ACHERON, undefined)])
      battle.member('a').instance.actions.basic!.use()
      battle.member('b').instance.actions.basic!.use()
      expect(requests[0]!.setConditionals).toEqual({ [NAME]: false })
      expect(requests[1]!.teammates[0]).not.toHaveProperty('teamOrnamentSet')
      expect(spd('a')).toBe(BASE_SPD)
      expect(spd('b')).toBe(BASE_SPD)
    })

    it('leaves the CRIT Rate 8% to Fribbels: the module adds no light cone state', () => {
      const { battle, requests } = setup([member('a', ACHERON, worn)])
      battle.member('a').instance.actions.basic!.use()
      expect(requests[0]!.attacker.lightConeConditionals).toBeUndefined()
    })
  })

  describe('a wearer with a memosprite', () => {
    it('gives every ally +8% SPD on the timeline while the memosprite is on the field, and takes it off when it leaves', () => {
      const { battle, addMemo, spd, mods } = setup([member('r', ROBIN, worn), member('a', ACHERON, undefined)])
      expect(spd('r')).toBe(BASE_SPD)
      addMemo('r')
      expect(spd('r')).toBeCloseTo(BASE_SPD * 1.08, 9)
      expect(spd('a')).toBeCloseTo(BASE_SPD * 1.08, 9)
      expect(spd('r.memo')).toBeCloseTo(100 * 1.08, 9) // memosprites are allies
      expect(mods.has('a', MODIFIER)).toBe(true)
      battle.removeMemosprite('r.memo')
      expect(spd('r')).toBe(BASE_SPD)
      expect(spd('a')).toBe(BASE_SPD)
      expect(mods.has('a', MODIFIER)).toBe(false)
    })

    it('can come back: a second summoning puts it on again', () => {
      const { battle, addMemo, spd } = setup([member('r', ROBIN, worn), member('a', ACHERON, undefined)])
      addMemo('r')
      battle.removeMemosprite('r.memo')
      addMemo('r')
      expect(spd('a')).toBeCloseTo(BASE_SPD * 1.08, 9)
    })

    it('does not touch a memosprite with no SPD (not on the timeline), and does not fail on it', () => {
      const { addMemo, spd, battle } = setup([member('r', ROBIN, worn)])
      expect(() => addMemo('r', { spd: null })).not.toThrow()
      expect(spd('r')).toBeCloseTo(BASE_SPD * 1.08, 9)
      expect(battle.timeline.has('r.memo')).toBe(false)
      expect(battle.timeline.modifiers.has('r.memo', MODIFIER)).toBe(false) // nothing to scale: no modifier on a unit that is not there
    })

    it('puts it on a suspended memosprite too (Summer Songbirds before Fever)', () => {
      const { battle, mods } = setup([member('r', ROBIN, worn)])
      battle.addMemosprite({ id: 'r.memo', owner: 'r', name: 'x', maxHp: 500, baseAggro: 4, baseSpd: 100, suspended: true, takeTurn: () => {} })
      expect(mods.has('r.memo', MODIFIER)).toBe(true)
    })

    it("gives a teammate's memosprite that joins later the SPD too, while the effect is up", () => {
      const { addMemo, spd } = setup([member('r', ROBIN, worn), member('c', CASTORICE, undefined)])
      addMemo('r')
      addMemo('c')
      expect(spd('c.memo')).toBeCloseTo(BASE_SPD * 1.08, 9)
    })

    it('a memosprite of a member that does not wear the set does not turn it on', () => {
      const { addMemo, spd } = setup([member('r', ROBIN, worn), member('c', CASTORICE, undefined)])
      addMemo('c')
      expect(spd('r')).toBe(BASE_SPD)
      expect(spd('c')).toBe(BASE_SPD)
      expect(spd('c.memo')).toBe(100)
    })

    it('ends when the wearer is downed (its memosprite leaves with it): the others lose it', () => {
      const { battle, addMemo, spd } = setup([member('r', ROBIN, worn), member('a', ACHERON, undefined)])
      addMemo('r')
      battle.party.takeDamage('r', 1e12, 'enemy')
      expect(spd('a')).toBe(BASE_SPD)
    })

    it("gives the kernel the switch ON for the wearer's own attacks while the memosprite is on the field, OFF after", () => {
      const { battle, requests, addMemo } = setup([member('r', ROBIN, worn), member('a', ACHERON, undefined)])
      battle.member('r').instance.actions.basic!.use()
      addMemo('r')
      battle.member('r').instance.actions.basic!.use()
      battle.removeMemosprite('r.memo')
      battle.member('r').instance.actions.basic!.use()
      // The kernel's answers are cached for equal requests, so the first and third (both OFF) are one request.
      expect(requests.map((r) => r.setConditionals?.[NAME])).toEqual([false, true])
      battle.member('r').instance.actions.basic!.use()
      expect(requests).toHaveLength(2)
    })

    it("gives a teammate's attack the team form only while the memosprite is on the field", () => {
      const { battle, requests, addMemo } = setup([member('r', ROBIN, worn), member('a', ACHERON, undefined)])
      battle.member('a').instance.actions.basic!.use()
      addMemo('r')
      battle.member('a').instance.actions.basic!.use()
      expect(requests[0]!.teammates[0]).not.toHaveProperty('teamOrnamentSet')
      expect(requests[1]!.teammates[0]).toMatchObject({ teamOrnamentSet: NAME })
    })
  })

  describe('two wearers', () => {
    const two = () => setup([member('r', ROBIN, worn), member('c', CASTORICE, worn), member('a', ACHERON, undefined)])

    it('do not stack: one shared modifier, +8% once', () => {
      const { addMemo, spd, mods } = two()
      addMemo('r')
      addMemo('c')
      expect(spd('a')).toBeCloseTo(BASE_SPD * 1.08, 9)
      expect(spd('r')).toBeCloseTo(BASE_SPD * 1.08, 9)
      expect(mods.on('a').filter((m) => m.id === MODIFIER)).toHaveLength(1)
    })

    it('stay on while either has a memosprite: only when the last leaves does it go', () => {
      const { battle, addMemo, spd } = two()
      addMemo('r')
      addMemo('c')
      const removed: string[] = []
      battle.timeline.bus.on('modifierRemoved', (e) => e.modifier.id === MODIFIER && removed.push(e.modifier.target))
      battle.removeMemosprite('r.memo')
      expect(removed).toEqual(['r.memo']) // the memosprite's own, with it: nobody else loses it, not even for a moment
      expect(spd('a')).toBeCloseTo(BASE_SPD * 1.08, 9)
      battle.removeMemosprite('c.memo')
      expect(spd('a')).toBe(BASE_SPD)
    })

    it('the kernel is given the team form by each wearer that has a memosprite (Fribbels counts it once: the real-kernel test checks the SPD)', () => {
      const { battle, requests, addMemo } = two()
      addMemo('r')
      addMemo('c')
      battle.member('a').instance.actions.basic!.use()
      expect(requests.at(-1)!.teammates.filter((t) => t.teamOrnamentSet === NAME)).toHaveLength(2)
    })
  })
})
