import type { TurnInfo, UnitId } from '../engine/events'
import type { Timeline } from '../engine/timeline'
import type { EnemyAttack, EnemyProfile } from '../enemy/profile'
import type { Party } from './party'

/**
 * The enemy side: N copies of one profile, each with its own turns, each working through the
 * profile's attack pattern.
 *
 * No randomness. Where the game would pick a target at random by aggro, every standing ally takes
 * its share instead (DESIGN.md, decision 4):
 * - single: each ally is hit `share` times, where share = its aggro / the team's aggro.
 * - bounce: the same, once per hit.
 * - blast: each ally takes the main hit `share` times and the adjacent hit once for each
 *   neighbour's share (the chance that neighbour was the main target).
 * - aoe: every ally is hit once.
 *
 * Damage taken = enemy ATK x multiplier x (1 - DEF / (DEF + 200 + 10 x enemy level)) x the ally's
 * damage reductions, with no crits (DESIGN.md, decision 8).
 * Source: https://www.prydwen.gg/star-rail/guides/damage-formula
 *
 * HP (DESIGN.md, K10 and S6): every enemy has max HP from the profile and a current HP that every hit
 * lowers. Enemies never die: current HP can go below 0 and nothing reacts to it. A profile without
 * `hp` still runs; the error comes only when something asks for an enemy's HP.
 *
 * Choices made here that sources do not settle:
 * - Copies of the same profile start their patterns together, so they all use the AoE on the same turn.
 * - Energy from being hit is scaled by the ally's Energy Regeneration Rate.
 */
/**
 * Toughness (DESIGN.md, K7 and K7b). Every enemy has a bar of `profile.toughness` in internal units (3 x the
 * in-game bar; a Basic ATK removes 30 of them, shown as 10 in game and in Fribbels' `toughnessDmg`).
 * `reduceToughness` takes an amount already scaled by Weakness Break Efficiency. At 0 or less the enemy is
 * Weakness Broken: the bar stays at 0 and further reductions do nothing until it recovers. The bar refills
 * and the broken state ends at the start of that enemy's next turn, before it acts. Sources are on the
 * constants below.
 */

/**
 * Action delay a Weakness Break gives the broken enemy, as a share of a full gauge; not scaled by Break Effect.
 * KQM speed guide, https://hsr.keqingmains.com/misc/speed-guide/ : "25% Action Delay ... not affected by Break
 * Effect%". srsim and hsr-simulator use the same 25% (srsim `modifyGaugeAfterWeaknessBreak`; hsr-simulator
 * `av_delayed` 2500).
 */
export const BREAK_BASE_DELAY = 0.25
/**
 * Entanglement (Quantum break): extra delay 20% x (1 + Break Effect of the breaker). KQM speed guide (same page).
 * The Entanglement damage over time is out of scope (K7b).
 */
export const ENTANGLEMENT_DELAY = 0.2
/**
 * Imprisonment (Imaginary break): extra delay 30% x (1 + Break Effect) and a 10% SPD reduction for 1 turn that
 * Break Effect does not scale. KQM speed guide (same page); the HoYoLAB wiki table gives the same
 * (https://wiki.hoyolab.com/m/hsr/entry/1099). srsim's older code uses 20% for the delay; the current guides say 30%.
 */
export const IMPRISONMENT_DELAY = 0.3
export const IMPRISONMENT_SLOW = 0.1
/**
 * Freeze (Ice break): the enemy's next turn is skipped, and the turn after it starts 50% advanced. KQM speed
 * guide: "unable to act for that turn, and receives a 50% Advance Forward on its next turn". The Freeze damage
 * over time is out of scope (K7b).
 */
export const THAW_ADVANCE = 0.5
/**
 * Does a frozen enemy's skipped turn leave it Weakness Broken, with the bar refilling at the turn after?
 * hsr-simulator checks Freeze before it restores toughness and returns, so the broken state lasts through the
 * skipped turn (`engine/core/combat_engine.py`, enemy turn, steps 0 and 1). No page read says so.
 * IN-GAME CHECK: set false to refill at the skipped turn's start like any other turn.
 */
export const FREEZE_HOLDS_BREAK = true

