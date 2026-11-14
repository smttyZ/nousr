import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { lightConeWithoutBehaviour } from './equipment'
import type { MemberEquipment } from './equipment'
import { SacerdosRelivedOrdeal } from './sacerdosRelivedOrdeal'

const profile = loadEnemyProfile('generic-moc')
const noBuild: KernelBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const noCone = lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' })

function recordingKernel() {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = {
    actionDamage(request) {
      requests.push(request)
      return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] })
    },
  }
  return { kernel, requests }
}

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

const member = (key: string, pieces?: 2 | 4, baseSpd = 100): MemberSetup => ({
  key,
  kit: basicKit(),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
  kernel: { unit: { characterId: key, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
  ...(pieces !== undefined && { equipment: { lightCone: noCone, sets: [{ module: SacerdosRelivedOrdeal, pieces }] } as MemberEquipment }),
})

const battleOf = (members: MemberSetup[], kernel: DamageKernel) =>
  new Battle({
    members,
    policy: members.map((m) => ({ unit: m.key, use: 'basic', when: [] })),
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0.5, skillPoints: 3, techniques: false },
    kernel,
  })

describe('Sacerdos\' Relived Ordeal: the module', () => {
  it('is the set the kernel calls by name, with its set id', () => {
    expect(SacerdosRelivedOrdeal.name).toBe('Sacerdos\' Relived Ordeal')
    expect(SacerdosRelivedOrdeal.setId).toBe('121')
    expect(SacerdosRelivedOrdeal.type).toBe('relic')
  })

  it('at 2 pieces (always-on SPD only) passes no conditionals and no team flags', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('w', 2), member('f')], kernel).run()
    expect(requests.length).toBeGreaterThan(0)
    for (const r of requests) {
      expect(r.setConditionals).toBeUndefined()
      expect(r.teammates.every((t) => t.teamRelicSet === undefined)).toBe(true)
    }
  })

  it('refuses at create() at 4 pieces: the ally the wearer buffs is not reported by the engine', () => {
    const build = () => battleOf([member('w', 4), member('f')], recordingKernel().kernel)
    expect(build).toThrow(/does not report that target/)
  })
})
