import type { EngineEvents, TurnInfo, UnitId } from '../engine/events'
import type { ModifierSpec } from '../engine/modifiers'
import { Timeline } from '../engine/timeline'
import type { EnemyProfile } from '../enemy/profile'
import type { DamageKernel, DamageRequest, DamageResult, KernelBuild, KernelTeammate, KernelUnit } from '../kernel/types'
import type { Kit, KitInstance } from '../kits/kit'
import type { Condition, Element, Rule } from '../scenario/types'
import { Enemies } from './enemies'
import { BASE_AGGRO, Party, removeDownedFromTimeline } from './party'

/**
 * Runs one team against N copies of an enemy profile for a number of cycles.
 *
 * Turn flow:
 * - Between any two actions, and before the first turn, the Ultimate window opens: the policy is
 *   read top to bottom and the first 'ultimate' rule that applies is used, repeatedly, until none does.
 * - On an ally's turn, the first non-Ultimate rule for that ally that applies is used. If none
 *   applies the battle stops with an error (DESIGN.md, S4).
 * - On an enemy's turn it uses the next attack in its pattern.
 *
 * Damage: a kit says which enemies an attack hits and with what ATK multiple. The runner asks the
 * kernel for the attacker's damage against each enemy's own state and scales it (DESIGN.md, S9, K1).
 * The primary target is the middle enemy (K3). A bounce is split evenly across the enemies.
 */

export const MAX_SKILL_POINTS = 5

export interface MemberSetup {
  /** The member's key from the scenario. Doubles as its unit id. */
  key: string
  kit: Kit
  eidolon: number
  affinitiveEidolon: boolean
  /** Out-of-combat stats. In-combat changes come from kits and modifiers. */
  stats: { maxHp: number, def: number, baseSpd: number, spdFlat?: number, energyRegen?: number }
  /** How the damage kernel knows this member. */
  kernel: { unit: KernelUnit, build: KernelBuild }
}

export interface Member extends MemberSetup {
  /** Position in the party, 0 at the left. */
  index: number
  instance: KitInstance
}

export interface BattleSetup {
  members: MemberSetup[]
  policy: Rule[]
  profile: EnemyProfile
  enemyCount: number
  weaknesses: 'all' | Element[]
  cycles: number
  start: { energy: number, skillPoints: number, techniques: boolean }
  kernel: DamageKernel
}

export type HitPart =
  /** One enemy. Defaults to the primary target. */
  | { shape: 'single', scaling: number, target?: UnitId }
  /** One enemy at `scaling` and the enemies next to it at `adjacent`. */
  | { shape: 'blast', scaling: number, adjacent: number, target?: UnitId }
  /** Every enemy. */
  | { shape: 'aoe', scaling: number }
  /** `hits` hits of `scaling`, each on a random enemy: split evenly. */
  | { shape: 'bounce', scaling: number, hits: number }

export interface AttackSpec {
  attacker: string
  /** Fribbels ability kind whose damage type and buffs apply: 'BASIC', 'SKILL', 'ULT', 'FUA', ... */
  ability: string
  parts: HitPart[]
}

export interface BattleResult {
  cycles: number
  enemyCount: number
  totalDamage: number
  /** Index 0 is cycle 1. */
  damageByCycle: number[]
  damageByMember: Record<string, number>
  /** Every ally action in order. */
  actions: EngineEvents['actionUsed'][]
  /** Allies that were downed. Non-empty fails the "no downed characters" objective. */
  downed: string[]
  kernelCalls: number
}

interface ActionInProgress {
  serial: number
  enemiesHit: Set<UnitId>
  debuffed: Set<UnitId>
}

export class Battle {
  readonly timeline = new Timeline()
  readonly party: Party
  readonly enemies: Enemies
  readonly members: Member[]
  /** The enemy that single-target and blast attacks aim at: the middle one. */
  readonly primary: UnitId

