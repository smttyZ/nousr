import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Ajv2020 } from 'ajv/dist/2020.js'
import schema from '../../schema/enemy-profile.schema.json' with { type: 'json' }
import { repoPath } from '../paths'

export type AttackTarget = 'single' | 'blast' | 'aoe' | 'bounce'

export interface EnemyAttack {
  id: string
  target: AttackTarget
  /** Multiple of the enemy's ATK. Blast: the main target. Bounce: each hit. */
  multiplier: number
  /** Blast only: multiple of ATK for the allies next to the main target. */
  adjacentMultiplier: number
  /** Number of hits. 1 except for bounce. */
  hits: number
  /** Energy an ally gains per hit received, before its Energy Regeneration Rate. */
  energy: number
}

export interface EnemyProfile {
  id: string
  name?: string
  level: number
  atk: number
  spd: number
  /** Max HP. Optional: without it the battle stops with an error only if a kit asks for enemy HP. */
  hp?: number
  /** Maximum toughness in internal units (3 x the in-game bar), the unit Fribbels' enemyMaxToughness uses. */
  toughness: number
  /** Damage RES to a non-weakness element. */
  res: number
  /** Control RES as a fraction, 0 when the file leaves it out (K29). Read by effects that need "no Control RES". */
  controlRes: number
  attacks: EnemyAttack[]
  /** The attacks in the order they are used, one per turn, repeating. */
  pattern: EnemyAttack[]
}

interface AttackFile {
  id: string
  name?: string
  target: AttackTarget
  multiplier: number
  adjacent_multiplier?: number
  hits?: number
  energy: number
}

interface ProfileFile {
  id: string
  name?: string
  level: number
  atk: number
  spd: number
  hp?: number
  toughness: number
  res: number
  control_res?: number
  attacks: AttackFile[]
  pattern: string[]
}

export class EnemyProfileError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid enemy profile:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    this.name = 'EnemyProfileError'
  }
}

/** Where the profiles that ship with NouSR live. */
export const ENEMY_PROFILE_DIR = repoPath('data/enemies')

const validate = new Ajv2020({ allErrors: true }).compile(schema)

/** Loads a profile by id from a directory of `<id>.json` files. */
export function loadEnemyProfile(id: string, dir: string = ENEMY_PROFILE_DIR): EnemyProfile {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new EnemyProfileError([`"${id}" is not a valid profile id`])
  const path = resolve(dir, `${id}.json`)
  let json: unknown
  try {
    json = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''))
  } catch (cause) {
    throw new EnemyProfileError([`cannot read enemy profile "${id}" at ${path}: ${(cause as Error).message}`])
  }
  const profile = parseEnemyProfile(json)
  if (profile.id !== id) {
    throw new EnemyProfileError([`${path} declares id "${profile.id}", expected "${id}"`])
  }
  return profile
}

/** Checks already-parsed JSON against the schema and the rules the schema cannot express. */
export function parseEnemyProfile(input: unknown): EnemyProfile {
  if (!validate(input)) {
    const lines = (validate.errors ?? []).map((e) => {
      const where = e.instancePath === '' ? '(top level)' : e.instancePath
      const extra = e.keyword === 'additionalProperties' ? ` ("${String(e.params.additionalProperty)}")` : ''
      return `${where}: ${e.message ?? e.keyword}${extra}`
    })
    throw new EnemyProfileError([...new Set(lines)])
  }
  const file = input as unknown as ProfileFile
  const problems: string[] = []

  const byId = new Map<string, EnemyAttack>()
  for (const a of file.attacks) {
    if (byId.has(a.id)) problems.push(`attack id "${a.id}" is used more than once`)
    if (a.target === 'blast' && a.adjacent_multiplier === undefined) {
      problems.push(`attack "${a.id}": a blast needs adjacent_multiplier`)
    }
    if (a.target !== 'blast' && a.adjacent_multiplier !== undefined) {
      problems.push(`attack "${a.id}": adjacent_multiplier only applies to a blast`)
    }
    if (a.target === 'bounce' && a.hits === undefined) problems.push(`attack "${a.id}": a bounce needs hits`)
    if (a.target !== 'bounce' && a.hits !== undefined) problems.push(`attack "${a.id}": hits only applies to a bounce`)
    byId.set(a.id, {
      id: a.id,
      target: a.target,
      multiplier: a.multiplier,
      adjacentMultiplier: a.adjacent_multiplier ?? 0,
      hits: a.hits ?? 1,
      energy: a.energy,
    })
  }

  const pattern: EnemyAttack[] = []
  file.pattern.forEach((attackId, i) => {
    const attack = byId.get(attackId)
    if (attack) pattern.push(attack)
    else problems.push(`pattern[${i}]: "${attackId}" is not one of this profile's attacks`)
  })

  if (problems.length > 0) throw new EnemyProfileError(problems)

  return {
    id: file.id,
    ...(file.name !== undefined && { name: file.name }),
    level: file.level,
    atk: file.atk,
    spd: file.spd,
    ...(file.hp !== undefined && { hp: file.hp }),
    toughness: file.toughness,
    controlRes: file.control_res ?? 0,
    res: file.res,
    attacks: [...byId.values()],
    pattern,
  }
}
