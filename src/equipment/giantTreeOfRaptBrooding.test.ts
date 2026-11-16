import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { BattleSetup, Member, MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult, ZERO_STATS } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit } from '../kits/kit'
import type { Rule } from '../scenario/types'
import { lightConeWithoutBehaviour } from './equipment'
import type { MemberEquipment } from './equipment'
import { GiantTreeOfRaptBrooding } from './giantTreeOfRaptBrooding'

const profile = loadEnemyProfile('generic-moc')
const noBuild: KernelBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/** `spd` is the in-combat SPD the fake kernel reports for every attacker (what Fribbels' own threshold would read). */
function recordingKernel(spd = 100) {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = {
    actionDamage(request) {
      requests.push(request)
      const hit = [{ damage: 1000, scaling: 1 }]
      return fakeResult({ BASIC: hit, SKILL: hit, ULT: hit, FUA: hit }, { ...ZERO_STATS, SPD: spd })
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

const member = (key: string, kit: Kit, equipment: MemberEquipment | undefined, baseSpd = 100): MemberSetup => ({
  key,
  kit,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
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

  it('lets the wearer heal when the timeline and the kernel agree on the SPD: below 135, from 135 and from 180', () => {
    const selfHeals = (battle: Battle, self: Member) => battle.party.heal(self.key, 100, self.key)
    for (const spd of [100, 134.9, 135, 150, 180, 250]) {
      const { kernel } = recordingKernel(spd)
      expect(() => battleOf([member('a', kitWith('a', selfHeals), wearing, spd)], kernel).run(), `SPD ${spd}`).not.toThrow()
    }
  })

  it('stops, naming both SPDs, when the kernel is over a threshold the timeline is under (and the other way round)', () => {
    const selfHeals = (battle: Battle, self: Member) => battle.party.heal(self.key, 100, self.key)
    for (const [timeline, kernelSpd] of [[100, 135], [134, 140], [150, 180], [200, 150], [140, 100]] as const) {
      const { kernel } = recordingKernel(kernelSpd)
      const battle = battleOf([member('a', kitWith('a', selfHeals), wearing, timeline)], kernel)
      expect(() => battle.run(), `timeline ${timeline}, kernel ${kernelSpd}`).toThrow(/Giant Tree of Rapt Brooding on a: the timeline has a at SPD .* and the kernel at .*135 \/ 180/)
    }
  })

  it("checks the wearer's summon too: a heal whose source is a summon it owns", () => {
    const { kernel } = recordingKernel(140)
    const summonHeals = (battle: Battle, self: Member) => {
      battle.addSummon({ id: 'a.helper', owner: self.key, baseSpd: 60, takeTurn: () => {} })
      battle.party.heal(self.key, 100, 'a.helper')
    }
    expect(() => battleOf([member('a', kitWith('a', summonHeals), wearing, 100)], kernel).run()).toThrow(/Giant Tree of Rapt Brooding on a/)
    expect(() => battleOf([member('a', kitWith('a', summonHeals), wearing, 140)], kernel).run()).not.toThrow()
  })

  it("does not check a heal whose source is another member's summon", () => {
    const { kernel } = recordingKernel(140)
    const otherSummonHeals = (battle: Battle, self: Member) => {
      battle.addSummon({ id: 'b.helper', owner: self.key, baseSpd: 60, takeTurn: () => {} })
      battle.party.heal('a', 100, 'b.helper')
    }
    expect(() =>
      battleOf([member('a', kitWith('a', undefined), wearing, 100), member('b', kitWith('b', otherSummonHeals), undefined)], kernel).run(),
    ).not.toThrow()
  })
})
