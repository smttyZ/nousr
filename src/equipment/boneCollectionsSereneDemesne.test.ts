import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { BattleSetup, MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit } from '../kits/kit'
import type { Rule } from '../scenario/types'
import { BoneCollectionsSereneDemesne } from './boneCollectionsSereneDemesne'
import { createRegistry, lightConeWithoutBehaviour, resolveEquipment, setWithoutBehaviour } from './equipment'
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

const wearing: MemberEquipment = {
  lightCone: lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' }),
  sets: [{ module: BoneCollectionsSereneDemesne, pieces: 2 }],
}

describe("Bone Collection's Serene Demesne", () => {
  it('is an ornament with the game id 319 and the name Fribbels uses', () => {
    expect(BoneCollectionsSereneDemesne).toMatchObject({ kind: 'set', type: 'ornament', name: "Bone Collection's Serene Demesne", setId: '319' })
  })

  it('gives the kernel no conditionals: its Max HP threshold is Fribbels\' own, and its memosprite part changes no result', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('a', wearing)], kernel).run()
    expect(requests[0]!.setConditionals).toBeUndefined()
    expect(requests[0]!.attacker.lightConeConditionals).toBeUndefined()
  })

  it('resolves as a 2-piece ornament in a benchmark build, so its module is created for the wearer', () => {
    const registry = createRegistry([
      lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' }),
      BoneCollectionsSereneDemesne,
      PoetOfMourningCollapse,
    ])
    const resolved = resolveEquipment(
      { characterId: 'a', eidolon: 0, lightConeId: 'x', superimposition: 1 },
      { ...noBuild, relicSet1: PoetOfMourningCollapse.name, relicSet2: PoetOfMourningCollapse.name, ornamentSet: BoneCollectionsSereneDemesne.name },
      registry,
    )
    expect(resolved.sets.map((s) => [s.module.name, s.pieces])).toEqual([
      [PoetOfMourningCollapse.name, 4],
      [BoneCollectionsSereneDemesne.name, 2],
    ])
  })

  it('a module with no behaviour must say why', () => {
    expect(() => setWithoutBehaviour({ type: 'ornament', name: 'x', reason: ' ' })).toThrow(/needs a reason/)
  })
})
