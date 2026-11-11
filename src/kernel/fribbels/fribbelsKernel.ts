/**
 * Damage kernel backed by Fribbels' hsr-optimizer (MIT, https://github.com/fribbels/hsr-optimizer),
 * read from the pinned submodule at vendor/hsr-optimizer. No Fribbels logic is copied here: this
 * file builds the same request Fribbels' own stat simulation takes and reads its result.
 *
 * This is the only directory that imports Fribbels. It is type-checked with tsconfig.fribbels.json,
 * which uses Fribbels' compiler options.
 */
import { generateContext } from '../../../vendor/hsr-optimizer/src/lib/optimization/context/calculateContext'
import { StatKey } from '../../../vendor/hsr-optimizer/src/lib/optimization/engine/config/keys'
import { runStatSimulations } from '../../../vendor/hsr-optimizer/src/lib/simulations/statSimulation'
import { type Simulation, StatSimTypes } from '../../../vendor/hsr-optimizer/src/lib/simulations/statSimulationTypes'
import { generateFullDefaultForm } from '../../../vendor/hsr-optimizer/src/lib/simulations/utils/benchmarkForm'
import { getGameMetadata } from '../../../vendor/hsr-optimizer/src/lib/state/gameMetadata'
import { Metadata } from '../../../vendor/hsr-optimizer/src/lib/state/metadataInitializer'
import type { CharacterId } from '../../../vendor/hsr-optimizer/src/types/character'
import type { Form, Teammate } from '../../../vendor/hsr-optimizer/src/types/form'
import type { LightConeId } from '../../../vendor/hsr-optimizer/src/types/lightCone'
import type {
  CombatStats,
  ConditionalValues,
  DamageKernel,
  DamageRequest,
  DamageResult,
  KernelTeammate,
  KernelUnit,
} from '../types'

let metadataReady = false

const TEAMMATE_SLOTS = ['teammate0', 'teammate1', 'teammate2'] as const

export class FribbelsKernel implements DamageKernel {
  constructor() {
    // Loads Fribbels' game data and character/light cone registries. Process-wide, so do it once.
    if (!metadataReady) {
      Metadata.initialize()
      metadataReady = true
    }
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

    const build = request.build
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

    const context = generateContext(form)
    const result = runStatSimulations([simulation], form, context)[0]!

    // result.x is a buffer Fribbels reuses on the next run, so copy the numbers out now.
    const stats: CombatStats = {
      ATK: result.x.a[StatKey.ATK]!,
      DEF: result.x.a[StatKey.DEF]!,
      HP: result.x.a[StatKey.HP]!,
      SPD: result.x.a[StatKey.SPD]!,
      CR: result.x.a[StatKey.CR]!,
      CD: result.x.a[StatKey.CD]!,
      EHR: result.x.a[StatKey.EHR]!,
      RES: result.x.a[StatKey.RES]!,
      BE: result.x.a[StatKey.BE]!,
      ERR: result.x.a[StatKey.ERR]!,
      OHB: result.x.a[StatKey.OHB]!,
    }
    const damage: Record<string, number> = {}
    for (const [ability, value] of Object.entries(result.actionDamage ?? {})) {
      damage[ability] = value ?? 0
    }
    return { damage, stats }
  }
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
