import { describe, expect, it } from 'vitest'
import { Battle, type BattleSetup, type HitPart, type MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit, KitAction } from '../kits/kit'
import type { Rule } from '../scenario/types'
import { TheAshblazingGrandDuke, hitsOfParts } from './ashblazingGrandDuke'
import type { MemberEquipment } from './equipment'
import { lightConeWithoutBehaviour } from './equipment'

const SET = 'The Ashblazing Grand Duke'
const profile = loadEnemyProfile('generic-moc')
const noBuild: KernelBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/**
 * Prices every hit at 1000 plus 10 per stack the module passed, so each damage event reads back the value the
 * kernel was given: (damage - 1000) / 10.
 */
function encodingKernel(): { kernel: DamageKernel, requests: DamageRequest[] } {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = {
    actionDamage(request) {
      requests.push(request)
      const value = request.setConditionals?.[SET]
      const hit = [{ damage: 1000 + 10 * (typeof value === 'number' ? value : 0), scaling: 1 }]
      return fakeResult({ BASIC: hit, SKILL: hit, ULT: hit, FUA: hit })
    },
  }
  return { kernel, requests }
}

type Use = 'basic' | 'skill' | 'ultimate' | 'followUp' | 'dismiss'
/** `parts` is the attack the step makes (one `battle.attack`); left out, one AoE hit. */
interface Step { use: Use, parts?: HitPart[] }

const AOE: HitPart = { shape: 'aoe', scaling: 1, hit: 0 }
/** `n` single-target hits as the parts of ONE attack. */
const singles = (n: number): HitPart[] => Array.from({ length: n }, () => ({ shape: 'single', scaling: 1, hit: 0 }))
/** `n` AoE hits as the parts of ONE attack. */
const aoes = (n: number): HitPart[] => Array.from({ length: n }, () => AOE)

const ABILITY = { basic: 'BASIC', skill: 'SKILL', ultimate: 'ULT', followUp: 'FUA' } as const
const KIND = { basic: 'basic', skill: 'skill', ultimate: 'ultimate', followUp: 'followUp' } as const

/**
 * A made-up wearer that takes `script` one step per turn, then Basic ATKs. Each attack is one part on every enemy
 * (an AoE) unless the step gives `parts`. Like the real kits, a step is ONE `battle.attack` with all its parts, so a damage
 * event is one per enemy per attack, not one per hit.
 */
function scripted(key: string, script: Step[]): Kit {
  return {
    characterId: key,
    path: 'Hunt',
    element: 'Fire',
    maxEnergy: 0,
    create: (battle: Battle) => {
      let step = 0
      const run = (use: Exclude<Use, 'dismiss'>) => {
        const parts = script[step]?.parts ?? [AOE]
        step += 1
        battle.performAction(key, use, KIND[use], () => {
          battle.attack({ attacker: key, ability: ABILITY[use], parts })
        })
      }
      const actions: Record<string, KitAction> = {}
      for (const use of ['basic', 'skill', 'ultimate', 'followUp'] as const) {
        actions[use] = { kind: 'basic', canUse: () => true, use: () => run(use) }
      }
      return {
        actions,
        quantities: { step: () => step },
        attackerState: () => ({}),
        teammateState: () => ({}),
      }
    },
  }
}

/** Policy: the script's step n is taken on the wearer's turn when its step counter is n; then Basic ATKs. */
function policyOf(key: string, script: Step[]): Rule[] {
  return [
    ...script.map((s, i): Rule => ({ unit: key, use: s.use, when: [{ what: `${key}.step`, min: i, max: i }] })),
    { unit: key, use: 'basic', when: [] },
  ]
}

