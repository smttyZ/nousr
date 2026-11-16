/**
 * The `nousr-result` file (schema/result.schema.json, version 1; docs/proposals/results-format.md). Snake_case keys, as the
 * schema writes them. `validateResult` (validate.ts) checks an object against the schema; these types only help the builder.
 */

export interface ResultStandardBuild {
  member: string
  file: string
  relic_sets?: unknown
  ornament_set?: unknown
  main_stats: Record<string, string>
  distributed: Record<string, number>
  totals: Record<string, number>
  path: 'file' | 're-split' | 'explicit'
  moves?: { from: string, to: string, rolls: number }[]
  swaps?: { slot: string, from: string, to: string }[]
  spd_solved?: { file_rolls: number, used_rolls: number, reachable: boolean, moves: { from: string, to: string, rolls: number }[] }
  spd?: { target: number | 'none', out_of_combat: number, missed_by?: number }
}

export interface ResultMember {
  key: string
  character: string
  ability_version: number
  eidolon: number
  affinitive_eidolon: boolean
  light_cone: { id: string, superimposition: number }
  relics: 'equipped' | 'standard' | 'list'
  technique: boolean
  stats: { spd: number, hp: number, def: number, err: number, effect_res: number }
}

export interface ResultTeam {
  id: string
  name?: string
  members: ResultMember[]
  standard_builds?: ResultStandardBuild[]
  kit_options?: { member: string, options: Record<string, unknown>, defaulted: string[] }[]
}

export type ActionKind = 'basic' | 'skill' | 'ultimate' | 'follow_up'

export interface ResultAction {
  serial: number
  at: number
  cycle: number
  actor: string
  owner?: string
  action: string
  kind: ActionKind
  damage: number
  sp_before: number
  sp_after: number
  expected_enemies_hit: number
  debuffed: Record<string, number>
}

export interface ResultMemberRun {
  member: string
  damage: number
  share: number
  actions: Record<ActionKind, number>
  by_ability: Record<string, number>
}

export interface ResultRun {
  team: string
  enemy_count: number
  window: { cycles: number, action_value: number }
  total: number
  /** Damage that belongs to no logged action (K35). Left out when zero. */
  unattributed?: number
  per_cycle: number[]
  by_member: ResultMemberRun[]
  downed: { member: string, at: number, cycle: number }[]
  objectives: { no_downed: boolean }
  actions?: ResultAction[]
}

export interface ResultWarning {
  severity: 'warning' | 'info'
  code: string
  message: string
  team?: string
  enemy_count?: number
  member?: string
}

export interface ResultComparison {
  baseline: string
  ratios: { team: string, enemy_count: number, ratio: number | null }[]
}

export interface NousrResult {
  format: 'nousr-result'
  version: 1
  game_version: string
  generator: { nousr: string, nousr_commit: string | null, kernel: string }
  scenario: {
    path?: string
    sha256: string
    account_sha256?: string
    content: Record<string, unknown>
  }
  teams: ResultTeam[]
  runs: ResultRun[]
  comparison: ResultComparison
  warnings: ResultWarning[]
}
