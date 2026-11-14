import type { BenchmarkBuild } from '../kernel/types'
import type { StandardBuildOverride } from '../scenario/types'
import schema from '../../schema/standard-build.schema.json' with { type: 'json' }
import { capFor, physicalLimit } from './rules'
import {
  AVERAGE_ROLL_QUALITY,
  AVERAGE_SPD_ROLL,
  DISTRIBUTED_ROLLS,
  FIXED_ROLLS_PER_STAT,
  FREE_SLOTS,
  type FreeSlot,
  type MainStats,
  type ResolvedStandardBuild,
  type SpdProbe,
  type StandardBuild,
  type StandardBuildReport,
  StandardBuildError,
  type Substat,
  SUBSTATS,
} from './types'

/** How close to the SPD target counts as reaching it (floating-point noise only). */
const SPD_EPSILON = 1e-6

export interface ResolveOptions {
  /** The scenario member's `standard_build`: new main stats, a whole split, or both (K14c). */
  override?: StandardBuildOverride
  /**
   * Reads the out-of-combat SPD of a build from the kernel. Without it the SPD target cannot be computed:
   * SPD may then pass its KQMS cap up to the physical limit, and the report has no `spd`.
   */
  spd?: SpdProbe
}

/**
 * Turns a character's standard build, with the scenario's override if any, into what the kernel takes
 * and a report of what was used. The order is the one in docs/proposals/scenario-standard-build-override.md:
 * the file's sets, main stats and split; the main-stat swaps; an explicit split, or else the published re-split;
 * then the checks (24 rolls, every cap, the SPD rule) with an error naming the file and the rule. Nothing is
 * fixed silently, and the SPD rolls are never moved (K14f).
 */
export function resolveStandardBuild(build: StandardBuild, options: ResolveOptions = {}): ResolvedStandardBuild {
  const { override } = options
  const problems: string[] = []
  const fail = (rule: string, text: string) => problems.push(`${build.source}: ${rule}: ${text}`)

  // Main stats: the file's, with the scenario's swaps on top.
  const mainStats: MainStats = { ...build.mainStats }
  const swaps: StandardBuildReport['swaps'] = []
  for (const [slot, stat] of Object.entries(override?.mainStats ?? {})) {
    if (!(FREE_SLOTS as readonly string[]).includes(slot)) {
      fail('standard_build.main_stats', `"${slot}" is not a slot whose main stat can change (${FREE_SLOTS.join(', ')}; Head and Hands are fixed)`)
      continue
    }
    const allowed = allowedMainStats(slot as FreeSlot)
    if (!allowed.includes(stat)) {
      fail('standard_build.main_stats', `${slot} cannot have the main stat "${stat}" (allowed: ${allowed.join(', ')})`)
      continue
    }
    if (mainStats[slot as FreeSlot] !== stat) {
      swaps.push({ slot: slot as FreeSlot, from: mainStats[slot as FreeSlot], to: stat })
      mainStats[slot as FreeSlot] = stat
    }
  }
  if (problems.length > 0) throw new StandardBuildError(problems)

  // The split: whole from the scenario, or the file's, re-split when the new main stats need it.
  let rolls: Record<Substat, number>
  let path: StandardBuildReport['path'] = 'file'
  let moves: StandardBuildReport['moves'] = []
  if (override?.distributed !== undefined) {
    rolls = explicitSplit(override.distributed, build.source, problems)
    path = 'explicit'
  } else {
    rolls = { ...build.distributed }
    if (swaps.length > 0) {
      moves = resplit(rolls, build, mainStats, problems)
      if (moves.length > 0) path = 're-split'
    }
  }
  if (problems.length > 0) throw new StandardBuildError(problems)

  // The checks. (a) and (b) are rules of every standard build; (f) is the SPD rule.
  const where = path === 'explicit' ? 'standard_build.distributed' : path === 're-split' ? 'the re-split' : 'distributed'
  const total = SUBSTATS.reduce((n, s) => n + rolls[s], 0)
  if (total !== DISTRIBUTED_ROLLS) {
    fail('rule (a) 24 distributed rolls', `${where} adds up to ${total}, not ${DISTRIBUTED_ROLLS}`)
  }
  for (const stat of SUBSTATS) {
    if (stat === 'SPD') continue
    const cap = capFor(stat, mainStats)
    if (rolls[stat] > cap) {
      fail('rule (b) per-stat cap', `${where} gives ${stat} ${rolls[stat]} rolls, over its cap of ${cap} with the main stats ${describeMains(mainStats)}`)
    }
  }
  const forKernel = (spdRolls: number): BenchmarkBuild => benchmarkBuild(build, mainStats, { ...rolls, SPD: spdRolls })
  checkSpd(build, mainStats, rolls.SPD, where, options.spd, forKernel, fail)
  if (problems.length > 0) throw new StandardBuildError(problems)

  const benchmark = forKernel(rolls.SPD)
  const totals = Object.fromEntries(SUBSTATS.map((s) => [s, rolls[s] + FIXED_ROLLS_PER_STAT])) as Record<Substat, number>
  const report: StandardBuildReport = {
    file: build.source,
    character: build.character,
    abilityVersion: build.abilityVersion,
    relicSets: build.relicSets,
    ornamentSet: build.ornamentSet,
    mainStats: { Head: 'HP', Hands: 'ATK', ...mainStats },
    distributed: rolls,
    totals,
    path,
    moves,
    moveText: moves.map((m) => `${m.rolls} ${m.from} -> ${m.to}`),
    swaps,
  }
  if (options.spd) {
    const outOfCombat = options.spd(benchmark)
    const target = build.spdTarget.value
    const missedBy = target !== 'none' && target - outOfCombat > SPD_EPSILON ? target - outOfCombat : undefined
    report.spd = { target, outOfCombat, ...(missedBy !== undefined && { missedBy }) }
  }
  return { build: benchmark, report }
}

