import { describe, expect, it } from 'vitest'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { Battle } from './battle'
import type { HitPart, MemberSetup } from './battle'

/**
 * DESIGN.md K17: an action's hit chance per enemy (the probability it hit that enemy at least once) and the
 * expected number of distinct enemies it hit, which "per enemy hit" effects use.
 */

const profile = loadEnemyProfile('generic-moc')

/** 1,000 damage per 100% of the multiple. */
const kernel: DamageKernel = {
  actionDamage: () => fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] }),
}

/** A character whose Basic ATK makes the attack calls the test sets, one `attack` per entry, in one action. */
let calls: HitPart[][] = []
const Roller: Kit = {
  characterId: 'roller',
  path: 'Hunt',
  element: 'Fire',
  maxEnergy: 100,
  create: (b, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          b.performAction(self.key, 'basic', 'basic', () => {
            for (const parts of calls) b.attack({ attacker: self.key, ability: 'BASIC', parts })
          }),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
}

const roller: MemberSetup = {
  key: 'a',
  kit: Roller,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: {
    unit: { characterId: 'roller', lightConeId: 'none', eidolon: 0, superimposition: 1 },
    build: { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} },
  },
}

/** The first action of a one-turn battle against `enemyCount` enemies, and what it dealt. */
function firstAction(enemyCount: number, attackCalls: HitPart[][]) {
  calls = attackCalls
  const battle = new Battle({
    members: [roller],
    policy: [{ unit: 'a', use: 'basic', when: [] }],
    profile,
    enemyCount,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0, skillPoints: 3, techniques: true },
    kernel,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  return { action: battle.run().actions[0]!, dealt }
}

/** What Lightning-Lord declares: one blast per possible target, each taking 1 / N of `hits` random hits. */
const familyOf = (ids: readonly string[], hits: number, adjacent: number, random: boolean): HitPart[] =>
  ids.map((target) => ({
    shape: 'blast',
    scaling: hits / ids.length,
    adjacent: (adjacent * hits) / ids.length,
    target,
    hit: 0,
    ...(random && { random: { hits, chance: 1 / ids.length } }),
  }))

const five = ['enemy1', 'enemy2', 'enemy3', 'enemy4', 'enemy5']

describe('expected enemies hit (K17)', () => {
  it('single, blast and AoE actions hit every enemy they reach with probability 1: nothing changes', () => {
    for (const parts of [
      [{ shape: 'single', scaling: 1, hit: 0 }],
      [{ shape: 'blast', scaling: 1, adjacent: 0.5, hit: 0 }],
      [{ shape: 'aoe', scaling: 1, hit: 0 }],
    ] satisfies HitPart[][]) {
      const { action } = firstAction(5, [parts])
      expect(action.expectedEnemiesHit).toBe(action.enemiesHit.length)
      expect(Object.values(action.hitChance).every((p) => p === 1)).toBe(true)
      expect(Object.keys(action.hitChance)).toEqual(action.enemiesHit)
    }
    expect(firstAction(5, [[{ shape: 'blast', scaling: 1, adjacent: 0.5, hit: 0 }]]).action.expectedEnemiesHit).toBe(3)
    expect(firstAction(1, [[{ shape: 'aoe', scaling: 1, hit: 0 }]]).action.expectedEnemiesHit).toBe(1)
  })

  it('a blast whose adjacent damage is 0 does not reach the neighbours', () => {
    expect(firstAction(5, [[{ shape: 'blast', scaling: 1, adjacent: 0, hit: 0 }]]).action.expectedEnemiesHit).toBe(1)
  })

  it.each([
    [1, 3, 1],
    [3, 3, 3 * (1 - (2 / 3) ** 3)],
    [5, 3, 5 * (1 - (4 / 5) ** 3)],
    [5, 1, 1],
    [3, 10, 3 * (1 - (2 / 3) ** 10)],
  ])('a bounce on %d enemies with %d hits hits N x (1 - (1 - 1/N)^hits) distinct enemies', (enemies, hits, expected) => {
    const { action } = firstAction(enemies, [[{ shape: 'bounce', scaling: 1, hits, hit: 0 }]])
    expect(action.expectedEnemiesHit).toBeCloseTo(expected, 12)
    // Every enemy is a candidate, each with the same chance.
    expect(action.enemiesHit).toHaveLength(enemies)
    for (const p of Object.values(action.hitChance)) expect(p).toBeCloseTo(expected / enemies, 12)
  })

  it('3 random single hits on 5 enemies, declared one part per target, are 2.44 distinct enemies', () => {
    const parts: HitPart[] = five.map((target) => ({
      shape: 'single',
      scaling: 3 / 5,
      target,
      hit: 0,
      random: { hits: 3, chance: 1 / 5 },
    }))
    const { action } = firstAction(5, [parts])
    expect(action.enemiesHit).toEqual(five)
    expect(action.expectedEnemiesHit).toBeCloseTo(2.44, 12)
  })

  it('splash from a random hit lands on the neighbours of the chosen enemy', () => {
    const { action } = firstAction(5, [familyOf(five, 3, 0.25, true)])
    // A hit reaches an end enemy with probability 2/5 and an inner one with 3/5.
    const ends = 1 - (3 / 5) ** 3
    const inner = 1 - (2 / 5) ** 3
    expect(action.hitChance.enemy1).toBeCloseTo(ends, 12)
    expect(action.hitChance.enemy5).toBeCloseTo(ends, 12)
    for (const id of ['enemy2', 'enemy3', 'enemy4']) expect(action.hitChance[id]).toBeCloseTo(inner, 12)
    expect(action.expectedEnemiesHit).toBeCloseTo(2 * ends + 3 * inner, 12)
  })

  it('splash on 1 enemy changes nothing, and with 2 enemies every hit reaches both', () => {
    expect(firstAction(1, [familyOf(['enemy1'], 3, 0.25, true)]).action.expectedEnemiesHit).toBe(1)
    expect(firstAction(2, [familyOf(['enemy1', 'enemy2'], 1, 0.25, true)]).action.expectedEnemiesHit).toBeCloseTo(2, 12)
  })

  it('a deterministic hit and random hits in one action combine: the certain enemy stays at 1', () => {
    // A single on the primary (enemy3 of 5) plus a 2-hit bounce.
    const { action } = firstAction(5, [[{ shape: 'single', scaling: 1, hit: 0 }, { shape: 'bounce', scaling: 1, hits: 2, hit: 0 }]])
    expect(action.hitChance.enemy3).toBe(1)
    for (const id of ['enemy1', 'enemy2', 'enemy4', 'enemy5']) expect(action.hitChance[id]).toBeCloseTo(1 - (4 / 5) ** 2, 12)
    expect(action.expectedEnemiesHit).toBeCloseTo(1 + 4 * (1 - 0.64), 12)
  })

  it('an AoE plus a bounce in one part list (Acheron) hits everyone for sure', () => {
    const { action } = firstAction(5, [[{ shape: 'aoe', scaling: 1, hit: 0 }, { shape: 'bounce', scaling: 1, hits: 6, hit: 0 }]])
    expect(action.expectedEnemiesHit).toBe(5)
  })

  it('random hits spread over several attack calls multiply: two calls of one hit are one call of two', () => {
    const ids = ['enemy1', 'enemy2', 'enemy3']
    const split = firstAction(3, [familyOf(ids, 1, 0, true), familyOf(ids, 1, 0, true)]).action
    const whole = firstAction(3, [familyOf(ids, 2, 0, true)]).action
    expect(split.expectedEnemiesHit).toBeCloseTo(whole.expectedEnemiesHit, 12)
    expect(whole.expectedEnemiesHit).toBeCloseTo(3 * (1 - (2 / 3) ** 2), 12)
    // Fractional hit counts (E6's expected stacks) behave the same: 0.4 + 1.6 hits is 2 hits.
    const fractional = firstAction(3, [familyOf(ids, 0.4, 0, true), familyOf(ids, 1.6, 0, true)]).action
    expect(fractional.expectedEnemiesHit).toBeCloseTo(whole.expectedEnemiesHit, 12)
  })

  it('a deterministic call after a random one makes that enemy certain', () => {
    const ids = ['enemy1', 'enemy2', 'enemy3']
    const { action } = firstAction(3, [familyOf(ids, 1, 0, true), [{ shape: 'single', scaling: 1, target: 'enemy1', hit: 0 }]])
    expect(action.hitChance.enemy1).toBe(1)
    expect(action.hitChance.enemy2).toBeCloseTo(1 / 3, 12)
  })

  it('marking parts as random changes no damage and no toughness', () => {
    const plain = firstAction(5, [familyOf(five, 3, 0.25, false).map((p) => ({ ...p, toughness: 6 }))])
    const marked = firstAction(5, [familyOf(five, 3, 0.25, true).map((p) => ({ ...p, toughness: 6 }))])
    expect(marked.dealt.map((d) => [d.enemy, d.scaling, d.damage])).toEqual(plain.dealt.map((d) => [d.enemy, d.scaling, d.damage]))
    // Without the marker every enemy a part reaches counts as hit for sure.
    expect(plain.action.expectedEnemiesHit).toBe(5)
    expect(marked.action.expectedEnemiesHit).toBeLessThan(5)
    expect(marked.action.enemiesHit).toEqual(plain.action.enemiesHit)
  })

  it('parts of one group must agree on the hit count', () => {
    const parts: HitPart[] = [
      { shape: 'single', scaling: 1, target: 'enemy1', hit: 0, random: { hits: 2, chance: 0.5 } },
      { shape: 'single', scaling: 1, target: 'enemy2', hit: 0, random: { hits: 3, chance: 0.5 } },
    ]
    expect(() => firstAction(2, [parts])).toThrow(/different hit counts/)
  })
})
