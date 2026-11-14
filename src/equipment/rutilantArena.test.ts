import { describe, expect, it } from 'vitest'
import { Battle, type BattleSetup, type MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit, KitAction } from '../kits/kit'
import type { Rule } from '../scenario/types'
import type { MemberEquipment } from './equipment'
import { lightConeWithoutBehaviour } from './equipment'
import { RutilantArena } from './rutilantArena'

const profile = loadEnemyProfile('generic-moc')
const noBuild: KernelBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

function recordingKernel(): { kernel: DamageKernel, requests: DamageRequest[] } {
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

/** A made-up wearer with one Basic ATK per turn. */
const basicer = (key: string): Kit => ({
  characterId: key,
  path: 'Hunt',
  element: 'Ice',
  maxEnergy: 0,
  create: (battle: Battle) => {
    const actions: Record<string, KitAction> = {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () => battle.performAction(key, 'basic', 'basic', () => {
          battle.attack({ attacker: key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
        }),
      },
    }
    return { actions, attackerState: () => ({}), teammateState: () => ({}) }
  },
})

const member = (key: string): MemberSetup => ({
  key,
  kit: basicer(key),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: key, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
  equipment: {
    lightCone: lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' }),
    sets: [{ module: RutilantArena, pieces: 2 }],
  } satisfies MemberEquipment,
})

function battleOf(members: MemberSetup[], kernel: DamageKernel, overrides: Partial<BattleSetup> = {}): Battle {
  const policy: Rule[] = members.map((m) => ({ unit: m.key, use: 'basic', when: [] }))
  return new Battle({
    members,
    policy,
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0.5, skillPoints: 3, techniques: false },
    kernel,
    ...overrides,
  })
}

describe('Rutilant Arena', () => {
  it('is registered as an ornament with no behaviour, under the game id Fribbels uses', () => {
    expect(RutilantArena).toMatchObject({ kind: 'set', type: 'ornament', name: 'Rutilant Arena', setId: '309' })
  })

  it('supplies no conditional: Fribbels evaluates the 70% CRIT Rate threshold itself', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('wearer')], kernel).run()
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((r) => r.setConditionals === undefined)).toBe(true)
  })
})
