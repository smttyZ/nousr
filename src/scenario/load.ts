import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Ajv2020 } from 'ajv/dist/2020.js'
import type { ErrorObject } from 'ajv'
import schema from '../../schema/scenario.schema.json' with { type: 'json' }
import { defaultKitOptions, resolveKitOptions } from './kitOptions'
import type {
  AccountScan,
  Member,
  MemberFile,
  Rule,
  ScanRelic,
  Scenario,
  ScenarioFile,
  StandardBuildOverride,
  StandardBuildOverrideFile,
  Team,
  TeamFile,
} from './types'

/** Game versions this build of the simulator models. */
export const SUPPORTED_GAME_VERSIONS: readonly string[] = ['4.7']

/** Starting state when a scenario leaves it out: the Memory of Chaos defaults (DESIGN.md, decision 6). */
export const DEFAULT_START = { energy: 0.5, skillPoints: 3, techniques: true } as const

/** First segments of a condition path that are not member keys. */
const RESERVED_KEYS: readonly string[] = ['team', 'battle']

/** Everything wrong with a scenario, reported together so one run finds every problem. */
export class ScenarioError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid scenario:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    this.name = 'ScenarioError'
  }
}

export interface ParseOptions {
  /**
   * Turns the scenario's `account` path into the parsed JSON of that file. Needed only when
   * `account` is a path; `loadScenarioFile` supplies one that reads relative to the scenario file.
   */
  readAccount?: (path: string) => unknown
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true })
const validateScenario = ajv.compile(schema)
const validateScan = ajv.getSchema(`${schema.$id}#/$defs/scan_v4`)!

/** Reads a scenario file from disk. An `account` path in it is read relative to that file. */
export function loadScenarioFile(path: string): Scenario {
  const file = resolve(path)
  return parseScenario(readJson(file), {
    readAccount: (accountPath) => readJson(resolve(dirname(file), accountPath)),
  })
}

/** Checks already-parsed JSON against the schema and the cross-reference rules, and resolves it. */
export function parseScenario(input: unknown, options: ParseOptions = {}): Scenario {
  if (!validateScenario(input)) {
    throw new ScenarioError(describeSchemaErrors(validateScenario.errors ?? []))
  }
  const file = input as unknown as ScenarioFile
  const problems: string[] = []

  if (!SUPPORTED_GAME_VERSIONS.includes(file.game_version)) {
    problems.push(
      `game_version "${file.game_version}" is not modelled by this build (supported: ${SUPPORTED_GAME_VERSIONS.join(', ')})`,
    )
  }

  const account = resolveAccount(file.account, options, problems)

  const teamIds = new Set<string>()
  const teams: Team[] = []
  file.teams.forEach((team, i) => {
    if (teamIds.has(team.id)) problems.push(`teams[${i}]: team id "${team.id}" is used more than once`)
    teamIds.add(team.id)
    teams.push(resolveTeam(team, account, problems))
  })

  if (problems.length > 0) throw new ScenarioError(problems)

  return {
    ...(file.name !== undefined && { name: file.name }),
    gameVersion: file.game_version,
    battle: {
      mode: file.battle.mode,
      cycles: file.battle.cycles,
      period: file.battle.period ?? null,
      start: {
        energy: file.battle.start?.energy ?? DEFAULT_START.energy,
        skillPoints: file.battle.start?.skill_points ?? DEFAULT_START.skillPoints,
        techniques: file.battle.start?.techniques ?? DEFAULT_START.techniques,
      },
    },
    enemies: {
      profile: file.enemies.profile,
      counts: [...file.enemies.counts],
      weaknesses: file.enemies.weaknesses ?? 'all',
    },
    teams,
    ...(account !== undefined && { scanSource: account.source }),
  }
}

function readJson(path: string): unknown {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (cause) {
    throw new ScenarioError([`cannot read ${path}: ${(cause as Error).message}`])
  }
  try {
    // Scanner exports written on Windows often start with a byte-order mark.
    return JSON.parse(text.replace(/^﻿/, ''))
  } catch (cause) {
    throw new ScenarioError([`${path} is not valid JSON: ${(cause as Error).message}`])
  }
}

function resolveAccount(
  account: ScenarioFile['account'],
  options: ParseOptions,
  problems: string[],
): AccountScan | undefined {
  if (account === undefined) return undefined

  let scan: unknown = account
  if (typeof account === 'string') {
    if (!options.readAccount) {
      problems.push(`account is the path "${account}", but nothing was given to read it with (use loadScenarioFile)`)
      return undefined
    }
    scan = options.readAccount(account)
    if (!validateScan(scan)) {
      problems.push(...describeSchemaErrors(validateScan.errors ?? []).map((p) => `account file "${account}": ${p}`))
      return undefined
    }
  }
  return scan as AccountScan
}

