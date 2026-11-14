import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { lightConeWithoutBehaviour } from './equipment'
import type { MemberEquipment } from './equipment'
import { SelfEnshroudedRecluse } from './selfEnshroudedRecluse'

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

const member = (key: string, pieces?: 2 | 4): MemberSetup => ({
  key,
  kit: basicKit(),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: key, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
  ...(pieces !== undefined && { equipment: { lightCone: noCone, sets: [{ module: SelfEnshroudedRecluse, pieces }] } as MemberEquipment }),
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

describe('Self-Enshrouded Recluse: the module', () => {
  it('is the set the kernel calls by name, with its set id', () => {
    expect(SelfEnshroudedRecluse.name).toBe('Self-Enshrouded Recluse')
    expect(SelfEnshroudedRecluse.setId).toBe('128')
    expect(SelfEnshroudedRecluse.type).toBe('relic')
  })

  it('at 2 pieces passes no conditionals: the shield boost has no damage effect and no shield amount is priced yet', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('w', 2), member('f')], kernel).run()
    expect(requests.length).toBeGreaterThan(0)
    for (const r of requests) expect(r.setConditionals).toBeUndefined()
  })

  it('refuses at create() at 4 pieces: the ally\'s CRIT DMG depends on a shield source the engine does not record', () => {
    expect(() => battleOf([member('w', 4), member('f')], recordingKernel().kernel)).toThrow(/does not record a shield's source/)
  })
})
