import { parseArgs } from 'node:util'

/** Exit codes (results-format.md, "The command line"). */
export const EXIT = {
  ok: 0,
  /** The scenario cannot run (ScenarioError, RunError, an unreadable file). */
  cannotRun: 1,
  badArguments: 2,
  /** `--strict` and a warning-severity warning was raised. */
  warnings: 3,
  /** A bug in NouSR (a result that breaks its own schema, say). Not a user error. */
  internal: 70,
} as const

export interface RunArgs {
  command: 'run'
  scenario: string
  out?: string
  json: boolean
  baseline?: string
  teams?: string[]
  enemies?: number[]
  log: boolean
  logRuns: { team: string, enemyCount: number }[]
  cycles: boolean
  noColor: boolean
  strict: boolean
}

export interface ValidateArgs {
  command: 'validate'
  scenario: string
  noColor: boolean
  strict: boolean
}

export type Parsed =
  | RunArgs
  | ValidateArgs
  | { command: 'version' }
  | { command: 'help' }
  | { command: 'error', message: string }

export const USAGE = `Usage:
  nousr run <scenario.json> [options]   run a scenario and print the tables
  nousr validate <scenario.json>        check a scenario and its kit options without running it
  nousr version                         NouSR version, kernel commit, game version

Options for run:
  -o, --out <file>          write the nousr-result JSON to <file> ("-" for stdout)
      --json                print the JSON to stdout instead of the tables
      --baseline <team>     the team ratios are taken against (default: the first team)
      --teams <a,b,...>     run only these teams
      --enemies <1,3,...>   run only these enemy counts (counts the scenario lists)
      --no-log              leave the action log out of the JSON
      --log <team>:<count>  print one run's action log after the tables (repeatable)
      --cycles              add the per-cycle table
      --no-color            plain text (also when stdout is not a terminal, or NO_COLOR is set)
      --strict              exit with code 3 when any warning-severity warning was raised
Options for validate: --no-color, --strict.
  -h, --help                this text

Exit codes: 0 ran, 1 the scenario cannot run, 2 bad arguments, 3 warnings with --strict.
`

const RUN_OPTIONS = {
  out: { type: 'string', short: 'o' },
  json: { type: 'boolean' },
  baseline: { type: 'string' },
  teams: { type: 'string' },
  enemies: { type: 'string' },
  'no-log': { type: 'boolean' },
  log: { type: 'string', multiple: true },
  cycles: { type: 'boolean' },
  'no-color': { type: 'boolean' },
  strict: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const

const VALIDATE_OPTIONS = {
  'no-color': { type: 'boolean' },
  strict: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const

const error = (message: string): Parsed => ({ command: 'error', message })

/** Reads the command line (without `node` and the script). Never throws: a mistake comes back as `{ command: 'error' }`. */
export function parseCommandLine(argv: readonly string[]): Parsed {
  const [command, ...rest] = argv
  if (command === undefined) return error('no command given')
  if (command === '-h' || command === '--help' || command === 'help') return { command: 'help' }
  if (command === 'version' || command === '--version' || command === '-v') {
    return rest.length === 0 ? { command: 'version' } : error('"version" takes no arguments')
  }
  if (command === 'run') return parseRun(rest)
  if (command === 'validate') return parseValidate(rest)
  return error(`unknown command "${command}"`)
}

function parseRun(args: readonly string[]): Parsed {
  let parsed
  try {
    parsed = parseArgs({ args: [...args], options: RUN_OPTIONS, allowPositionals: true, strict: true })
  } catch (cause) {
    return error((cause as Error).message)
  }
  const { values, positionals } = parsed
  if (values.help) return { command: 'help' }
  if (positionals.length !== 1) return error(positionals.length === 0 ? 'no scenario file given' : `expected one scenario file, got ${positionals.length}`)
  if (values.json && values.out === '-') return error('--json and "-o -" both print the JSON to stdout; use one of them')
  if (values.log !== undefined && (values.json || values.out === '-')) {
    // The tables are not printed when the JSON goes to stdout, so --log would print nothing.
    return error('--log prints a table, and no tables are printed when the JSON goes to stdout')
  }

  const teams = values.teams === undefined ? undefined : splitList(values.teams)
  if (teams !== undefined && teams.length === 0) return error('--teams needs at least one team id')
  let enemies: number[] | undefined
  if (values.enemies !== undefined) {
    const parts = splitList(values.enemies)
    const numbers = parts.map(Number)
    if (parts.length === 0 || numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 5)) {
      return error(`--enemies takes whole numbers from 1 to 5, separated by commas; got "${values.enemies}"`)
    }
    enemies = [...new Set(numbers)]
  }
  const logRuns: RunArgs['logRuns'] = []
  for (const spec of values.log ?? []) {
    const at = spec.lastIndexOf(':')
    const count = Number(spec.slice(at + 1))
    if (at <= 0 || !Number.isInteger(count) || count < 1 || count > 5) return error(`--log takes <team>:<enemy count>, got "${spec}"`)
    logRuns.push({ team: spec.slice(0, at), enemyCount: count })
  }

  return {
    command: 'run',
    scenario: positionals[0]!,
    ...(values.out !== undefined && { out: values.out }),
    json: values.json ?? false,
    ...(values.baseline !== undefined && { baseline: values.baseline }),
    ...(teams !== undefined && { teams }),
    ...(enemies !== undefined && { enemies }),
    log: !(values['no-log'] ?? false),
    logRuns,
    cycles: values.cycles ?? false,
    noColor: values['no-color'] ?? false,
    strict: values.strict ?? false,
  }
}

function parseValidate(args: readonly string[]): Parsed {
  let parsed
  try {
    parsed = parseArgs({ args: [...args], options: VALIDATE_OPTIONS, allowPositionals: true, strict: true })
  } catch (cause) {
    return error((cause as Error).message)
  }
  const { values, positionals } = parsed
  if (values.help) return { command: 'help' }
  if (positionals.length !== 1) return error(positionals.length === 0 ? 'no scenario file given' : `expected one scenario file, got ${positionals.length}`)
  return { command: 'validate', scenario: positionals[0]!, noColor: values['no-color'] ?? false, strict: values.strict ?? false }
}

const splitList = (text: string): string[] => [...new Set(text.split(',').map((s) => s.trim()).filter((s) => s !== ''))]
