import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { BattleSetup, Member, MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit } from '../kits/kit'
import type { Rule } from '../scenario/types'
import { lightConeWithoutBehaviour } from './equipment'
import type { MemberEquipment } from './equipment'
import { GiantTreeOfRaptBrooding } from './giantTreeOfRaptBrooding'

const profile = loadEnemyProfile('generic-moc')
const noBuild: KernelBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

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

/** A basic-only kit. `healsOnStart` makes it take 500 damage and heal 100 at battle start, from `healer` as source. */
const kitWith = (characterId: string, healsOnStart: ((battle: Battle, self: Member) => void) | undefined): Kit => ({
  characterId,
  path: 'Hunt',
  element: 'Lightning',
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
    ...(healsOnStart && {
      onBattleStart: () => {
        battle.party.takeDamage(self.key, 500, 'enemy1')
        healsOnStart(battle, self)
      },
    }),
  }),
})

const member = (key: string, kit: Kit, equipment: MemberEquipment | undefined): MemberSetup => ({
  key,
  kit,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: key, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
  ...(equipment && { equipment }),
})

const rule = (unit: string): Rule => ({ unit, use: 'basic', when: [] })

function battleOf(members: MemberSetup[], kernel: DamageKernel, overrides: Partial<BattleSetup> = {}) {
  return new Battle({
    members,
    policy: members.map((m) => rule(m.key)),
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0.5, skillPoints: 3, techniques: false },
    kernel,
    ...overrides,
  })
}

const wearing: MemberEquipment = {
  lightCone: lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' }),
  sets: [{ module: GiantTreeOfRaptBrooding, pieces: 2 }],
}

describe('Giant Tree of Rapt Brooding', () => {
  it('is an ornament with the game id 320 and the name Fribbels uses', () => {
    expect(GiantTreeOfRaptBrooding).toMatchObject({ kind: 'set', type: 'ornament', name: 'Giant Tree of Rapt Brooding', setId: '320' })
  })

  it('gives the kernel no conditionals: its SPD thresholds are Fribbels\' own and touch healing only', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('a', kitWith('a', undefined), wearing)], kernel).run()
    expect(requests[0]!.setConditionals).toBeUndefined()
  })

  it('runs a wearer that never heals, and a wearer whose ally heals', () => {
    const { kernel } = recordingKernel()
    expect(() => battleOf([member('a', kitWith('a', undefined), wearing)], kernel).run()).not.toThrow()
    // b heals the wearer a: the source is b, so a's Outgoing Healing is not what the heal uses.
    const allyHeals = (battle: Battle) => battle.party.heal('a', 100, 'b')
    expect(() =>
      battleOf([member('a', kitWith('a', undefined), wearing), member('b', kitWith('b', allyHeals), undefined)], kernel).run(),
    ).not.toThrow()
  })

  it('stops, naming the missing Outgoing Healing, when the wearer heals', () => {
    const { kernel } = recordingKernel()
    const selfHeals = (battle: Battle, self: Member) => battle.party.heal(self.key, 100, self.key)
    const battle = battleOf([member('a', kitWith('a', selfHeals), wearing)], kernel)
    expect(() => battle.run()).toThrow(/Giant Tree of Rapt Brooding on a: NOT MODELLED: its Outgoing Healing bonus/)
  })

  it('stops when a summon the wearer owns is the source of a heal', () => {
    const { kernel } = recordingKernel()
    const summonHeals = (battle: Battle, self: Member) => {
      battle.addSummon({ id: 'a.helper', owner: self.key, baseSpd: 60, takeTurn: () => {} })
      battle.party.heal(self.key, 100, 'a.helper')
    }
    const battle = battleOf([member('a', kitWith('a', summonHeals), wearing)], kernel)
    expect(() => battle.run()).toThrow(/Giant Tree of Rapt Brooding on a: NOT MODELLED/)
  })

  it("does not stop for a heal whose source is another member's summon", () => {
    const { kernel } = recordingKernel()
    const otherSummonHeals = (battle: Battle, self: Member) => {
      battle.addSummon({ id: 'b.helper', owner: self.key, baseSpd: 60, takeTurn: () => {} })
      battle.party.heal('a', 100, 'b.helper')
    }
    expect(() =>
      battleOf([member('a', kitWith('a', undefined), wearing), member('b', kitWith('b', otherSummonHeals), undefined)], kernel).run(),
    ).not.toThrow()
  })
})