/** The build as Fribbels' stat simulation takes it, with K14d's average roll values. */
export function benchmarkBuild(build: StandardBuild, mainStats: MainStats, distributed: Record<Substat, number>): BenchmarkBuild {
  const [relicSet1, relicSet2] = 'fourPiece' in build.relicSets
    ? [build.relicSets.fourPiece.name, build.relicSets.fourPiece.name]
    : [build.relicSets.twoPiece[0].name, build.relicSets.twoPiece[1].name]
  return {
    relicSet1,
    relicSet2,
    ornamentSet: build.ornamentSet.name,
    body: mainStats.Body,
    feet: mainStats.Feet,
    planarSphere: mainStats['Planar Sphere'],
    linkRope: mainStats['Link Rope'],
    substatRolls: Object.fromEntries(SUBSTATS.map((s) => [s, distributed[s] + FIXED_ROLLS_PER_STAT])),
    rollQuality: AVERAGE_ROLL_QUALITY,
    speedRollValue: AVERAGE_SPD_ROLL,
  }
}

/** Main stats a slot can have, from the standard-build schema. */
function allowedMainStats(slot: FreeSlot): string[] {
  return (schema.properties.main_stats.properties[slot] as { enum: string[] }).enum
}

function describeMains(mains: MainStats): string {
  return FREE_SLOTS.map((slot) => `${slot} ${mains[slot]}`).join(', ')
}

function explicitSplit(given: Record<string, number>, source: string, problems: string[]): Record<Substat, number> {
  const rolls = Object.fromEntries(SUBSTATS.map((s) => [s, 0])) as Record<Substat, number>
  for (const [stat, count] of Object.entries(given)) {
    if (!(SUBSTATS as readonly string[]).includes(stat)) {
      problems.push(`${source}: standard_build.distributed: "${stat}" is not a substat type (${SUBSTATS.join(', ')})`)
    } else if (!Number.isInteger(count) || count < 0) {
      problems.push(`${source}: standard_build.distributed: ${stat} must be a whole number of rolls, 0 or more, got ${count}`)
    } else {
      rolls[stat as Substat] = count
    }
  }
  return rolls
}

