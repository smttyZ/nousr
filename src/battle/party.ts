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

/**
 * Moves part of the damage an ally takes to another ally (DESIGN.md K6; Fu Xuan's Matrix of Prescience: "teammates Distribute
 * 65% of the DMG they receive (before this DMG is mitigated by any Shields) to Fu Xuan"). Applied in `Party.takeDamage`, so
 * to every hit on the ally from an enemy, ahead of its shields. The amount a hit reaches `takeDamage` with is already after the
 * ally's damage reductions (`Enemies.takeTurn` applies them), so the moved share is a share of the damage the ally would
 * have taken. IN-GAME CHECK: whether the game takes the share before or after the ally's DEF and reductions. The text settles
 * only "before Shields", which is what is built.
 */
export interface RedirectRule {
  /** Identity for `removeRedirect`. Adding a rule with an id already in use replaces it. */
  id: string
  /** The ally that receives the share. A rule never moves damage the receiver itself takes. */
  to: UnitId
  /** Fraction of the damage moved, 0 to 1 (0.65 for Fu Xuan). */
  share: number
  /** Which allies it covers. Default: every other combatant in the party, memosprites included. */
  from?: (id: UnitId) => boolean
  /** Checked on every hit; the rule is skipped while it returns false. Typically `() => modifiers.has(owner, 'matrix')`, so it lasts as long as that modifier. */
  active?: () => boolean
  /**
   * Whether the receiver's own damage reductions apply to the share it takes. Default false: the share is already after
   * the original target's reductions. IN-GAME CHECK (Fu Xuan's own 18% to 19.6% Misfortune Avoidance).
   */
  targetReductions?: boolean
}

/**
 * An ally that covers for others' HP (Netherwing's talent "Wings Sweep the Ruins": "When allies take DMG or consume HP, their
 * current HP can be reduced down to a minimum of 1, after which Netherwing will bear the HP loss. But Netherwing consumes HP
 * equal to 500% of the original value"). Applied inside the one HP-loss path, so it covers hits and HP an ally spends itself
 * (`consumeHp`). The covered ally keeps at least 1 HP; the loss it did not take, times `multiplier`, is lost by `by`
 * (shields do not apply to it, and `by` itself is covered by no backup). `by` at 0 HP is removed like any combatant at 0.
 */
export interface BackupRule {
  id: string
  /** The ally that bears the loss. It is never covered by its own rule. */
  by: UnitId
  /** 5 for Netherwing's 500%. */
  multiplier: number
  /** Which allies it covers. Default: every other combatant in the party. */
  covers?: (id: UnitId) => boolean
  /** As `RedirectRule.active`. */
  active?: () => boolean
}

/**
 * A rule that can veto a knockdown (Fu Xuan's E2: "any ally target struck by a killing blow ... will not be knocked down, and
 * 70% of their Max HP is immediately restored"). Called in the one HP-loss path when a unit's HP has reached 0, before the
 * unit is downed (and before `unitDowned` / `memospriteDefeated`). Return the HP to hold the unit at (above 0, capped at its
 * Max HP) to prevent the knockdown; return undefined to let it happen. Guards run in the order they were added and the first
 * to return an HP wins; a guard that returns one has used up its trigger, so it should keep its own count.
 *
 * Order of everything a hit goes through (`takeDamage`): redirect rules move their share to another ally; the share each unit
 * keeps goes through its shields; the rest comes off HP, where a backup rule (Netherwing) holds the unit at 1 HP and passes the
 * excess, times its multiplier, to the backup; only an HP that is still 0 after that reaches the guards. So a covered ally is
 * never "struck by a killing blow" (the backup's rule comes first), the redirect's receiver (and the backup itself) are
 * guarded like any other unit when their own HP runs out, and a guard sees the loss that reached the unit, not the original hit.
 */
export interface KnockdownGuard {
  (info: { unit: UnitId, source: UnitId, cause: 'damage' | 'consume' }): number | undefined
}

export type CombatantKind = 'character' | 'memosprite'

