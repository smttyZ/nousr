/**
 * Damage kernel backed by Fribbels' hsr-optimizer (MIT, https://github.com/fribbels/hsr-optimizer),
 * read from the pinned submodule at vendor/hsr-optimizer. No Fribbels logic is copied here: this
 * file builds the same request Fribbels' own stat simulation takes and reads its result.
 *
 * This is the only directory that imports Fribbels. It is type-checked with tsconfig.fribbels.json,
 * which uses Fribbels' compiler options.
 */
import { BasicKey } from '../../../vendor/hsr-optimizer/src/lib/optimization/basicStatsArray'
import { DamageFunctionType } from '../../../vendor/hsr-optimizer/src/lib/optimization/engine/damage/damageCalculator'
import { OutputTag } from '../../../vendor/hsr-optimizer/src/lib/optimization/engine/config/tag'
import { generateContext } from '../../../vendor/hsr-optimizer/src/lib/optimization/context/calculateContext'
import { StatKey } from '../../../vendor/hsr-optimizer/src/lib/optimization/engine/config/keys'
import { resetConditionalState } from '../../../vendor/hsr-optimizer/src/lib/optimization/conditionalStateUtils'
import { simulateBuild } from '../../../vendor/hsr-optimizer/src/lib/simulations/simulateBuild'
import { runStatSimulations } from '../../../vendor/hsr-optimizer/src/lib/simulations/statSimulation'
import { type Simulation, StatSimTypes } from '../../../vendor/hsr-optimizer/src/lib/simulations/statSimulationTypes'
import { generateFullDefaultForm } from '../../../vendor/hsr-optimizer/src/lib/simulations/utils/benchmarkForm'
import { getGameMetadata } from '../../../vendor/hsr-optimizer/src/lib/state/gameMetadata'
import { Metadata } from '../../../vendor/hsr-optimizer/src/lib/state/metadataInitializer'
import type { CharacterId } from '../../../vendor/hsr-optimizer/src/types/character'
import type { Hit } from '../../../vendor/hsr-optimizer/src/types/hitConditionalTypes'
import type { Form, Teammate } from '../../../vendor/hsr-optimizer/src/types/form'
import type { LightConeId } from '../../../vendor/hsr-optimizer/src/types/lightCone'
import type {
  BasicStats,
  CombatStats,
  ConditionalValues,
  DamageRequest,
  DamageResult,
  HitResult,
  KernelBuild,
  BenchmarkBuild,
  KernelTeammate,
  KernelUnit,
  ScenarioKernel,
} from '../types'
import { isScannedBuild } from '../types'
import { scannedRelicsByPart, scanSourceInfo } from './scannedRelics'

let metadataReady = false

const TEAMMATE_SLOTS = ['teammate0', 'teammate1', 'teammate2'] as const

export class FribbelsKernel implements ScenarioKernel {
  constructor() {
    // Loads Fribbels' game data and character/light cone registries. Process-wide, so do it once.
    if (!metadataReady) {
      Metadata.initialize()
      metadataReady = true
    }
  }

  /**
   * Fribbels keeps a buffed (Nova Flare) character as a separate id, `${gameId}b${version}`, beside
   * the original (its HSR-Scanner importer reads ids the same way:
   * vendor/hsr-optimizer/src/lib/importer/kelzFormatParser.tsx).
   */
  characterId(gameId: string, abilityVersion: number | undefined): string {
    if (!/^[0-9]{4}$/.test(gameId)) throw new Error(`"${gameId}" is not a game character id (4 digits)`)
    const known = getGameMetadata().characters as Record<string, unknown>
    const buffed = Object.keys(known)
      .map((id) => new RegExp(`^${gameId}b([0-9]+)$`).exec(id))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b)
    const versions = [...(gameId in known ? [0] : []), ...buffed]
    if (versions.length === 0) throw new Error(`Fribbels has no character with game id ${gameId}`)