/** Remaining toughness this close to 0 counts as 0, so a chain of float sums that should hit 0 breaks. */
export const TOUGHNESS_EPSILON = 1e-9

export class Enemies {
  readonly ids: readonly UnitId[]
  private readonly toughnessLeft = new Map<UnitId, number>()
  private readonly broken = new Set<UnitId>()
  private readonly frozen = new Set<UnitId>()
  private readonly turnsTaken = new Map<UnitId, number>()
  private readonly forcedTargets = new Map<UnitId, UnitId>()
  /** Current HP per enemy. Empty when the profile has no HP. May go below 0. */
  private readonly currentHp = new Map<UnitId, number>()

  /** Adds `count` enemies to the timeline. Create this after the allies so allies win AV ties. */
  constructor(
    private readonly timeline: Timeline,
    private readonly party: Party,
    readonly profile: EnemyProfile,
    count: number,
  ) {
    if (!Number.isInteger(count) || count < 1) throw new Error(`Enemy count must be a positive whole number, got ${count}`)
    const ids: UnitId[] = []
    for (let i = 1; i <= count; i++) {
      const id = `enemy${i}`
      timeline.addUnit({ id, baseSpd: profile.spd })
      this.turnsTaken.set(id, 0)
      if (profile.hp !== undefined) this.currentHp.set(id, profile.hp)
      this.toughnessLeft.set(id, profile.toughness)
      ids.push(id)
    }
    this.ids = ids
    // The bar refills when the enemy's turn starts, before it acts.
    timeline.bus.on('turnStart', (turn) => {
      if (this.has(turn.unit)) this.recover(turn.unit)
    })
  }

  /** The enemy's bar, in internal units. */
  maxToughness(enemy: UnitId): number {
    this.requireEnemy(enemy)
    return this.profile.toughness
  }

  /** Toughness left, in internal units. 0 while broken. */
  toughness(enemy: UnitId): number {
    this.requireEnemy(enemy)
    return this.toughnessLeft.get(enemy)!
  }

  isBroken(enemy: UnitId): boolean {
    this.requireEnemy(enemy)
    return this.broken.has(enemy)
  }

  isFrozen(enemy: UnitId): boolean {
    this.requireEnemy(enemy)
    return this.frozen.has(enemy)
  }

  /**
   * Removes `amount` (internal units, already scaled by the attacker's Weakness Break Efficiency) and returns
   * true if this is the reduction that broke the enemy. A broken enemy has nothing left to remove.
   */
  reduceToughness(enemy: UnitId, amount: number): boolean {
    this.requireEnemy(enemy)
    if (!(amount >= 0)) throw new Error(`Toughness reduction must not be negative, got ${amount}`)
    if (this.broken.has(enemy) || amount === 0) return false
    const left = this.toughnessLeft.get(enemy)! - amount
    if (left > TOUGHNESS_EPSILON) {
      this.toughnessLeft.set(enemy, left)
      return false
    }
    this.toughnessLeft.set(enemy, 0)
    this.broken.add(enemy)
    return true
  }

  /** Freeze: this enemy skips its next turn (see `FREEZE_HOLDS_BREAK`, `THAW_ADVANCE`). */
  freeze(enemy: UnitId): void {
    this.requireEnemy(enemy)
    this.frozen.add(enemy)
  }

  /** The start of the enemy's turn: refill the bar and end the broken state. */
  private recover(enemy: UnitId): void {
    if (!this.broken.has(enemy)) return
    if (FREEZE_HOLDS_BREAK && this.frozen.has(enemy)) return
    this.broken.delete(enemy)
    this.toughnessLeft.set(enemy, this.profile.toughness)
    this.timeline.bus.emit('toughnessRecovered', { enemy, at: this.timeline.now })
  }

  has(id: UnitId): boolean {
    return this.turnsTaken.has(id)
  }

  /** An enemy's max HP. Stops with an error when the profile has none. */
  maxHp(enemy: UnitId): number {
    this.requireEnemy(enemy)
    if (this.profile.hp === undefined) {
      throw new Error(
        `Enemy HP was asked for, but enemy profile "${this.profile.id}" has no "hp". Add one to the profile to use effects that read enemy HP.`,
      )
    }
    return this.profile.hp
  }

