import type { CombatStats, DamageResult, HitResult } from './types'

/** Stats for a fake kernel's answer: tests that do not read them can leave them at zero. */
export const ZERO_STATS: CombatStats = { ATK: 0, DEF: 0, HP: 0, SPD: 0, CR: 0, CD: 0, EHR: 0, RES: 0, BE: 0, ERR: 0, OHB: 0 }

/**
 * A fake kernel's answer built from its hits, for tests. Each ability's total is the sum of its hits,
 * so the two cannot disagree.
 */
export function fakeResult(hits: Record<string, HitResult[]>, stats: CombatStats = ZERO_STATS): DamageResult {
  const damage: Record<string, number> = {}
  for (const [ability, list] of Object.entries(hits)) damage[ability] = list.reduce((sum, hit) => sum + hit.damage, 0)
  return { damage, hits, stats }
}
