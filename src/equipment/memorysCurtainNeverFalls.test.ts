import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { MemorysCurtainNeverFalls } from './memorysCurtainNeverFalls'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/** A wearer with a Skill (no damage), a Basic ATK, and optionally a memosprite that attacks as the wearer. */
const wearerKit = (memo: boolean): Kit => ({
  characterId: 'wearer',
  path: 'Remembrance',
  element: 'Wind',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () => battle.performAction(self.key, 'basic', 'basic', () => battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })),
      },
      skill: {
        kind: 'skill',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'skill', 'skill', () => {
            if (memo && battle.memospritesOf(self.key).length === 0) {
              battle.addMemosprite({
                id: `${self.key}.memo`, owner: self.key, name: 'x', maxHp: 1000, baseAggro: 4, baseSpd: 100,
                takeTurn: () =>
                  battle.performAction(`${self.key}.memo`, 'memo', 'skill', () =>
                    battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] }),
                  ),
              })
            }
          }),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
})
const allyKit: Kit = { ...wearerKit(false), characterId: 'ally' }

const wearer = (memo: boolean, baseSpd = 100): MemberSetup => ({
  key: 'wearer', kit: wearerKit(memo), eidolon: 0, affinitiveEidolon: false,
  stats: { maxHp: 1e6, def: 1000, baseSpd },
  kernel: { unit: { characterId: 'wearer', lightConeId: '24005', eidolon: 0, superimposition: 1 }, build: noBuild },
  equipment: { lightCone: MemorysCurtainNeverFalls, sets: [] },
})
const ally = (baseSpd = 90): MemberSetup => ({
  key: 'ally', kit: allyKit, eidolon: 0, affinitiveEidolon: false,
  stats: { maxHp: 1e6, def: 1000, baseSpd },
  kernel: { unit: { characterId: 'ally', lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
})

function setup(memo = false) {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = { actionDamage: (r) => (requests.push(r), fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] })) }
  const members = [wearer(memo), ally()]
  const battle = new Battle({
    members, policy: members.map((m) => ({ unit: m.key, use: 'basic', when: [] })), profile, enemyCount: 1, weaknesses: 'all',
    cycles: 3, start: { energy: 0, skillPoints: 3, techniques: false }, kernel,
  })
  /** The switch the kernel was last given for an attack by `who`. */
  const lastSwitch = (who: 'wearer' | 'ally'): unknown => {
    const r = [...requests].reverse().find((q) => q.attacker.characterId === who)!
    return who === 'wearer' ? r.attacker.lightConeConditionals?.teamDmgBoost : r.teammates.find((t) => t.characterId === 'wearer')?.lightConeConditionals?.teamDmgBoost
  }
  return { battle, requests, lastSwitch }
}

describe("Memory's Curtain Never Falls", () => {
  it('is off for everyone before the wearer uses its Skill, and on for the wearer and its ally after it', () => {
    const { battle, lastSwitch } = setup()
    battle.member('wearer').instance.actions.basic!.use()
    battle.member('ally').instance.actions.basic!.use()
    expect(lastSwitch('wearer')).toBe(false)
    expect(lastSwitch('ally')).toBe(false)
    battle.member('wearer').instance.actions.skill!.use()
    battle.member('wearer').instance.actions.basic!.use()
    battle.member('ally').instance.actions.basic!.use()
    expect(lastSwitch('wearer')).toBe(true)
    expect(lastSwitch('ally')).toBe(true)
  })

  it('lasts 3 of each holder turns, not counting the turn it was given in', () => {
    const { battle, lastSwitch } = setup()
    battle.member('wearer').instance.actions.skill!.use()
    const id = 'lightcone.24005.dmg:wearer'
    const mods = battle.timeline.modifiers
    expect(mods.get('ally', id)!.turnsLeft).toBe(3)
    expect(mods.get('wearer', id)!.turnsLeft).toBe(3)
    // Three turns of the run: the ally's and the wearer's countdowns run on their own turns.
    battle.run()
    expect(mods.has('ally', id)).toBe(false)
    expect(mods.has('wearer', id)).toBe(false)
  })

  it('covers a memosprite on the field at the Skill, on its own turns: its attacks read its own modifier', () => {
    const { battle, requests } = setup(true)
    battle.member('wearer').instance.actions.skill!.use()
    const id = 'lightcone.24005.dmg:wearer'
    expect(battle.timeline.modifiers.has('wearer.memo', id)).toBe(true)
    // The owner's own modifier is dropped, the memosprite's stays: an attack in the memosprite's turn is priced with the buff,
    // an attack in another unit's turn by the owner is priced from the owner's.
    battle.timeline.modifiers.remove('wearer', id)
    requests.length = 0
    battle.run()
    const wearerRequests = requests.filter((r) => r.attacker.characterId === 'wearer')
    expect(wearerRequests.some((r) => r.attacker.lightConeConditionals?.teamDmgBoost === true)).toBe(true)
    expect(wearerRequests.some((r) => r.attacker.lightConeConditionals?.teamDmgBoost === false)).toBe(true)
  })

  it('refuses a superimposition outside 1 to 5', () => {
    const bad = wearer(false)
    bad.kernel.unit.superimposition = 6
    expect(() => new Battle({
      members: [bad], policy: [{ unit: 'wearer', use: 'basic', when: [] }], profile, enemyCount: 1, weaknesses: 'all',
      cycles: 1, start: { energy: 0, skillPoints: 3, techniques: false }, kernel: { actionDamage: () => fakeResult({}) },
    })).toThrow(/superimposition/)
  })
})
