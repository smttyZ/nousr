import type { Battle, Member } from '../battle/battle'
import type { UnitId } from '../engine/events'
import type { ConditionalValues, KernelBuild, KernelUnit } from '../kernel/types'
import { isScannedBuild } from '../kernel/types'

/**
 * Light cones and relic sets as equipment modules (DESIGN.md, K4). They sit in src/equipment/ and
 * not in src/kits/ because a module belongs to an item, not to a character: any wearer can have it, and
 * a kit never has to know which one its character holds.
 *
 * A module has the hook style of a kit. `create(battle, wearer)` runs once per battle, after the field
 * exists, and subscribes to events and registers modifiers (a debuff on the enemy, a team SPD buff, an
 * action advance). It returns an instance that supplies the live Fribbels conditional values the
 * item's effect needs:
 *
 * - as the attacker: when the wearer attacks, `lightConeConditionals` (laid over Fribbels' defaults
 *   for the wearer's light cone, whose keys are the light cone's own `content`/`defaults`) and
 *   `setConditionals` (by Fribbels set name, in `DamageRequest.setConditionals`);
 * - as a teammate: when someone else attacks, `lightConeConditionals` (the light cone's
 *   `teammateContent`/`teammateDefaults` keys) and the team flags `teamRelicSet` / `teamOrnamentSet`,
 *   which Fribbels reads only for a fixed list of sets.
 *
 * Effects Fribbels has no clock for (a team SPD set, an action advance) act on the timeline directly:
 * the module registers modifiers or advances units from `create`, like a kit, and supplies no
 * conditionals.
 *
 * Nothing in here silently stands in for a missing module. See `resolveEquipment`.
 */

export interface AttackerEquipmentState {
  lightConeConditionals?: ConditionalValues
  /** By Fribbels set name. The value is that set's conditional (a switch, a count or a menu index). */
  setConditionals?: ConditionalValues
}

export interface TeammateEquipmentState {
  lightConeConditionals?: ConditionalValues
  /** Fribbels set name of a 4-piece relic effect this wearer is giving the team right now. */
  teamRelicSet?: string
  /** Fribbels set name of a 2-piece ornament effect this wearer is giving the team right now. */
  teamOrnamentSet?: string
}

export interface EquipmentInstance {
  /** What the damage kernel needs when the wearer attacks `enemy`. Read at every pricing. */
  attackerState?(enemy: UnitId): AttackerEquipmentState
  /** What the damage kernel needs about the wearer when `attacker`, a teammate, attacks `enemy`. */
  teammateState?(attacker: Member, enemy: UnitId): TeammateEquipmentState
}

export interface LightConeModule {
  kind: 'lightCone'
  /** Game id as scans write it, e.g. '23024'. Also Fribbels' id. */
  id: string
  name: string
  /** The wearer's superimposition is `wearer.kernel.unit.superimposition`. */
  create(battle: Battle, wearer: Member): EquipmentInstance
}

export type SetPieces = 2 | 4

export interface SetModule {
  kind: 'set'
  /** Whether the set is a relic set (2 and 4 piece) or an ornament set (2 piece). */
  type: 'relic' | 'ornament'
  /** Fribbels' name for the set, which is also what a benchmark build and `setConditionals` use. */
  name: string
  /** The game's set id as scans write it in `set_id`, e.g. '117'. Needed to recognise a scanned relic. */
  setId?: string
  /** `pieces` is how many pieces the wearer has on: 2 or 4. */
  create(battle: Battle, wearer: Member, pieces: SetPieces): EquipmentInstance
}

/** The equipment a member wears, with a module for each item that has an effect. */
export interface MemberEquipment {
  lightCone: LightConeModule
  sets: { module: SetModule, pieces: SetPieces }[]
}

// ---------------------------------------------------------------- items with no behaviour

/**
 * A light cone with no effect the timeline or the conditionals need to track: its stats are always on
 * and Fribbels adds them itself. Declaring one is a claim that the text was read and has nothing
 * conditional, so `reason` is required and says why.
 */