  private skillPointCount: number
  private actionSerial = 0
  private current: ActionInProgress | undefined
  private readonly kernelCache = new Map<string, DamageResult>()
  private kernelCalls = 0
  private readonly damageByCycle: number[]
  private readonly damageByMember: Record<string, number> = {}
  private readonly actionLog: EngineEvents['actionUsed'][] = []
  private readonly downed: string[] = []

  constructor(private readonly setup: BattleSetup) {
    if (setup.members.length === 0) throw new Error('A battle needs at least one member')
    this.party = new Party(this.timeline.bus, () => this.timeline.now)
    this.skillPointCount = Math.min(setup.start.skillPoints, MAX_SKILL_POINTS)
    this.damageByCycle = new Array<number>(setup.cycles).fill(0)

    // Allies first, so an ally wins an action-value tie against an enemy.
    setup.members.forEach((m, index) => {
      this.timeline.addUnit({ id: m.key, baseSpd: m.stats.baseSpd, spdFlat: m.stats.spdFlat ?? 0 })
      this.party.add({
        id: m.key,
        maxHp: m.stats.maxHp,
        def: m.stats.def,
        baseAggro: BASE_AGGRO[m.kit.path],
        position: index,
        maxEnergy: m.kit.maxEnergy,
        energy: m.kit.maxEnergy * setup.start.energy,
        energyRegen: m.stats.energyRegen ?? 0,
      })
      this.damageByMember[m.key] = 0
    })
    this.enemies = new Enemies(this.timeline, this.party, setup.profile, setup.enemyCount)
    this.primary = this.enemies.ids[Math.floor(setup.enemyCount / 2)]!
    removeDownedFromTimeline(this.timeline)
    this.timeline.bus.on('unitDowned', (e) => this.downed.push(e.unit))

    // Kits are created last: they may look at the whole field and subscribe to events.
    this.members = setup.members.map((m, index) => ({ ...m, index, instance: undefined as unknown as KitInstance }))
    for (const member of this.members) member.instance = member.kit.create(this, member)
    this.checkPolicy()
  }

  // ---------------------------------------------------------------- what kits use

  get skillPoints(): number {
    return this.skillPointCount
  }

  gainSkillPoints(n: number): void {
    this.skillPointCount = Math.min(MAX_SKILL_POINTS, this.skillPointCount + n)
  }

  spendSkillPoints(n: number): void {
    if (n > this.skillPointCount + 1e-9) throw new Error(`Tried to spend ${n} skill points with ${this.skillPointCount}`)
    this.skillPointCount = Math.max(0, this.skillPointCount - n)
  }

  member(key: string): Member {
    const m = this.members.find((x) => x.key === key)
    if (!m) throw new Error(`No member "${key}"`)
    return m
  }

  isAlly(id: UnitId): boolean {
    return this.members.some((m) => m.key === id)
  }

  /** The enemies standing next to this one. */
  adjacentEnemies(enemy: UnitId): UnitId[] {
    const i = this.enemies.ids.indexOf(enemy)
    if (i < 0) throw new Error(`${enemy} is not an enemy`)
    return [this.enemies.ids[i - 1], this.enemies.ids[i + 1]].filter((x): x is UnitId => x !== undefined)
  }

  /**
   * Wraps one Basic ATK, Skill, Ultimate or follow-up. Everything the body does counts as that one
   * action; `actionUsed` is emitted when it has fully resolved.
   */
  performAction(actor: string, action: string, kind: EngineEvents['actionUsed']['kind'], body: () => void): void {
    const outer = this.current
    const mine: ActionInProgress = { serial: ++this.actionSerial, enemiesHit: new Set(), debuffed: new Set() }
    this.current = mine
    try {
      body()
    } finally {
      this.current = outer
    }
    const event = { actor, action, kind, serial: mine.serial, enemiesHit: [...mine.enemiesHit], debuffed: [...mine.debuffed] }
    this.actionLog.push(event)
    this.timeline.bus.emit('actionUsed', event)
  }

  /** Puts a debuff on an enemy and records it against the action in progress. */
  applyDebuff(spec: Omit<ModifierSpec, 'debuff'>): void {
    if (!this.enemies.has(spec.target)) throw new Error(`${spec.target} is not an enemy`)
    this.timeline.modifiers.apply({ ...spec, debuff: true })
    this.current?.debuffed.add(spec.target)
  }

