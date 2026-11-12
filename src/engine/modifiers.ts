import type { EngineEvents, EventBus, TurnInfo, UnitId } from './events'

export type TickPhase = 'turnStart' | 'turnEnd'

/** A duration counted in turns of one unit. */
export interface TurnDuration {
  turns: number
  /** When in the counted unit's turn the count drops by one. */
  tick: TickPhase
  /** Whose turns are counted. Defaults to the unit the modifier is on. */
  clock?: UnitId
  /**
   * When the modifier is applied during a turn of the counted unit, does that same turn already
   * count? Default false, so a 2-turn buff a unit gives itself on its own turn is still up for its
   * next two turns.
   */
  countApplicationTurn?: boolean
}

export interface ModifierSpec {
  /** Identity for refresh and lookup. Applying the same id to the same target replaces the old one. */
  id: string
  target: UnitId
  source: UnitId
  /** SPD as a fraction of the target's base SPD: 0.12 is "+12% SPD". Negative slows. */
  spdPct?: number
  /** Flat SPD. */
  spdFlat?: number
  /** Stack count, for kits to read back. The engine does not multiply anything by it. */
  stacks?: number
  /** True for a debuff, which effects such as "against debuffed enemies" look for. Default false. */
  debuff?: boolean
  /** Leave out for a modifier that stays until something removes it. */
  duration?: TurnDuration
}

export interface Modifier {
  readonly id: string
  readonly target: UnitId
  readonly source: UnitId
  readonly spdPct: number
  readonly spdFlat: number
  readonly stacks: number
  readonly debuff: boolean
  readonly duration: Required<TurnDuration> | undefined
  /** Turns left, or undefined for a modifier with no duration. */
  turnsLeft: number | undefined
  /** Elapsed action value when it was applied. */
  readonly appliedAt: number
  /** Serial of the turn it was applied in, or undefined if applied between turns. */
  readonly appliedInTurn: number | undefined
}

/** What the store needs to know about the timeline it belongs to. */
export interface ModifierClock {
  now(): number
  activeTurn(): TurnInfo | undefined
}

export class ModifierStore {
  private readonly byTarget = new Map<UnitId, Modifier[]>()

  constructor(
    private readonly bus: EventBus<EngineEvents>,
    private readonly clock: ModifierClock,
  ) {}

  apply(spec: ModifierSpec): Modifier {
    const d = spec.duration
    if (d && !(Number.isInteger(d.turns) && d.turns > 0)) {
      throw new Error(`Modifier ${spec.id}: duration.turns must be a positive whole number, got ${d.turns}`)
    }
    const modifier: Modifier = {
      id: spec.id,
      target: spec.target,
      source: spec.source,
      spdPct: spec.spdPct ?? 0,
      spdFlat: spec.spdFlat ?? 0,
      stacks: spec.stacks ?? 1,
      debuff: spec.debuff ?? false,
      duration: d && {
        turns: d.turns,
        tick: d.tick,
        clock: d.clock ?? spec.target,
        countApplicationTurn: d.countApplicationTurn ?? false,
      },
      turnsLeft: d?.turns,
      appliedAt: this.clock.now(),
      appliedInTurn: this.clock.activeTurn()?.serial,
    }

    const list = this.byTarget.get(spec.target) ?? []
    const index = list.findIndex((m) => m.id === spec.id)
    const previous = index >= 0 ? list[index] : undefined
    // A refreshed modifier keeps its place, so iteration order does not depend on refresh timing.
    if (index >= 0) list[index] = modifier
    else list.push(modifier)
    this.byTarget.set(spec.target, list)

    this.bus.emit('modifierApplied', { modifier, previous })
    return modifier
  }

  get(target: UnitId, id: string): Modifier | undefined {
    return this.byTarget.get(target)?.find((m) => m.id === id)
  }

  has(target: UnitId, id: string): boolean {
    return this.get(target, id) !== undefined
  }

  /** Modifiers on a unit, in the order they were first applied. */
  on(target: UnitId): readonly Modifier[] {
    return this.byTarget.get(target) ?? []
  }

  remove(target: UnitId, id: string): boolean {
    const modifier = this.get(target, id)
    if (!modifier) return false
    this.drop(modifier, 'removed')
    return true
  }

  /** Removes everything on a unit that is leaving the battle. */
  removeAllOn(target: UnitId): void {
    for (const modifier of [...this.on(target)]) this.drop(modifier, 'unitRemoved')
  }

  spdPct(target: UnitId): number {
    return this.on(target).reduce((sum, m) => sum + m.spdPct, 0)
  }

  spdFlat(target: UnitId): number {
    return this.on(target).reduce((sum, m) => sum + m.spdFlat, 0)
  }

  /** Counts down every duration clocked on this unit's turn, at the given phase. Called by the timeline. */
  tick(turn: TurnInfo, phase: TickPhase): void {
    const due: Modifier[] = []
    for (const list of this.byTarget.values()) {
      for (const m of list) {
        if (m.duration?.clock === turn.unit && m.duration.tick === phase) due.push(m)
      }
    }
    for (const m of due) {
      // A modifier applied earlier in this same turn has not been up for a turn yet.
      const appliedThisTurn = m.appliedInTurn === turn.serial
      if (appliedThisTurn && !m.duration!.countApplicationTurn) continue
      // An earlier expiry in this loop may have triggered a handler that already removed this one.
      if (this.get(m.target, m.id) !== m) continue

      m.turnsLeft = m.turnsLeft! - 1
      if (m.turnsLeft <= 0) this.drop(m, 'expired')
    }
  }

  private drop(modifier: Modifier, reason: EngineEvents['modifierRemoved']['reason']): void {
    const list = this.byTarget.get(modifier.target)
    if (!list) return
    const remaining = list.filter((m) => m !== modifier)
    if (remaining.length === list.length) return
    if (remaining.length > 0) this.byTarget.set(modifier.target, remaining)
    else this.byTarget.delete(modifier.target)
    this.bus.emit('modifierRemoved', { modifier, reason })
  }
}