    const version = abilityVersion ?? versions[versions.length - 1]!
    if (!versions.includes(version)) {
      throw new Error(
        `Fribbels has no ability_version ${version} of character ${gameId}` +
          `${version > 0 ? ` (no id "${gameId}b${version}")` : ''}. Versions it has: ${versions.join(', ')}`,
      )
    }
    return version === 0 ? gameId : `${gameId}b${version}`
  }

  /**
   * Fribbels' basic stats: the array its simulation fills before any action is evaluated
   * (vendor/hsr-optimizer/src/lib/simulations/simulateBuild.ts, calculateBasicSetEffects,
   * calculateRelicStats, calculateBaseStats). Teammates and conditionals do not reach it.
   */
  basicStats(unit: KernelUnit, build: KernelBuild): BasicStats {
    const form = unitForm(unit, false)
    const { x, context } = simulate(form, build)
    // x.c is a buffer Fribbels reuses on the next run, so copy the numbers out now.
    const c = x.c.a
    return {
      ATK: c[BasicKey.ATK]!,
      DEF: c[BasicKey.DEF]!,
      HP: c[BasicKey.HP]!,
      SPD: c[BasicKey.SPD]!,
      CR: c[BasicKey.CR]!,
      CD: c[BasicKey.CD]!,
      EHR: c[BasicKey.EHR]!,
      RES: c[BasicKey.RES]!,
      BE: c[BasicKey.BE]!,
      ERR: c[BasicKey.ERR]!,
      OHB: c[BasicKey.OHB]!,
      baseSPD: context.baseSPD,
    }
  }

  scanSource(source: string): { speedVerified: boolean } {
    return scanSourceInfo(source)
  }

  actionDamage(request: DamageRequest): DamageResult {
    if (request.teammates.length > TEAMMATE_SLOTS.length) {
      throw new Error(`A team has at most 3 teammates, got ${request.teammates.length}`)
    }

    const form = unitForm(request.attacker, false)
    request.teammates.forEach((teammate, i) => {
      form[TEAMMATE_SLOTS[i]!] = teammateForm(teammate)
    })

    for (const [set, value] of Object.entries(request.setConditionals ?? {})) {
      const sets = form.setConditionals as Record<string, [undefined, number | boolean]>
      if (!(set in sets)) throw new Error(`Unknown set "${set}" in setConditionals`)
      sets[set] = [undefined, value]
    }

    const enemy = request.enemy ?? {}
    if (enemy.level !== undefined) form.enemyLevel = enemy.level
    if (enemy.count !== undefined) form.enemyCount = enemy.count
    if (enemy.resistance !== undefined) form.enemyResistance = enemy.resistance
    if (enemy.effectResistance !== undefined) form.enemyEffectResistance = enemy.effectResistance
    if (enemy.maxToughness !== undefined) form.enemyMaxToughness = enemy.maxToughness
    if (enemy.elementalWeak !== undefined) form.enemyElementalWeak = enemy.elementalWeak
    if (enemy.weaknessBroken !== undefined) form.enemyWeaknessBroken = enemy.weaknessBroken

    const { x, actionDamage, context } = simulate(form, request.build)

    // x is a buffer Fribbels reuses on the next run, so copy the numbers out now.
    const stats: CombatStats = {
      ATK: x.a[StatKey.ATK]!,
      DEF: x.a[StatKey.DEF]!,
      HP: x.a[StatKey.HP]!,
      SPD: x.a[StatKey.SPD]!,
      CR: x.a[StatKey.CR]!,
      CD: x.a[StatKey.CD]!,
      EHR: x.a[StatKey.EHR]!,
      RES: x.a[StatKey.RES]!,
      BE: x.a[StatKey.BE]!,
      ERR: x.a[StatKey.ERR]!,
      OHB: x.a[StatKey.OHB]!,
    }
    const damage: Record<string, number> = {}
    for (const [ability, value] of Object.entries(actionDamage ?? {})) {
      damage[ability] = value ?? 0
    }

    // Every hit of every default action. Fribbels evaluates each hit on its own and stores the number
    // in a register (simulateBuild.ts: x.setHitRegisterValue); read them here. Two default actions of
    // one kind (none today) would be joined in declaration order, as Fribbels sums their damage.
    const hits: Record<string, HitResult[]> = {}
    for (const action of context.defaultActions) {
      const list = (hits[action.actionType] ??= [])
      for (const hit of action.hits ?? []) {
        const scaling = hitScaling(hit)
        list.push({ damage: x.getHitRegisterValue(hit.registerIndex), ...(scaling !== undefined && { scaling }) })
      }
    }
    return { damage, hits, stats }
  }
}

