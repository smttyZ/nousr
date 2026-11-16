import type { Battle } from '../battle/battle'
import type { Kit } from '../kits/kit'

/**
 * A MoC period (Memory Turbulence) as a module (DESIGN.md, "Period modules", decision 4b). It has the hook
 * style of a kit and of an equipment module: `create(battle)` runs once per battle, after every kit and
 * equipment module exists, and subscribes to events (cycle start, an Ultimate used ...) and registers
 * modifiers. A scenario selects one by id in `battle.period`; swapping periods means adding a file in
 * src/periods/, registering it in index.ts, and changing that one field.
 */
export interface PeriodModule {
  /** The id a scenario writes in `battle.period`, e.g. "moc-2026-11-survival-of-the-fittest". */
  id: string
  /** The period's name in game. */
  name: string
  /**
   * Called while a team is planned, before any battle runs: one line per team member whose presence makes
   * this period's rule something the simulator cannot model. Each line starts with `member "<key>"`. A run
   * with any such line stops with an error, so the period cannot silently change a result.
   */
  check?(members: readonly { key: string, kit: Pick<Kit, 'path' | 'characterId'> }[]): string[]
  /** Called once per battle. May throw when `check` would report a problem (a battle built without `run.ts`). */
  create(battle: Battle): void
}

/** Periods by id. */
export type PeriodRegistry = ReadonlyMap<string, PeriodModule>

export function createPeriodRegistry(modules: readonly PeriodModule[]): PeriodRegistry {
  const byId = new Map<string, PeriodModule>()
  for (const module of modules) {
    if (byId.has(module.id)) throw new Error(`Period "${module.id}" is registered twice`)
    byId.set(module.id, module)
  }
  return byId
}

/** The module for a period id, or an error listing every known id. */
export function resolvePeriod(id: string, registry: PeriodRegistry): PeriodModule {
  const found = registry.get(id)
  if (!found) {
    const known = [...registry.keys()]
    throw new Error(`unknown period "${id}" (known periods: ${known.length > 0 ? known.join(', ') : 'none'})`)
  }
  return found
}