export function lightConeWithoutBehaviour(spec: { id: string, name: string, reason: string }): LightConeModule {
  if (!spec.reason.trim()) throw new Error(`Light cone ${spec.id} (${spec.name}): a module with no behaviour needs a reason`)
  return { kind: 'lightCone', id: spec.id, name: spec.name, create: () => ({}) }
}

/** The same for a set: always-on stats, or a conditional that Fribbels itself derives (the reason names which). */
export function setWithoutBehaviour(spec: { type: 'relic' | 'ornament', name: string, setId?: string, reason: string }): SetModule {
  if (!spec.reason.trim()) throw new Error(`Set ${spec.name}: a module with no behaviour needs a reason`)
  return { kind: 'set', type: spec.type, name: spec.name, ...(spec.setId !== undefined && { setId: spec.setId }), create: () => ({}) }
}

// ---------------------------------------------------------------- registry

export interface EquipmentRegistry {
  lightCones: ReadonlyMap<string, LightConeModule>
  /** By Fribbels set name. */
  setsByName: ReadonlyMap<string, SetModule>
  /** By the game's set id. Only sets that declare one. */
  setsById: ReadonlyMap<string, SetModule>
}

export function createRegistry(modules: readonly (LightConeModule | SetModule)[]): EquipmentRegistry {
  const lightCones = new Map<string, LightConeModule>()
  const setsByName = new Map<string, SetModule>()
  const setsById = new Map<string, SetModule>()
  for (const module of modules) {
    if (module.kind === 'lightCone') {
      if (lightCones.has(module.id)) throw new Error(`Light cone ${module.id} is registered twice`)
      lightCones.set(module.id, module)
    } else {
      if (setsByName.has(module.name)) throw new Error(`Set "${module.name}" is registered twice`)
      setsByName.set(module.name, module)
      if (module.setId !== undefined) {
        if (setsById.has(module.setId)) throw new Error(`Set id ${module.setId} is registered twice`)
        setsById.set(module.setId, module)
      }
    }
  }
  return { lightCones, setsByName, setsById }
}

/**
 * The modules for a member's light cone and active sets, or an error listing every item that has none.
 *
 * Why an error and not a fallback: Fribbels' defaults switch conditional effects ON (Along the Passing
 * Shore's debuff, Pioneer Diver's debuff count), so a light cone or set with no module would count its
 * conditional buffs as always on. The honest options are to say so or to refuse; this refuses. An item
 * whose text has nothing conditional is registered with `lightConeWithoutBehaviour` /
 * `setWithoutBehaviour`, which makes that a recorded claim.
 *
 * Sets count when 2 or more pieces are worn (4 pieces for a 4-piece effect). A single piece of a set
 * does nothing and needs no module.
 */
export function resolveEquipment(unit: KernelUnit, build: KernelBuild, registry: EquipmentRegistry): MemberEquipment {
  const problems: string[] = []
  const lightCone = registry.lightCones.get(unit.lightConeId)
  if (!lightCone) {
    problems.push(`light cone ${unit.lightConeId} has no equipment module (modules exist for: ${describe(registry.lightCones.values())})`)
  }

  const sets: MemberEquipment['sets'] = []
  const piecesBySet = new Map<string, { label: string, count: number, module: SetModule | undefined }>()
  const tally = (key: string, label: string, module: SetModule | undefined, n: number) => {
    const entry = piecesBySet.get(key) ?? { label, count: 0, module }
    entry.count += n
    piecesBySet.set(key, entry)
  }
  if (isScannedBuild(build)) {
    for (const relic of build.relics) tally(`id:${relic.set_id}`, `set_id ${relic.set_id}`, registry.setsById.get(relic.set_id), 1)
  } else {
    // A benchmark build has either one relic set in 4 pieces (set 1 = set 2) or two in 2 pieces, and an ornament set in 2.
    const four = build.relicSet1 === build.relicSet2
    for (const [name, n] of [[build.relicSet1, four ? 4 : 2], ...(four ? [] : [[build.relicSet2, 2] as const]), [build.ornamentSet, 2]] as const) {
      tally(`name:${name}`, `set "${name}"`, registry.setsByName.get(name), n)
    }
  }
  for (const { label, count, module } of piecesBySet.values()) {
    if (count < 2) continue
    if (!module) {
      problems.push(`${label} (${count} pieces) has no equipment module (modules exist for: ${describe(registry.setsByName.values())})`)
      continue
    }
    sets.push({ module, pieces: count >= 4 ? 4 : 2 })
  }

  if (problems.length > 0) throw new EquipmentError(problems)
  return { lightCone: lightCone!, sets }
}

