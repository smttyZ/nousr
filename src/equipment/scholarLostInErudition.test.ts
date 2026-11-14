import { describe, expect, it } from 'vitest'
import { Battle, type BattleSetup, type MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit, KitAction } from '../kits/kit'
import type { Rule } from '../scenario/types'
import type { MemberEquipment } from './equipment'
import { lightConeWithoutBehaviour } from './equipment'
import { ScholarLostInErudition } from './scholarLostInErudition'

const SET = 'Scholar Lost in Erudition'
const profile = loadEnemyProfile('generic-moc')
const noBuild: KernelBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/** Prices every hit at 1000, plus 10 when the module's flag is on, so a damage event reads back the flag. */
function encodingKernel(): { kernel: DamageKernel, requests: DamageRequest[] } {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = {
    actionDamage(request) {
      requests.push(request)
      const hit = [{ damage: request.setConditionals?.[SET] === true ? 1010 : 1000, scaling: 1 }]
      return fakeResult({ BASIC: hit, SKILL: hit, ULT: hit, FUA: hit })
    },
  }
  return { kernel, requests }
}

type Use = 'basic' | 'skill' | 'ultimate' | 'followUp'
interface Step { use: Use }

const ABILITY = { basic: 'BASIC', skill: 'SKILL', ultimate: 'ULT', followUp: 'FUA' } as const
const KIND = { basic: 'basic', skill: 'skill', ultimate: 'ultimate', followUp: 'followUp' } as const

/** A made-up wearer that takes `script` one step per turn (an Ultimate also in the Ultimate window), then Basic ATKs. */
function scripted(key: string, script: Step[]): Kit {
  return {
    characterId: key,
    path: 'Hunt',
    element: 'Fire',
    maxEnergy: 0,
    create: (battle: Battle) => {
      let step = 0
      const actions: Record<string, KitAction> = {}
      for (const use of ['basic', 'skill', 'ultimate', 'followUp'] as const) {
        actions[use] = {
          kind: 'basic',
          canUse: () => true,
          use: () => {
            step += 1
            battle.performAction(key, use, KIND[use], () => {
              battle.attack({ attacker: key, ability: ABILITY[use], parts: [{ shape: 'aoe', scaling: 1, hit: 0 }] })
            })
          },
        }
      }
      return { actions, quantities: { step: () => step }, attackerState: () => ({}), teammateState: () => ({}) }
    },
  }
}

function policyOf(key: string, script: Step[]): Rule[] {
  return [
    ...script.map((s, i): Rule => ({ unit: key, use: s.use, when: [{ what: `${key}.step`, min: i, max: i }] })),
    { unit: key, use: 'basic', when: [] },
  ]
}

const member = (key: string, kit: Kit, pieces: 2 | 4): MemberSetup => ({
  key,
  kit,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000_000, def: 1000, baseSpd: 1000 },
  kernel: { unit: { characterId: key, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
  equipment: {
    lightCone: lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' }),
    sets: [{ module: ScholarLostInErudition, pieces }],
  } satisfies MemberEquipment,
})

function battleOf(members: MemberSetup[], policy: Rule[], kernel: DamageKernel, overrides: Partial<BattleSetup> = {}): Battle {
  return new Battle({
    members,
    policy,
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 2,
    start: { energy: 0.5, skillPoints: 3, techniques: false },
    kernel,
    ...overrides,
  })
}

/** Every damage event of the wearer, in order: the ability and whether the kernel was given the flag on. */
function watch(battle: Battle): { ability: string, on: boolean }[] {
  const seen: { ability: string, on: boolean }[] = []
  battle.timeline.bus.on('damageDealt', (dealt) => seen.push({ ability: dealt.ability, on: (dealt.damage - 1000) / 10 === 1 }))
  return seen
}

describe('Scholar Lost in Erudition: 4 pieces', () => {
  it('is on from the wearer\'s Ultimate to its next Skill, which is the only Skill it applies to', () => {
    const { kernel } = encodingKernel()
    const script: Step[] = [{ use: 'ultimate' }, { use: 'skill' }, { use: 'basic' }, { use: 'skill' }, { use: 'skill' }]
    const battle = battleOf([member('wearer', scripted('wearer', script), 4)], policyOf('wearer', script), kernel)
    const seen = watch(battle)
    battle.run()
    const first = seen.slice(0, 5)
    expect(first).toEqual([
      { ability: 'ULT', on: false },
      { ability: 'SKILL', on: true }, // the Skill after the Ultimate: +25% applies
      { ability: 'BASIC', on: false },
      { ability: 'SKILL', on: false }, // consumed by the Skill above
      { ability: 'SKILL', on: false },
    ])
  })

  it('a second Ultimate before the Skill leaves the flag on once, not twice: the Skill gets +25% and it is then off', () => {
    const { kernel } = encodingKernel()
    const script: Step[] = [{ use: 'ultimate' }, { use: 'ultimate' }, { use: 'skill' }, { use: 'skill' }]
    const battle = battleOf([member('wearer', scripted('wearer', script), 4)], policyOf('wearer', script), kernel)
    const seen = watch(battle)
    battle.run()
    // The second Ultimate is priced after the first has turned the flag on (the kernel only applies it to Skill damage).
    expect(seen.slice(0, 4).map((s) => s.on)).toEqual([false, true, true, false])
  })

  it('Ultimate, then Basic ATK, then Skill: a Basic ATK in between does not clear the flag, the Skill still gets +25%', () => {
    const { kernel } = encodingKernel()
    const script: Step[] = [{ use: 'ultimate' }, { use: 'basic' }, { use: 'skill' }, { use: 'skill' }]
    const battle = battleOf([member('wearer', scripted('wearer', script), 4)], policyOf('wearer', script), kernel)
    const seen = watch(battle)
    battle.run()
    expect(seen.slice(0, 4)).toEqual([
      { ability: 'ULT', on: false },
      { ability: 'BASIC', on: true }, // still on: only a Skill consumes it
      { ability: 'SKILL', on: true },
      { ability: 'SKILL', on: false },
    ])
  })

  it('a Skill with no Ultimate before it is not boosted', () => {
    const { kernel, requests } = encodingKernel()
    const script: Step[] = [{ use: 'skill' }, { use: 'skill' }]
    const battle = battleOf([member('wearer', scripted('wearer', script), 4)], policyOf('wearer', script), kernel, { cycles: 1 })
    battle.run()
    expect(requests.every((r) => r.setConditionals?.[SET] === false)).toBe(true)
  })

  it('reaches the kernel as a flag every time: the module\'s value, not Fribbels\' default of on', () => {
    const { kernel, requests } = encodingKernel()
    const script: Step[] = [{ use: 'basic' }]
    battleOf([member('wearer', scripted('wearer', script), 4)], policyOf('wearer', script), kernel, { cycles: 1 }).run()
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((r) => r.setConditionals?.[SET] === false)).toBe(true)
  })
})

describe('Scholar Lost in Erudition: 2 pieces', () => {
  it('supplies no conditional: its effects are always on and Fribbels applies them', () => {
    const { kernel, requests } = encodingKernel()
    const script: Step[] = [{ use: 'ultimate' }, { use: 'skill' }]
    battleOf([member('wearer', scripted('wearer', script), 2)], policyOf('wearer', script), kernel, { cycles: 1 }).run()
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((r) => r.setConditionals === undefined)).toBe(true)
  })
})
