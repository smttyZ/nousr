import { EventBus } from './events'
import type { EngineEvents, TurnInfo, UnitId } from './events'
import { ModifierStore } from './modifiers'

/**
 * The action-value scheduler.
 *
 * Rules and where they come from:
 * - Every unit has an action gauge of 10,000 that drains at its current SPD per unit of action
 *   value (AV), so time to act = gauge / SPD. A SPD change keeps the gauge and so rescales the
 *   remaining AV. Advance and delay move the gauge by a share of 10,000, never below 0.
 *   Source: https://hsr.keqingmains.com/misc/speed-guide
 * - SPD = base SPD x (1 + sum of SPD%) + sum of flat SPD, the same composition Fribbels uses
 *   (vendor/hsr-optimizer/src/lib/optimization/calculateStats.ts).
 * - Memory of Chaos cycles: the first lasts 150 AV, each later one 100 AV (DESIGN.md, decision 2).
 *
 * Choices made here that sources do not settle. Each one is a single line to change:
 * - A turn landing exactly on a cycle boundary counts in the cycle that is ending (CYCLE_INCLUSIVE).
 * - Equal AV: a unit advanced to 0 goes before a unit that reached 0 by waiting, the most recently
 *   advanced first (KQM); otherwise the unit added to the timeline earlier goes first (compareOrder).
 * - The gauge refills after the turnStart event and before the unit acts. An advance during
 *   turnStart is therefore wasted (gauge already 0), and an advance during or after the unit's own
 *   action shortens its next turn.
 */

export const ACTION_GAUGE = 10_000

/** Two action values closer than this count as equal. Absorbs floating-point rounding. */
const EPSILON = 1e-9

const CYCLE_INCLUSIVE = true

export interface CycleRules {
  firstCycleAv: number
  laterCycleAv: number
}

export const MOC_CYCLES: CycleRules = { firstCycleAv: 150, laterCycleAv: 100 }

export interface UnitInit {
  id: UnitId
  /** The SPD that percentage buffs scale from. */
  baseSpd: number
  /** Permanent SPD% from the build, as a fraction. */
  spdPct?: number
  /** Permanent flat SPD from the build. */
  spdFlat?: number
  /** Starting gauge. Defaults to a full gauge. */
  gauge?: number
}

interface Unit {
  readonly id: UnitId
  readonly baseSpd: number
  readonly spdPct: number
  readonly spdFlat: number
  /** Position in the order units were added. */
  readonly slot: number
  gauge: number
  /** Non-zero while the unit sits at 0 gauge because of an advance. Higher is more recent. */
  advancedStamp: number
  turnsTaken: number
}

export type TurnHandler = (turn: TurnInfo, timeline: Timeline) => void

export type Step =
  | ({ kind: 'turn' } & TurnInfo)
  | { kind: 'cycleEnd', cycle: number, at: number }

export interface RunOptions {
  /** Stop when this many cycles have ended. */
  cycles: number
  /** Called once per turn, after the gauge refills. Later steps plug the action policy in here. */
  takeTurn?: TurnHandler
  /** Guard against a kit that advances itself forever. */
  maxTurns?: number
}

export class Timeline {
  readonly bus: EventBus<EngineEvents>
  readonly modifiers: ModifierStore
  readonly cycleRules: CycleRules

  private readonly unitMap = new Map<UnitId, Unit>()
  private elapsed = 0
  private currentCycle = 1
  private started = false
  private cycleStartPending = true
  private nextSlot = 0
  private nextStamp = 1
  private turnSerial = 0
  private active: TurnInfo | undefined

  constructor(options: { cycleRules?: CycleRules, bus?: EventBus<EngineEvents> } = {}) {
    this.cycleRules = options.cycleRules ?? MOC_CYCLES
    this.bus = options.bus ?? new EventBus<EngineEvents>()
    this.modifiers = new ModifierStore(this.bus, {
      now: () => this.elapsed,
      activeTurn: () => this.active,
    })
  }

  /** Elapsed action value since the battle began. */
  get now(): number {
    return this.elapsed
  }

  /** The cycle in progress. The first cycle is 1. */
  get cycle(): number {
    return this.currentCycle
  }

  get activeTurn(): TurnInfo | undefined {
    return this.active
  }

  /** Unit ids in the order they were added. */
  units(): UnitId[] {
    return [...this.unitMap.keys()]
  }

  has(id: UnitId): boolean {
    return this.unitMap.has(id)
  }

  addUnit(init: UnitInit): void {
    if (this.unitMap.has(init.id)) throw new Error(`Unit ${init.id} is already on the timeline`)
    if (!(init.baseSpd > 0)) throw new Error(`Unit ${init.id}: baseSpd must be positive, got ${init.baseSpd}`)
    const gauge = init.gauge ?? ACTION_GAUGE
    if (!(gauge >= 0)) throw new Error(`Unit ${init.id}: gauge must not be negative, got ${gauge}`)
    this.unitMap.set(init.id, {
      id: init.id,
      baseSpd: init.baseSpd,
      spdPct: init.spdPct ?? 0,
      spdFlat: init.spdFlat ?? 0,
      slot: this.nextSlot++,
      gauge,
      advancedStamp: 0,
      turnsTaken: 0,
    })
    this.bus.emit('unitAdded', { unit: init.id, at: this.elapsed })
  }

  /** Takes a unit off the timeline (downed, or a summon that left) and drops the modifiers on it. */
  removeUnit(id: UnitId): void {
    this.unit(id)
    this.unitMap.delete(id)
    this.modifiers.removeAllOn(id)
    this.bus.emit('unitRemoved', { unit: id, at: this.elapsed })
  }