export interface CombatantInit {
  id: UnitId
  /** 'character' (default) or 'memosprite'. A memosprite at 0 HP emits `memospriteDefeated`, not `unitDowned`, and never counts in `anyDowned`. */
  kind?: CombatantKind
  /**
   * Whether enemies can choose this unit as a target (DESIGN.md K6). Default true. An untargetable unit is left out of
   * `standing()`, of aggro shares and of AoE hits, but is a party member in every other way: HP, shields, healing, backup.
   */
  targetable?: boolean
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
  readonly kind: CombatantKind
  readonly targetable: boolean
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
  kind: CombatantKind
  targetable: boolean
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
  private readonly redirects = new Map<string, RedirectRule>()
  private readonly backups = new Map<string, BackupRule>()
  private readonly guards = new Map<string, KnockdownGuard>()

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
      kind: init.kind ?? 'character',
      targetable: init.targetable ?? true,
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
    for (const [key, rule] of [...this.redirects]) if (rule.to === id) this.redirects.delete(key)
    for (const [key, rule] of [...this.backups]) if (rule.by === id) this.backups.delete(key)
  }

  has(id: UnitId): boolean {
    return this.members.has(id)
  }

  get(id: UnitId): Combatant {
    return this.state(id)
  }

  /** Units enemies can still choose as a target, left to right: alive and targetable. */
  standing(): UnitId[] {
    return [...this.members.values()]
      .filter((m) => !m.downed && m.targetable)
      .sort((a, b) => a.position - b.position)
      .map((m) => m.id)
  }

  /** Every unit still alive, targetable or not, left to right. */
  alive(): UnitId[] {
    return [...this.members.values()]
      .filter((m) => !m.downed)
      .sort((a, b) => a.position - b.position)
      .map((m) => m.id)
  }

  /** Switches whether enemies can choose the unit (see `CombatantInit.targetable`). */
  setTargetable(id: UnitId, targetable: boolean): void {
    this.state(id).targetable = targetable
  }

  /** True once any character has been downed: the Memory of Chaos "no downed characters" objective. Memosprites do not count. */
  anyDowned(): boolean {
    return [...this.members.values()].some((m) => m.downed && m.kind === 'character')
  }

  // ---------------------------------------------------------------- redirection and backup

  /** Adds or replaces a damage redirect rule (see `RedirectRule`). */
  addRedirect(rule: RedirectRule): void {
    if (!(rule.share >= 0 && rule.share <= 1)) throw new Error(`Redirect ${rule.id}: share must be in [0, 1], got ${rule.share}`)
    this.state(rule.to)
    this.redirects.set(rule.id, rule)
  }

  removeRedirect(id: string): void {
    this.redirects.delete(id)
  }

  /** Adds or replaces a backup rule (see `BackupRule`). */
  addBackup(rule: BackupRule): void {
    if (!(rule.multiplier >= 0)) throw new Error(`Backup ${rule.id}: multiplier must not be negative, got ${rule.multiplier}`)
    this.state(rule.by)
    this.backups.set(rule.id, rule)
  }

  removeBackup(id: string): void {
    this.backups.delete(id)
  }

  /** Adds or replaces a knockdown guard (see `KnockdownGuard`). */
  addKnockdownGuard(id: string, guard: KnockdownGuard): void {
    this.guards.set(id, guard)
  }

  removeKnockdownGuard(id: string): void {
    this.guards.delete(id)
  }

  private redirectsFor(id: UnitId): RedirectRule[] {
    return [...this.redirects.values()].filter((r) => {
      const to = this.members.get(r.to)
      return r.to !== id && to !== undefined && !to.downed && (r.from?.(id) ?? true) && (r.active?.() ?? true)
    })
  }

  private backupFor(id: UnitId): BackupRule | undefined {
    return [...this.backups.values()].find((r) => {
      const by = this.members.get(r.by)
      return r.by !== id && by !== undefined && !by.downed && (r.covers?.(id) ?? true) && (r.active?.() ?? true)
    })
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

  /**
   * Replaces the shield stored under `key`. Pass 0 or undefined to remove it. `source` is who provides it (default: the shielded
   * unit). A shield that is new or larger than what the key held emits `shieldGranted`; removing or lowering one does not.
   */
  setShield(id: UnitId, key: string, amount: number | undefined, source: UnitId = id): void {
    const m = this.state(id)
    const previous = m.shields.get(key) ?? 0
    const next = amount !== undefined && amount > EPSILON ? amount : undefined
    setOrDelete(m.shields, key, next)
    if (next !== undefined && next > previous + EPSILON && !m.downed) {
      this.bus.emit('shieldGranted', { unit: id, key, amount: next, previous, source })
    }
  }

  /** How much damage the unit's shields would absorb right now. */
  shield(id: UnitId): number {
    return Math.max(0, ...this.state(id).shields.values())
  }

  /**
   * The amount of the one shield stored under `key`, or 0 if the unit has none under it. Unlike `shield`, it ignores
   * every other source, so a kit can stack its own shield without counting another one's.
   */
  shieldOf(id: UnitId, key: string): number {
    return this.state(id).shields.get(key) ?? 0
  }

  /**
   * A hit: redirect rules move their share first (`RedirectRule`), then shields absorb, the rest comes off HP (and a backup
   * rule may hold the unit at 1 HP, `BackupRule`). Returns what the unit itself took; a moved share is reported by `damageRedirected`.
   */
  takeDamage(id: UnitId, amount: number, source: UnitId): { absorbed: number, lost: number } {
    const m = this.state(id)
    if (m.downed || !(amount > 0)) return { absorbed: 0, lost: 0 }

    let own = amount
    for (const rule of this.redirectsFor(id)) {
      const moved = own * rule.share
      if (!(moved > 0)) continue
      own -= moved
      this.bus.emit('damageRedirected', { from: id, to: rule.to, amount: moved, source })
      const factor = rule.targetReductions ? this.damageTakenMultiplier(rule.to) : 1
      this.applyDamage(this.state(rule.to), moved * factor, source)
    }
    return this.applyDamage(m, own, source)
  }

  private applyDamage(m: State, amount: number, source: UnitId): { absorbed: number, lost: number } {
    const id = m.id
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

  /**
   * Raises HP up to max HP without it being a heal: no `healed` event, so nothing that reacts to healing (Contained Dark Tide, Robin
   * Summeretto's Vibes, Gentle Rain, healing tallies) sees it. For HP a kit's own rule moves, such as Netherwing taking allies' HP loss
   * as its HP. Returns the HP gained.
   */
  gainHp(id: UnitId, amount: number): number {
    const m = this.state(id)
    if (m.downed || !(amount > 0)) return 0
    const gained = Math.min(amount, m.maxHp - m.hp)
    m.hp += gained
    return gained
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

  /**
   * Changes a unit's energy cap (Robin Summeretto E6: in Fever she can store her Ultimate up to twice). Lowering it below the
   * energy held cuts the energy down to the new cap. IN-GAME CHECK: whether energy above the normal cap is kept or lost when
   * the state that allowed it ends; cutting it is the reading built.
   */
  setMaxEnergy(id: UnitId, maxEnergy: number): void {
    const m = this.state(id)
    if (!(maxEnergy >= 0)) throw new Error(`Combatant ${id}: maxEnergy must not be negative, got ${maxEnergy}`)
    m.maxEnergy = maxEnergy
    m.energy = Math.min(m.energy, maxEnergy)
  }

  /** Sets energy directly, for example to 0 when an Ultimate is used. */
  setEnergy(id: UnitId, value: number): void {
    const m = this.state(id)
    m.energy = Math.min(Math.max(0, value), m.maxEnergy)
  }

  private loseHp(m: State, amount: number, cause: 'damage' | 'consume', source: UnitId, floor: number, covered = true): number {
    if (!(amount > 0)) return 0
    // A backup holds the unit at 1 HP (never raising HP it does not have); the rest of the loss is borne by the backup.
    const backup = covered ? this.backupFor(m.id) : undefined
    const effectiveFloor = backup ? Math.min(m.hp, Math.max(floor, 1)) : floor
    const after = Math.max(effectiveFloor, m.hp - amount)
    const lost = m.hp - after
    const excess = amount - lost
    m.hp = after
    if (lost > 0) this.bus.emit('hpLost', { unit: m.id, amount: lost, cause, source })
    if (m.hp <= EPSILON && !m.downed) {
      const held = this.vetoKnockdown(m, cause, source)
      if (held !== undefined) {
        m.hp = held
        this.bus.emit('knockdownPrevented', { unit: m.id, hp: held, by: this.vetoedBy, source })
      }
    }
    if (m.hp <= EPSILON && !m.downed) {
      m.hp = 0
      m.downed = true
      m.shields.clear()
      if (m.kind === 'memosprite') this.bus.emit('memospriteDefeated', { unit: m.id, at: this.now() })
      else this.bus.emit('unitDowned', { unit: m.id, at: this.now() })
    }
    if (backup && excess > EPSILON) {
      const by = this.state(backup.by)
      const requested = excess * backup.multiplier
      const borne = this.loseHp(by, requested, cause, source, 0, false)
      this.bus.emit('hpBorne', { unit: m.id, by: by.id, excess, requested, lost: borne, cause, source })
    }
    return lost
  }

  private vetoedBy = ''

  /** The HP the first guard that vetoes holds the unit at, or undefined. Records which guard in `vetoedBy`. */
  private vetoKnockdown(m: State, cause: 'damage' | 'consume', source: UnitId): number | undefined {
    for (const [id, guard] of [...this.guards]) {
      const hp = guard({ unit: m.id, source, cause })
      if (hp !== undefined && hp > EPSILON) {
        this.vetoedBy = id
        return Math.min(hp, m.maxHp)
      }
    }
    return undefined
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
