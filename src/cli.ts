/**
 * The `nousr` command (DESIGN.md K8, K33, K34; docs/proposals/results-format.md): `run`, `validate` and `version`.
 *
 * `main` takes everything it touches from the outside (streams, environment, working folder, the damage kernel), so tests run it
 * in process. This file never imports the Fribbels adapter, which only the bundle's entry point does
 * (src/kernel/fribbels/cliEntry.ts): the adapter is type-checked separately, with Fribbels' own compiler options.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { EXIT, parseCommandLine, USAGE } from './cli/args'
import type { RunArgs, ValidateArgs } from './cli/args'
import { formatReport } from './cli/format'
import { KERNEL_ID, nousrCommit, nousrVersion, sha256 } from './result/identity'
import { buildResult } from './result/build'
import type { NousrResult } from './result/types'
import { assertValidResult } from './result/validate'
import { planTeam, RunError, runScenario } from './run/run'
import type { RunOptions } from './run/run'
import { formatWarning } from './run/warnings'
import type { RunWarning } from './run/warnings'
import { parseScenario, ScenarioError, SUPPORTED_GAME_VERSIONS } from './scenario/load'
import type { Scenario } from './scenario/types'
import type { ScenarioKernel } from './kernel/types'

export interface CliStream {
  write(text: string): unknown
  isTTY?: boolean
}

/** What the command line touches. The real ones are set in src/kernel/fribbels/cliEntry.ts. */
export interface CliDeps {
  stdout: CliStream
  stderr: CliStream
  env: Record<string, string | undefined>
  /** Scenario and output paths resolve against this. */
  cwd: string
  /** Called only when a command needs the damage kernel. */
  kernel: () => ScenarioKernel
  /** Replaces defaults of `runScenario` (tests give a fake kit registry here). */
  runOptions?: Partial<Omit<RunOptions, 'kernel'>>
  /** Replaces NouSR's own version and commit in the result (tests; so a result does not change with every commit). */
  identity?: { nousr: string, nousr_commit: string | null }
}

/** Runs the command and returns its exit code. Never throws: a bug in NouSR is printed and returned as `EXIT.internal`. */
export async function main(argv: readonly string[], deps: CliDeps): Promise<number> {
  const parsed = parseCommandLine(argv)
  try {
    switch (parsed.command) {
      case 'help':
        deps.stdout.write(USAGE)
        return EXIT.ok
      case 'error':
        deps.stderr.write(`nousr: ${parsed.message}\n\n${USAGE}`)
        return EXIT.badArguments
      case 'version':
        deps.stdout.write(`NouSR ${identity(deps).nousr}\nkernel ${KERNEL_ID}\ngame ${SUPPORTED_GAME_VERSIONS.join(', ')}\n`)
        return EXIT.ok
      case 'validate':
        return validateCommand(parsed, deps)
      case 'run':
        return runCommand(parsed, deps)
    }
  } catch (cause) {
    if (cause instanceof ScenarioError || cause instanceof RunError) {
      deps.stderr.write(`nousr: ${cause.message}\n`)
      return EXIT.cannotRun
    }
    deps.stderr.write(`nousr: internal error: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}\n`)
    return EXIT.internal
  }
}

const identity = (deps: CliDeps) => deps.identity ?? { nousr: nousrVersion(), nousr_commit: nousrCommit() }

/** A scenario file as read: the parsed JSON, its hash, and the hash of the account file it names by path. */
interface LoadedScenario {
  scenario: Scenario
  content: Record<string, unknown>
  sha256: string
  accountSha256?: string
}

/** Reads and resolves the scenario file. Throws `ScenarioError` for anything the user can fix. */
function loadScenario(path: string, deps: CliDeps): LoadedScenario {
  const file = resolve(deps.cwd, path)
  const bytes = readBytes(file)
  const content = parseJson(bytes, file)
  let accountSha256: string | undefined
  const scenario = parseScenario(content, {
    readAccount: (accountPath) => {
      const accountFile = resolve(dirname(file), accountPath)
      const accountBytes = readBytes(accountFile)
      accountSha256 = sha256(accountBytes)
      return parseJson(accountBytes, accountFile)
    },
  })
  return { scenario, content: content as Record<string, unknown>, sha256: sha256(bytes), ...(accountSha256 !== undefined && { accountSha256 }) }
}

function readBytes(file: string): Buffer {
  try {
    return readFileSync(file)
  } catch (cause) {
    throw new ScenarioError([`cannot read ${file}: ${(cause as Error).message}`])
  }
}

function parseJson(bytes: Buffer, file: string): unknown {
  try {
    // Scanner exports written on Windows often start with a byte-order mark.
    return JSON.parse(bytes.toString('utf8').replace(/^﻿/, ''))
  } catch (cause) {
    throw new ScenarioError([`${file} is not valid JSON: ${(cause as Error).message}`])
  }
}

/** Colour only on a terminal, unless told otherwise (warnings are the only coloured text). */
function useColor(args: { noColor: boolean }, deps: CliDeps): boolean {
  const noColorEnv = deps.env.NO_COLOR !== undefined && deps.env.NO_COLOR !== ''
  return !args.noColor && !noColorEnv && deps.stdout.isTTY === true && deps.stderr.isTTY === true
}

