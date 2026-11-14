import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { lightConeWithoutBehaviour } from './equipment'
import type { MemberEquipment } from './equipment'
import { BrokenKeel } from './brokenKeel'

const profile = loadEnemyProfile('generic-moc')
const noBuild: KernelBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const noCone = lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' })
const kernel: DamageKernel = { actionDamage: () => fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] }) }

const basicKit = (): Kit => ({
  characterId: 'basic',
  path: 'Harmony',
  element: 'Fire',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () => battle.performAction(self.key, 'basic', 'basic', () => {
          battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'aoe', scaling: 1, hit: 0 }] })
        }),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
})

const member = (key: string, equipment?: MemberEquipment): MemberSetup => ({
  key,
  kit: basicKit(),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: key, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
  ...(equipment && { equipment }),
})

describe('Broken Keel: the module', () => {
  it('is the ornament the kernel calls by name, with its set id', () => {
    expect(BrokenKeel.name).toBe('Broken Keel')
    expect(BrokenKeel.setId).toBe('310')
    expect(BrokenKeel.type).toBe('ornament')
  })

  const wearing: MemberEquipment = { lightCone: noCone, sets: [{ module: BrokenKeel, pieces: 2 }] }
  const requests: DamageRequest[] = []
  const recording: DamageKernel = {
    actionDamage: (request) => {
      requests.push(request)
      return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] })
    },
  }
  const run = (effectRes: number | undefined) => {
    requests.length = 0
    const wearer = member('w', wearing)
    if (effectRes === undefined) delete wearer.stats.effectRes
    else wearer.stats.effectRes = effectRes
    new Battle({
      members: [wearer, member('f')],
      policy: [{ unit: 'w', use: 'basic', when: [] }, { unit: 'f', use: 'basic', when: [] }],
      profile,
      enemyCount: 1,
      weaknesses: 'all',
      cycles: 1,
      start: { energy: 0.5, skillPoints: 3, techniques: false },
      kernel: recording,
    }).run()
  }
  /** The teammate flag the wearer 'w' gave in the requests priced for the other member 'f'. */
  const flagsForFriend = () => requests.filter((r) => r.attacker.characterId === 'f').map((r) => r.teammates[0]?.teamOrnamentSet)

  it('gives the team flag at exactly 30% Effect RES', () => {
    run(0.3)
    expect(flagsForFriend().length).toBeGreaterThan(0)
    expect(flagsForFriend().every((f) => f === 'Broken Keel')).toBe(true)
  })

  it('gives no team flag just under 30% Effect RES', () => {
    run(0.2999)
    expect(flagsForFriend().length).toBeGreaterThan(0)
    expect(flagsForFriend().every((f) => f === undefined)).toBe(true)
  })

  it('gives the flag well above 30%', () => {
    run(0.55)
    expect(flagsForFriend().every((f) => f === 'Broken Keel')).toBe(true)
  })

  it("never puts a team flag on the wearer's own attacks", () => {
    run(0.55)
    expect(requests.filter((r) => r.attacker.characterId === 'w').every((r) => r.teammates.every((t) => t.teamOrnamentSet === undefined))).toBe(true)
  })

  it('refuses a wearer whose effectRes is unknown', () => {
    expect(() => run(undefined)).toThrow(/no stats\.effectRes/)
  })
})