  hasDebuff(enemy: UnitId): boolean {
    return this.timeline.modifiers.on(enemy).some((m) => m.debuff)
  }

  /** Deals an attack's damage. Returns the total across all enemies. */
  attack(spec: AttackSpec): number {
    const attacker = this.member(spec.attacker)
    const ids = this.enemies.ids
    const scalingByEnemy = new Map<UnitId, number>()
    const add = (enemy: UnitId, scaling: number) => {
      if (scaling > 0) scalingByEnemy.set(enemy, (scalingByEnemy.get(enemy) ?? 0) + scaling)
    }
    for (const part of spec.parts) {
      switch (part.shape) {
        case 'single':
          add(part.target ?? this.primary, part.scaling)
          break
        case 'blast': {
          const target = part.target ?? this.primary
          add(target, part.scaling)
          for (const neighbour of this.adjacentEnemies(target)) add(neighbour, part.adjacent)
          break
        }
        case 'aoe':
          for (const enemy of ids) add(enemy, part.scaling)
          break
        case 'bounce':
          for (const enemy of ids) add(enemy, (part.scaling * part.hits) / ids.length)
          break
      }
    }

    let total = 0
    for (const enemy of ids) {
      const scaling = scalingByEnemy.get(enemy)
      if (scaling === undefined) continue
      const damage = this.damagePerUnitScaling(attacker, spec.ability, enemy) * scaling
      total += damage
      this.current?.enemiesHit.add(enemy)
      this.damageByMember[attacker.key]! += damage
      const cycleIndex = Math.min(this.timeline.cycle, this.setup.cycles) - 1
      this.damageByCycle[cycleIndex]! += damage
      this.timeline.bus.emit('damageDealt', {
        attacker: attacker.key,
        enemy,
        ability: spec.ability,
        scaling,
        damage,
        at: this.timeline.now,
        cycle: this.timeline.cycle,
      })
    }
    return total
  }

  // ---------------------------------------------------------------- running

  run(): BattleResult {
    for (const member of this.members) member.instance.onBattleStart?.({ techniques: this.setup.start.techniques })
    this.ultimateWindow()
    this.timeline.run({ cycles: this.setup.cycles, takeTurn: (turn) => this.takeTurn(turn) })
    return {
      cycles: this.setup.cycles,
      enemyCount: this.setup.enemyCount,
      totalDamage: this.damageByCycle.reduce((a, b) => a + b, 0),
      damageByCycle: [...this.damageByCycle],
      damageByMember: { ...this.damageByMember },
      actions: [...this.actionLog],
      downed: [...this.downed],
      kernelCalls: this.kernelCalls,
    }
  }

  private takeTurn(turn: TurnInfo): void {
    if (this.enemies.has(turn.unit)) {
      this.enemies.takeTurn(turn)
      this.ultimateWindow()
      return
    }
    const member = this.member(turn.unit)
    this.ultimateWindow()
    const rule = this.setup.policy.find((r) => r.unit === member.key && r.use !== 'ultimate' && this.applies(r))
    if (!rule) {
      throw new Error(
        `No policy rule applies on ${member.key}'s turn ${turn.index} (AV ${turn.at.toFixed(1)}, cycle ${turn.cycle}, ` +
          `${this.skillPointCount} skill points). Add an unconditional fallback such as a basic attack.`,
      )
    }
    member.instance.actions[rule.use]!.use(rule.target)
    this.ultimateWindow()
  }

  private ultimateWindow(): void {
    for (let used = 0; ; used++) {
      if (used > 100) throw new Error('More than 100 Ultimates in one window: an Ultimate is not using up its charge')
      const rule = this.setup.policy.find((r) => r.use === 'ultimate' && this.party.has(r.unit) && this.applies(r))
      if (!rule) return
      this.member(rule.unit).instance.actions.ultimate!.use(rule.target)
    }
  }

