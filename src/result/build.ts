import type { BattleResult } from '../battle/battle'
import type { TeamRun } from '../run/run'
import type { RunWarning } from '../run/warnings'
import type { Member, Scenario, Team } from '../scenario/types'
import type { StandardBuildReport } from '../standard/types'
import type {
  ActionKind,
  NousrResult,
  ResultAction,
  ResultComparison,
  ResultMember,
  ResultMemberRun,
  ResultRun,
  ResultStandardBuild,
  ResultTeam,
  ResultWarning,
} from './types'

/** Everything the report is made from. */
export interface BuildInput {
  /** What `runScenario` returned (teams in scenario order, counts in scenario order). */
  runs: TeamRun[]
  /** The resolved scenario the runs came from. Only the teams that were run need to be in it. */
  scenario: Scenario
  /** The scenario as given: the parsed file, an account given by path still a path. Embedded as it is. */
  content: Record<string, unknown>
  /** The scenario file as given on the command line, when there was one. */
  scenarioPath?: string
  scenarioSha256: string
  /** Hash of the account file when the scenario names one by path. Its content is never copied in. */
  accountSha256?: string
  generator: NousrResult['generator']
  /** The team the ratios are taken against. Default: the first team that ran. */
  baseline?: string
  /** Put the action log in the file. Default true. */
  log?: boolean
}

/** MoC cycle 1 lasts 150 action value, each later cycle 100 (DESIGN.md, decision 2). */
export const windowActionValue = (cycles: number): number => 150 + 100 * (cycles - 1)

const KINDS: Record<string, ActionKind> = { basic: 'basic', skill: 'skill', ultimate: 'ultimate', followUp: 'follow_up' }

/** Builds the `nousr-result` object from a scenario run (results-format.md). Pure: no clock, no files. */
export function buildResult(input: BuildInput): NousrResult {
  const { runs, scenario } = input
  if (runs.length === 0) throw new Error('buildResult: no runs')
  const ranTeams = new Set(runs.map((r) => r.team))
  const teams = scenario.teams.filter((t) => ranTeams.has(t.id))
  const baseline = input.baseline ?? teams[0]!.id
  if (!ranTeams.has(baseline)) {
    throw new Error(`baseline team "${baseline}" is not one of the teams that ran (${teams.map((t) => t.id).join(', ')})`)
  }
  const withLog = input.log ?? true

  return {
    format: 'nousr-result',
    version: 1,
    game_version: scenario.gameVersion,
    generator: input.generator,
    scenario: {
      ...(input.scenarioPath !== undefined && { path: input.scenarioPath }),
      sha256: input.scenarioSha256,
      ...(input.accountSha256 !== undefined && { account_sha256: input.accountSha256 }),
      content: input.content,
    },
    teams: teams.map((team) => resultTeam(team, runs.find((r) => r.team === team.id)!, input.content)),
    runs: runs.map((run) => resultRun(run, scenario, withLog)),
    comparison: comparison(runs, baseline),
    warnings: warnings(runs),
  }
}

// ---------------------------------------------------------------- teams and their echoes

function resultTeam(team: Team, run: TeamRun, content: Record<string, unknown>): ResultTeam {
  const rawMembers = rawMembersOf(content, team.id)
  return {
    id: team.id,
    ...(team.name !== undefined && { name: team.name }),
    members: team.members.map((m) => resultMember(m, run, rawMembers.get(m.key))),
    ...(run.standardBuilds.length > 0 && {
      standard_builds: run.standardBuilds.map((b) => standardBuild(b.member, b.report)),
    }),
    ...(run.kitOptions.length > 0 && {
      kit_options: run.kitOptions.map((k) => ({ member: k.member, options: { ...k.options }, defaulted: [...k.defaulted] })),
    }),
  }
}

function rawMembersOf(content: Record<string, unknown>, teamId: string): Map<string, { relics?: unknown }> {
  const teams = Array.isArray(content.teams) ? (content.teams as { id?: unknown, members?: unknown }[]) : []
  const team = teams.find((t) => t.id === teamId)
  const members = Array.isArray(team?.members) ? (team.members as { key?: unknown, relics?: unknown }[]) : []
  return new Map(members.filter((m) => typeof m.key === 'string').map((m) => [m.key as string, m]))
}

function resultMember(member: Member, run: TeamRun, raw: { relics?: unknown } | undefined): ResultMember {
  const info = run.members.find((m) => m.member === member.key)
  if (!info) throw new Error(`team "${run.team}" has no run info for member "${member.key}"`)
  const technique = run.techniques.find((t) => t.member === member.key)
  return {
    key: member.key,
    character: member.character,
    ability_version: info.abilityVersion,
    eidolon: member.eidolon,
    affinitive_eidolon: member.affinitiveEidolon,
    light_cone: { id: member.lightCone.id, superimposition: member.lightCone.superimposition },
    relics: relicsKind(member, raw),
    technique: technique?.used ?? member.technique,
    stats: { spd: info.spd, hp: info.hp, def: info.def, err: info.err, effect_res: info.effectRes },
  }
}

