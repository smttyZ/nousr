import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { BattleSetup, MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit } from '../kits/kit'
import type { Rule } from '../scenario/types'
import { AmphoreusTheEternalLand } from './amphoreusTheEternalLand'
import { lightConeWithoutBehaviour } from './equipment'
import type { MemberEquipment } from './equipment'

const profile = loadEnemyProfile('generic-moc')
const noBuild: KernelBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const NAME = 'Amphoreus, The Eternal Land'

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
const ROBIN = '1512'
const worn: MemberEquipment = {
  lightCone: lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' }),
  sets: [{ module: AmphoreusTheEternalLand, pieces: 2 }],
}

describe('Amphoreus, The Eternal Land', () => {
  it('is an ornament with the game id 323 and the name Fribbels uses', () => {
    expect(AmphoreusTheEternalLand).toMatchObject({ kind: 'set', type: 'ornament', name: NAME, setId: '323' })
  })

  it('passes the team SPD switch OFF for a wearer with no memosprite', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('a', ACHERON, worn)], kernel).run()
    expect(requests[0]!.setConditionals).toEqual({ [NAME]: false })
  })

  it('gives no team flag to the team, so a teammate wearing it is not a team SPD buff for a memosprite-less wearer', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('a', ACHERON, undefined), member('b', '1308', worn)], kernel).run()
    expect(requests[0]!.teammates[0]).not.toHaveProperty('teamOrnamentSet')
  })

  it('stops at create for a memosprite wearer, naming the memosprite', () => {
    const { kernel } = recordingKernel()
    expect(() => battleOf([member('r', ROBIN, worn)], kernel)).toThrow(/Amphoreus, The Eternal Land on r \(1512\): NOT MODELLED.*memosprite/)
  })

  it('leaves the CRIT Rate 8% to Fribbels, as a 2-piece always-on stat: the module adds nothing to the attacker', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('a', ACHERON, worn)], kernel).run()
    expect(requests[0]!.attacker.lightConeConditionals).toBeUndefined()
  })
})
