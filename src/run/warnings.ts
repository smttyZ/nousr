/**
 * Run warnings as records (DESIGN.md, K19): a severity, a short stable code, the message, and where it
 * applies. Front ends render them: the command line in red with a warning sign, a web UI as a box.
 */

/** Every code a run can produce. Codes are stable: a front end may key on them. */
export type WarningCode =
  /** A scanner that writes SPD rounded down: a relic's SPD substat can hide just under 1 SPD (K5). */
  | 'spd-may-be-understated'
  /** An undecided "highest HP" tie that priced differently (DESIGN.md, "Known approximations"). */
  | 'undecided-tie'
  /** A standard build ends below its SPD target (K14e, K14f). */
  | 'spd-target-missed'
  /** A kit option's placeholder default decided a choice (K26; e.g. Cyrene's Demiurge order when the scenario gives none). */
  | 'kit-option-default-used'
  /**
   * A member has an ability below its maximum level or a major trace locked (from the scan or the scenario's `levels`) that its
   * kit does not follow yet (K15, K15a), so that part is simulated at full strength. Names the member and what is below.
   */
  | 'levels-not-modelled'
  /** `levels` was "scan" (or the default with an account), but the scan has no level fields for this character: everything at maximum (K15). */
  | 'levels-scan-missing'
  /** A battle reached a choice turn past the end of a kit option's list (K26; e.g. `demiurge_order`). */
  | 'kit-option-list-exhausted'

export interface RunWarning {
  /** `'warning'`: the numbers may be off or a choice is undecided. `'info'`: for the reader only. */
  severity: 'warning' | 'info'
  code: WarningCode
  /** One or more sentences, without where it applies: that is in the fields below. */
  message: string
  /** Team id, when it applies to one team. */
  team?: string
  /** Number of enemies of the run it applies to; absent when it is the same for every enemy count. */
  enemyCount?: number
  /** Member key, when it applies to one member. */
  member?: string
}

export interface FormatWarningOptions {
  /** Wrap a warning in ANSI red (an `'info'` stays plain). Default false. */
  color?: boolean
}

const WARNING_SIGN = '⚠'
const INFO_SIGN = 'ℹ'
const RED = '\u001B[31m'
const RESET = '\u001B[0m'

/**
 * One line for a command line: the sign, where it applies (team, enemy count, member, in that order), the
 * message. With `color`, a `'warning'` is wrapped in ANSI red.
 */
export function formatWarning(warning: RunWarning, options: FormatWarningOptions = {}): string {
  const where: string[] = []
  if (warning.team !== undefined) where.push(`team "${warning.team}"`)
  if (warning.enemyCount !== undefined) where.push(`${warning.enemyCount} enem${warning.enemyCount === 1 ? 'y' : 'ies'}`)
  if (warning.member !== undefined) where.push(`member "${warning.member}"`)
  const sign = warning.severity === 'warning' ? WARNING_SIGN : INFO_SIGN
  const text = `${sign} ${where.length > 0 ? `${where.join(', ')}: ` : ''}${warning.message}`
  return options.color && warning.severity === 'warning' ? `${RED}${text}${RESET}` : text
}
