import type { Battle, Member } from '../battle/battle'
import type { Path } from '../battle/party'
import type { UnitId } from '../engine/events'
import type { ConditionalValues } from '../kernel/types'
import type { Element } from '../scenario/types'

/**
 * A kit is one character's timing behaviour: what its actions do to skill points, stacks, the turn
 * order and the enemies, and when its passives fire. It never computes damage itself. It declares
 * what each attack hits and with what ATK multiple, and tells the damage kernel what state the
 * character is in.
 */
export interface Kit {
  /** Game character id, e.g. '1308'. */
  characterId: string
  path: Path
  element: Element
  /** 0 for a character with no energy bar. */
  maxEnergy: number
  /** Called once per battle, after every unit is on the field. Subscribe to events here. */
  create(battle: Battle, self: Member): KitInstance
}

export type ActionKind = 'basic' | 'skill' | 'ultimate'

export interface KitAction {
  kind: ActionKind
  /** Whether the action is available right now (enough skill points, Ultimate charged, ...). */
  canUse(): boolean
  /** `target` is an ally's key, for actions aimed at an ally. */
  use(target?: string): void
}

/** What the damage kernel needs to know when this character attacks one particular enemy. */
export interface AttackerState {
  /** Fribbels conditional values for the character, laid over its defaults. */
  characterConditionals?: ConditionalValues
  lightConeConditionals?: ConditionalValues
  /**
   * For each Fribbels ability kind this kit attacks with ('BASIC', 'SKILL', 'ULT', 'FUA', ...): the
   * ATK multiple Fribbels itself uses for that ability under the conditionals above. The runner
   * divides Fribbels' damage by this to get damage per 100% ATK, then multiplies by what each
   * enemy actually takes.
   */
  scaling: Record<string, number>
}

/** What the damage kernel needs to know about this character when a teammate attacks. */
export interface TeammateState {
  characterConditionals?: ConditionalValues
  lightConeConditionals?: ConditionalValues
}

export interface KitInstance {
  /** By the name a policy rule uses: 'basic', 'skill', 'ultimate', or a kit's own. */
  actions: Record<string, KitAction>
  /** Numbers and yes/no values a policy condition can read as `<member key>.<name>`. */
  quantities?: Record<string, () => number | boolean>
  attackerState(enemy: UnitId): AttackerState
  /**
   * Required on purpose: left to Fribbels' defaults, a teammate's buffs would count as always on.
   */
  teammateState(attacker: Member, enemy: UnitId): TeammateState
  /** Effects at the start of battle. `techniques` is the scenario's setting. */
  onBattleStart?(options: { techniques: boolean }): void
}
