/**
 * Standard builds (DESIGN.md K14 to K14f): one file per character in data/standard-builds, format
 * schema/standard-build.schema.json. Stat names are Fribbels' own strings, the same ones `BenchmarkBuild` uses.
 */
import type { BenchmarkBuild } from '../kernel/types'

/** The 12 substat types. Every standard build has the same fixed rolls on each. */
export const SUBSTATS = [
  'ATK%', 'ATK', 'HP%', 'HP', 'DEF%', 'DEF',
  'SPD', 'CRIT Rate', 'CRIT DMG', 'Effect Hit Rate', 'Effect RES', 'Break Effect',
] as const
export type Substat = (typeof SUBSTATS)[number]

/** The four slots whose main stat a build chooses. Head is always HP and Hands always ATK. */
export const FREE_SLOTS = ['Body', 'Feet', 'Planar Sphere', 'Link Rope'] as const
export type FreeSlot = (typeof FREE_SLOTS)[number]

export type MainStats = Record<FreeSlot, string>

/** K14: 2 fixed rolls on each of the 12 substat types. */
export const FIXED_ROLLS_PER_STAT = 2
/** K14: the rolls a file splits over the substat types. */
export const DISTRIBUTED_ROLLS = 24
/** K14d: every roll at its average value, which is the 5-star mid value (Fribbels' quality 0.9). */
export const AVERAGE_ROLL_QUALITY = 0.9
/** K14d: the average SPD roll, the mid of 2.0, 2.3 and 2.6. */
export const AVERAGE_SPD_ROLL = 2.3

export interface SetRef {
  setId: string
  /** Fribbels' spelling, as the kernel and the equipment registry know it. */
  name: string
}

/** A standard-build file that passed the schema and every rule that does not need the kernel. */
export interface StandardBuild {
  /** The file's path, for messages. */
  source: string
  character: string
  abilityVersion: number
  name?: string
  /** One set worn on four slots, or two different sets of two. */
  relicSets: { fourPiece: SetRef } | { twoPiece: [SetRef, SetRef] }
  ornamentSet: SetRef
  mainStats: MainStats
  /** Out-of-combat SPD the build is made to reach, or `'none'`. */
  spdTarget: { value: number | 'none', reason: string }
  /** All 12 types, 0 where the file leaves one out. */
  distributed: Record<Substat, number>
  /** Most wanted first. Never SPD. */
  priority: Exclude<Substat, 'SPD'>[]
}

/**
 * The out-of-combat SPD the kernel reports for a build (the character's base SPD, traces, the main stat and rolls,
 * the always-on SPD% of the sets; see rule (f) of schema/standard-build.schema.json). The resolver calls it
 * with the same build and different SPD roll counts to find how many rolls reach the target.
 */
export type SpdProbe = (build: BenchmarkBuild) => number

/** What a resolved build says about how it came to be, for the run result. */
export interface StandardBuildReport {
  /** The file the build came from. */
  file: string
  character: string
  abilityVersion: number
  relicSets: StandardBuild['relicSets']
  ornamentSet: SetRef
  /** All six slots. */
  mainStats: Record<'Head' | 'Hands' | FreeSlot, string>
  /** Distributed rolls per type (all 12), as actually used. */
  distributed: Record<Substat, number>
  /** Fixed plus distributed rolls per type (all 12): what the kernel gets. */
  totals: Record<Substat, number>
  /**
   * How the split came about: `file` (the file's, apart from the SPD rolls solved at load, see `spdSolved`),
   * `re-split` (a main-stat swap moved rolls by the published rule, K14c) or `explicit` (the scenario gave a
   * whole split, taken as given).
   */
  path: 'file' | 're-split' | 'explicit'
  /** The re-split's moves, in the order made. Empty unless `path` is `re-split`. */
  moves: { from: Substat, to: Substat, rolls: number }[]
  /** The same moves as sentences, e.g. "2 CRIT DMG -> CRIT Rate". */
  moveText: string[]
  /**
   * K32: set when the loader solved the SPD rolls (a numeric `spd_target`, an SPD probe, no explicit split).
   * `fileRolls` is the file's count, `usedRolls` what the build runs with: the fewest that reach the target, or,
   * when `reachable` is false, the file's count held to the SPD cap (the run then carries `spd-target-missed`).
   * `moves` are the rolls that went to or came from SPD along `distributed.priority`.
   */
  spdSolved?: { fileRolls: number, usedRolls: number, reachable: boolean, moves: { from: Substat, to: Substat, rolls: number }[], moveText: string[] }
  /** Main stats the scenario changed: slot, the file's value and the new one. */
  swaps: { slot: FreeSlot, from: string, to: string }[]
  /** Only when the resolver was given an SPD probe. `missedBy` is set only when the target is a number and was not reached. */
  spd?: { target: number | 'none', outOfCombat: number, missedBy?: number }
}

export interface ResolvedStandardBuild {
  /** What the kernel takes: sets, main stats, roll counts, and K14d's average roll values. */
  build: BenchmarkBuild
  report: StandardBuildReport
}

/** Everything wrong with a standard build, reported together. Each line names the file and the rule. */
export class StandardBuildError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid standard build:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    this.name = 'StandardBuildError'
  }
}
