import { DEFAULT_START } from '../scenario/load'
import type { NousrResult, ResultAction, ResultRun } from '../result/types'

/** What the tables show besides the defaults (the totals and the per-member blocks). */
export interface FormatOptions {
  /** `--cycles`: a per-cycle table per enemy count. */
  cycles?: boolean
  /** `--log team:count`: that run's action log, in the order given. */
  logs?: { team: string, enemyCount: number }[]
}

const GAP = '  '

/** `1234567.8` as `1,234,568`. Written out here rather than with `Intl` so the layout cannot change with the machine's locale. */
export const formatInt = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
export const formatRatio = (r: number | null): string => (r === null ? 'n/a' : r.toFixed(3))
export const formatShare = (share: number): string => `${(share * 100).toFixed(1)}%`
const enemies = (n: number): string => `${n} ${n === 1 ? 'enemy' : 'enemies'}`

/**
 * The text the command line prints for a result: header, totals with ratios, one per-member block per team and enemy count,
 * then the optional per-cycle tables and action logs. Plain text, no colour (warnings are printed separately).
 */
export function formatReport(result: NousrResult, options: FormatOptions = {}): string {
  const blocks: string[] = [header(result), totals(result)]
  for (const count of enemyCounts(result)) {
    for (const run of result.runs.filter((r) => r.enemy_count === count)) blocks.push(memberBlock(run))
  }
  if (options.cycles) for (const count of enemyCounts(result)) blocks.push(cycleTable(result, count))
  for (const want of options.logs ?? []) blocks.push(actionLog(result, want.team, want.enemyCount))
  return blocks.join('\n\n') + '\n'
}

/** The enemy counts that ran, ascending. */
export function enemyCounts(result: NousrResult): number[] {
  return [...new Set(result.runs.map((r) => r.enemy_count))].sort((a, b) => a - b)
}

// ---------------------------------------------------------------- header

function header(result: NousrResult): string {
  const g = result.generator
  const content = result.scenario.content as {
    name?: string
    battle?: { cycles?: number, period?: string | null, start?: { energy?: number, skill_points?: number, techniques?: boolean } }
    enemies?: { profile?: string, weaknesses?: 'all' | string[] }
  }
  const first = result.runs[0]!
  const start = content.battle?.start
  const weaknesses = content.enemies?.weaknesses ?? 'all'
  const lines = [
    `NouSR ${g.nousr} · kernel ${g.kernel} · game ${result.game_version}`,
    `Scenario: ${content.name ?? '(unnamed)'}${result.scenario.path !== undefined ? ` (${result.scenario.path})` : ''}`,
    [
      `MoC, ${first.window.cycles} cycles (${first.window.action_value} AV)`,
      `period: ${content.battle?.period ?? 'none'}`,
      content.enemies?.profile ?? 'unknown profile',
      `weakness: ${Array.isArray(weaknesses) ? weaknesses.join(', ') : weaknesses}`,
      `start ${Math.round((start?.energy ?? DEFAULT_START.energy) * 100)}% energy`,
      `${start?.skill_points ?? DEFAULT_START.skillPoints} SP`,
      `techniques ${(start?.techniques ?? DEFAULT_START.techniques) ? 'on' : 'off'}`,
    ].join(', '),
  ]
  return lines.join('\n')
}

// ---------------------------------------------------------------- totals

function totals(result: NousrResult): string {
  const counts = enemyCounts(result)
  const baseline = result.comparison.baseline
  const teamIds = result.teams.map((t) => t.id)
  const ratioOf = (team: string, count: number): number | null | undefined =>
    team === baseline ? 1 : result.comparison.ratios.find((r) => r.team === team && r.enemy_count === count)?.ratio

  const head = ['', ...counts.flatMap(() => ['total', 'ratio'])]
  const body = teamIds.map((team) => [
    team === baseline ? `${team} (baseline)` : team,
    ...counts.flatMap((count) => {
      const run = result.runs.find((r) => r.team === team && r.enemy_count === count)
      if (!run) return ['', '']
      const ratio = ratioOf(team, count)
      return [formatInt(run.total), ratio === undefined ? '' : formatRatio(ratio)]
    }),
  ])
  const align = ['l', ...counts.flatMap(() => ['r', 'r'])] as Align[]
  const widths = columnWidths([head, ...body])
  // The group titles ("1 enemy") sit right-aligned over their total and ratio columns.
  const groups = ['Total damage'.padEnd(widths[0]!)]
  counts.forEach((count, k) => {
    const span = widths[1 + 2 * k]! + GAP.length + widths[2 + 2 * k]!
    groups.push(enemies(count).padStart(span))
  })
  return [groups.join(GAP), ...[head, ...body].map((row) => renderRow(row, widths, align))].join('\n')
}