const toRunWarning = (w: NousrResult['warnings'][number]): RunWarning => ({
  severity: w.severity,
  code: w.code as RunWarning['code'],
  message: w.message,
  ...(w.team !== undefined && { team: w.team }),
  ...(w.enemy_count !== undefined && { enemyCount: w.enemy_count }),
  ...(w.member !== undefined && { member: w.member }),
})

function printWarnings(warnings: RunWarning[], color: boolean, deps: CliDeps): void {
  for (const w of warnings) deps.stderr.write(formatWarning(w, { color }) + '\n')
}

const badArguments = (deps: CliDeps, message: string): number => {
  deps.stderr.write(`nousr: ${message}\n`)
  return EXIT.badArguments
}

// ---------------------------------------------------------------- run

function runCommand(args: RunArgs, deps: CliDeps): number {
  const loaded = loadScenario(args.scenario, deps)
  const { scenario } = loaded

  // The filters only take subsets of what the scenario says (S1): no option changes the conditions.
  const teamIds = scenario.teams.map((t) => t.id)
  const unknownTeams = (args.teams ?? []).filter((t) => !teamIds.includes(t))
  if (unknownTeams.length > 0) return badArguments(deps, `--teams: no team ${unknownTeams.map((t) => `"${t}"`).join(', ')} in the scenario (teams: ${teamIds.join(', ')})`)
  const unknownCounts = (args.enemies ?? []).filter((n) => !scenario.enemies.counts.includes(n))
  if (unknownCounts.length > 0) return badArguments(deps, `--enemies: the scenario has no run with ${unknownCounts.join(', ')} enemies (it lists ${scenario.enemies.counts.join(', ')})`)

  const teams = args.teams === undefined ? scenario.teams : scenario.teams.filter((t) => args.teams!.includes(t.id))
  const counts = args.enemies === undefined ? scenario.enemies.counts : scenario.enemies.counts.filter((n) => args.enemies!.includes(n))
  if (args.baseline !== undefined && !teams.some((t) => t.id === args.baseline)) {
    return badArguments(deps, `--baseline: "${args.baseline}" is not one of the teams that run (${teams.map((t) => t.id).join(', ')})`)
  }
  for (const want of args.logRuns) {
    if (!teams.some((t) => t.id === want.team) || !counts.includes(want.enemyCount)) {
      return badArguments(deps, `--log ${want.team}:${want.enemyCount}: no such run (teams: ${teams.map((t) => t.id).join(', ')}; enemy counts: ${counts.join(', ')})`)
    }
  }

  const subset: Scenario = { ...scenario, teams, enemies: { ...scenario.enemies, counts } }
  const runs = runScenario(subset, { ...deps.runOptions, kernel: deps.kernel() })

  const id = identity(deps)
  const full = buildResult({
    runs,
    scenario: subset,
    content: loaded.content,
    scenarioPath: args.scenario,
    scenarioSha256: loaded.sha256,
    ...(loaded.accountSha256 !== undefined && { accountSha256: loaded.accountSha256 }),
    generator: { nousr: id.nousr, nousr_commit: id.nousr_commit, kernel: KERNEL_ID },
    ...(args.baseline !== undefined && { baseline: args.baseline }),
  })
  // The tables and `--log` read the log, so it is always built; `--no-log` only leaves it out of what is written.
  const output = args.log ? full : withoutLog(full)
  assertValidResult(output)

  const toStdout = args.json || args.out === '-'
  if (args.out !== undefined && args.out !== '-') {
    const target = resolve(deps.cwd, args.out)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, json(output))
    deps.stderr.write(`Wrote ${args.out}\n`)
  }
  if (toStdout) deps.stdout.write(json(output))
  else deps.stdout.write(formatReport(full, { cycles: args.cycles, logs: args.logRuns }))

  const warnings = full.warnings.map(toRunWarning)
  printWarnings(warnings, useColor(args, deps), deps)
  return args.strict && warnings.some((w) => w.severity === 'warning') ? EXIT.warnings : EXIT.ok
}

const json = (result: NousrResult): string => JSON.stringify(result, null, 2) + '\n'

function withoutLog(result: NousrResult): NousrResult {
  return { ...result, runs: result.runs.map(({ actions: _actions, ...run }) => run) }
}

// ---------------------------------------------------------------- validate

/** Loads the scenario and plans every team at every enemy count (the kernel's stats, the builds, the kit options) without running a battle. */
function validateCommand(args: ValidateArgs, deps: CliDeps): number {
  const { scenario } = loadScenario(args.scenario, deps)
  const options: RunOptions = { ...deps.runOptions, kernel: deps.kernel() }
  const problems: string[] = []
  const warnings = new Map<string, RunWarning>()
  for (const team of scenario.teams) {
    for (const count of scenario.enemies.counts) {
      try {
        for (const w of planTeam(scenario, team, count, options).warnings) warnings.set(JSON.stringify(w), w)
      } catch (cause) {
        if (!(cause instanceof RunError)) throw cause
        problems.push(...cause.problems)
      }
    }
  }
  if (problems.length > 0) throw new RunError([...new Set(problems)])

  const counts = scenario.enemies.counts.join(', ')
  deps.stdout.write(`${args.scenario}: OK (${scenario.teams.length} team${scenario.teams.length === 1 ? '' : 's'}, enemy counts ${counts}, ${scenario.battle.cycles} cycles)\n`)
  const list = [...warnings.values()]
  printWarnings(list, useColor(args, deps), deps)
  return args.strict && list.some((w) => w.severity === 'warning') ? EXIT.warnings : EXIT.ok
}
