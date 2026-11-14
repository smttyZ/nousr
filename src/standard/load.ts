import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Ajv2020 } from 'ajv/dist/2020.js'
import type { ErrorObject } from 'ajv'
import schema from '../../schema/standard-build.schema.json' with { type: 'json' }
import {
  DISTRIBUTED_ROLLS,
  type MainStats,
  type SetRef,
  type StandardBuild,
  StandardBuildError,
  type Substat,
  SUBSTATS,
} from './types'
import { capFor } from './rules'

/** Where the standard builds that ship with NouSR live. */
export const STANDARD_BUILD_DIR = resolve(import.meta.dirname, '../../data/standard-builds')

/**
 * The game's set names by id, from the data file Fribbels ships (the same data its importer reads). Rule (d) of
 * the schema: a file's `set_id` and `name` must agree with it.
 */
export const GAME_DATA_PATH = resolve(import.meta.dirname, '../../vendor/hsr-optimizer/src/data/game_data.json')

let gameSetNames: ReadonlyMap<string, string> | undefined

export function loadGameSetNames(path: string = GAME_DATA_PATH): ReadonlyMap<string, string> {
  if (path === GAME_DATA_PATH && gameSetNames) return gameSetNames
  let json: { relics?: { id: string, name: string }[] }
  try {
    json = JSON.parse(readFileSync(path, 'utf8'))
  } catch (cause) {
    throw new StandardBuildError([`cannot read the game's set names from ${path}: ${(cause as Error).message}`])
  }
  const names = new Map((json.relics ?? []).map((set) => [String(set.id), set.name] as const))
  if (path === GAME_DATA_PATH) gameSetNames = names
  return names
}

const validate = new Ajv2020({ allErrors: true, allowUnionTypes: true }).compile(schema)

interface SetFile { set_id: string, name: string }
interface BuildFile {
  character: string
  ability_version: number
  name?: string
  relic_sets: { four_piece?: SetFile, two_piece?: [SetFile, SetFile] }
  ornament_set: SetFile
  main_stats: Record<string, string>
  spd_target: { value: number | 'none', reason: string }
  distributed: { rolls: Record<string, number>, priority: string[] }
}

export interface LoadOptions {
  /** Directory of standard-build files. Defaults to data/standard-builds. */
  dir?: string
  /** Set names by id, for rule (d). Defaults to the game data Fribbels ships. */
  setNames?: ReadonlyMap<string, string>
}

/**
 * The standard build for a character and ability version (the kernel's ability version: 0 is the original kit,
 * 1 the buffed one). Looks for `<character>.json`, then for any file in the directory that declares that
 * character and version. Errors name the file and the rule.
 */
export function loadStandardBuild(character: string, abilityVersion: number, options: LoadOptions = {}): StandardBuild {
  const dir = options.dir ?? STANDARD_BUILD_DIR
  const direct = resolve(dir, `${character}.json`)
  const read = (path: string) => readStandardBuildFile(path, options)

  const declared = (path: string): { character?: unknown, ability_version?: unknown } | undefined => {
    try {
      return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''))
    } catch {
      return undefined
    }
  }
  const matches = (path: string) => {
    const json = declared(path)
    return json?.character === character && json.ability_version === abilityVersion
  }

  if (matches(direct)) return read(direct)
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  } catch (cause) {
    throw new StandardBuildError([`cannot read the standard-build directory ${dir}: ${(cause as Error).message}`])
  }
  const found = files.map((f) => resolve(dir, f)).filter(matches)
  if (found.length > 1) {
    throw new StandardBuildError([`${found.join(' and ')} both declare character ${character}, ability_version ${abilityVersion}`])
  }
  if (found.length === 1) return read(found[0]!)

  const have = files
    .map((f) => declared(resolve(dir, f)))
    .filter((j) => j?.character === character)
    .map((j) => `ability_version ${String(j!.ability_version)}`)
  throw new StandardBuildError([
    `no standard build for character ${character}, ability_version ${abilityVersion} in ${dir}` +
      (have.length > 0 ? ` (that character has: ${have.join(', ')})` : ''),
  ])
}

/** Reads and validates one standard-build file. */
export function readStandardBuildFile(path: string, options: LoadOptions = {}): StandardBuild {
  let json: unknown
  try {
    json = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''))
  } catch (cause) {
    throw new StandardBuildError([`${path}: cannot read: ${(cause as Error).message}`])
  }
  return parseStandardBuild(json, path, options)
}

