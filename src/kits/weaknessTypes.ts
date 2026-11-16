import type { Battle } from '../battle/battle'
import type { UnitId } from '../engine/events'

/**
 * How many different Weakness Types an enemy has (DESIGN.md, K28): the number Anaxa's Qualitative Disclosure (5 or more),
 * his Qualitative Shift trace (4% DEF ignored per type) and The Great Cosmic Enterprise (DMG per type) all read.
 *
 * The scenario's `weaknesses` setting (S5) is one list for every enemy; the engine does not track weaknesses per enemy
 * (a roadmap item), so the per-enemy count lives in Anaxa's kit, which is the only source of implanted weaknesses in the
 * roster. A kit that keeps such a count registers it here for its member; an item that reads "the wearer's enemy's number of
 * Weakness Types" asks for it here and gets the scenario's own count when no kit has registered one.
 */

/** The game has seven elements, so an enemy has at most seven Weakness Types. */
export const MAX_WEAKNESS_TYPES = 7

/** The scenario's count: 'all' is every type, a list is its length (a repeated element counts once). */
export function scenarioWeaknessTypes(battle: Battle): number {
  const { weaknesses } = battle
  return weaknesses === 'all' ? MAX_WEAKNESS_TYPES : Math.min(MAX_WEAKNESS_TYPES, new Set(weaknesses).size)
}

/** An enemy's expected number of Weakness Types (a fraction when implants landed at a chance, K22). */
export type WeaknessCounter = (enemy: UnitId) => number

const counters = new WeakMap<Battle, Map<string, WeaknessCounter>>()

/** `member` (a member key) keeps its own per-enemy count; `weaknessTypesFor` reads it for that member's equipment. */
export function registerWeaknessCounter(battle: Battle, member: string, counter: WeaknessCounter): void {
  const byMember = counters.get(battle) ?? new Map<string, WeaknessCounter>()
  byMember.set(member, counter)
  counters.set(battle, byMember)
}

/**
 * The number of Weakness Types `enemy` has for `member`'s effects: the count that member's kit keeps (Anaxa), else the
 * scenario's. Reads state only, so it is safe to call from `attackerState`.
 */
export function weaknessTypesFor(battle: Battle, member: string, enemy: UnitId): number {
  const counter = counters.get(battle)?.get(member)
  return counter === undefined ? scenarioWeaknessTypes(battle) : counter(enemy)
}
