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
import type { ActionModifier } from '../../../vendor/hsr-optimizer/src/lib/optimization/context/calculateActions'
import { HitDefinitionBuilder } from '../../../vendor/hsr-optimizer/src/lib/conditionals/hitDefinitionBuilder'
import { characterOptionMapping } from '../../../vendor/hsr-optimizer/src/lib/conditionals/resolver/characterConditionalsResolver'
import { AToHKey, StatKey } from '../../../vendor/hsr-optimizer/src/lib/optimization/engine/config/keys'
import { Source } from '../../../vendor/hsr-optimizer/src/lib/optimization/buffSource'
import { DamageTag, ElementTag, TargetTag } from '../../../vendor/hsr-optimizer/src/lib/optimization/engine/config/tag'
import { AbilityKind } from '../../../vendor/hsr-optimizer/src/lib/optimization/rotation/turnAbilityConfig'
import { resetConditionalState } from '../../../vendor/hsr-optimizer/src/lib/optimization/conditionalStateUtils'
import { simulateBuild } from '../../../vendor/hsr-optimizer/src/lib/simulations/simulateBuild'
import { runStatSimulations } from '../../../vendor/hsr-optimizer/src/lib/simulations/statSimulation'
import { type Simulation, StatSimTypes } from '../../../vendor/hsr-optimizer/src/lib/simulations/statSimulationTypes'
import { generateFullDefaultForm } from '../../../vendor/hsr-optimizer/src/lib/simulations/utils/benchmarkForm'
import { getGameMetadata } from '../../../vendor/hsr-optimizer/src/lib/state/gameMetadata'
import { Metadata } from '../../../vendor/hsr-optimizer/src/lib/state/metadataInitializer'
import type { CharacterId } from '../../../vendor/hsr-optimizer/src/types/character'
import type { HealTallyHit, Hit } from '../../../vendor/hsr-optimizer/src/types/hitConditionalTypes'
import type { Form, Teammate } from '../../../vendor/hsr-optimizer/src/types/form'
import type { LightConeId } from '../../../vendor/hsr-optimizer/src/types/lightCone'
import type {
  BasicStats,
  CombatStats,
  ConditionalValues,
  DamageRequest,
  DamageResult,
  ExtraHit,
  HitResult,
  InjectedBuff,
  InjectedDamageType,
  InjectedStat,
  KernelBuild,
  BenchmarkBuild,
  KernelTeammate,
  KernelUnit,
  ScenarioKernel,
} from '../types'
import { EXTRA_ABILITY, isScannedBuild } from '../types'
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

    const { x, actionDamage, context, extra } = simulate(form, request.build, request.injectedBuffs, request.extraHits, request.attacker.characterId)

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
      // Weakness Break Efficiency as a fraction, which the runner multiplies an attack's toughness damage by (K7).
      breakEfficiency: x.a[StatKey.BREAK_EFFICIENCY_BOOST]!,
    }
    const damage: Record<string, number> = {}
    for (const [ability, value] of Object.entries(actionDamage ?? {})) {
      damage[ability] = value ?? 0
    }
    const extraHitObjects = new Set<Hit>(extra.hits)

    // Every hit of every default action. Fribbels evaluates each hit on its own and stores the number
    // in a register (simulateBuild.ts: x.setHitRegisterValue); read them here. Two default actions of
    // one kind (none today) would be joined in declaration order, as Fribbels sums their damage.
    const hits: Record<string, HitResult[]> = {}
    for (const action of context.defaultActions) {
      const list = (hits[action.actionType] ??= [])
      for (const hit of action.hits ?? []) {
        // An extra hit rides on a host action of Fribbels' (see `extraHitModifier`) and is reported as ability EXTRA below.
        if (extraHitObjects.has(hit)) continue
        const scaling = hitScaling(hit)
        const output = hitOutput(hit)
        list.push({ damage: x.getHitRegisterValue(hit.registerIndex), ...(output !== undefined && { output }), ...(scaling !== undefined && { scaling }) })
      }
    }
    if (extra.hits.length > 0) {
      hits[EXTRA_ABILITY] = extra.hits.map((hit) => {
        const scaling = hitScaling(hit)
        return { damage: x.getHitRegisterValue(hit.registerIndex), ...(scaling !== undefined && { scaling }) }
      })
      damage[EXTRA_ABILITY] = hits[EXTRA_ABILITY].reduce((sum, hit) => sum + hit.damage, 0)
    }
    return { damage, hits, stats }
  }
}

