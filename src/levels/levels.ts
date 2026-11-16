/**
 * Ability and trace levels (DESIGN.md K15, K15a, K18, K20; docs/proposals/scenario-ability-trace-levels.md).
 *
 * Three layers:
 * - `LevelTable`: a character's committed numbers (data/levels/<id>[_vN].json, written by tools/gamedata/level-tables.mjs).
 * - `MemberLevels`: what one scenario member has: an in-game level per ability (eidolon bonus included, as the game screen and the
 *   scan show it) and which of the 3 major and 10 minor traces are unlocked.
 * - `LevelView`: what a kit reads. `ratio` scales a multiple the kit wrote for the maximum level; `delta` is the number to
 *   inject (K15a) for a buff Fribbels applied at the maximum level.
 */
import { existsSync, readFileSync } from 'node:fs'
import type { InjectedBuff, InjectedDamageType, InjectedStat } from '../kernel/types'
import { repoPath } from '../paths'

export const ABILITY_KEYS = ['basic', 'skill', 'ult', 'talent', 'memo_skill', 'memo_talent', 'elation'] as const
export type AbilityKey = (typeof ABILITY_KEYS)[number]

export interface LevelTable {
  character: string
  ability_version: number
  abilities: Partial<Record<AbilityKey, {
    point: number
    tree_max_level: number
    eidolon_levels: { eidolon: number, levels: number }[]
    skills: Record<string, { levels: number[][] }>
  }>>
  major_traces: { key: string, point: number, requires: number[] }[]
  minor_traces: { key: string, point: number, requires: number[], stat?: string, value?: number }[]
}

export const LEVEL_TABLE_DIR = repoPath('data/levels')

const cache = new Map<string, LevelTable | null>()

/** `<id>.json` for the original kit, `<id>_v<n>.json` for buffed version n. */
export const levelTableFile = (character: string, abilityVersion: number): string =>
  `${character}${abilityVersion > 0 ? `_v${abilityVersion}` : ''}.json`

/**
 * The table for a character and ability version, or undefined when the repository has none (only the roster has one). With no
 * version, the newest file there is, which is what the kernel picks for an unspecified version too.
 */
export function loadLevelTable(character: string, abilityVersion: number | undefined, dir: string = LEVEL_TABLE_DIR): LevelTable | undefined {
  let version = abilityVersion
  if (version === undefined) {
    for (let v = 9; v >= 0; v--) {
      if (existsSync(`${dir}/${levelTableFile(character, v)}`)) { version = v; break }
    }
    if (version === undefined) return undefined
  }
  const file = `${dir}/${levelTableFile(character, version)}`
  const hit = cache.get(file)
  if (hit !== undefined) return hit ?? undefined
  const table = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as LevelTable) : null
  cache.set(file, table)
  return table ?? undefined
}

/** The highest level an ability reaches at this eidolon: the tree's maximum plus the eidolons' bonuses. */
export function maxAbilityLevel(table: LevelTable, key: AbilityKey, eidolon: number): number {
  const ability = table.abilities[key]
  if (!ability) throw new Error(`character ${table.character} has no ${key} ability`)
  return ability.tree_max_level + ability.eidolon_levels.filter((e) => e.eidolon <= eidolon).reduce((n, e) => n + e.levels, 0)
}

/** The abilities this character has, in `ABILITY_KEYS` order. */
export const abilityKeysOf = (table: LevelTable): AbilityKey[] => ABILITY_KEYS.filter((k) => table.abilities[k] !== undefined)

export type LevelsSource = 'scan' | 'max' | 'scenario'

/** What a scenario member has (resolved). Plain data, so it can be echoed in the result. */
export interface MemberLevels {
  /** Total in-game level per ability the character has. */
  abilities: Partial<Record<AbilityKey, number>>
  /** B1..B3: true = unlocked. */
  majorTraces: boolean[]
  /** S1..S10: true = unlocked. */
  minorTraces: boolean[]
  /** `'scan'` = read from the account scan; `'max'` = everything at maximum; `'scenario'` = the member's `levels` object decided something. */
  source: LevelsSource
  /** The table's ability version these were checked against. */
  abilityVersion: number
  /** `'scan'` was asked for (or the default) but the scan has no levels for this character, so everything was set to maximum. */
  scanMissing?: boolean
}

/** Everything at maximum for this eidolon. */
export function maxLevels(table: LevelTable, eidolon: number, source: LevelsSource = 'max'): MemberLevels {
  const abilities: Partial<Record<AbilityKey, number>> = {}
  for (const key of abilityKeysOf(table)) abilities[key] = maxAbilityLevel(table, key, eidolon)
  return { abilities, majorTraces: table.major_traces.map(() => true), minorTraces: table.minor_traces.map(() => true), source, abilityVersion: table.ability_version }
}

/** Every deviation from the maximum, in words: for warnings and the result's echo. Empty when fully built. */
export function describeBelowMax(table: LevelTable, levels: MemberLevels, eidolon: number, only?: (kind: string) => boolean): string[] {
  const out: string[] = []
  for (const key of abilityKeysOf(table)) {
    const have = levels.abilities[key] ?? maxAbilityLevel(table, key, eidolon)
    const max = maxAbilityLevel(table, key, eidolon)
    if (have < max && (only === undefined || only(key))) out.push(`${key} level ${have} of ${max}`)
  }
  const majors = levels.majorTraces.flatMap((on, i) => (on ? [] : [`B${i + 1}`]))
  for (const m of majors) if (only === undefined || only(m)) out.push(`major trace ${m} locked`)
  const minors = levels.minorTraces.flatMap((on, i) => (on ? [] : [`S${i + 1}`]))
  if (minors.length > 0 && (only === undefined || only('minor'))) out.push(`minor trace${minors.length === 1 ? '' : 's'} ${minors.join(', ')} locked`)
  return out
}