  spd(id: UnitId): number {
    const u = this.unit(id)
    const spd = u.baseSpd * (1 + u.spdPct + this.modifiers.spdPct(id)) + u.spdFlat + this.modifiers.spdFlat(id)
    if (!(spd > 0)) throw new Error(`Unit ${id} has non-positive SPD ${spd}`)
    return spd
  }

  gauge(id: UnitId): number {
    return this.unit(id).gauge
  }

  /** Action value until this unit's next turn, at its current SPD. */
  av(id: UnitId): number {
    return this.unit(id).gauge / this.spd(id)
  }

  /** Action advance. `fraction` 0.25 is "advance action by 25%". */
  advance(id: UnitId, fraction: number): void {
    if (!(fraction >= 0)) throw new Error(`advance fraction must not be negative, got ${fraction}`)
    const u = this.unit(id)
    const before = u.gauge
    u.gauge = Math.max(0, before - fraction * ACTION_GAUGE)
    if (before > 0 && u.gauge === 0) u.advancedStamp = this.nextStamp++
    if (u.gauge !== before) this.bus.emit('gaugeChanged', { unit: id, before, after: u.gauge, cause: 'advance' })
  }

  /** Action delay. `fraction` 0.25 is "delay action by 25%". */
  delay(id: UnitId, fraction: number): void {
    if (!(fraction >= 0)) throw new Error(`delay fraction must not be negative, got ${fraction}`)
    const u = this.unit(id)
    const before = u.gauge
    u.gauge = before + fraction * ACTION_GAUGE
    if (u.gauge > 0) u.advancedStamp = 0
    if (u.gauge !== before) this.bus.emit('gaugeChanged', { unit: id, before, after: u.gauge, cause: 'delay' })
  }

  /** The upcoming order: who acts next first, with the action value each still has to wait. */
  order(): { unit: UnitId, av: number }[] {
    return [...this.unitMap.values()]
      .map((u) => ({ u, av: this.av(u.id) }))
      .sort((a, b) => compareOrder(a.u, a.av, b.u, b.av))
      .map(({ u, av }) => ({ unit: u.id, av }))
  }

  /** Elapsed action value at which the given cycle ends. */
  cycleEnd(cycle: number): number {
    return this.cycleRules.firstCycleAv + (cycle - 1) * this.cycleRules.laterCycleAv
  }

  /** Advances to the next thing that happens: one unit's turn, or the end of the current cycle. */
  step(takeTurn?: TurnHandler): Step {
    if (!this.started) {
      this.started = true
      this.bus.emit('battleStart', { at: this.elapsed })
    }
    if (this.cycleStartPending) {
      this.cycleStartPending = false
      this.bus.emit('cycleStart', {
        cycle: this.currentCycle,
        startsAt: this.elapsed,
        endsAt: this.cycleEnd(this.currentCycle),
      })
    }

    const next = this.order()[0]
    const boundary = this.cycleEnd(this.currentCycle)
    const turnAt = next === undefined ? Infinity : this.elapsed + next.av
    const missesCycle = CYCLE_INCLUSIVE ? turnAt > boundary + EPSILON : turnAt > boundary - EPSILON

    if (next === undefined || missesCycle) {
      this.drain(boundary - this.elapsed)
      this.elapsed = boundary
      const ended = { cycle: this.currentCycle, at: boundary }
      this.bus.emit('cycleEnd', ended)
      this.currentCycle += 1
      this.cycleStartPending = true
      return { kind: 'cycleEnd', ...ended }
    }

    this.drain(next.av)
    const u = this.unit(next.unit)
    u.gauge = 0
    u.turnsTaken += 1
    const turn: TurnInfo = {
      unit: u.id,
      serial: ++this.turnSerial,
      index: u.turnsTaken,
      at: this.elapsed,
      cycle: this.currentCycle,
    }
    this.active = turn

    // Listeners first, countdown second: an effect that triggers "at the start of the turn" still
    // sees a modifier on its last turn. Same order at the end of the turn.
    this.bus.emit('turnStart', turn)
    this.modifiers.tick(turn, 'turnStart')

    // Any of the above may have removed the unit (for example damage at turn start).
    if (this.unitMap.has(u.id)) {
      u.gauge = ACTION_GAUGE
      u.advancedStamp = 0
      takeTurn?.(turn, this)
    }
    if (this.unitMap.has(u.id)) {
      this.bus.emit('turnEnd', turn)
      this.modifiers.tick(turn, 'turnEnd')
    }

    this.active = undefined
    return { kind: 'turn', ...turn }
  }

  /** Runs until the given number of cycles have ended and returns everything that happened, in order. */
  run(options: RunOptions): Step[] {
    const maxTurns = options.maxTurns ?? 10_000
    const steps: Step[] = []
    let turns = 0
    for (;;) {
      const step = this.step(options.takeTurn)
      steps.push(step)
      if (step.kind === 'cycleEnd' && step.cycle >= options.cycles) return steps
      if (step.kind === 'turn' && ++turns > maxTurns) {
        throw new Error(`More than ${maxTurns} turns: something is advancing itself without end`)
      }
    }
  }

  private unit(id: UnitId): Unit {
    const u = this.unitMap.get(id)
    if (!u) throw new Error(`No unit ${id} on the timeline`)
    return u
  }

  /** Lets `av` action value pass: every gauge drains at its unit's current SPD. */
  private drain(av: number): void {
    if (av <= 0) return
    for (const u of this.unitMap.values()) {
      u.gauge = Math.max(0, u.gauge - av * this.spd(u.id))
    }
    this.elapsed += av
  }
}

function compareOrder(a: Unit, aAv: number, b: Unit, bAv: number): number {
  if (Math.abs(aAv - bAv) > EPSILON) return aAv - bAv
  if (a.advancedStamp !== b.advancedStamp) return b.advancedStamp - a.advancedStamp
  return a.slot - b.slot
}
