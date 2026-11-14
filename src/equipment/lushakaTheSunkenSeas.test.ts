import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit } from '../kits/kit'
import type { Rule } from '../scenario/types'
import { lightConeWithoutBehaviour } from './equipment'
import type { MemberEquipment } from './equipment'
import { LushakaTheSunkenSeas as Module } from './lushakaTheSunkenSeas'

const SET = 'Lushaka, the Sunken Seas'
const profile = loadEnemyProfile('generic-moc')
const noBuild: KernelBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const noCone = lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' })

/** A kernel that records every request it is asked and prices each hit at 1,000 per 100%. */
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

/** A Basic-only kit that attacks once per turn. */
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

const member = (key: string, equipped: boolean, baseSpd = 100): MemberSetup => ({
  key,
  kit: basicKit(),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
  kernel: { unit: { characterId: key, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
  ...(equipped && { equipment: { lightCone: noCone, sets: [{ module: Module, pieces: 2 }] } as MemberEquipment }),
})

function battleOf(members: MemberSetup[], kernel: DamageKernel) {
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
  })
}

describe('Lushaka, the Sunken Seas: the module', () => {
  it('is the ornament the kernel calls by name, with its set id', () => {
    expect(Module.name).toBe(SET)
    expect(Module.setId).toBe('317')
    expect(Module.type).toBe('ornament')
  })

  it('is always off for the wearer\'s own attacks: the buff goes to the first character, never the wearer', () => {
    // Wearer not first (index 1), and then the wearer as the first character (index 0).
    for (const wearerFirst of [false, true]) {
      const { kernel, requests } = recordingKernel()
      const members = wearerFirst
        ? [member('w', true, 100), member('f', false, 90)]
        : [member('f', false, 100), member('w', true, 90)]
      battleOf(members, kernel).run()
      const mine = requests.filter((r) => r.attacker.characterId === 'w')
      expect(mine.length).toBeGreaterThan(0)
      expect(mine.every((r) => r.setConditionals![SET] === false)).toBe(true)
    }
  })

  it('gives the first character the team effect while the wearer is not first', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('f', false, 100), member('w', true, 90)], kernel).run()
    const first = requests.filter((r) => r.attacker.characterId === 'f')
    expect(first.length).toBeGreaterThan(0)
    for (const r of first) expect(r.teammates.find((t) => t.characterId === 'w')!.teamOrnamentSet).toBe(SET)
  })

  it('gives no team effect to a teammate who is not the first character', () => {
    const { kernel, requests } = recordingKernel()
    // Order: f (first), w (wearer, index 1), g (index 2). g's attacks see w as a teammate, and w is not first.
    battleOf([member('f', false, 120), member('w', true, 110), member('g', false, 100)], kernel).run()
    const g = requests.filter((r) => r.attacker.characterId === 'g')
    expect(g.length).toBeGreaterThan(0)
    for (const r of g) expect(r.teammates.find((t) => t.characterId === 'w')!.teamOrnamentSet).toBeUndefined()
  })

  it('gives no team effect when the wearer is the first character, to anyone', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('w', true, 100), member('f', false, 90)], kernel).run()
    const friend = requests.filter((r) => r.attacker.characterId === 'f')
    expect(friend.length).toBeGreaterThan(0)
    for (const r of friend) expect(r.teammates[0]!.teamOrnamentSet).toBeUndefined()
  })
})
