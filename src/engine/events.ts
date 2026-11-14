import type { HitPart } from '../battle/battle'
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
  /** True for an extra turn (`Timeline.grantExtraTurn`): taken outside the gauge, right after an action. Absent otherwise. */
  extra?: true
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
  /** `Timeline.suspend`: the unit left the order but keeps its gauge. */
  unitSuspended: { unit: UnitId, at: number }
  /** `Timeline.resume`: the unit is back in the order with `gauge`. */
  unitResumed: { unit: UnitId, at: number, gauge: number }
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
  /**
   * A knockdown guard (`Party.addKnockdownGuard`) held `unit` at `hp` instead of letting it be downed. `hpLost` for the
   * blow came just before it. `by` is the guard's id, `source` who caused the loss.
   */
  knockdownPrevented: { unit: UnitId, hp: number, by: string, source: UnitId }
  /**
   * A shield was applied or refreshed upward (`Party.setShield`): `amount` is the new value of the shield stored under `key`,
   * `previous` what that key held before (0 for a new one). `source` is who provided it (the shielded unit itself when the
   * caller did not say). Not emitted when a shield is removed, lowered, or set to the amount it already has.
   */
  shieldGranted: { unit: UnitId, key: string, amount: number, previous: number, source: UnitId }
  /**
   * A memosprite's HP reached 0 (src/battle/party.ts). The battle removes it and then emits `memospriteRemoved`. It is NOT a
   * `unitDowned`: a memosprite is not a character, so it never fails the "no downed characters" objective.
   */
  memospriteDefeated: { unit: UnitId, at: number }
  /** A memosprite joined the field (`Battle.addMemosprite`). */
  memospriteAdded: { unit: UnitId, owner: UnitId, at: number }
  /** A memosprite left the field: its HP reached 0, its owner was downed, or its kit removed it. */
  memospriteRemoved: { unit: UnitId, owner: UnitId, reason: 'hp' | 'ownerDowned' | 'removed', at: number }
  /**
   * Damage moved from one ally to another by a redirect rule (`Party.addRedirect`; Fu Xuan's Matrix of Prescience).
   * `amount` is what `from` would have taken and `to` is given instead (before `to`'s shields). `source` is the attacker.
   */
  damageRedirected: { from: UnitId, to: UnitId, amount: number, source: UnitId }
  /**
   * A backup rule (`Party.addBackup`; Netherwing) made `by` bear HP loss that `unit` could not: `unit` was held at 1 HP, `excess`
   * is the part of the loss it did not take, `requested` is `excess` times the rule's multiplier, `lost` is what `by` actually
   * lost. `by`'s own `hpLost` event comes just before this one (source: the original cause), so listeners that only count
   * hpLost see both the covered unit's and the backup's loss.
   */
  hpBorne: { unit: UnitId, by: UnitId, excess: number, requested: number, lost: number, cause: 'damage' | 'consume', source: UnitId }

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
    /**
     * Set when the actor is a memosprite: the member that owns it. The damage is priced as, and credited to, the owner
     * (`damageDealt.attacker` is the owner); `actor` is the memosprite so the log shows who acted.
     */
    owner?: UnitId
    action: string
    kind: 'basic' | 'skill' | 'ultimate' | 'followUp'
    serial: number
    enemiesHit: UnitId[]
    hitChance: Record<UnitId, number>
    expectedEnemiesHit: number
    debuffed: UnitId[]
    /**
     * Per enemy of `debuffed`, the probability that at least one debuff landed on it during the action (K22), the way
     * `hitChance` is for hits: 1 for a deterministic application, the chance it landed there for a random-target one,
     * independent applications combined as 1 - the product of their misses. `debuffed` stays 'could have been debuffed'.
     * Break effects count as debuffs on the enemy while they last (K24) but are not recorded here: a break is not an
     * ability inflicting a debuff (the IN-GAME CHECK in `Battle.weaknessBreak`).
     */
    debuffChance: Record<UnitId, number>
  }
  /**
   * One `Battle.attack` call has resolved (after its `damageDealt` events), with the parts it was given, read-only.
   * `damageDealt` is one event per enemy with the parts summed, so it cannot say how many hits an attack had; a
   * listener that counts hits (The Ashblazing Grand Duke) reads the parts here. Do not mutate them.
   */
  attackResolved: { attacker: UnitId, ability: string, parts: readonly HitPart[] }
  /** One enemy's damage from one part of an attack. `scaling` is the ATK multiple that produced it. */
  damageDealt: {
    attacker: UnitId
    enemy: UnitId
    ability: string
    scaling: number
    damage: number
    /**
     * Set only for a flat amount of damage (`Battle.dealFlatDamage`), which the kernel did not price: 'TRUE' for True DMG.
     * Absent for everything the kernel priced. A tally of "non-True DMG" skips `kind === 'TRUE'`.
     */
    kind?: 'TRUE' | 'FLAT'
    /**
     * The probability that the enemy was hit at least once by the attack call this event belongs to (K17): 1 for a
     * single, blast or AoE part or for Break DMG, below 1 for an enemy only random-target parts reach, and 0 for an
     * enemy reached only by Additional DMG that rides on hits dealt elsewhere. Effects that react to "the wearer hit an
     * enemy" apply at this chance (Along the Passing Shore's Mirage Fizzle).
     */
    chance: number
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