  private applies(rule: Rule): boolean {
    if (this.party.get(rule.unit).downed) return false
    const action = this.member(rule.unit).instance.actions[rule.use]!
    return action.canUse() && rule.when.every((c) => this.holds(c))
  }

  private holds(condition: Condition): boolean {
    const value = this.quantity(condition.what)()
    if (typeof value === 'boolean') {
      if (condition.is === undefined) throw new Error(`Condition on "${condition.what}" needs "is": it is a yes/no value`)
      return value === condition.is
    }
    if (condition.is !== undefined) throw new Error(`Condition on "${condition.what}" cannot use "is": it is a number`)
    return (condition.min === undefined || value >= condition.min) && (condition.max === undefined || value <= condition.max)
  }

  /** Resolves a condition path to a reader, or throws if nothing publishes it. */
  private quantity(path: string): () => number | boolean {
    const [owner, ...rest] = path.split('.')
    const name = rest.join('.')
    if (owner === 'team' && name === 'skill_points') return () => this.skillPointCount
    if (owner === 'battle' && name === 'cycle') return () => this.timeline.cycle
    const member = this.members.find((m) => m.key === owner)
    if (member) {
      const own = member.instance.quantities?.[name]
      if (own) return own
      const combatant = () => this.party.get(member.key)
      if (name === 'energy') return () => combatant().energy
      if (name === 'hp_share') return () => combatant().hp / combatant().maxHp
      if (name === 'ultimate_ready') return () => member.instance.actions.ultimate?.canUse() ?? false
    }
    throw new Error(`Unknown quantity "${path}" in a policy condition`)
  }

  /** Fails fast on a policy that names an action or a quantity that does not exist. */
  private checkPolicy(): void {
    for (const [i, rule] of this.setup.policy.entries()) {
      const member = this.members.find((m) => m.key === rule.unit)
      if (!member) throw new Error(`policy[${i}]: no member "${rule.unit}"`)
      if (!member.instance.actions[rule.use]) {
        throw new Error(
          `policy[${i}]: ${rule.unit} has no action "${rule.use}" (it has: ${Object.keys(member.instance.actions).join(', ')})`,
        )
      }
      for (const condition of rule.when) {
        try {
          this.quantity(condition.what)
        } catch (cause) {
          throw new Error(`policy[${i}]: ${(cause as Error).message}`)
        }
      }
    }
  }

  // ---------------------------------------------------------------- kernel

  /** The attacker's damage against one enemy per 100% ATK of the given ability, in its current state. */
  private damagePerUnitScaling(attacker: Member, ability: string, enemy: UnitId): number {
    const state = attacker.instance.attackerState(enemy)
    const reference = state.scaling[ability]
    if (!(reference !== undefined && reference > 0)) {
      throw new Error(`${attacker.key}'s kit gives no reference scaling for ability "${ability}"`)
    }
    const teammates: KernelTeammate[] = this.members
      .filter((m) => m !== attacker)
      .map((m) => ({ ...m.kernel.unit, ...m.instance.teammateState(attacker, enemy) }))
    const { weaknesses, profile, enemyCount } = this.setup
    const request: DamageRequest = {
      attacker: {
        ...attacker.kernel.unit,
        ...(state.characterConditionals && { characterConditionals: state.characterConditionals }),
        ...(state.lightConeConditionals && { lightConeConditionals: state.lightConeConditionals }),
      },
      teammates,
      build: attacker.kernel.build,
      enemy: {
        count: enemyCount,
        level: profile.level,
        maxToughness: profile.toughness,
        resistance: profile.res,
        elementalWeak: weaknesses === 'all' || weaknesses.includes(attacker.kit.element),
      },
    }
    const key = JSON.stringify(request)
    let result = this.kernelCache.get(key)
    if (!result) {
      result = this.setup.kernel.actionDamage(request)
      this.kernelCache.set(key, result)
      this.kernelCalls += 1
    }
    const damage = result.damage[ability]
    if (damage === undefined) {
      throw new Error(`The kernel returned no "${ability}" damage for ${attacker.key} (it has: ${Object.keys(result.damage).join(', ')})`)
    }
    return damage / reference
  }
}
