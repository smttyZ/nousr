import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { BattleSetup, MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit } from '../kits/kit'
import type { Rule } from '../scenario/types'
import { lightConeWithoutBehaviour, setWithoutBehaviour } from './equipment'
import type { MemberEquipment } from './equipment'
import { PoetOfMourningCollapse } from './poetOfMourningCollapse'

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

const basicKit = (characterId: string): Kit => ({
  characterId,
  path: 'Hunt',
  element: 'Quantum',
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

const member = (key: string, equipment: MemberEquipment | undefined): MemberSetup => ({
  key,
  kit: basicKit(key),
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

const pieces = (pieceCount: 2 | 4): MemberEquipment => ({
  lightCone: lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' }),
  sets: [{ module: PoetOfMourningCollapse, pieces: pieceCount }],
})

describe('Poet of Mourning Collapse', () => {
  it('is a relic with the game id 124 and the name Fribbels uses', () => {
    expect(PoetOfMourningCollapse).toMatchObject({ kind: 'set', type: 'relic', name: 'Poet of Mourning Collapse', setId: '124' })
  })

  it('gives the kernel no conditionals at 4 pieces: SPD -8% and the CRIT Rate by SPD are Fribbels\' own', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('a', pieces(4))], kernel).run()
    expect(requests[0]!.setConditionals).toBeUndefined()
    expect(requests[0]!.attacker.lightConeConditionals).toBeUndefined()
  })

  it('gives the kernel no conditionals at 2 pieces either', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('a', pieces(2))], kernel).run()
    expect(requests[0]!.setConditionals).toBeUndefined()
  })

  it('a module with no behaviour must say why', () => {
    expect(() => setWithoutBehaviour({ type: 'relic', name: 'x', reason: '' })).toThrow(/needs a reason/)
  })
})