/** The PointIDs (as strings, Fribbels' trace node ids) of the minor traces that are locked. */
export function lockedMinorPoints(table: LevelTable, levels: MemberLevels): string[] {
  return table.minor_traces.filter((_, i) => levels.minorTraces[i] === false).map((t) => String(t.point))
}

/**
 * Checks and fills in what a scan or a scenario gave for one member. Every problem comes back as a line; nothing throws.
 * Trace prerequisites: a minor trace unlocked while one it needs is locked is a problem naming both.
 */
export function checkLevels(table: LevelTable, levels: MemberLevels, eidolon: number, at: string): string[] {
  const problems: string[] = []
  for (const key of abilityKeysOf(table)) {
    const level = levels.abilities[key]
    const max = maxAbilityLevel(table, key, eidolon)
    if (level === undefined || !Number.isInteger(level) || level < 1 || level > max) {
      const treeMax = table.abilities[key]!.tree_max_level
      const bonus = max > treeMax ? ` (${max} at E${eidolon})` : ''
      problems.push(`${at}: levels.abilities.${key} is ${String(level)}, but at E${eidolon} ${table.character}'s ${key} goes from 1 up to ${max}${bonus}`)
    }
  }
  const all = [...table.major_traces, ...table.minor_traces]
  const unlocked = new Set<number>()
  table.major_traces.forEach((t, i) => levels.majorTraces[i] && unlocked.add(t.point))
  table.minor_traces.forEach((t, i) => levels.minorTraces[i] && unlocked.add(t.point))
  for (const t of all) {
    if (!unlocked.has(t.point)) continue
    for (const need of t.requires) {
      if (unlocked.has(need)) continue
      const needed = all.find((x) => x.point === need)
      problems.push(`${at}: trace ${t.key} is unlocked but ${needed?.key ?? need}, which it needs, is locked`)
    }
  }
  return problems
}

/**
 * What a kit reads. `levels` absent (a member built without a scenario, or a test): everything at maximum, so `ratio` is 1 and
 * `delta` is 0 and a kit's behaviour is exactly what it was.
 */
export class LevelView {
  constructor(
    readonly table: LevelTable | undefined,
    readonly levels: MemberLevels | undefined,
    readonly eidolon: number,
  ) {}

  /** The member's total level for this ability. */
  level(key: AbilityKey): number {
    if (!this.table) return 1
    return this.levels?.abilities[key] ?? this.max(key)
  }

  max(key: AbilityKey): number {
    return this.table ? maxAbilityLevel(this.table, key, this.eidolon) : 1
  }

  below(key: AbilityKey): boolean {
    return this.level(key) !== this.max(key)
  }

  /** The skill row's parameter at a level (default: the member's). */
  value(key: AbilityKey, skillId: string, param: number, level: number = this.level(key)): number {
    const skill = this.table?.abilities[key]?.skills[skillId]
    if (!skill) throw new Error(`level table has no ${key} skill ${skillId}`)
    const row = skill.levels[level - 1]
    const v = row?.[param]
    if (v === undefined) throw new Error(`level table: ${key} skill ${skillId} has no parameter ${param} at level ${level}`)
    return v
  }

  /** Value at the member's level over the value at the maximum level: what a multiple written for the maximum is multiplied by. */
  ratio(key: AbilityKey, skillId: string, param: number): number {
    if (!this.below(key)) return 1
    return this.value(key, skillId, param) / this.value(key, skillId, param, this.max(key))
  }

  /** Value at the member's level minus the value at the maximum level: the buff to inject on top of the one Fribbels applied (K15a). */
  delta(key: AbilityKey, skillId: string, param: number): number {
    if (!this.below(key)) return 0
    return this.value(key, skillId, param) - this.value(key, skillId, param, this.max(key))
  }

  /** Whether major trace B`n` (1 to 3) is unlocked. */
  major(n: 1 | 2 | 3): boolean {
    return this.levels?.majorTraces[n - 1] ?? true
  }

  /** Whether minor trace S`n` (1 to 10) is unlocked. */
  minor(n: number): boolean {
    return this.levels?.minorTraces[n - 1] ?? true
  }
}

/** The view of a member that has no levels: everything at maximum. */
export const FULL_BUILD = new LevelView(undefined, undefined, 0)

/** A member's view for a kit: its own, or everything at maximum when the setup carries none. */
export const levelsOf = (member: { levels?: LevelView }): LevelView => member.levels ?? FULL_BUILD

/**
 * The buff to inject for a level below the maximum (K15a): `delta` is `LevelView.delta(...)`, negative below the maximum, 0 at it
 * (then there is nothing to inject). `target`: `'self'` is the attacker and its memosprites, `'team'` everyone the buff reaches.
 */
export function levelBuff(
  stat: InjectedStat,
  delta: number,
  target: 'self' | 'team' | 'selfAndMemosprite',
  label: string,
  filter: { abilityKind?: string, damageType?: InjectedDamageType } = {},
): InjectedBuff[] {
  if (Math.abs(delta) < 1e-12) return []
  return [{ stat, value: delta, target, label: `${label} (level)`, ...filter }]
}
