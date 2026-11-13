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
export class Enemies {
  readonly ids: readonly UnitId[]
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
      ids.push(id)
    }
    this.ids = ids
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
