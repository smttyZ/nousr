import type { MainStats, Substat } from './types'

/** Main stats of all six relics: Head is always HP and Hands always ATK (flat). */
export function allMainStats(mains: MainStats): string[] {
  return ['HP', 'ATK', mains.Body, mains.Feet, mains['Planar Sphere'], mains['Link Rope']]
}

/**
 * Rule (b) of schema/standard-build.schema.json: a stat's distributed rolls are at most 2 times the number of the
 * six relics whose main stat is not that stat (a relic cannot roll its own main stat as a substat).
 */
export function capFor(stat: Substat, mains: MainStats): number {
  return 2 * allMainStats(mains).filter((main) => main !== stat).length
}

/**
 * Rule (f): the most rolls of one stat the six relics can hold, fixed ones included. A 5-star relic at +15 has 4
 * substats and 5 upgrades, so at most 6 rolls of one substat on one piece.
 */
export function physicalLimit(stat: Substat, mains: MainStats): number {
  return 6 * allMainStats(mains).filter((main) => main !== stat).length
}
