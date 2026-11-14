import type { Modifier } from './modifiers'

export type UnitId = string

/** One turn of one unit. The same object is passed to turnStart, the turn handler and turnEnd. */
export interface TurnInfo {
  unit: UnitId
  /** Counts every turn taken by anyone in the battle, from 1. */
  serial: number
  /** Counts this unit's own turns, from 1. */
  index: number
  /** Elapsed action value when the turn happens. */
  at: number
  /** Cycle the turn falls in. The first cycle is 1. */
  cycle: number
}

/**
 * Every event the simulator can emit, with its payload.
 * Steps 5 and 6 add the kit-facing events from DESIGN.md here (attack, Ultimate, follow-up,
 * debuff applied, SP spent, HP lost, energy gained).
 */
export interface EngineEvents {
  battleStart: { at: number }
  cycleStart: { cycle: number, startsAt: number, endsAt: number }
  cycleEnd: { cycle: number, at: number }
  /** The unit's gauge is still 0 here; it refills right after this event, before the unit acts. */
  turnStart: TurnInfo
  turnEnd: TurnInfo
  unitAdded: { unit: UnitId, at: number }
  unitRemoved: { unit: UnitId, at: number }
  gaugeChanged: { unit: UnitId, before: number, after: number, cause: 'advance' | 'delay' }
  modifierApplied: { modifier: Modifier, previous: Modifier | undefined }
  modifierRemoved: { modifier: Modifier, reason: 'expired' | 'removed' | 'unitRemoved' }

  // ---- HP, shields, energy (src/battle/party.ts). Amounts are expected values and can be fractional.
  /**
   * HP actually lost, after shields. `cause` is 'damage' for a hit and 'consume' for HP a unit
   * spends itself. `source` is who caused it.
   */
  hpLost: { unit: UnitId, amount: number, cause: 'damage' | 'consume', source: UnitId }
  /** `amount` is HP actually restored; `overheal` is the part that did not fit under max HP. */
  healed: { unit: UnitId, amount: number, overheal: number, source: UnitId }
  /** `amount` is energy actually added, after Energy Regeneration Rate and the cap. */
  energyGained: { unit: UnitId, amount: number }
  unitDowned: { unit: UnitId, at: number }

  // ---- ally actions (src/battle/battle.ts)
  /**
   * An ally finished a Basic ATK, Skill, Ultimate or follow-up. `debuffed` lists the enemies it put a
   * debuff on. `serial` numbers actions from 1.
   *
   * Two views of "who was hit" (DESIGN.md, K17):
   * - `enemiesHit` is the set of enemies the action COULD have hit: every enemy any part of it reaches,
   *   including every enemy a random-target part (a bounce, Lightning-Lord's hits) may land on. Use it where
   *   the set itself matters (candidates for a choice, "does any hit enemy carry X").
   * - `hitChance` is, per enemy of that set, the probability that the action hit it at least once. A
   *   single, blast or AoE part hits with probability 1. Each random hit lands on a given enemy with
   *   probability 1/N (a blast's splash also reaches the neighbours of the chosen enemy); an enemy missed by all
   *   random hits has probability the product of (1 - p) over the hits, and any deterministic hit makes it 1.
   *   `expectedEnemiesHit` is the sum of `hitChance`: use it for every effect that counts "per enemy hit".
   *   For 3 random single hits on 5 enemies it is 5 x (1 - (4/5)^3) = 2.44, while `enemiesHit` has all 5.
   */
  actionUsed: {
    actor: UnitId
    action: string
    kind: 'basic' | 'skill' | 'ultimate' | 'followUp'
    serial: number
    enemiesHit: UnitId[]
    hitChance: Record<UnitId, number>
    expectedEnemiesHit: number
    debuffed: UnitId[]
  }
  /** One enemy's damage from one part of an attack. `scaling` is the ATK multiple that produced it. */
  damageDealt: {
    attacker: UnitId
    enemy: UnitId
    ability: string
    scaling: number
    damage: number
    at: number
    cycle: number
  }

  // ---- enemy turns (src/battle/enemies.ts)
  enemyAttack: { enemy: UnitId, attack: string }
  /** The enemy's turn came and it did not act. Today only Freeze does this. */
  enemyTurnSkipped: { enemy: UnitId, reason: 'frozen' }

  // ---- toughness (src/battle/enemies.ts, src/battle/battle.ts; DESIGN.md K7 and K7b)
  /**
   * An attack took the last of an enemy's toughness. Emitted after the Break DMG has been dealt and the
   * delays and element effect applied. `element` is the breaker's element.
   */
  weaknessBroken: { enemy: UnitId, attacker: UnitId, element: string, at: number, cycle: number }
  /** The bar refilled at the start of the enemy's turn and the broken state ended. */
  toughnessRecovered: { enemy: UnitId, at: number }
  /**
   * One ally's share of an enemy attack. `hits` is the expected number of times it was hit:
   * for a single-target attack that is its chance of being the target.
   */
  allyHit: { unit: UnitId, enemy: UnitId, attack: string, hits: number, damage: number }
}

export type Handler<P> = (payload: P) => void
export type Unsubscribe = () => void

interface Subscription {
  handler: Handler<never>
  priority: number
  seq: number
  active: boolean
}

/**
 * Synchronous publish/subscribe with a fixed, reproducible call order: higher priority first, then
 * the order the handlers subscribed in. A handler that emits another event has that event fully
 * delivered before the outer delivery continues.
 */
export class EventBus<E extends object> {
  private readonly subs = new Map<keyof E, Subscription[]>()
  private seq = 0

  on<K extends keyof E>(type: K, handler: Handler<E[K]>, options: { priority?: number } = {}): Unsubscribe {
    const sub: Subscription = {
      handler: handler as Handler<never>,
      priority: options.priority ?? 0,
      seq: this.seq++,
      active: true,
    }
    const list = this.subs.get(type) ?? []
    list.push(sub)
    list.sort((a, b) => b.priority - a.priority || a.seq - b.seq)
    this.subs.set(type, list)

    return () => {
      sub.active = false
      const current = this.subs.get(type)
      if (current) this.subs.set(type, current.filter((s) => s !== sub))
    }
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const list = this.subs.get(type)
    if (!list) return
    // Iterate a copy: handlers added during delivery start with the next emit, and handlers
    // removed during delivery are skipped.
    for (const sub of [...list]) {
      if (sub.active) (sub.handler as Handler<E[K]>)(payload)
    }
  }
}
