import type { BattleResult, BattleSetup, MemberSetup } from '../battle/battle'
import { Battle } from '../battle/battle'
import { EQUIPMENT, type EquipmentRegistry, resolveEquipment } from '../equipment/index'
import { ENEMY_PROFILE_DIR, type EnemyProfile, loadEnemyProfile } from '../enemy/profile'
import type { KernelBuild, KernelUnit, ScannedRelic, ScenarioKernel } from '../kernel/types'
import { KITS, kitFor, type RegisteredKit } from '../kits/index'
import type { Member, Scenario, Team } from '../scenario/types'

/**
 * Turns a loaded scenario into battles and runs them: one battle per team and enemy count
 * (DESIGN.md, decision 1 and S1).
 *
 * Where each member's numbers come from:
 * - Kernel character id: the game id plus `ability_version`, mapped by the kernel (S2).
 * - Kit: the registry in src/kits/index.ts, by game id.
 * - Out-of-combat stats (max HP, DEF, SPD, Energy Regeneration Rate): the kernel's basic stats for
 *   the member's character, light cone and build. In-combat changes come from kits and modifiers.
 *   The timeline scales SPD% buffs from `baseSpd`; the build's own SPD% is already folded into the
 *   basic SPD, so `spdFlat` is basic SPD minus base SPD. That is the same total either way, since
 *   SPD% only ever scales base SPD.
 * - Kit version (K13): the kernel's id says which ability version the scenario resolved to (no
 *   `ability_version` means the newest the kernel has). The kit must list that version in `abilityVersions`.
 * - Light cone and relic sets: id and superimposition go to the kernel, and each item's equipment module
 *   (src/equipment, K4) is resolved from `options.equipment`. An item with no module stops the run: the
 *   kernel's defaults would count its conditional buffs as always on.
 * - Relics: `"standard"` asks `options.standardBuild` for the build. No rule for turning Fribbels'
 *   benchmark data into one build has been chosen yet, so there is no default. Scanned relics
 *   (`"equipped"` or a list) go to the kernel as they are in the scan file and its importer reads
 *   them (K5). A scan file's SPD is exact only when the scanner writes exact values
 *   (`ScenarioKernel.scanSource`); otherwise the result carries a warning naming each member whose
 *   relics have an SPD substat, since the game shows SPD rounded down and each such substat can hide
 *   just under 1 SPD.
 */

/** Everything needed to pick a member's standard build. */
export interface StandardBuildRequest {
  /** The kernel's character id, after the ability version is applied. */
  characterId: string
  unit: KernelUnit
  member: Member
  team: Team
  scenario: Scenario
}

export type StandardBuildSource = (request: StandardBuildRequest) => KernelBuild

export interface RunOptions {
  kernel: ScenarioKernel
  /** Builds for members on `"standard"` relics. Required while a scenario uses them. */
  standardBuild?: StandardBuildSource
  /** Defaults to the kits in src/kits/index.ts. */
  kits?: ReadonlyMap<string, RegisteredKit>
  /** Light cone and set modules. Defaults to the registry in src/equipment/index.ts. */
  equipment?: EquipmentRegistry
  /** Where enemy profiles are read from. Defaults to data/enemies. */
  profileDir?: string
  /**
   * Overrides the account scan's `source` ('HSR-Scanner', 'reliquary_archiver'), which the loaded
   * scenario carries when it has an account. With neither (relic objects given inline, no account),
   * relics are read as HSR-Scanner's, whose SPD is not verified, and the warning says so.
   */
  scanSource?: string
}

/** What a run says about its own numbers. Each entry is one sentence naming what it is about. */
export type RunWarnings = string[]

/** A team ready to run, with what to tell the user about it. */
export interface TeamPlan {
  setup: BattleSetup
  warnings: RunWarnings
}

export interface TeamRun {
  team: string
  enemyCount: number
  result: BattleResult
  /**
   * The team's setup warnings (the same for every enemy count), then the battle's own
   * (`BattleResult.warnings`) prefixed with the team and enemy count.
   */
  warnings: RunWarnings
}

