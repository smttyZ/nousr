import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { TheStorysNextPage } from './theStorysNextPage'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const MODIFIER = 'lightcone.21054.ohb'

/** A wearer whose Basic ATK is a plain hit and whose Skill puts a memosprite (no SPD) on the field, which acts through `battle.grantExtraTurn`. */
const wearerKit: Kit = {
  characterId: 'wearer',
  path: 'Remembrance',
  element: 'Wind',
  maxEnergy: 0,
  create: (battle, self) => {
    const memo = `${self.key}.memo`
    const hit = () => battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
    return {
      actions: {
        basic: {
          kind: 'basic',
          canUse: () => true,
          use: () => battle.performAction(self.key, 'basic', 'basic', hit),
        },
        skill: {
          kind: 'skill',
          canUse: () => true,
          use: () =>
            battle.performAction(self.key, 'skill', 'skill', () => {
              if (!battle.isMemosprite(memo)) {
                battle.addMemosprite({
                  id: memo, owner: self.key, name: 'x', maxHp: 1000, baseAggro: 4,
                  takeTurn: () => battle.performAction(memo, 'memo', 'skill', hit),
                })
              }
              battle.grantExtraTurn(memo)
            }),
        },
      },
      attackerState: () => ({}),
      teammateState: () => ({}),
    }
  },
}

const wearer = (): MemberSetup => ({
  key: 'wearer', kit: wearerKit, eidolon: 0, affinitiveEidolon: false,
  stats: { maxHp: 1e6, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: 'wearer', lightConeId: '21054', eidolon: 0, superimposition: 1 }, build: noBuild },
  equipment: { lightCone: TheStorysNextPage, sets: [] },
})

/** A second character with the same kit (and its own memosprite), wearing nothing. */
const ally = (): MemberSetup => ({
  key: 'ally', kit: wearerKit, eidolon: 0, affinitiveEidolon: false,
  stats: { maxHp: 1e6, def: 1000, baseSpd: 90 },
  kernel: { unit: { characterId: 'wearer', lightConeId: 'none', eidolon: 0, superimposition: 1 }, build: noBuild },
})

function setup(withAlly = false) {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = { actionDamage: (r) => (requests.push(r), fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] })) }
  const battle = new Battle({
    members: withAlly ? [wearer(), ally()] : [wearer()],
    policy: withAlly ? [{ unit: 'wearer', use: 'basic', when: [] }, { unit: 'ally', use: 'basic', when: [] }] : [{ unit: 'wearer', use: 'basic', when: [] }],
    profile, enemyCount: 1, weaknesses: 'all',
    cycles: 3, start: { energy: 0, skillPoints: 3, techniques: false }, kernel,
  })
  return { battle, requests }
}

describe("The Story's Next Page", () => {
  it("has its Outgoing Healing off until the wearer's memosprite attacks", () => {
    const { battle, requests } = setup()
    battle.member('wearer').instance.actions.basic!.use()
    expect(requests[requests.length - 1]!.attacker.lightConeConditionals?.ohbBuff).toBe(false)
  })

  it("turns it on for the wearer after the memosprite acts: the memosprite's own attack is priced without it, the wearer's next one with it", () => {
    const { battle, requests } = setup()
    battle.member('wearer').instance.actions.skill!.use()
    expect(battle.timeline.modifiers.has('wearer', MODIFIER)).toBe(false)
    battle.run()
    const flags = requests.map((r) => r.attacker.lightConeConditionals?.ohbBuff)
    expect(flags[0]).toBe(false)
    expect(flags).toContain(true)
  })

  it("lasts one of the wearer's turns: given on the memosprite's turn, it is up for the wearer's next turn and gone for the one after", () => {
    const { battle } = setup()
    battle.member('wearer').instance.actions.skill!.use()
    const mods = battle.timeline.modifiers
    const starts: boolean[] = []
    battle.timeline.bus.on('turnStart', (t) => {
      if (t.unit === 'wearer') starts.push(mods.has('wearer', MODIFIER))
    })
    battle.run()
    expect(starts.slice(0, 2)).toEqual([true, false])
  })

  it("ignores the wearer's own actions", () => {
    const { battle } = setup()
    battle.member('wearer').instance.actions.basic!.use()
    expect(battle.timeline.modifiers.has('wearer', MODIFIER)).toBe(false)
  })

  it("ignores an ally's actions and its memosprite's: only the wearer's own memosprite gives the buff", () => {
    const { battle } = setup(true)
    const applied: string[] = []
    battle.timeline.bus.on('modifierApplied', ({ modifier }) => {
      if (modifier.id === MODIFIER) applied.push(modifier.target)
    })
    battle.member('ally').instance.actions.basic!.use()
    expect(battle.timeline.modifiers.has('wearer', MODIFIER)).toBe(false)
    // The ally's memosprite acts through an extra turn: its owner is the ally, not the wearer.
    battle.member('ally').instance.actions.skill!.use()
    battle.run()
    expect(applied).not.toContain('wearer')
  })
})
