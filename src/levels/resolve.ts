/**
 * Resolves a member's `levels` (scenario file) and the scan's per-character ability and trace fields into `MemberLevels`
 * (K15, K18). The scan side is Reliquary Archiver / HSR-Scanner v4: `skills {basic, skill, ult, talent, elation?}`, a separate
 * `memosprite {skill, talent}`, and `traces {ability_1..3, stat_1..10, special}`, a boolean each. Read as: `ability_N` is major
 * trace B<N>, `stat_N` is minor trace S<N>. The scan README does not say so; it is checked on a real scan by the prerequisite
 * rule (no unlocked trace has a locked prerequisite for any of the 13 roster characters of that scan).
 */
import type { LevelTable, MemberLevels, AbilityKey } from './levels'
import { abilityKeysOf, checkLevels, maxLevels } from './levels'

export interface LevelsObjectFile {
  base?: 'scan' | 'max'
  abilities?: Partial<Record<AbilityKey, number>>
  traces?: {
    major?: boolean[]
    minor?: { locked?: number[], unlocked?: number[] }
  }
}
export type LevelsFile = 'scan' | 'max' | LevelsObjectFile

/** The parts of a scan character that carry levels. All optional: older fixtures have none. */
export interface ScanLevelFields {
  skills?: Partial<Record<string, number>>
  memosprite?: Partial<Record<string, number>>
  traces?: Partial<Record<string, boolean>>
}

/** The scan's levels for a character as `MemberLevels`, or undefined when the scan does not carry them (or not completely). */
export function levelsFromScan(table: LevelTable, scanned: ScanLevelFields | undefined): MemberLevels | undefined {
  if (!scanned?.skills || !scanned.traces) return undefined
  const abilities: Partial<Record<AbilityKey, number>> = {}
  for (const key of abilityKeysOf(table)) {
    const value = key === 'memo_skill' ? scanned.memosprite?.skill
      : key === 'memo_talent' ? scanned.memosprite?.talent
        : scanned.skills[key]
    if (typeof value !== 'number') return undefined
    abilities[key] = value
  }
  const flag = (name: string): boolean | undefined => (typeof scanned.traces![name] === 'boolean' ? scanned.traces![name] : undefined)
  const majors = table.major_traces.map((_, i) => flag(`ability_${i + 1}`))
  const minors = table.minor_traces.map((_, i) => flag(`stat_${i + 1}`))
  if (majors.includes(undefined) || minors.includes(undefined)) return undefined
  return { abilities, majorTraces: majors as boolean[], minorTraces: minors as boolean[], source: 'scan', abilityVersion: table.ability_version }
}

/**
 * The member's levels. `undefined` = no table for the character (only the roster has one), and then nothing is modelled.
 * `hasAccount`: whether the scenario has an account scan. Problems are appended; the result is then undefined.
 */
export function resolveLevels(
  spec: LevelsFile | undefined,
  table: LevelTable | undefined,
  scanned: ScanLevelFields | undefined,
  eidolon: number,
  hasAccount: boolean,
  at: string,
  problems: string[],
): MemberLevels | undefined {
  const given = spec ?? (hasAccount ? 'scan' : 'max')
  if (!table) {
    if (typeof given === 'object') problems.push(`${at}: levels cannot be set: there is no level table for this character yet (data/levels)`)
    return undefined
  }
  const max = maxLevels(table, eidolon)
  const base = typeof given === 'string' ? given : given.base ?? (hasAccount ? 'scan' : 'max')

  let start: MemberLevels = max
  if (base === 'scan') {
    if (!hasAccount) {
      problems.push(`${at}: levels "scan" needs an account`)
      return undefined
    }
    const scan = levelsFromScan(table, scanned)
    if (scan) {
      const before = problems.length
      const found = checkLevels(table, scan, eidolon, `${at}: the scan's levels`)
      for (const line of found) {
        const overEidolon = /goes from 1 up to/.test(line)
        problems.push(overEidolon ? `${line}. Set "eidolon" to match the scan, or "levels": "max"` : line)
      }
      if (problems.length > before) return undefined
      start = scan
    } else {
      start = { ...max, source: 'max', scanMissing: true }
    }
  }
  if (typeof given === 'string') return { ...start, abilities: { ...start.abilities }, majorTraces: [...start.majorTraces], minorTraces: [...start.minorTraces] }

  const before = problems.length
  const levels: MemberLevels = { ...start, abilities: { ...start.abilities }, majorTraces: [...start.majorTraces], minorTraces: [...start.minorTraces], source: 'scenario' }
  for (const [key, value] of Object.entries(given.abilities ?? {})) {
    if (table.abilities[key as AbilityKey] === undefined) {
      problems.push(`${at}: levels.abilities.${key}: character ${table.character} has no ${key} ability`)
      continue
    }
    levels.abilities[key as AbilityKey] = value
  }
  const traces = given.traces
  if (traces?.major !== undefined) {
    if (traces.major.length !== 3) problems.push(`${at}: levels.traces.major needs exactly 3 entries (B1..B3), got ${traces.major.length}`)
    else levels.majorTraces = [...traces.major]
  }
  const minor = traces?.minor
  if (minor?.locked !== undefined && minor.unlocked !== undefined) {
    problems.push(`${at}: levels.traces.minor: "locked" and "unlocked" are exclusive, give one`)
  } else if (minor) {
    const named = minor.locked ?? minor.unlocked ?? []
    const bad = named.filter((n) => !Number.isInteger(n) || n < 1 || n > 10)
    if (bad.length > 0) problems.push(`${at}: levels.traces.minor: S numbers go from 1 to 10, got ${bad.join(', ')}`)
    else if (minor.unlocked !== undefined) levels.minorTraces = levels.minorTraces.map((_, i) => minor.unlocked!.includes(i + 1))
    else for (const n of minor.locked ?? []) levels.minorTraces[n - 1] = false
  }
  if (problems.length === before) problems.push(...checkLevels(table, levels, eidolon, at))
  return problems.length > before ? undefined : levels
}