// ---------------------------------------------------------------- per member

function memberBlock(run: ResultRun): string {
  const title = `${run.team}, ${enemies(run.enemy_count)}`
  const head = [title, 'damage', 'share', 'basic', 'skill', 'ult', 'fup']
  const body = run.by_member.map((m) => [
    `  ${m.member}`,
    formatInt(m.damage),
    formatShare(m.share),
    String(m.actions.basic),
    String(m.actions.skill),
    String(m.actions.ultimate),
    String(m.actions.follow_up),
  ])
  const widths = columnWidths([head, ...body])
  const align: Align[] = ['l', 'r', 'r', 'r', 'r', 'r', 'r']
  const downed = run.downed.length === 0
    ? 'none'
    : run.downed.map((d) => `${d.member} (cycle ${d.cycle}, AV ${d.at.toFixed(1)})`).join(', ')
  return [...[head, ...body].map((row) => renderRow(row, widths, align)), `  downed: ${downed}`].join('\n')
}

// ---------------------------------------------------------------- per cycle

function cycleTable(result: NousrResult, count: number): string {
  const runs = result.runs.filter((r) => r.enemy_count === count)
  const cycles = Math.max(...runs.map((r) => r.per_cycle.length))
  const head = [`Damage per cycle, ${enemies(count)}`, ...Array.from({ length: cycles }, (_, i) => `C${i + 1}`)]
  const body = runs.map((r) => [`  ${r.team}`, ...Array.from({ length: cycles }, (_, i) => formatInt(r.per_cycle[i] ?? 0))])
  const widths = columnWidths([head, ...body])
  const align: Align[] = ['l', ...Array.from({ length: cycles }, () => 'r' as const)]
  return [head, ...body].map((row) => renderRow(row, widths, align)).join('\n')
}

// ---------------------------------------------------------------- action log

function actionLog(result: NousrResult, team: string, count: number): string {
  const run = result.runs.find((r) => r.team === team && r.enemy_count === count)
  const title = `Action log: ${team}, ${enemies(count)}`
  if (!run) return `${title}\n  (no such run)`
  if (!run.actions) return `${title}\n  (this result has no action log)`
  const head = ['#', 'AV', 'cycle', 'actor', 'action', 'kind', 'damage', 'SP']
  const body = run.actions.map((a) => [
    String(a.serial),
    a.at.toFixed(1),
    String(a.cycle),
    actorName(a),
    a.action,
    a.kind,
    formatInt(a.damage),
    `${a.sp_before} -> ${a.sp_after}`,
  ])
  const widths = columnWidths([head, ...body])
  const align: Align[] = ['r', 'r', 'r', 'l', 'l', 'l', 'r', 'l']
  return [title, ...[head, ...body].map((row) => renderRow(row, widths, align))].join('\n')
}

const actorName = (a: ResultAction): string => (a.owner !== undefined ? `${a.actor} (${a.owner})` : a.actor)

// ---------------------------------------------------------------- layout

type Align = 'l' | 'r'

function columnWidths(rows: string[][]): number[] {
  const widths: number[] = []
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, [...cell].length)))
  return widths
}

function renderRow(row: string[], widths: number[], align: Align[]): string {
  return row
    .map((cell, i) => (align[i] === 'r' ? cell.padStart(widths[i]!) : cell.padEnd(widths[i]!)))
    .join(GAP)
    .trimEnd()
}