/** Everything that stops a team from being run, reported together. */
export class RunError extends Error {
  constructor(readonly problems: string[]) {
    super(`Cannot run the scenario:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    this.name = 'RunError'
  }
}

/**
 * Runs every team at every enemy count the scenario asks for, teams in file order. Every team is
 * checked before any battle starts, and all problems are reported together.
 */
export function runScenario(scenario: Scenario, options: RunOptions): TeamRun[] {
  const profile = loadProfile(scenario, options)
  const planned: { team: string, enemyCount: number, plan: TeamPlan }[] = []
  const problems: string[] = []
  for (const team of scenario.teams) {
    for (const enemyCount of scenario.enemies.counts) {
      try {
        planned.push({ team: team.id, enemyCount, plan: buildSetup(scenario, team, enemyCount, profile, options) })
      } catch (cause) {
        if (!(cause instanceof RunError)) throw cause
        problems.push(...cause.problems)
      }
    }
  }
  if (problems.length > 0) throw new RunError([...new Set(problems)])
  return planned.map(({ team, enemyCount, plan }) => {
    const result = runBattle(plan.setup)
    const prefix = `team "${team}", ${enemyCount} enem${enemyCount === 1 ? 'y' : 'ies'}: `
    return { team, enemyCount, result, warnings: [...plan.warnings, ...result.warnings.map((w) => prefix + w)] }
  })
}

/** Runs one team of the scenario against `enemyCount` enemies. `runScenario` also returns the warnings. */
export function runTeam(scenario: Scenario, team: Team | string, enemyCount: number, options: RunOptions): BattleResult {
  return runBattle(buildBattleSetup(scenario, team, enemyCount, options))
}

/** The battle one team of the scenario fights against `enemyCount` enemies, without running it. */
export function buildBattleSetup(
  scenario: Scenario,
  team: Team | string,
  enemyCount: number,
  options: RunOptions,
): BattleSetup {
  return planTeam(scenario, team, enemyCount, options).setup
}

/** Like `buildBattleSetup`, with the warnings for the team. */
export function planTeam(scenario: Scenario, team: Team | string, enemyCount: number, options: RunOptions): TeamPlan {
  return buildSetup(scenario, findTeam(scenario, team), enemyCount, loadProfile(scenario, options), options)
}

function runBattle(setup: BattleSetup): BattleResult {
  return new Battle(setup).run()
}

function findTeam(scenario: Scenario, team: Team | string): Team {
  if (typeof team !== 'string') return team
  const found = scenario.teams.find((t) => t.id === team)
  if (!found) throw new RunError([`no team "${team}" in the scenario (teams: ${scenario.teams.map((t) => t.id).join(', ')})`])
  return found
}

function loadProfile(scenario: Scenario, options: RunOptions): EnemyProfile {
  return loadEnemyProfile(scenario.enemies.profile, options.profileDir ?? ENEMY_PROFILE_DIR)
}

function buildSetup(
  scenario: Scenario,
  team: Team,
  enemyCount: number,
  profile: EnemyProfile,
  options: RunOptions,
): TeamPlan {
  const problems: string[] = []
  const warnings: RunWarnings = []
  if (!Number.isInteger(enemyCount) || enemyCount < 1 || enemyCount > 5) {
    problems.push(`enemy count must be a whole number from 1 to 5, got ${enemyCount}`)
  }
  if (scenario.battle.period !== null) {
    problems.push(
      `battle.period "${scenario.battle.period}": period modules are not built yet (build order step 7). ` +
        'Set period to null to run without one.',
    )
  }

  const members: MemberSetup[] = []
  for (const member of team.members) {
    const setup = memberSetup(scenario, team, member, options, problems, warnings)
    if (setup) members.push(setup)
  }
  if (problems.length > 0) throw new RunError(problems)

  return {
    setup: {
      members,
      policy: team.policy,
      profile,
      enemyCount,
      weaknesses: scenario.enemies.weaknesses,
      cycles: scenario.battle.cycles,
      start: { ...scenario.battle.start },
      kernel: options.kernel,
    },
    warnings,
  }
}

function memberSetup(
  scenario: Scenario,
  team: Team,
  member: Member,
  options: RunOptions,
  problems: string[],
  warnings: RunWarnings,
): MemberSetup | undefined {
  const at = `team "${team.id}", member "${member.key}"`
  const before = problems.length

  const kit = attempt(() => kitFor(member.character, options.kits ?? KITS), at, problems)
  if (kit && kit.characterId !== member.character) {
    problems.push(`${at}: the kit registered for ${member.character} is for character ${kit.characterId}`)
  }
  const characterId = attempt(() => options.kernel.characterId(member.character, member.abilityVersion), at, problems)
  if (kit && characterId !== undefined) {
    const version = abilityVersionOf(characterId)
    const implemented = kit.abilityVersions
    const asked = member.abilityVersion === undefined ? `the newest version the kernel has (${version})` : `ability_version ${version}`
    if (implemented === undefined) {
      problems.push(`${at}: the kit for ${member.character} does not say which ability versions it implements`)
    } else if (!implemented.includes(version)) {
      problems.push(
        `${at}: the scenario asks for ${asked} of character ${member.character}, but its kit implements ` +
          `version${implemented.length === 1 ? '' : 's'} ${implemented.join(', ')} only`,
      )
    }
  }

  if (member.relics === 'standard' && !options.standardBuild) {
    problems.push(
      `${at}: relics "standard" needs a standard build source, and no rule for Fribbels' benchmark build has been chosen yet`,
    )
  }
  if (problems.length > before) return undefined

