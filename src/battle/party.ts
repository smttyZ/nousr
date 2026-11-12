import type { EngineEvents, EventBus, Unsubscribe, UnitId } from '../engine/events'
import type { Timeline } from '../engine/timeline'

/**
 * The allied side's HP, shields, energy and aggro.
 *
 * The engine is expected-value: an attack that would hit one of four allies at random instead hits
 * all four for their share, so every amount here can be fractional. A threshold read off these
 * numbers (energy full, HP at 0) is the documented approximation in DESIGN.md.
 *
 * Sources:
 * - Base aggro by path, and Aggro = base x (1 + modifiers): the game data (AvatarPromotionConfig
 *   BaseAggro, 25 per point) and https://www.hoyolab.com/article/36700608
 * - Damage reductions multiply together: https://www.prydwen.gg/star-rail/guides/damage-formula
 *
 * Choices made here that are recalled rather than sourced; each is one place to change:
 * - Several shields do not add up: a hit is absorbed up to the largest one and every shield loses
 *   the hit's amount.
 * - HP a unit spends on its own abilities cannot take it below 1 HP.
 */

export type Path =
  | 'Destruction'
  | 'Hunt'
  | 'Erudition'
  | 'Harmony'
  | 'Nihility'
  | 'Preservation'
  | 'Abundance'
  | 'Remembrance'
  | 'Elation'

export const BASE_AGGRO: Record<Path, number> = {
  Preservation: 6,
  Destruction: 5,
  Harmony: 4,
  Nihility: 4,
  Abundance: 4,
  Remembrance: 4,
  Elation: 4,
  Hunt: 3,
  Erudition: 3,
}

/** Amounts below this count as zero, so a float remainder does not keep a unit alive. */
const EPSILON = 1e-9

export interface CombatantInit {
  id: UnitId
  maxHp: number
  def: number
  /** In aggro points: a character's path value from BASE_AGGRO, a memosprite's own value. */
  baseAggro: number
  /**
   * Place in the line from the left. Decides who stands next to whom for blast attacks. A
   * memosprite takes a value just after its owner's (owner 2, memosprite 2.5).
   */
  position: number
  /** Starting HP. Defaults to max HP. */
  hp?: number
  /** 0 or absent for a unit that has no energy. */
  maxEnergy?: number
  energy?: number
  /** Energy Regeneration Rate as a fraction: 0.194 for a 19.4% rope. */
  energyRegen?: number
}

export interface Combatant {
  readonly id: UnitId
  readonly maxHp: number
  readonly def: number
  readonly baseAggro: number
  readonly position: number
  readonly hp: number
  readonly maxEnergy: number
  readonly energy: number
  readonly energyRegen: number
  readonly downed: boolean
}

interface State {
  id: UnitId
  maxHp: number
  def: number
  baseAggro: number
  position: number
  hp: number
  maxEnergy: number
  energy: number
  energyRegen: number
  downed: boolean
  shields: Map<string, number>
  aggroModifiers: Map<string, number>
  damageReductions: Map<string, number>
}

export class Party {
  private readonly members = new Map<UnitId, State>()

  constructor(
    private readonly bus: EventBus<EngineEvents>,
    /** Elapsed action value, for event timestamps. */
    private readonly now: () => number = () => 0,
  ) {}

  add(init: CombatantInit): void {
    if (this.members.has(init.id)) throw new Error(`Combatant ${init.id} is already in the party`)
    if (!(init.maxHp > 0)) throw new Error(`Combatant ${init.id}: maxHp must be positive, got ${init.maxHp}`)
    if (!(init.def >= 0)) throw new Error(`Combatant ${init.id}: def must not be negative, got ${init.def}`)
    if (!(init.baseAggro >= 0)) throw new Error(`Combatant ${init.id}: baseAggro must not be negative`)
    const maxEnergy = init.maxEnergy ?? 0
    this.members.set(init.id, {
      id: init.id,
      maxHp: init.maxHp,
      def: init.def,
      baseAggro: init.baseAggro,
      position: init.position,
      hp: Math.min(init.hp ?? init.maxHp, init.maxHp),
      maxEnergy,
      energy: Math.min(init.energy ?? 0, maxEnergy),
      energyRegen: init.energyRegen ?? 0,
      downed: false,
      shields: new Map(),
      aggroModifiers: new Map(),
      damageReductions: new Map(),
    })
  }

  /** Takes a unit off the field without downing it (a memosprite that leaves). */
  remove(id: UnitId): void {
    this.state(id)
    this.members.delete(id)
  }

  has(id: UnitId): boolean {
    return this.members.has(id)
  }

  get(id: UnitId): Combatant {
    return this.state(id)
  }

  /** Units that can still be hit, left to right. */
  standing(): UnitId[] {
    return [...this.members.values()]
      .filter((m) => !m.downed)
      .sort((a, b) => a.position - b.position)
      .map((m) => m.id)
  }

  /** True once any unit has been downed: the Memory of Chaos "no downed characters" objective. */
  anyDowned(): boolean {
    return [...this.members.values()].some((m) => m.downed)
  }

  /** Updates live stats. Lowering max HP below current HP lowers HP to match; nothing else moves. */
  setStats(id: UnitId, stats: { maxHp?: number, def?: number, energyRegen?: number }): void {
    const m = this.state(id)
    if (stats.maxHp !== undefined) {
      if (!(stats.maxHp > 0)) throw new Error(`Combatant ${id}: maxHp must be positive, got ${stats.maxHp}`)
      m.maxHp = stats.maxHp
      m.hp = Math.min(m.hp, m.maxHp)
    }
    if (stats.def !== undefined) m.def = stats.def
    if (stats.energyRegen !== undefined) m.energyRegen = stats.energyRegen
  }

