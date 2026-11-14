import { describe, expect, it } from 'vitest'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { Battle } from './battle'
import type { HitPart, MemberSetup } from './battle'
import { distinctEnemiesHitDistribution, enemyHitChances, probabilityAtLeastEnemiesHit } from './hitProbability'
import type { ActionHits } from './hitProbability'

/** DESIGN.md K21: exact P(N or more distinct enemies hit) from an action's attacks, checked against hand sums. */

const field = (n: number) => {
  const enemies = Array.from({ length: n }, (_, i) => `e${i + 1}`)
  return { enemies, primary: enemies[Math.floor(n / 2)]! }
}
const action = (n: number, ...attacks: HitPart[][]): ActionHits => ({ ...field(n), attacks })
const atLeast = (n: number, k: number, ...attacks: HitPart[][]) => probabilityAtLeastEnemiesHit(action(n, ...attacks), k)

const single = (target?: string): HitPart => ({ shape: 'single', scaling: 1, hit: 0, ...(target ? { target } : {}) })
const blast = (adjacent: number, target?: string): HitPart => ({ shape: 'blast', scaling: 1, adjacent, hit: 0, ...(target ? { target } : {}) })
const aoe: HitPart = { shape: 'aoe', scaling: 1, hit: 0 }
const bounce = (hits: number): HitPart => ({ shape: 'bounce', scaling: 1, hits, hit: 0 })
/** One random blast per possible target, each chosen with 1 / n (the shape Jing Yuan's Lightning-Lord uses). */
const randomBlasts = (ids: readonly string[], hits: number, adjacent: number): HitPart[] =>
  ids.map((target) => ({
    shape: 'blast',
    scaling: hits / ids.length,
    adjacent: (adjacent * hits) / ids.length,
    target,
    hit: 0,
    random: { hits, chance: 1 / ids.length },
  }))
const lord = (n: number, hits: number, adjacent = 0.5) => randomBlasts(field(n).enemies, hits, adjacent)

describe('deterministic parts only', () => {
  it('one enemy: a single hit is certain, a second enemy never', () => {
    expect(atLeast(1, 1, [single()])).toBe(1)
    expect(atLeast(1, 2, [single()])).toBe(0)
    expect(atLeast(1, 1, [aoe])).toBe(1)
  })

  it('three enemies: the blast on the middle enemy reaches all three; with no adjacent damage it reaches one', () => {
    expect(atLeast(3, 3, [blast(0.5)])).toBe(1)
    expect(atLeast(3, 3, [blast(0)])).toBe(0)
    expect(atLeast(3, 1, [blast(0)])).toBe(1)
    expect(atLeast(3, 3, [aoe])).toBe(1)
  })

  it('five enemies: the blast on the middle reaches 3, a blast on the end reaches 2, an AoE all 5', () => {
    expect(atLeast(5, 3, [blast(0.5)])).toBe(1)
    expect(atLeast(5, 4, [blast(0.5)])).toBe(0)
    expect(atLeast(5, 3, [blast(0.5, 'e1')])).toBe(0)
    expect(atLeast(5, 2, [blast(0.5, 'e1')])).toBe(1)
    expect(atLeast(5, 5, [aoe])).toBe(1)
    expect(atLeast(5, 2, [single('e1')], [single('e5')])).toBe(1)
    expect(atLeast(5, 3, [single('e1')], [single('e5')])).toBe(0)
  })

  it('n of 0 or less is certain', () => {
    expect(atLeast(5, 0, [single()])).toBe(1)
  })
})

describe('bounce only', () => {
  it('3 enemies, 3 hits: all three distinct is 3!/3^3 = 6/27', () => {
    expect(atLeast(3, 3, [bounce(3)])).toBeCloseTo(6 / 27, 12)
  })

  it('3 enemies, n hits: P(all three) = 1 - 3 (2/3)^n + 3 (1/3)^n', () => {
    for (const n of [4, 8, 10]) expect(atLeast(3, 3, [bounce(n)]), `${n} hits`).toBeCloseTo(1 - 3 * (2 / 3) ** n + 3 * (1 / 3) ** n, 12)
  })

  it('5 enemies: 3 hits give 3 or more distinct with 60/125, 4 hits 1 - 145/625, 5 hits 1 - 305/3125', () => {
    expect(atLeast(5, 3, [bounce(3)])).toBeCloseTo(60 / 125, 12)
    expect(atLeast(5, 3, [bounce(4)])).toBeCloseTo(1 - 145 / 625, 12)
    expect(atLeast(5, 3, [bounce(5)])).toBeCloseTo(1 - 305 / 3125, 12)
  })

  it('the distribution of 3 hits on 5 enemies: 1 distinct 5/125, 2 distinct 60/125, 3 distinct 60/125', () => {
    const d = distinctEnemiesHitDistribution(action(5, [bounce(3)]))
    expect(d[0]).toBe(0)
    expect(d[1]).toBeCloseTo(5 / 125, 12)
    expect(d[2]).toBeCloseTo(60 / 125, 12)
    expect(d[3]).toBeCloseTo(60 / 125, 12)
    expect(d[4]! + d[5]!).toBeCloseTo(0, 12)
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
  })

  it('hits on different enemies are not independent: 2 hits on 2 enemies hit both with 1/2, not the product 9/16', () => {
    // Each enemy is hit with 1 - (1/2)^2 = 3/4; both are hit only when the two hits differ: 2 / 4.
    expect(atLeast(2, 2, [bounce(2)])).toBeCloseTo(0.5, 12)
  })
})

