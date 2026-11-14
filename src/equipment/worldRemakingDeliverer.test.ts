import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { BattleSetup, MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit } from '../kits/kit'
import type { Rule } from '../scenario/types'
import { lightConeWithoutBehaviour } from './equipment'
import type { MemberEquipment } from './equipment'
import { MEMOSPRITE_CHARACTERS, WorldRemakingDeliverer, hasMemosprite } from './worldRemakingDeliverer'

const profile = loadEnemyProfile('generic-moc')
const noBuild: KernelBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const NAME = 'World-Remaking Deliverer'

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
  element: 'Fire',
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

/** `characterId` is the Fribbels id, which is also what the memosprite check reads. */
const member = (key: string, characterId: string, equipment: MemberEquipment | undefined): MemberSetup => ({
  key,
  kit: basicKit(characterId),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
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

const ACHERON = '1308'
const CASTORICE = '1407'
const worn = (pieces: 2 | 4): MemberEquipment => ({
  lightCone: lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' }),
  sets: [{ module: WorldRemakingDeliverer, pieces }],
})

describe('World-Remaking Deliverer', () => {
  it('is a relic with the game id 127 and the name Fribbels uses', () => {
    expect(WorldRemakingDeliverer).toMatchObject({ kind: 'set', type: 'relic', name: NAME, setId: '127' })
  })

  it('passes the 4-piece switch OFF for a wearer with no memosprite, at 4 pieces', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('a', ACHERON, worn(4))], kernel).run()
    expect(requests[0]!.setConditionals).toEqual({ [NAME]: false })
  })

  it('also switches it OFF at 2 pieces, where the 4-piece effect is not worn at all', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('a', ACHERON, worn(2))], kernel).run()
    expect(requests[0]!.setConditionals).toEqual({ [NAME]: false })
  })

  it('gives no team flag to the team: a teammate wearing it at 4 pieces without a memosprite is not a team buff', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('a', ACHERON, undefined), member('b', '1400', worn(4))], kernel).run()
    expect(requests[0]!.teammates[0]).not.toHaveProperty('teamRelicSet')
  })

  it('stops at create for a memosprite wearer at 4 pieces, naming the memosprite', () => {
    const { kernel } = recordingKernel()
    expect(() => battleOf([member('c', CASTORICE, worn(4))], kernel)).toThrow(/World-Remaking Deliverer \(4 pieces\) on c \(1407\): NOT MODELLED.*memosprite/)
  })

  it('simulates a memosprite wearer at 2 pieces, since the 2-piece text has no memosprite part', () => {
    const { kernel, requests } = recordingKernel()
    expect(() => battleOf([member('c', CASTORICE, worn(2))], kernel).run()).not.toThrow()
    expect(requests[0]!.setConditionals).toEqual({ [NAME]: false })
  })

  it('a buffed kernel id of a memosprite character (1407b1) is still a memosprite wearer: the suffix is stripped', () => {
    const { kernel } = recordingKernel()
    expect(hasMemosprite({ kernel: { unit: { characterId: '1407b1' } } } as never)).toBe(true)
    expect(() => battleOf([member('c', '1407b1', worn(4))], kernel)).toThrow(/NOT MODELLED.*memosprite/)
    expect(hasMemosprite({ kernel: { unit: { characterId: '1308b1' } } } as never)).toBe(false)
  })

  it('knows which characters have a memosprite, from Fribbels\' config', () => {
    expect(MEMOSPRITE_CHARACTERS.has(CASTORICE)).toBe(true)
    expect(hasMemosprite({ kernel: { unit: { characterId: CASTORICE } } } as never)).toBe(true)
    expect(hasMemosprite({ kernel: { unit: { characterId: ACHERON } } } as never)).toBe(false)
  })
})