/**
 * What a hit produces when it is not damage: Fribbels' `OutputTag` of the hit, as `HitResult.output`. A heal hit's register
 * holds the healed amount (`HealDamageFunction`, damageCalculator.ts:597-620: base heal x (1 + Outgoing Healing Boost) x
 * (1 + heal boost)), which is what `Battle.healAmount` reads.
 */
function hitOutput(hit: Hit): HitResult['output'] {
  switch (hit.outputTag) {
    case OutputTag.HEAL:
      return 'HEAL'
    case OutputTag.SHIELD:
      return 'SHIELD'
    case OutputTag.BUFF:
      return 'BUFF'
    default:
      return undefined
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
  } else if (hit.damageFunctionType === DamageFunctionType.HealTally) {
    // Damage = a referenced heal hit's value x healTallyScaling x the damage multipliers (Fribbels'
    // HealTallyDamageFunction, damageCalculator.ts ~725-745). Its multiple is healTallyScaling, so damage per
    // unit is the referenced heal value with this hit's multipliers (Hyacine's Little Ica, Rainclouds).
    return (hit as HealTallyHit).healTallyScaling
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
function simulate(
  form: Form,
  build: KernelBuild,
  injectedBuffs?: readonly InjectedBuff[],
  extraHits?: readonly ExtraHit[],
  characterId?: string,
) {
  const extra: ExtraHitSlot = { hits: [] }
  const context = extraHits !== undefined && extraHits.length > 0
    ? withExtraHits(characterId!, extraHits, extra, () => generateContext(form))
    : generateContext(form)
  injectBuffs(context, injectedBuffs ?? [])
  if (isScannedBuild(build)) {
    for (const action of context.allActions) resetConditionalState(action)
    const { x, actionDamage } = simulateBuild(scannedRelicsByPart(build), context, null)
    return { x, actionDamage, context, extra }
  }
  return { ...simulateBenchmark(form, build, context), context, extra }
}

/** The extra hits as Fribbels hit objects, in the request's order, once `generateContext` has built them. */
interface ExtraHitSlot {
  hits: Hit[]
}

const EXTRA_HIT_ELEMENTS: Record<string, ElementTag> = {
  Physical: ElementTag.Physical,
  Fire: ElementTag.Fire,
  Ice: ElementTag.Ice,
  Lightning: ElementTag.Lightning,
  Wind: ElementTag.Wind,
  Quantum: ElementTag.Quantum,
  Imaginary: ElementTag.Imaginary,
}

/**
 * Adds the request's extra hits (K23) to the attacker's actions, through the extension point Fribbels' own light cones use for
 * the same thing (Hidden Shadow pushes a `HitDefinitionBuilder.standardAdditional()` hit onto an action: an `actionModifiers`
 * entry). `generateContext` builds the action list, the hit registers and the stat containers in one pass, and collects the
 * character's modifiers inside it, so a hit cannot be appended afterwards; instead the attacker's controller factory is wrapped
 * for the duration of that one synchronous call and restored in `finally`.
 *
 * Each extra hit is a standard Additional DMG hit (`standardAdditional()`), so it is priced with the attacker's own ATK/HP/DEF,
 * CRIT, element and buffs, including the hit-level buffs aimed at Additional DMG. It is put on the default action of ability
 * kind BREAK (the last default action when there is none): of Fribbels' actions that is the one least likely to carry buffs
 * the damage should not get (its action-level buffs are Break's). The hit is `recorded(false)`, so the host action's own
 * total in `damage` does not change, and the adapter takes it out of the host's hit list and reports it as ability EXTRA.
 */
function withExtraHits<T>(characterId: string, extraHits: readonly ExtraHit[], slot: ExtraHitSlot, run: () => T): T {
  const ids = new Set<string>()
  for (const hit of extraHits) {
    const name = `Extra hit "${hit.id}"`
    if (ids.has(hit.id)) throw new Error(`${name}: the id is used twice in one request`)
    ids.add(hit.id)
    if (hit.damageType !== 'ADDITIONAL') throw new Error(`${name}: damage type must be 'ADDITIONAL', got ${String(hit.damageType)}`)
    if (hit.scalingStat !== 'ATK' && hit.scalingStat !== 'HP' && hit.scalingStat !== 'DEF') {
      throw new Error(`${name}: scaling stat must be 'ATK', 'HP' or 'DEF', got ${String(hit.scalingStat)}`)
    }
    if (typeof hit.multiple !== 'number' || !Number.isFinite(hit.multiple) || hit.multiple <= 0) {
      throw new Error(`${name}: multiple must be a positive number, got ${String(hit.multiple)}`)
    }
    if (hit.element !== undefined && !Object.hasOwn(EXTRA_HIT_ELEMENTS, hit.element)) {
      throw new Error(`${name}: unknown element "${String(hit.element)}". Known: ${Object.keys(EXTRA_HIT_ELEMENTS).join(', ')}`)
    }
  }

  const original = characterOptionMapping[characterId as CharacterId]
  if (original === undefined) throw new Error(`Unknown character id "${characterId}"`)
  const modifier = (): ActionModifier => ({
    modify: (action, context, self) => {
      // The attacker's own actions only (a teammate of the same character gets none), and only the default ones.
      if (self.isTeammate || !action.actionIdentifier.startsWith('Default')) return
      const declared = context.actionDeclarations as string[]
      const breakIndex = declared.indexOf(AbilityKind.BREAK)
      const hostIndex = breakIndex >= 0 ? breakIndex : declared.length - 1
      if (action.actionIndex !== hostIndex) return
      const element = ElementTag[context.element as keyof typeof ElementTag]
      for (const extraHit of extraHits) {
        const builder = HitDefinitionBuilder.standardAdditional()
          .damageElement(extraHit.element !== undefined ? EXTRA_HIT_ELEMENTS[extraHit.element]! : element)
          .recorded(false)
        if (extraHit.scalingStat === 'ATK') builder.atkScaling(extraHit.multiple)
        else if (extraHit.scalingStat === 'HP') builder.hpScaling(extraHit.multiple)
        else builder.defScaling(extraHit.multiple)
        const hit = builder.build() as Hit
        action.hits!.push(hit)
        slot.hits.push(hit)
      }
    },
  })
  characterOptionMapping[characterId as CharacterId] = (eidolon, withContent, ex) => {
    const controller = original(eidolon, withContent, ex)
    const base = controller.actionModifiers
    return { ...controller, actionModifiers: () => [...base(), modifier()] }
  }
  try {
    const result = run()
    if (slot.hits.length !== extraHits.length) {
      throw new Error(`Extra hits were not added to the attacker's default actions (added ${slot.hits.length} of ${extraHits.length})`)
    }
    return result
  } finally {
    characterOptionMapping[characterId as CharacterId] = original
  }
}

/**
 * NouSR stat to Fribbels' stat key (config/statsConfig.ts, `newStatsConfig`; keys.ts: `StatKey`).
 * Percent stats of ATK, HP, DEF and SPD are separate keys from the flat ones.
 */
const INJECTED_STAT_KEYS: Record<InjectedStat, number> = {
  DMG_PERCENT: StatKey.BOOST,
  CRIT_RATE: StatKey.CR,
  CRIT_DMG: StatKey.CD,
  RES_PEN: StatKey.RES_PEN,
  DEF_PEN: StatKey.DEF_PEN,
  VULNERABILITY: StatKey.VULNERABILITY,
  TRUE_DMG: StatKey.TRUE_DMG_MODIFIER,
  FINAL_DMG: StatKey.FINAL_DMG_BOOST,
  BREAK_EFFECT: StatKey.BE,
  EFFECT_HIT_RATE: StatKey.EHR,
  ATK_PERCENT: StatKey.ATK_P,
  HP_PERCENT: StatKey.HP_P,
  DEF_PERCENT: StatKey.DEF_P,
  SPD_PERCENT: StatKey.SPD_P,
  ATK: StatKey.ATK,
  HP: StatKey.HP,
  DEF: StatKey.DEF,
  SPD: StatKey.SPD,
  UNCONVERTIBLE_ATK: StatKey.UNCONVERTIBLE_ATK_BUFF,
  UNCONVERTIBLE_HP: StatKey.UNCONVERTIBLE_HP_BUFF,
  UNCONVERTIBLE_DEF: StatKey.UNCONVERTIBLE_DEF_BUFF,
  UNCONVERTIBLE_SPD: StatKey.UNCONVERTIBLE_SPD_BUFF,
  UNCONVERTIBLE_CRIT_RATE: StatKey.UNCONVERTIBLE_CR_BUFF,
  UNCONVERTIBLE_CRIT_DMG: StatKey.UNCONVERTIBLE_CD_BUFF,
  UNCONVERTIBLE_BREAK_EFFECT: StatKey.UNCONVERTIBLE_BE_BUFF,
  UNCONVERTIBLE_EFFECT_HIT_RATE: StatKey.UNCONVERTIBLE_EHR_BUFF,
}

/** NouSR damage type to Fribbels' `DamageTag` (config/tag.ts). */
const INJECTED_DAMAGE_TAGS: Record<InjectedDamageType, DamageTag> = {
  BASIC: DamageTag.BASIC,
  SKILL: DamageTag.SKILL,
  ULT: DamageTag.ULT,
  FUA: DamageTag.FUA,
  DOT: DamageTag.DOT,
  BREAK: DamageTag.BREAK,
  SUPER_BREAK: DamageTag.SUPER_BREAK,
  MEMO: DamageTag.MEMO,
  ADDITIONAL: DamageTag.ADDITIONAL,
  ELATION: DamageTag.ELATION,
  ASSIST: DamageTag.ASSIST,
}

/**
 * Adds the request's injected buffs to every action's precomputed stats, after `generateContext` and
 * before the simulation reads them (`simulateBuild` copies `action.precomputedStats` in with
 * `setPrecompute`, simulateBuild.ts:160 and :221, on both the benchmark and the scanned-relic path).
 * This is the same call Fribbels' own characters make: `x.buff(stat, value, x.targets(..).source(..))`.
 *
 * A stat Fribbels keeps only per action (the percent stats, the UNCONVERTIBLE_* companions) cannot
 * take a damage type filter: `internalBuff` throws for it (computedStatsContainer.ts:511-519), so that
 * is checked here and named. An ability kind filter works on every stat (computedStatsContainer.ts:490).
 */
function injectBuffs(context: ReturnType<typeof generateContext>, buffs: readonly InjectedBuff[]): void {
  const abilityKinds = new Set<string>(Object.values(AbilityKind))
  const resolved = buffs.map((buff) => {
    const name = describeBuff(buff)
    const key = Object.hasOwn(INJECTED_STAT_KEYS, buff.stat) ? INJECTED_STAT_KEYS[buff.stat] : undefined
    if (key === undefined) {
      throw new Error(`Injected buff ${name}: unknown stat "${String(buff.stat)}". Known: ${Object.keys(INJECTED_STAT_KEYS).join(', ')}`)
    }
    if (typeof buff.value !== 'number' || !Number.isFinite(buff.value)) {
      throw new Error(`Injected buff ${name}: value must be a finite number, got ${String(buff.value)}`)
    }
    if (buff.target !== 'self' && buff.target !== 'team') {
      throw new Error(`Injected buff ${name}: target must be 'self' or 'team', got ${String(buff.target)}`)
    }
    if (buff.abilityKind !== undefined && !abilityKinds.has(buff.abilityKind)) {
      throw new Error(`Injected buff ${name}: unknown ability kind "${buff.abilityKind}". Known: ${[...abilityKinds].join(', ')}`)
    }
    let damageTag: DamageTag | undefined
    if (buff.damageType !== undefined) {
      damageTag = Object.hasOwn(INJECTED_DAMAGE_TAGS, buff.damageType) ? INJECTED_DAMAGE_TAGS[buff.damageType] : undefined
      if (damageTag === undefined) {
        throw new Error(`Injected buff ${name}: unknown damage type "${String(buff.damageType)}". Known: ${Object.keys(INJECTED_DAMAGE_TAGS).join(', ')}`)
      }
      if (AToHKey[key as keyof typeof AToHKey] === undefined) {
        throw new Error(
          `Injected buff ${name}: Fribbels keeps ${buff.stat} per action, not per hit, so it cannot be limited to a damage type. ` +
            'Limit it by abilityKind instead, or drop the filter.',
        )
      }
    }
    return { buff, key, damageTag }
  })

  for (const { buff, key, damageTag } of resolved) {
    if (buff.value === 0) continue
    const target = buff.target === 'team' ? TargetTag.FullTeam : TargetTag.SelfAndPet
    for (const action of context.allActions) {
      const x = action.precomputedStats
      // The builder is one shared object that `x.targets` resets, so each filter is chained fresh.
      let config = x.targets(target) as any
      if (buff.abilityKind !== undefined) config = config.actionKind(buff.abilityKind)
      if (damageTag !== undefined) config = config.damageType(damageTag)
      x.buff(key as any, buff.value, config.source(Source.NONE))
    }
  }
}

function describeBuff(buff: InjectedBuff): string {
  const { label, ...rest } = buff
  return `${label !== undefined ? `"${label}" ` : ''}${JSON.stringify(rest)}`
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

  // K14d: roll values go in only when the build sets them; Fribbels' own defaults (1, 2.6) stay otherwise.
  // (Spreading an undefined would overwrite its default.)
  const params = {
    ...(build.rollQuality !== undefined && { quality: build.rollQuality }),
    ...(build.speedRollValue !== undefined && { speedRollValue: build.speedRollValue }),
  }
  const result = runStatSimulations([simulation], form, context, params)[0]!
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