/**
 * Checks already-parsed JSON against schema/standard-build.schema.json and the rules a JSON Schema cannot express
 * that need no kernel: (a) 24 distributed rolls, (b) the per-stat cap (SPD is checked with the SPD target in
 * `resolveStandardBuild`), (c) two different 2-piece sets, (d) set id and name agree with the game data,
 * (e) the priority lists every stat that has rolls. `source` names the file in every message.
 */
export function parseStandardBuild(input: unknown, source: string, options: LoadOptions = {}): StandardBuild {
  if (!validate(input)) {
    throw new StandardBuildError(describeSchemaErrors(validate.errors ?? []).map((p) => `${source}: ${p}`))
  }
  const file = input as unknown as BuildFile
  const problems: string[] = []
  const fail = (rule: string, text: string) => problems.push(`${source}: rule ${rule}: ${text}`)

  const rolls = Object.fromEntries(SUBSTATS.map((s) => [s, file.distributed.rolls[s] ?? 0])) as Record<Substat, number>
  const mainStats: MainStats = {
    Body: file.main_stats.Body!,
    Feet: file.main_stats.Feet!,
    'Planar Sphere': file.main_stats['Planar Sphere']!,
    'Link Rope': file.main_stats['Link Rope']!,
  }

  const total = SUBSTATS.reduce((n, s) => n + rolls[s], 0)
  if (total !== DISTRIBUTED_ROLLS) {
    fail('(a) 24 distributed rolls', `distributed.rolls add up to ${total}, not ${DISTRIBUTED_ROLLS}`)
  }

  for (const stat of SUBSTATS) {
    if (stat === 'SPD') continue
    const cap = capFor(stat, mainStats)
    if (rolls[stat] > cap) {
      fail('(b) per-stat cap', `${stat} has ${rolls[stat]} distributed rolls, over its cap of ${cap} (2 x the ${cap / 2} relics whose main stat is not ${stat}, with these main stats)`)
    }
  }

  const sets = [
    ...(file.relic_sets.four_piece ? [file.relic_sets.four_piece] : []),
    ...(file.relic_sets.two_piece ?? []),
    file.ornament_set,
  ]
  const two = file.relic_sets.two_piece
  if (two && (two[0].set_id === two[1].set_id || two[0].name === two[1].name)) {
    fail('(c) two different 2-piece sets', `both 2-piece sets are ${two[0].name} (${two[0].set_id})`)
  }

  const names = options.setNames ?? loadGameSetNames()
  for (const set of sets) {
    const known = names.get(set.set_id)
    if (known === undefined) fail('(d) set id and name', `set_id "${set.set_id}" (${set.name}) is not a set in the game data`)
    else if (known !== set.name) fail('(d) set id and name', `set_id "${set.set_id}" is "${known}" in the game data, but the file calls it "${set.name}"`)
  }

  for (const stat of SUBSTATS) {
    if (stat !== 'SPD' && rolls[stat] > 0 && !file.distributed.priority.includes(stat)) {
      fail('(e) priority covers every rolled stat', `${stat} has ${rolls[stat]} distributed rolls but is not in distributed.priority`)
    }
  }

  if (problems.length > 0) throw new StandardBuildError(problems)

  const ref = (set: SetFile): SetRef => ({ setId: set.set_id, name: set.name })
  return {
    source,
    character: file.character,
    abilityVersion: file.ability_version,
    ...(file.name !== undefined && { name: file.name }),
    relicSets: file.relic_sets.four_piece
      ? { fourPiece: ref(file.relic_sets.four_piece) }
      : { twoPiece: [ref(two![0]), ref(two![1])] },
    ornamentSet: ref(file.ornament_set),
    mainStats,
    spdTarget: { value: file.spd_target.value, reason: file.spd_target.reason },
    distributed: rolls,
    priority: [...file.distributed.priority] as StandardBuild['priority'],
  }
}

function describeSchemaErrors(errors: ErrorObject[]): string[] {
  const lines = errors.map((e) => {
    const where = e.instancePath === '' ? '(top level)' : e.instancePath
    const extra = e.keyword === 'additionalProperties' ? ` ("${String(e.params.additionalProperty)}")` : ''
    return `${where}: ${e.message ?? e.keyword}${extra}`
  })
  return [...new Set(lines)]
}