  /** An enemy's current HP. Below 0 once it has taken more than its max HP: enemies do not die (S6). */
  hp(enemy: UnitId): number {
    this.maxHp(enemy)
    return this.currentHp.get(enemy)!
  }

  /** Lowers an enemy's HP by one hit's damage. Does nothing when the profile has no HP. */
  takeDamage(enemy: UnitId, amount: number): void {
    this.requireEnemy(enemy)
    const hp = this.currentHp.get(enemy)
    if (hp !== undefined) this.currentHp.set(enemy, hp - amount)
  }

  /** Taunt: this enemy's single-target choices all go to `ally` while it stands. Undefined clears it. */
  setForcedTarget(enemy: UnitId, ally: UnitId | undefined): void {
    this.requireEnemy(enemy)
    if (ally === undefined) this.forcedTargets.delete(enemy)
    else this.forcedTargets.set(enemy, ally)
  }

  /** The attack this enemy will use on its next turn. */
  nextAttack(enemy: UnitId): EnemyAttack {
    const taken = this.requireEnemy(enemy)
    return this.profile.pattern[taken % this.profile.pattern.length]!
  }

  /** Resolves one enemy turn. Call from the timeline's turn handler when the unit is an enemy. */
  takeTurn(turn: TurnInfo): void {
    const enemy = turn.unit
    if (this.frozen.has(enemy)) {
      // Frozen: no action this turn, and the next turn comes sooner. The gauge has refilled by now.
      this.frozen.delete(enemy)
      this.timeline.bus.emit('enemyTurnSkipped', { enemy, reason: 'frozen' })
      this.timeline.advance(enemy, THAW_ADVANCE)
      return
    }
    const attack = this.nextAttack(enemy)
    this.turnsTaken.set(enemy, this.requireEnemy(enemy) + 1)

    const allies = this.party.standing()
    if (allies.length === 0) return
    this.timeline.bus.emit('enemyAttack', { enemy, attack: attack.id })

    const shares = this.shares(enemy)
    // Work out every ally's share before applying any of it, so an ally downed by this attack
    // does not change what the others take from the same attack.
    const plan = allies.map((ally, i) => {
      const share = shares.get(ally) ?? 0
      let mainHits = 0
      let adjacentHits = 0
      switch (attack.target) {
        case 'single':
          mainHits = share
          break
        case 'bounce':
          mainHits = share * attack.hits
          break
        case 'aoe':
          mainHits = 1
          break
        case 'blast': {
          mainHits = share
          const left = allies[i - 1]
          const right = allies[i + 1]
          adjacentHits = (left ? shares.get(left) ?? 0 : 0) + (right ? shares.get(right) ?? 0 : 0)
          break
        }
      }
      const perMultiplier = this.profile.atk * this.defMultiplier(ally) * this.party.damageTakenMultiplier(ally)
      const damage = perMultiplier * (mainHits * attack.multiplier + adjacentHits * attack.adjacentMultiplier)
      return { ally, hits: mainHits + adjacentHits, damage }
    })

    for (const { ally, hits, damage } of plan) {
      if (hits <= 0) continue
      this.party.takeDamage(ally, damage, enemy)
      this.party.gainEnergy(ally, hits * attack.energy)
      this.timeline.bus.emit('allyHit', { unit: ally, enemy, attack: attack.id, hits, damage })
    }
  }

  /** The share of the enemy's damage that gets past an ally's DEF. */
  defMultiplier(ally: UnitId): number {
    const def = this.party.get(ally).def
    return 1 - def / (def + 200 + 10 * this.profile.level)
  }

  private shares(enemy: UnitId): Map<UnitId, number> {
    const forced = this.forcedTargets.get(enemy)
    if (forced !== undefined && this.party.has(forced) && !this.party.get(forced).downed) {
      return new Map(this.party.standing().map((id) => [id, id === forced ? 1 : 0]))
    }
    return this.party.targetShares()
  }

  private requireEnemy(id: UnitId): number {
    const taken = this.turnsTaken.get(id)
    if (taken === undefined) throw new Error(`${id} is not an enemy`)
    return taken
  }
}