/**
 * The multiple of ATK, HP and DEF Fribbels multiplies this hit by (damageCalculator.ts,
 * calculateInitialDamage), with the tick coefficient Additional DMG hits carry. Only the Crit and
 * Additional damage functions are priced this way. A hit that adds a Break Effect or Elation term to
 * its ATK multiple, or that is not damage, has no plain multiple: undefined.
 */
function hitScaling(hit: Hit): number | undefined {
  if (hit.outputTag !== OutputTag.DAMAGE) return undefined
  let tick = 1
  if (hit.damageFunctionType === DamageFunctionType.Crit) {
    if (hit.beScaling != null || hit.elationAtkScaling != null) return undefined
  } else if (hit.damageFunctionType === DamageFunctionType.Additional) {
    tick = hit.tickCoefficient ?? 1
  } else {
    return undefined
  }
  return ((hit.atkScaling ?? 0) + (hit.hpScaling ?? 0) + (hit.defScaling ?? 0)) * tick
}

/**
 * One run of Fribbels' simulation. A benchmark build goes through its stat simulation, the same call
 * its own tests make. Scanned relics go through `simulateBuild` directly with the relics the importer
 * read, the call its character preview and optimizer make for a character's real relics. Both end in
 * the same function, so the two paths differ only in where the relic stats come from.
 */
function simulate(form: Form, build: KernelBuild) {
  const context = generateContext(form)
  if (isScannedBuild(build)) {
    for (const action of context.allActions) resetConditionalState(action)
    const { x, actionDamage } = simulateBuild(scannedRelicsByPart(build), context, null)
    return { x, actionDamage, context }
  }
  return { ...simulateBenchmark(form, build, context), context }
}

function simulateBenchmark(form: Form, build: BenchmarkBuild, context: ReturnType<typeof generateContext>) {
  const simulation = {
    simType: StatSimTypes.SubstatRolls,
    request: {
      simRelicSet1: build.relicSet1,
      simRelicSet2: build.relicSet2,
      simOrnamentSet: build.ornamentSet,
      simBody: build.body,
      simFeet: build.feet,
      simPlanarSphere: build.planarSphere,
      simLinkRope: build.linkRope,
      stats: build.substatRolls,
    },
  } as Simulation

  const result = runStatSimulations([simulation], form, context)[0]!
  return { x: result.x, actionDamage: result.actionDamage }
}

function unitForm(unit: KernelUnit, asTeammate: boolean): Form {
  const metadata = getGameMetadata()
  if (!(unit.characterId in metadata.characters)) throw new Error(`Unknown character id "${unit.characterId}"`)
  if (!(unit.lightConeId in metadata.lightCones)) throw new Error(`Unknown light cone id "${unit.lightConeId}"`)

  const form = generateFullDefaultForm(
    unit.characterId as CharacterId,
    unit.lightConeId as LightConeId,
    unit.eidolon,
    unit.superimposition,
    asTeammate,
    unit.ex ?? 0,
  )
  const role = asTeammate ? 'teammate' : 'attacker'
  overlay(form.characterConditionals, unit.characterConditionals, `character ${unit.characterId} as ${role}`)
  overlay(form.lightConeConditionals, unit.lightConeConditionals, `light cone ${unit.lightConeId} as ${role}`)
  return form
}

function teammateForm(teammate: KernelTeammate): Teammate {
  // Fribbels' own tests pass a full default form in the teammate slot; do the same.
  const form = unitForm(teammate, true) as Form & Teammate
  if (teammate.teamRelicSet !== undefined) form.teamRelicSet = teammate.teamRelicSet
  if (teammate.teamOrnamentSet !== undefined) form.teamOrnamentSet = teammate.teamOrnamentSet
  return form
}

/** Fribbels ignores a conditional it does not know, which would hide a typo as wrong damage. */
function overlay(defaults: ConditionalValues, overrides: ConditionalValues | undefined, owner: string): void {
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (!(key in defaults)) {
      throw new Error(`Unknown conditional "${key}" for ${owner}. Known: ${Object.keys(defaults).join(', ') || '(none)'}`)
    }
    defaults[key] = value
  }
}