function resolveTeam(team: TeamFile, account: AccountScan | undefined, problems: string[]): Team {
  const at = `team "${team.id}"`
  const keys = new Set<string>()
  const characters = new Set<string>()
  const members: Member[] = []
  const teamKeys: ReadonlySet<string> = new Set(team.members.map((m) => m.key))

  for (const member of team.members) {
    if (RESERVED_KEYS.includes(member.key)) {
      problems.push(`${at}: member key "${member.key}" is reserved (${RESERVED_KEYS.join(', ')})`)
    }
    if (keys.has(member.key)) problems.push(`${at}: member key "${member.key}" is used more than once`)
    keys.add(member.key)
    if (characters.has(member.character)) {
      problems.push(`${at}: character ${member.character} is in the team more than once`)
    }
    characters.add(member.character)

    const resolved = resolveMember(member, account, teamKeys, `${at}, member "${member.key}"`, problems)
    if (resolved) members.push(resolved)
  }

  const policy: Rule[] = team.policy.map((rule, i) => {
    const ruleAt = `${at}, policy[${i}]`
    if (!keys.has(rule.unit)) problems.push(`${ruleAt}: unit "${rule.unit}" is not a member of this team`)
    if (rule.target !== undefined && !keys.has(rule.target)) {
      problems.push(`${ruleAt}: target "${rule.target}" is not a member of this team`)
    }
    for (const condition of rule.when ?? []) {
      const owner = condition.what.split('.')[0]!
      if (!RESERVED_KEYS.includes(owner) && !keys.has(owner)) {
        problems.push(
          `${ruleAt}: condition "${condition.what}" must start with ${RESERVED_KEYS.join(', ')} or a member key of this team`,
        )
      }
    }
    return {
      unit: rule.unit,
      use: rule.use,
      ...(rule.target !== undefined && { target: rule.target }),
      when: (rule.when ?? []).map(({ what, min, max, is }) => ({
        what,
        ...(min !== undefined && { min }),
        ...(max !== undefined && { max }),
        ...(is !== undefined && { is }),
      })),
    }
  })

  return { id: team.id, ...(team.name !== undefined && { name: team.name }), members, policy }
}

function resolveMember(
  member: MemberFile,
  account: AccountScan | undefined,
  teamKeys: ReadonlySet<string>,
  at: string,
  problems: string[],
): Member | undefined {
  const before = problems.length
  const scanned = account?.characters.find((c) => c.id === member.character)
  const noScanReason = account
    ? `character ${member.character} is not in the account scan`
    : 'there is no account'

  const eidolon = member.eidolon ?? scanned?.eidolon
  if (eidolon === undefined) problems.push(`${at}: eidolon is required because ${noScanReason}`)

  let lightCone = member.light_cone
  if (!lightCone) {
    const held = account?.light_cones.find((lc) => lc.location === member.character)
    if (held) lightCone = { id: held.id, superimposition: held.superimposition ?? 1 }
    else if (account && scanned) problems.push(`${at}: light_cone is required because the scan shows none on this character`)
    else problems.push(`${at}: light_cone is required because ${noScanReason}`)
  }

  const relics = resolveRelics(member, account, at, problems)
  if (member.standard_build !== undefined && relics !== undefined && relics !== 'standard') {
    const given = member.relics === undefined
      ? '"equipped" (the default when there is an account)'
      : typeof member.relics === 'string' ? `"${member.relics}"` : 'a list'
    problems.push(`${at}: standard_build changes a standard build, but this member's relics are ${given}; set relics to "standard" or remove standard_build`)
  }

  const kitOptions = member.kit_options !== undefined
    ? resolveKitOptions(member.character, member.kit_options, teamKeys, at, problems)
    : defaultKitOptions(member.character)

  if (problems.length > before) return undefined
  return {
    key: member.key,
    character: member.character,
    abilityVersion: member.ability_version ?? scanned?.ability_version,
    eidolon: eidolon!,
    affinitiveEidolon: member.affinitive_eidolon ?? false,
    lightCone: lightCone!,
    relics: relics!,
    ...(member.standard_build !== undefined && { standardBuild: resolveOverride(member.standard_build) }),
    ...(kitOptions !== undefined && { kitOptions, kitOptionsGiven: Object.keys(member.kit_options ?? {}).filter((k) => k !== 'notes') }),
  }
}

function resolveOverride(file: StandardBuildOverrideFile): StandardBuildOverride {
  return {
    ...(file.main_stats !== undefined && { mainStats: { ...file.main_stats } }),
    ...(file.distributed !== undefined && { distributed: { ...file.distributed.rolls } }),
  }
}

function resolveRelics(
  member: MemberFile,
  account: AccountScan | undefined,
  at: string,
  problems: string[],
): 'standard' | ScanRelic[] | undefined {
  const choice = member.relics ?? (account ? 'equipped' : 'standard')
  if (choice === 'standard') return 'standard'

  let relics: ScanRelic[]
  if (choice === 'equipped') {
    if (!account) {
      problems.push(`${at}: relics "equipped" needs an account`)
      return undefined
    }
    relics = account.relics.filter((r) => r.location === member.character)
    if (relics.length === 0) {
      problems.push(`${at}: the scan shows no relics on character ${member.character}; use "standard" or list the relics`)
      return undefined
    }
  } else {
    relics = []
    for (const entry of choice) {
      if (typeof entry !== 'string') {
        relics.push(entry)
        continue
      }
      const found = account?.relics.find((r) => r._uid === entry)
      if (found) relics.push(found)
      else problems.push(`${at}: relic "${entry}" ${account ? 'is not in the account scan' : 'cannot be looked up because there is no account'}`)
    }
  }

  const slots = new Set<string>()
  for (const relic of relics) {
    if (slots.has(relic.slot)) problems.push(`${at}: more than one relic in the ${relic.slot} slot`)
    slots.add(relic.slot)
  }
  return relics
}

function describeSchemaErrors(errors: ErrorObject[]): string[] {
  const lines = errors.map((e) => {
    const where = e.instancePath === '' ? '(top level)' : e.instancePath
    const extra = e.keyword === 'additionalProperties' ? ` ("${String(e.params.additionalProperty)}")` : ''
    return `${where}: ${e.message ?? e.keyword}${extra}`
  })
  return [...new Set(lines)]
}
