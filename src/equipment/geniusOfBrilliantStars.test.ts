import { describe, expect, it } from 'vitest'
import { Battle, type BattleSetup, type MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit, KitAction } from '../kits/kit'
import type { Rule } from '../scenario/types'
import type { MemberEquipment } from './equipment'
import { lightConeWithoutBehaviour } from './equipment'
import { GeniusOfBrilliantStars } from './geniusOfBrilliantStars'

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
  element: 'Quantum',
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

const member = (key: string, pieces: 2 | 4): MemberSetup => ({
  key,
  kit: basicer(key),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: key, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
  equipment: {
    lightCone: lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' }),
    sets: [{ module: GeniusOfBrilliantStars, pieces }],
  } satisfies MemberEquipment,
})

const policy = (key: string): Rule[] => [{ unit: key, use: 'basic', when: [] }]

function battleOf(members: MemberSetup[], kernel: DamageKernel, overrides: Partial<BattleSetup> = {}): Battle {
  return new Battle({
    members,
    policy: members.flatMap((m) => policy(m.key)),
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0.5, skillPoints: 3, techniques: false },
    kernel,
    ...overrides,
  })
}

describe('Genius of Brilliant Stars: 2 pieces', () => {
  it('runs with no conditional to supply: the 2-piece Quantum DMG is always on and Fribbels applies it', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('wearer', 2)], kernel, { cycles: 1 }).run()
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((r) => r.setConditionals === undefined)).toBe(true)
  })
})

describe('Genius of Brilliant Stars: 4 pieces', () => {
  const SET = 'Genius of Brilliant Stars'
  const flagFor = (weaknesses: BattleSetup['weaknesses']) => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('wearer', 4)], kernel, { weaknesses }).run()
    expect(requests.length).toBeGreaterThan(0)
    return [...new Set(requests.map((r) => r.setConditionals?.[SET]))]
  }

  it('is no longer refused', () => {
    const { kernel } = recordingKernel()
    expect(() => battleOf([member('wearer', 4)], kernel)).not.toThrow()
  })

  it('turns the second 10% DEF PEN on when the enemies are weak to everything', () => {
    expect(flagFor('all')).toEqual([true])
  })

  it('turns it on when Quantum is among the weaknesses, even for a wearer of another element', () => {
    expect(flagFor(['Fire', 'Quantum'])).toEqual([true])
  })

  it('leaves it off when the enemies are not weak to Quantum, even for a Quantum wearer', () => {
    // The made-up wearer is Quantum: Fribbels' own preset would turn the flag on for it.
    expect(flagFor(['Fire', 'Ice'])).toEqual([false])
  })
})