  // ---------------------------------------------------------------- aggro

  /** `value` 5 is "+500% chance to be attacked". Pass undefined to clear. */
  setAggroModifier(id: UnitId, key: string, value: number | undefined): void {
    setOrDelete(this.state(id).aggroModifiers, key, value)
  }

  aggro(id: UnitId): number {
    const m = this.state(id)
    return Math.max(0, m.baseAggro * (1 + sum(m.aggroModifiers.values())))
  }

  /** Each standing unit's chance of being the target of a single-target attack. */
  targetShares(): Map<UnitId, number> {
    const ids = this.standing()
    const total = ids.reduce((acc, id) => acc + this.aggro(id), 0)
    return new Map(ids.map((id) => [id, total > 0 ? this.aggro(id) / total : 1 / ids.length]))
  }

  // ---------------------------------------------------------------- damage taken

  /** `fraction` 0.18 is "takes 18% less damage". Pass undefined to clear. */
  setDamageReduction(id: UnitId, key: string, fraction: number | undefined): void {
    setOrDelete(this.state(id).damageReductions, key, fraction)
  }

  /** The product of (1 - reduction) over every damage reduction on the unit. */
  damageTakenMultiplier(id: UnitId): number {
    let product = 1
    for (const r of this.state(id).damageReductions.values()) product *= 1 - r
    return product
  }

  /** Replaces the shield stored under `key`. Pass 0 or undefined to remove it. */
  setShield(id: UnitId, key: string, amount: number | undefined): void {
    setOrDelete(this.state(id).shields, key, amount !== undefined && amount > EPSILON ? amount : undefined)
  }

  /** How much damage the unit's shields would absorb right now. */
  shield(id: UnitId): number {
    return Math.max(0, ...this.state(id).shields.values())
  }

  /** A hit: shields absorb first, the rest comes off HP. Returns what each took. */
  takeDamage(id: UnitId, amount: number, source: UnitId): { absorbed: number, lost: number } {
    const m = this.state(id)
    if (m.downed || !(amount > 0)) return { absorbed: 0, lost: 0 }

    const absorbed = Math.min(amount, this.shield(id))
    for (const [key, value] of [...m.shields]) {
      setOrDelete(m.shields, key, value - amount > EPSILON ? value - amount : undefined)
    }
    const lost = this.loseHp(m, amount - absorbed, 'damage', source, 0)
    return { absorbed, lost }
  }

  /** HP a unit spends on its own ability. Skips shields and stops at 1 HP. Returns the HP lost. */
  consumeHp(id: UnitId, amount: number, source: UnitId = id): number {
    const m = this.state(id)
    if (m.downed || !(amount > 0)) return 0
    return this.loseHp(m, amount, 'consume', source, Math.min(1, m.hp))
  }

  /** Restores HP up to max HP. Returns the HP actually restored. */
  heal(id: UnitId, amount: number, source: UnitId): number {
    const m = this.state(id)
    if (m.downed || !(amount > 0)) return 0
    const restored = Math.min(amount, m.maxHp - m.hp)
    m.hp += restored
    this.bus.emit('healed', { unit: id, amount: restored, overheal: amount - restored, source })
    return restored
  }

  // ---------------------------------------------------------------- energy

  /**
   * Adds energy. Scaled by the unit's Energy Regeneration Rate unless `fixed` is set, for the
   * effects that grant a flat amount. Returns the energy actually added.
   */
  gainEnergy(id: UnitId, amount: number, options: { fixed?: boolean } = {}): number {
    const m = this.state(id)
    if (m.downed || m.maxEnergy <= 0 || !(amount > 0)) return 0
    const scaled = options.fixed ? amount : amount * (1 + m.energyRegen)
    const added = Math.min(scaled, m.maxEnergy - m.energy)
    m.energy += added
    if (added > 0) this.bus.emit('energyGained', { unit: id, amount: added })
    return added
  }

  /** Sets energy directly, for example to 0 when an Ultimate is used. */
  setEnergy(id: UnitId, value: number): void {
    const m = this.state(id)
    m.energy = Math.min(Math.max(0, value), m.maxEnergy)
  }

  private loseHp(m: State, amount: number, cause: 'damage' | 'consume', source: UnitId, floor: number): number {
    if (!(amount > 0)) return 0
    const after = Math.max(floor, m.hp - amount)
    const lost = m.hp - after
    m.hp = after
    if (lost > 0) this.bus.emit('hpLost', { unit: m.id, amount: lost, cause, source })
    if (m.hp <= EPSILON && !m.downed) {
      m.hp = 0
      m.downed = true
      m.shields.clear()
      this.bus.emit('unitDowned', { unit: m.id, at: this.now() })
    }
    return lost
  }

  private state(id: UnitId): State {
    const m = this.members.get(id)
    if (!m) throw new Error(`No combatant ${id} in the party`)
    return m
  }
}

/** Removes a unit from the turn order when it is downed (DESIGN.md, decision 8). */
export function removeDownedFromTimeline(timeline: Timeline): Unsubscribe {
  return timeline.bus.on('unitDowned', ({ unit }) => {
    if (timeline.has(unit)) timeline.removeUnit(unit)
  })
}

function sum(values: Iterable<number>): number {
  let total = 0
  for (const v of values) total += v
  return total
}

function setOrDelete(map: Map<string, number>, key: string, value: number | undefined): void {
  if (value === undefined) map.delete(key)
  else map.set(key, value)
}