  const unit: KernelUnit = {
    characterId: characterId!,
    eidolon: member.eidolon,
    ex: member.affinitiveEidolon ? 1 : 0,
    lightConeId: member.lightCone.id,
    superimposition: member.lightCone.superimposition,
  }
  const build = attempt(
    () =>
      member.relics === 'standard'
        ? options.standardBuild!({ characterId: characterId!, unit, member, team, scenario })
        : scannedBuild(member.relics, at, scenario.scanSource, options, warnings),
    at,
    problems,
  )
  if (!build) return undefined
  const equipment = attempt(() => resolveEquipment(unit, build, options.equipment ?? EQUIPMENT), at, problems)
  if (!equipment) return undefined
  const basic = attempt(() => options.kernel.basicStats(unit, build), at, problems)
  if (!basic) return undefined

  return {
    key: member.key,
    kit: kit!,
    eidolon: member.eidolon,
    affinitiveEidolon: member.affinitiveEidolon,
    stats: {
      maxHp: basic.HP,
      def: basic.DEF,
      baseSpd: basic.baseSPD,
      spdFlat: basic.SPD - basic.baseSPD,
      energyRegen: basic.ERR,
    },
    kernel: { unit, build },
    equipment,
  }
}

/** The ability version in a kernel character id: '1006b1' is version 1, '1308' is version 0. */
function abilityVersionOf(kernelId: string): number {
  const buffed = /b(\d+)$/.exec(kernelId)
  return buffed ? Number(buffed[1]) : 0
}

/**
 * The member's scanned relics as a kernel build, and the SPD warning when the scanner's SPD is not
 * verified. Throws when the kernel does not read the scan source.
 */
function scannedBuild(
  relics: ScannedRelic[],
  at: string,
  accountSource: string | undefined,
  options: RunOptions,
  warnings: RunWarnings,
): KernelBuild {
  const given = options.scanSource ?? accountSource
  const source = given ?? UNKNOWN_SOURCE_FALLBACK
  const { speedVerified } = options.kernel.scanSource(source)
  if (!speedVerified) {
    const spdSubstats = relics.reduce((n, r) => n + r.substats.filter((s) => s.key === 'SPD').length, 0)
    if (spdSubstats > 0) {
      const why = given === undefined
        ? `the scan's source was not given, so its relics are read as ${source}'s`
        : `the ${source} scanner writes SPD rounded down, as the game shows it`
      warnings.push(
        `${at}: SPD may be understated by up to just under ${spdSubstats} (${spdSubstats} SPD substat${spdSubstats === 1 ? '' : 's'}, each can hide just under 1): ${why}`,
      )
    }
  }
  return { source, relics }
}

/** Read relics as this scanner's when the caller does not say where they came from: the one whose SPD is not trusted. */
const UNKNOWN_SOURCE_FALLBACK = 'HSR-Scanner'

/** Runs `f`; a thrown error becomes one problem line instead of stopping the whole check. */
function attempt<T>(f: () => T, at: string, problems: string[]): T | undefined {
  try {
    return f()
  } catch (cause) {
    problems.push(`${at}: ${(cause as Error).message}`)
    return undefined
  }
}