/** How the member's relics were chosen: "standard", a listed set, or the account's equipped ones (also the default when an account is given). */
function relicsKind(member: Member, raw: { relics?: unknown } | undefined): 'equipped' | 'standard' | 'list' {
  if (member.relics === 'standard') return 'standard'
  if (Array.isArray(raw?.relics)) return 'list'
  return 'equipped'
}

function standardBuild(member: string, r: StandardBuildReport): ResultStandardBuild {
  return {
    member,
    file: r.file,
    relic_sets: 'fourPiece' in r.relicSets
      ? { four_piece: setRef(r.relicSets.fourPiece) }
      : { two_piece: r.relicSets.twoPiece.map(setRef) },
    ornament_set: setRef(r.ornamentSet),
    main_stats: { ...r.mainStats },
    distributed: { ...r.distributed },
    totals: { ...r.totals },
    path: r.path,
    moves: r.moves.map((m) => ({ from: m.from, to: m.to, rolls: m.rolls })),
    swaps: r.swaps.map((s) => ({ slot: s.slot, from: s.from, to: s.to })),
    ...(r.spdSolved !== undefined && {
      spd_solved: {
        file_rolls: r.spdSolved.fileRolls,
        used_rolls: r.spdSolved.usedRolls,
        reachable: r.spdSolved.reachable,
        moves: r.spdSolved.moves.map((m) => ({ from: m.from, to: m.to, rolls: m.rolls })),
      },
    }),
    ...(r.spd !== undefined && {
      spd: {
        target: r.spd.target,
        out_of_combat: r.spd.outOfCombat,
        ...(r.spd.missedBy !== undefined && { missed_by: r.spd.missedBy }),
      },
    }),
  }
}

const setRef = (s: { setId: string, name: string }) => ({ set_id: s.setId, name: s.name })

// ---------------------------------------------------------------- runs

function resultRun(run: TeamRun, scenario: Scenario, withLog: boolean): ResultRun {
  const r = run.result
  const team = scenario.teams.find((t) => t.id === run.team)!
  return {
    team: run.team,
    enemy_count: run.enemyCount,
    window: { cycles: r.cycles, action_value: windowActionValue(r.cycles) },
    total: r.totalDamage,
    ...(r.unattributedDamage > 1e-9 * Math.max(1, r.totalDamage) && { unattributed: r.unattributedDamage }),
    per_cycle: [...r.damageByCycle],
    by_member: team.members.map((m) => memberRun(m.key, r)),
    downed: r.downedAt.map((d) => ({ member: d.member, at: d.at, cycle: d.cycle })),
    objectives: { no_downed: r.downed.length === 0 },
    ...(withLog && { actions: r.actions.map(resultAction) }),
  }
}

function memberRun(key: string, r: BattleResult): ResultMemberRun {
  const damage = r.damageByMember[key] ?? 0
  const actions: Record<ActionKind, number> = { basic: 0, skill: 0, ultimate: 0, follow_up: 0 }
  // A memosprite's actions count under its owner, as its damage does (K6).
  for (const a of r.actions) if ((a.owner ?? a.actor) === key) actions[KINDS[a.kind]!]++
  return {
    member: key,
    damage,
    share: r.totalDamage > 0 ? damage / r.totalDamage : 0,
    actions,
    by_ability: { ...r.damageByAbility[key] },
  }
}

function resultAction(a: BattleResult['actions'][number]): ResultAction {
  return {
    serial: a.serial,
    at: a.at,
    cycle: a.cycle,
    actor: a.actor,
    ...(a.owner !== undefined && { owner: a.owner }),
    action: a.action,
    kind: KINDS[a.kind]!,
    damage: a.damage,
    sp_before: a.skillPointsBefore,
    sp_after: a.skillPointsAfter,
    expected_enemies_hit: a.expectedEnemiesHit,
    debuffed: { ...a.debuffChance },
  }
}

// ---------------------------------------------------------------- comparison and warnings

function comparison(runs: TeamRun[], baseline: string): ResultComparison {
  const base = new Map(runs.filter((r) => r.team === baseline).map((r) => [r.enemyCount, r.result.totalDamage]))
  return {
    baseline,
    ratios: runs
      .filter((r) => r.team !== baseline)
      .map((r) => {
        const b = base.get(r.enemyCount)
        return { team: r.team, enemy_count: r.enemyCount, ratio: b === undefined || b === 0 ? null : r.result.totalDamage / b }
      }),
  }
}

/** Every warning once: a team's setup warning repeats for each enemy count in `TeamRun.warnings` and is written once here (K19). */
function warnings(runs: TeamRun[]): ResultWarning[] {
  const seen = new Set<string>()
  const out: ResultWarning[] = []
  for (const run of runs) {
    for (const w of run.warnings) {
      const converted = resultWarning(w)
      const key = JSON.stringify(converted)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(converted)
    }
  }
  return out
}

function resultWarning(w: RunWarning): ResultWarning {
  return {
    severity: w.severity,
    code: w.code,
    message: w.message,
    ...(w.team !== undefined && { team: w.team }),
    ...(w.enemyCount !== undefined && { enemy_count: w.enemyCount }),
    ...(w.member !== undefined && { member: w.member }),
  }
}