const member = (key: string, kit: Kit, pieces: 2 | 4 | undefined, baseSpd = 1000): MemberSetup => ({
  key,
  kit,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000_000, def: 1000, baseSpd },
  kernel: { unit: { characterId: key, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
  equipment: {
    lightCone: lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' }),
    sets: pieces === undefined ? [] : [{ module: TheAshblazingGrandDuke, pieces }],
  } satisfies MemberEquipment,
})

function battleOf(members: MemberSetup[], policy: Rule[], kernel: DamageKernel, overrides: Partial<BattleSetup> = {}): Battle {
  return new Battle({
    members,
    policy,
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 3,
    start: { energy: 0.5, skillPoints: 3, techniques: false },
    kernel,
    ...overrides,
  })
}

/** Every damage event of `who`, in order: the ability and the stack count the kernel was given (decoded). */
function watch(battle: Battle, who: string): { ability: string, stacks: number }[] {
  const seen: { ability: string, stacks: number }[] = []
  battle.timeline.bus.on('damageDealt', (dealt) => {
    if (dealt.attacker === who) seen.push({ ability: dealt.ability, stacks: (dealt.damage / dealt.scaling - 1000) / 10 })
  })
  return seen
}

describe('The Ashblazing Grand Duke: 2 pieces', () => {
  it('has no conditional to supply: the 2-piece Follow-Up DMG is always on, and Fribbels applies it', () => {
    const { kernel, requests } = encodingKernel()
    const script: Step[] = [{ use: 'followUp', parts: singles(2) }, { use: 'basic' }]
    const battle = battleOf([member('wearer', scripted('wearer', script), 2)], policyOf('wearer', script), kernel, { cycles: 1 })
    const seen = watch(battle, 'wearer')
    battle.run()
    expect(requests.every((r) => r.setConditionals === undefined)).toBe(true)
    expect(seen.every((s) => s.stacks === 0)).toBe(true)
  })
})

describe('The Ashblazing Grand Duke: counting hits from an attack\'s parts', () => {
  const battleWith = (enemyCount: number) =>
    battleOf([member('w', scripted('w', []), 4)], policyOf('w', []), encodingKernel().kernel, { enemyCount })

  it('single is 1, AoE is 1 per enemy, a bounce of n is n', () => {
    expect(hitsOfParts(battleWith(3), [{ shape: 'single', scaling: 1, hit: 0 }])).toBe(1)
    expect(hitsOfParts(battleWith(3), [AOE])).toBe(3)
    expect(hitsOfParts(battleWith(5), [AOE])).toBe(5)
    expect(hitsOfParts(battleWith(5), [{ shape: 'bounce', scaling: 0.8, hits: 6, hit: 0 }])).toBe(6)
  })

  it('a blast is 1 plus the neighbours it reaches: the middle of 5 is 3, the end is 2, and 0 splash is 1', () => {
    const b = battleWith(5)
    const ids = b.enemies.ids
    expect(hitsOfParts(b, [{ shape: 'blast', scaling: 1, adjacent: 0.5, hit: 0 }])).toBe(3)
    expect(hitsOfParts(b, [{ shape: 'blast', scaling: 1, adjacent: 0.5, target: ids[0]!, hit: 0 }])).toBe(2)
    expect(hitsOfParts(b, [{ shape: 'blast', scaling: 1, adjacent: 0, hit: 0 }])).toBe(1)
  })

  it('a random family is its expected hits: 3 random single hits on 5 enemies is 3, not 5', () => {
    const b = battleWith(5)
    const parts: HitPart[] = b.enemies.ids.map((target) => ({ shape: 'single', scaling: 3 / 5, target, hit: 0, random: { hits: 3, chance: 1 / 5 } }))
    expect(hitsOfParts(b, parts)).toBeCloseTo(3, 12)
  })

  it('a part with no damage is no hit', () => {
    expect(hitsOfParts(battleWith(3), [{ shape: 'aoe', scaling: 0, hit: 0 }, { shape: 'single', scaling: 1, hit: 0 }])).toBe(1)
  })
})

describe('The Ashblazing Grand Duke: 4 pieces, stacks as the battle unfolds', () => {
  // Turns: 1 basic, 2 Follow-Up (3 hits), 3 basic, 4 Follow-Up (2 hits), 5 basic, then basics.
  // Stacks: the Follow-Up on turn 2 builds 3; turn 3 reads 3. Turn 4 reads 3 (the Follow-Up that removes them is
  // priced with them) and builds 2, refreshing the 3 turns. Turns 5, 6, 7 read 2; the duration ends at turn 7's end.
  const script: Step[] = [{ use: 'basic' }, { use: 'followUp', parts: singles(3) }, { use: 'basic' }, { use: 'followUp', parts: singles(2) }, { use: 'basic' }]

  it('reads 0, then the stacks the last Follow-Up built, then expires 3 of the wearer\'s turns after the last Follow-Up', () => {
    const { kernel } = encodingKernel()
    const battle = battleOf([member('wearer', scripted('wearer', script), 4)], policyOf('wearer', script), kernel, { cycles: 2 })
    const seen = watch(battle, 'wearer')
    battle.run()
    // One damage event per attack: basic 0, FUA 0 (builds 3), basic 3, FUA 3 (builds 2), basics 2, 2, 2, then 0.
    expect(seen.slice(0, 9).map((s) => s.stacks)).toEqual([0, 0, 3, 3, 2, 2, 2, 0, 0])
    expect(seen.slice(0, 9).map((s) => s.ability)).toEqual(['BASIC', 'FUA', 'BASIC', 'FUA', 'BASIC', 'BASIC', 'BASIC', 'BASIC', 'BASIC'])
  })

  it('counts every hit on every enemy of ONE attack, capped at 8: 3 AoE hits on 3 enemies is 8 stacks', () => {
    const { kernel } = encodingKernel()
    const threeHits: Step[] = [{ use: 'followUp', parts: aoes(3) }, { use: 'basic' }, { use: 'basic' }]
    const battle = battleOf(
      [member('wearer', scripted('wearer', threeHits), 4)],
      policyOf('wearer', threeHits),
      kernel,
      { cycles: 1, enemyCount: 3 },
    )
    const seen = watch(battle, 'wearer')
    battle.run()
    // 3 hits x 3 enemies = 9, capped at 8. The Follow-Up's own damage reads 0; the next basics read 8.
    const followUp = seen.filter((s) => s.ability === 'FUA')
    const basics = seen.filter((s) => s.ability === 'BASIC')
    expect(followUp).toHaveLength(3)
    expect(followUp.every((s) => s.stacks === 0)).toBe(true)
    expect(basics.slice(0, 3).every((s) => s.stacks === 8)).toBe(true)
  })

  it('an AoE part and a bounce in one attack add up (the shape of Acheron\'s Affinitive Follow-Up): 1 enemy is 1 + 6 = 7', () => {
    const { kernel } = encodingKernel()
    const shape: Step[] = [{ use: 'followUp', parts: [AOE, { shape: 'bounce', scaling: 0.8, hits: 6, hit: 0 }] }, { use: 'basic' }]
    const battle = battleOf([member('wearer', scripted('wearer', shape), 4)], policyOf('wearer', shape), kernel, { cycles: 1, enemyCount: 1 })
    const seen = watch(battle, 'wearer')
    battle.run()
    expect(seen.find((s) => s.ability === 'BASIC')!.stacks).toBe(7)
  })

  it('counts hits across several attacks inside ONE Follow-Up action (Jing Yuan\'s Lightning-Lord at E6 makes several)', () => {
    const { kernel } = encodingKernel()
    const twoAttacks = (key: string): Kit => ({
      characterId: key,
      path: 'Hunt',
      element: 'Fire',
      maxEnergy: 0,
      create: (battle: Battle) => ({
        actions: {
          followUp: {
            kind: 'basic',
            canUse: () => true,
            use: () => battle.performAction(key, 'f', 'followUp', () => {
              battle.attack({ attacker: key, ability: 'FUA', parts: singles(2) })
              battle.attack({ attacker: key, ability: 'FUA', parts: singles(3) })
            }),
          },
        },
        attackerState: () => ({}),
        teammateState: () => ({}),
      }),
    })
    const battle = battleOf([member('wearer', twoAttacks('wearer'), 4)], [{ unit: 'wearer', use: 'followUp', when: [] }], kernel, { cycles: 1 })
    const seen = watch(battle, 'wearer')
    battle.run()
    // Every turn is the same two-attack Follow-Up: 2 + 3 = 5 stacks after the first, read by the next one's two attacks.
    expect(seen.slice(0, 4).map((s) => s.stacks)).toEqual([0, 0, 5, 5])
  })

  it('counts only the wearer\'s own Follow-Up ATKs: a teammate\'s Follow-Up and the wearer\'s other abilities add nothing', () => {
    const { kernel } = encodingKernel()
    const wearerScript: Step[] = [{ use: 'skill' }, { use: 'basic' }, { use: 'basic' }]
    const otherScript: Step[] = [{ use: 'followUp', parts: singles(4) }]
    const battle = battleOf(
      [member('wearer', scripted('wearer', wearerScript), 4), member('other', scripted('other', otherScript), 2)],
      [...policyOf('wearer', wearerScript), ...policyOf('other', otherScript)],
      kernel,
      { cycles: 1 },
    )
    const seen = watch(battle, 'wearer')
    battle.run()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((s) => s.stacks === 0)).toBe(true)
  })

  it('is 0 before any Follow-Up has dealt damage, and every request carries the module\'s value', () => {
    const { kernel, requests } = encodingKernel()
    const basicOnly: Step[] = []
    battleOf([member('wearer', scripted('wearer', basicOnly), 4)], policyOf('wearer', basicOnly), kernel, { cycles: 1 }).run()
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((r) => r.setConditionals?.[SET] === 0)).toBe(true)
  })
})
