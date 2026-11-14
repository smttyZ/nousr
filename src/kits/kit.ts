import type { Battle, Member } from '../battle/battle'
import type { Path } from '../battle/party'
import type { UnitId } from '../engine/events'
import type { ConditionalValues, InjectedBuff } from '../kernel/types'
import type { Element } from '../scenario/types'

/**
 * A kit is one character's timing behaviour: what its actions do to skill points, stacks, the turn
 * order and the enemies, and when its passives fire. It never computes damage itself. It declares
 * what each attack hits, which hit of the kernel's ability each part is and with what multiple, and
 * tells the damage kernel what state the character is in.
 */
export interface Kit {
  /** Game character id, e.g. '1308'. */
  characterId: string
  path: Path
  element: Element
  /**
   * The ability versions this kit is written for (DESIGN.md, K13): 0 is the original kit, n > 0 the buffed
   * ("Nova Flare") version n, the scanner's `ability_version`. A scenario that resolves to any other
   * version stops with an error. Optional in the type only so that test stubs need not name one; a scenario
   * run refuses a kit that does not declare it.
   */
  abilityVersions?: readonly number[]
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

/**
 * What the damage kernel needs to know when this character attacks one particular enemy. Light cone and
 * set conditionals are not here: they come from the equipment modules (DESIGN.md, K4).
 */
export interface AttackerState {
  /** Fribbels conditional values for the character, laid over its defaults. */
  characterConditionals?: ConditionalValues
  /**
   * Buffs this character adds on top of the kernel's own (DESIGN.md, K15a), for example the
   * difference between its level-scaled value and the maximum-level value the kernel applied. A
   * `'self'` or `'team'` target both reach the attacker here.
   */
  injectedBuffs?: InjectedBuff[]
}

/** What the damage kernel needs to know about this character when a teammate attacks. */
export interface TeammateState {
  characterConditionals?: ConditionalValues
  /**
   * Buffs this character adds on top of the kernel's own (DESIGN.md, K15a). Only those targeted at
   * the `'team'` reach the attacker; a `'self'` buff of a teammate is dropped, since it changes only
   * that teammate.
   */
  injectedBuffs?: InjectedBuff[]
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