describe('random parts with the `random` marker (Lightning-Lord shape, with splash)', () => {
  it('5 enemies, 1 hit: the splash sets are 2, 3, 3, 3, 2 enemies, so P(3 or more) = 3/5', () => {
    expect(atLeast(5, 3, lord(5, 1))).toBeCloseTo(3 / 5, 12)
  })

  it('5 enemies, 2 hits: only two identical hits on an end enemy stay under 3 (2 of 25)', () => {
    expect(atLeast(5, 3, lord(5, 2))).toBeCloseTo(23 / 25, 12)
  })

  it('3 enemies, n hits: all three unless every hit is the left end or every hit is the right end (1 - 2 / 3^n)', () => {
    for (const n of [3, 8, 10]) expect(atLeast(3, 3, lord(3, n)), `${n} hits`).toBeCloseTo(1 - 2 / 3 ** n, 12)
  })

  it('with no adjacent damage the parts are single random hits, the same as a bounce', () => {
    expect(atLeast(5, 3, lord(5, 4, 0))).toBeCloseTo(atLeast(5, 3, [bounce(4)]), 12)
  })

  it('a fractional hit count is whole hits plus a partial one that takes effect with the fraction', () => {
    // 1.5 hits on 3 enemies cannot reach 3 distinct enemies.
    expect(atLeast(3, 3, [bounce(1.5)])).toBe(0)
    // 2 distinct needs the second (partial) hit, 0.5, to land on a different enemy, 2/3.
    expect(atLeast(3, 2, [bounce(1.5)])).toBeCloseTo(0.5 * (2 / 3), 12)
  })
})

describe('mixed deterministic and random', () => {
  it('an AoE already reaches every enemy', () => {
    expect(atLeast(5, 5, [aoe, bounce(1)])).toBe(1)
  })

  it('a single on e1 plus 2 bounce hits on 5: 3 or more needs two distinct hits outside e1, 4 x 3 / 25', () => {
    expect(atLeast(5, 3, [single('e1'), bounce(2)])).toBeCloseTo(12 / 25, 12)
  })

  it('separate attacks are independent groups: two 1-hit bounces equal one 2-hit bounce', () => {
    expect(atLeast(5, 3, [bounce(1)], [bounce(1)])).toBeCloseTo(atLeast(5, 3, [bounce(2)]), 12)
  })

  it('a deterministic blast on e3 (e2, e3, e4) plus one bounce hit: 3 certain, 4 or more with 2 / 5', () => {
    expect(atLeast(5, 3, [blast(0.5), bounce(1)])).toBe(1)
    expect(atLeast(5, 4, [blast(0.5), bounce(1)])).toBeCloseTo(2 / 5, 12)
  })
})

describe('agreement with actionUsed.hitChance for each enemy', () => {
  const profile = loadEnemyProfile('generic-moc')
  const kernel: DamageKernel = { actionDamage: () => fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] }) }
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
          use: () => b.performAction(self.key, 'basic', 'basic', () => { for (const parts of calls) b.attack({ attacker: self.key, ability: 'BASIC', parts }) }),
        },
      },
      attackerState: () => ({}),
      teammateState: () => ({}),
    }),
  }
  const member: MemberSetup = {
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

  /** Runs one action with the attacks and compares the helper's per-enemy chance with the battle's. */
  function compare(enemyCount: number, attackCalls: (ids: readonly string[]) => HitPart[][]) {
    const battle = new Battle({
      members: [member],
      policy: [{ unit: 'a', use: 'basic', when: [] }],
      profile,
      enemyCount,
      weaknesses: 'all',
      cycles: 1,
      start: { energy: 0, skillPoints: 0, techniques: false },
      kernel,
    })
    calls = attackCalls(battle.enemies.ids)
    const attacks: HitPart[][] = []
    let hitChance: Record<string, number> = {}
    battle.timeline.bus.on('attackResolved', (e) => attacks.push([...e.parts]))
    battle.timeline.bus.on('actionUsed', (e) => { hitChance = e.hitChance })
    battle.member('a').instance.actions.basic!.use()
    const mine = enemyHitChances({ attacks, enemies: [...battle.enemies.ids], primary: battle.primary })
    for (const id of battle.enemies.ids) expect(mine[id]!, id).toBeCloseTo(hitChance[id] ?? 0, 12)
    return { mine, ids: [...battle.enemies.ids], primary: battle.primary, attacks }
  }

  it('a bounce, on 3 and 5 enemies', () => {
    compare(5, () => [[bounce(3)]])
    compare(3, () => [[bounce(8)]])
  })

  it('random blasts with splash, two attacks, and a deterministic part', () => {
    compare(5, (ids) => [randomBlasts(ids, 4, 0.5), [single(ids[0])]])
    compare(3, (ids) => [randomBlasts(ids, 5, 0.5), randomBlasts(ids, 2, 0.5)])
    compare(4, () => [[blast(0.5), bounce(2)]])
  })

  it('the Lightning-Lord case: 3 enemies, P(all three) = 1 - 2 / 3^hits from the battle\'s own parts', () => {
    for (const hits of [3, 8, 10]) {
      const { ids, primary, attacks } = compare(3, (e) => [randomBlasts(e, hits, 0.5)])
      expect(probabilityAtLeastEnemiesHit({ attacks, enemies: ids, primary }, 3), `${hits} hits`).toBeCloseTo(1 - 2 / 3 ** hits, 12)
    }
  })
})