/**
 * The published re-split rule (DESIGN.md K14c). Going once down the file's priority list, a stat whose rolls
 * exceed its cap under the new main stats gives the excess to the first stat lower in the list that has room
 * (cap minus rolls), filling each in turn. A stat not in the list never receives rolls and SPD is not touched.
 * Rolls left over after the last stat are an error naming the stat. Changes `rolls` in place and returns the moves.
 */
function resplit(
  rolls: Record<Substat, number>,
  build: StandardBuild,
  mainStats: MainStats,
  problems: string[],
): StandardBuildReport['moves'] {
  const moves: StandardBuildReport['moves'] = []
  build.priority.forEach((stat, i) => {
    let excess = rolls[stat] - capFor(stat, mainStats)
    if (excess <= 0) return
    for (const lower of build.priority.slice(i + 1)) {
      const room = capFor(lower, mainStats) - rolls[lower]
      if (room <= 0) continue
      const moved = Math.min(excess, room)
      rolls[stat] -= moved
      rolls[lower] += moved
      excess -= moved
      moves.push({ from: stat, to: lower, rolls: moved })
      if (excess === 0) break
    }
    if (excess > 0) {
      problems.push(
        `${build.source}: the re-split cannot place ${excess} of ${stat}'s ${rolls[stat]} distributed rolls: with the main stats ` +
          `${describeMains(mainStats)} its cap is ${capFor(stat, mainStats)}, and every stat after it in distributed.priority ` +
          `(${build.priority.slice(i + 1).join(', ') || 'none'}) is full. Give the split yourself in standard_build.distributed`,
      )
    }
  })
  return moves
}

/**
 * Rule (f) with the SPD target (K14e): SPD rolls may pass the KQMS cap only as far as the fewest rolls that reach
 * `spd_target`, and never past the physical limit.
 */
function checkSpd(
  build: StandardBuild,
  mainStats: MainStats,
  spdRolls: number,
  where: string,
  probe: SpdProbe | undefined,
  forKernel: (spdRolls: number) => BenchmarkBuild,
  fail: (rule: string, text: string) => void,
): void {
  const limit = physicalLimit('SPD', mainStats) - FIXED_ROLLS_PER_STAT
  if (spdRolls > limit) {
    fail('rule (f) SPD physical limit', `${where} gives SPD ${spdRolls} distributed rolls, over the most six relics can hold (${limit} plus the ${FIXED_ROLLS_PER_STAT} fixed, ${limit + FIXED_ROLLS_PER_STAT} in all)`)
    return
  }
  const cap = capFor('SPD', mainStats)
  if (spdRolls <= cap || !probe) return
  const target = build.spdTarget.value
  const needed = target === 'none' ? 0 : fewestSpdRolls(target, probe, forKernel, limit)
  if (needed === undefined || spdRolls > needed) {
    fail(
      'rule (f) SPD cap',
      `${where} gives SPD ${spdRolls} distributed rolls, over the cap of ${cap}; SPD may pass the cap only as far as ` +
        (target === 'none'
          ? 'the build needs for an SPD target, and this file has none'
          : needed === undefined
            ? `reaching spd_target ${target}, which these main stats cannot reach at all`
            : `reaching spd_target ${target}, which takes ${needed} with these main stats`),
    )
  }
}

/** The fewest distributed SPD rolls that bring the build's out-of-combat SPD to `target`, or undefined if even `limit` falls short. */
function fewestSpdRolls(target: number, probe: SpdProbe, forKernel: (spdRolls: number) => BenchmarkBuild, limit: number): number | undefined {
  const at = (k: number) => probe(forKernel(k))
  const reaches = (k: number) => at(k) >= target - SPD_EPSILON
  if (reaches(0)) return 0
  if (!reaches(limit)) return undefined
  // SPD grows by the same amount per roll, so a binary search finds the first roll count that reaches it.
  let lo = 0
  let hi = limit
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (reaches(mid)) hi = mid
    else lo = mid
  }
  return hi
}