export class EquipmentError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `${problems.join('; ')}. Without a module the kernel's defaults would count the item's conditional effects as always on; ` +
        'write a module, or register the item with lightConeWithoutBehaviour / setWithoutBehaviour if its text has nothing conditional',
    )
    this.name = 'EquipmentError'
  }
}

function describe(modules: Iterable<{ name: string }>): string {
  const names = [...modules].map((m) => m.name)
  return names.length === 0 ? '(none)' : names.join(', ')
}

// ---------------------------------------------------------------- what the battle does with them

/** Creates every module a member wears. Called by the battle once the field exists. */
export function createEquipment(battle: Battle, wearer: Member): EquipmentInstance[] {
  const equipment = wearer.equipment
  if (!equipment) return []
  return [equipment.lightCone.create(battle, wearer), ...equipment.sets.map((s) => s.module.create(battle, wearer, s.pieces))]
}

/** Several modules' conditionals in one record. The same key from two modules is a bug, not a merge. */
export function mergeConditionals(
  parts: readonly (ConditionalValues | undefined)[],
  owner: string,
): ConditionalValues | undefined {
  let merged: ConditionalValues | undefined
  for (const part of parts) {
    if (!part) continue
    merged ??= {}
    for (const [key, value] of Object.entries(part)) {
      if (key in merged) throw new Error(`${owner}: two equipment modules both set "${key}"`)
      merged[key] = value
    }
  }
  return merged
}

export function attackerEquipmentState(instances: readonly EquipmentInstance[], enemy: UnitId, owner: string): AttackerEquipmentState {
  const states = instances.map((i) => i.attackerState?.(enemy) ?? {})
  const lightConeConditionals = mergeConditionals(states.map((s) => s.lightConeConditionals), `${owner} light cone`)
  const setConditionals = mergeConditionals(states.map((s) => s.setConditionals), `${owner} sets`)
  return { ...(lightConeConditionals && { lightConeConditionals }), ...(setConditionals && { setConditionals }) }
}

export function teammateEquipmentState(
  instances: readonly EquipmentInstance[],
  attacker: Member,
  enemy: UnitId,
  owner: string,
): TeammateEquipmentState {
  const states = instances.map((i) => i.teammateState?.(attacker, enemy) ?? {})
  const lightConeConditionals = mergeConditionals(states.map((s) => s.lightConeConditionals), `${owner} light cone`)
  const one = (pick: (s: TeammateEquipmentState) => string | undefined, what: string) => {
    const values = states.map(pick).filter((v): v is string => v !== undefined)
    if (new Set(values).size > 1) throw new Error(`${owner}: two equipment modules give different ${what}: ${values.join(', ')}`)
    return values[0]
  }
  const teamRelicSet = one((s) => s.teamRelicSet, 'teamRelicSet')
  const teamOrnamentSet = one((s) => s.teamOrnamentSet, 'teamOrnamentSet')
  return {
    ...(lightConeConditionals && { lightConeConditionals }),
    ...(teamRelicSet !== undefined && { teamRelicSet }),
    ...(teamOrnamentSet !== undefined && { teamOrnamentSet }),
  }
}
