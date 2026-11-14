import type { UnitId } from '../engine'
import type { HitPart } from './battle'

/**
 * How likely an action is to hit N or more DISTINCT enemies (DESIGN.md K21), computed exactly from its attacks.
 *
 * It lives beside `battle.ts` because it reads the same `HitPart` shapes and mirrors the way `Battle.attack`
 * decides which enemies a part reaches and how random parts are grouped (K17). It imports only types from there,
 * so any module (a light cone, a relic set, a kit) can call it from an `attackResolved` listener without a cycle.
 *
 * Method. Hits on different enemies are NOT independent (one random hit lands on exactly one choice), so this works
 * over hits, not over per-enemy chances. The state is the set of enemies reached so far (a bitmask, at most 2^5
 * subsets for 5 enemies) with its probability:
 * - Deterministic parts (a part without `random`: single, blast, AoE) reach their enemies with certainty. They are
 *   the starting set.
 * - A random group is the disjoint choices of ONE random hit (a 'bounce' part is one group of one choice per enemy,
 *   each with chance 1 / enemies; parts with the `random` marker form a group by `random.group`, default 'random').
 *   Each choice reaches its set of enemies (the target, plus the neighbours for a blast with adjacent damage) with
 *   its `chance`; with the leftover probability the hit reaches nobody new. The group applies `hits` such hits in
 *   turn, each independent of the others.
 * - Separate attacks (one `Battle.attack` call each) never share a group, as in `Battle.attack`.
 *
 * Per enemy this agrees with `actionUsed.hitChance` (1 - the product of (1 - chance) over the hits) whenever
 * the hits are whole numbers. A fractional `hits` (Jing Yuan's E6 vulnerability ramp splits a hit count into
 * fractional weights) is applied as floor(hits) whole hits plus one partial hit that takes effect with probability
 * equal to the fraction; that is exact for the expected number of hits, but its per-enemy chance differs slightly
 * from `hitChance`, which raises (1 - chance) to the fractional power.
 */

/** The attacks of one action (each the `parts` of one `Battle.attack` call) and the field they landed on. */
export interface ActionHits {
  attacks: ReadonlyArray<readonly HitPart[]>
  /** The enemies in battle order (neighbours are adjacent entries). */
  enemies: readonly UnitId[]
  /** The enemy a `single` or `blast` part without a `target` lands on. */
  primary: UnitId
}

interface Choice { reach: number, chance: number }

/** The probability of each exact set of enemies reached (bit i is `enemies[i]`). */
export function reachedSetDistribution(action: ActionHits): Map<number, number> {
  const { enemies, primary } = action
  const count = enemies.length
  if (count > 20) throw new Error(`hitProbability: ${count} enemies is more than the subset walk is meant for`)
  const bit = (id: UnitId): number => {
    const i = enemies.indexOf(id)
    if (i < 0) throw new Error(`hitProbability: ${id} is not one of the enemies`)
    return 1 << i
  }
  const reachOf = (target: UnitId, adjacent: number | undefined): number => {
    let mask = bit(target)
    if (adjacent !== undefined && adjacent > 0) {
      const i = enemies.indexOf(target)
      if (i > 0) mask |= 1 << (i - 1)
      if (i < count - 1) mask |= 1 << (i + 1)
    }
    return mask
  }

  let certain = 0
  /** Random groups across the whole action: each is its own independent set of hits. */
  const groups: Array<{ hits: number, choices: Choice[] }> = []

  action.attacks.forEach((parts, attackIndex) => {
    const byKey = new Map<string, { hits: number, choices: Choice[] }>()
    const addRandom = (key: string, hits: number, choice: Choice) => {
      let group = byKey.get(key)
      if (group === undefined) {
        group = { hits, choices: [] }
        byKey.set(key, group)
        groups.push(group)
      }
      if (group.hits !== hits) throw new Error(`hitProbability: random group "${key}" has parts with different hit counts`)
      group.choices.push(choice)
    }
    parts.forEach((part, partIndex) => {
      // Like Battle.attack, a part that deals nothing reaches nothing.
      if (!(part.scaling > 0)) return
      switch (part.shape) {
        case 'single':
        case 'blast': {
          const adjacent = part.shape === 'blast' && part.adjacent > 0 ? part.adjacent : undefined
          const reach = reachOf(part.target ?? primary, adjacent)
          if (part.random === undefined) certain |= reach
          else addRandom(`${attackIndex}:${part.random.group ?? 'random'}`, part.random.hits, { reach, chance: part.random.chance })
          break
        }
        case 'aoe':
          certain |= (1 << count) - 1
          break
        case 'bounce':
          for (let i = 0; i < count; i++) {
            addRandom(`${attackIndex}:bounce:${partIndex}`, part.hits, { reach: 1 << i, chance: 1 / count })
          }
          break
      }
    })
  })

  let states = new Map<number, number>([[certain, 1]])
  for (const group of groups) {
    const whole = Math.floor(group.hits + 1e-9)
    const fraction = group.hits - whole
    const steps: number[] = Array<number>(whole).fill(1)
    if (fraction > 1e-9) steps.push(fraction)
    for (const weight of steps) {
      const next = new Map<number, number>()
      const put = (mask: number, p: number) => next.set(mask, (next.get(mask) ?? 0) + p)
      for (const [mask, p] of states) {
        let landed = 0
        for (const choice of group.choices) {
          const q = Math.min(1, choice.chance) * weight
          landed += q
          put(mask | choice.reach, p * q)
        }
        put(mask, p * Math.max(0, 1 - landed))
      }
      states = next
    }
  }

  return states
}

/** `result[k]` is the probability that exactly k distinct enemies were hit. Length enemies + 1. */
export function distinctEnemiesHitDistribution(action: ActionHits): number[] {
  const distribution = Array<number>(action.enemies.length + 1).fill(0)
  for (const [mask, p] of reachedSetDistribution(action)) distribution[popcount(mask)]! += p
  return distribution
}

/** The probability that the action hit at least `n` distinct enemies. `n <= 0` is 1; `n` above the enemy count, 0. */
export function probabilityAtLeastEnemiesHit(action: ActionHits, n: number): number {
  if (n <= 0) return 1
  const distribution = distinctEnemiesHitDistribution(action)
  let sum = 0
  for (let k = Math.ceil(n); k < distribution.length; k++) sum += distribution[k]!
  return Math.min(1, Math.max(0, sum))
}

/** Per enemy, the probability that the action hit it at least once, from the same walk (agrees with `actionUsed.hitChance`). */
export function enemyHitChances(action: ActionHits): Record<UnitId, number> {
  const result: Record<UnitId, number> = {}
  for (const id of action.enemies) result[id] = 0
  for (const [mask, p] of reachedSetDistribution(action)) {
    action.enemies.forEach((id, i) => {
      if (mask & (1 << i)) result[id]! += p
    })
  }
  return result
}

function popcount(mask: number): number {
  let n = 0
  for (let m = mask; m; m &= m - 1) n++
  return n
}
