import type { EngineEvents, TurnInfo, UnitId } from '../engine/events'
import type { EquipmentInstance, MemberEquipment } from '../equipment/equipment'
import { attackerEquipmentState, createEquipment, teammateEquipmentState } from '../equipment/equipment'
import type { ModifierSpec } from '../engine/modifiers'
import { Timeline } from '../engine/timeline'
import type { EnemyProfile } from '../enemy/profile'
import type { DamageKernel, DamageRequest, DamageResult, HitResult, KernelBuild, KernelTeammate, KernelUnit } from '../kernel/types'
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
 * Damage: a kit says which enemies an attack hits, which hit of the kernel's ability each part is
 * (ability kind plus position in the kernel's hit list) and with what multiple. The kernel prices
 * every hit on its own, with that hit's own buffs. The runner turns a hit into damage per 100% of its
 * scaling stat (the kernel's damage over the multiple the kernel used for that hit), then multiplies
 * by the part's multiple (DESIGN.md, S9, K1, K11). An ability or hit the kernel does not have is an
 * error. The primary target is the middle enemy (K3). A bounce is split evenly across the enemies.
 *
 * Enemy HP (K10): every hit lowers the hit enemy's current HP, which may go below 0.
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
  /**
   * The modules for this member's light cone and sets (K4), from `resolveEquipment`. Left out, the member
   * has no modules and the kernel's own defaults stand, which switch conditional effects on: only for
   * tests whose kernel is fake or whose items have no conditional. A scenario run always resolves it, and
   * stops when an item has no module.
   */
  equipment?: MemberEquipment
}

export interface Member extends MemberSetup {
  /** Position in the party, 0 at the left. */
  index: number
  instance: KitInstance
  /** What this member's light cone and sets supply, one instance per module. Created before the kits. */
  equipmentInstances: EquipmentInstance[]
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

/**
 * Where an attack part lands. `scaling` is the multiple of the hit's scaling stat that the part
 * deals to an enemy it reaches (1.6 is 160%), as the in-game text gives it.
 */
export type HitShape =
  /** One enemy. Defaults to the primary target. */
  | { shape: 'single', scaling: number, target?: UnitId }
  /** One enemy at `scaling` and the enemies next to it at `adjacent`. */
  | { shape: 'blast', scaling: number, adjacent: number, target?: UnitId }
  /** Every enemy. */
  | { shape: 'aoe', scaling: number }
  /** `hits` hits of `scaling`, each on a random enemy: split evenly. */
  | { shape: 'bounce', scaling: number, hits: number }

/**
 * One part of an attack. `hit` is the position, from 0, of the kernel hit that sets this part's
 * buffs and damage per 100%, in the list the kernel returns for the attack's ability. Several parts
 * may share a hit (Acheron's Ultimate is one kernel hit made of many in-game hits).
 */
export type HitPart = HitShape & { hit: number }

export interface AttackSpec {
  attacker: string
  /** Kernel ability kind whose hits the parts name: 'BASIC', 'SKILL', 'ULT', 'FUA', ... */
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
    this.members = setup.members.map((m, index) => ({
      ...m,
      index,
      instance: undefined as unknown as KitInstance,
      equipmentInstances: [] as EquipmentInstance[],
    }))
    // Equipment first: a kit may look at what the field already has. Modules read the kits' instances only
    // when they are asked for state, never while they are created.
    for (const member of this.members) member.equipmentInstances = createEquipment(this, member)
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

  /** How many debuffs an enemy has, from any source. */
  debuffCount(enemy: UnitId): number {
    return this.timeline.modifiers.on(enemy).filter((m) => m.debuff).length
  }

  /** Serial of the action in progress, or undefined between actions (a bare attack). */
  get actionSerialInProgress(): number | undefined {
    return this.current?.serial
  }

  /** Deals an attack's damage. Returns the total across all enemies. */
  attack(spec: AttackSpec): number {
    const attacker = this.member(spec.attacker)
    const ids = this.enemies.ids
    /** Per enemy: the multiple each kernel hit is asked for. */
    const multiples = new Map<UnitId, Map<number, number>>()
    const add = (enemy: UnitId, hit: number, scaling: number) => {
      if (!(scaling > 0)) return
      const byHit = multiples.get(enemy) ?? new Map<number, number>()
      byHit.set(hit, (byHit.get(hit) ?? 0) + scaling)
      multiples.set(enemy, byHit)
    }
    for (const part of spec.parts) {
      if (!Number.isInteger(part.hit) || part.hit < 0) {
        throw new Error(`${spec.attacker}'s ${spec.ability} attack names hit ${part.hit}: a hit is a position from 0`)
      }
      switch (part.shape) {
        case 'single':
          add(part.target ?? this.primary, part.hit, part.scaling)
          break
        case 'blast': {
          const target = part.target ?? this.primary
          add(target, part.hit, part.scaling)
          for (const neighbour of this.adjacentEnemies(target)) add(neighbour, part.hit, part.adjacent)
          break
        }
        case 'aoe':
          for (const enemy of ids) add(enemy, part.hit, part.scaling)
          break
        case 'bounce':
          for (const enemy of ids) add(enemy, part.hit, (part.scaling * part.hits) / ids.length)
          break
      }
    }

    let total = 0
    for (const enemy of ids) {
      const byHit = multiples.get(enemy)
      if (byHit === undefined) continue
      const hits = this.abilityHits(attacker, spec.ability, enemy)
      let scaling = 0
      let damage = 0
      for (const [index, multiple] of byHit) {
        damage += this.damagePerUnitScaling(attacker, spec.ability, index, hits) * multiple
        scaling += multiple
      }
      total += damage
      this.current?.enemiesHit.add(enemy)
      this.enemies.takeDamage(enemy, damage)
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

  /**
   * An enemy's max HP and current HP. Current HP is below 0 once the enemy has taken more than its
   * max, because enemies do not die (S6, K10). Stops with an error if the profile has no HP.
   */
  enemyHp(enemy: UnitId): { current: number, max: number } {
    return { current: this.enemies.hp(enemy), max: this.enemies.maxHp(enemy) }
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

  /** Every hit of one ability for the attacker against one enemy, in the enemy's current state. */
  private abilityHits(attacker: Member, ability: string, enemy: UnitId): HitResult[] {
    const state = attacker.instance.attackerState(enemy)
    const gear = attackerEquipmentState(attacker.equipmentInstances, enemy, attacker.key)
    const teammates: KernelTeammate[] = this.members
      .filter((m) => m !== attacker)
      .map((m) => {
        const own = m.instance.teammateState(attacker, enemy)
        const worn = teammateEquipmentState(m.equipmentInstances, attacker, enemy, m.key)
        return {
          ...m.kernel.unit,
          ...(own.characterConditionals && { characterConditionals: own.characterConditionals }),
          ...(worn.lightConeConditionals && { lightConeConditionals: worn.lightConeConditionals }),
          ...(worn.teamRelicSet !== undefined && { teamRelicSet: worn.teamRelicSet }),
          ...(worn.teamOrnamentSet !== undefined && { teamOrnamentSet: worn.teamOrnamentSet }),
        }
      })
    const { weaknesses, profile, enemyCount } = this.setup
    const request: DamageRequest = {
      attacker: {
        ...attacker.kernel.unit,
        ...(state.characterConditionals && { characterConditionals: state.characterConditionals }),
        ...(gear.lightConeConditionals && { lightConeConditionals: gear.lightConeConditionals }),
      },
      teammates,
      build: attacker.kernel.build,
      ...(gear.setConditionals && { setConditionals: gear.setConditionals }),
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
    const hits = result.hits[ability]
    if (hits === undefined) {
      throw new Error(`The kernel has no ability "${ability}" for ${attacker.key} (it has: ${Object.keys(result.hits).join(', ')})`)
    }
    return hits
  }

  /**
   * Damage per 100% of the scaling stat for one kernel hit: the kernel's damage for the hit over the
   * multiple the kernel used for it, so a kit never supplies a reference of its own (K11).
   */
  private damagePerUnitScaling(attacker: Member, ability: string, index: number, hits: readonly HitResult[]): number {
    const hit = hits[index]
    if (hit === undefined) {
      throw new Error(
        `${attacker.key}'s ${ability} attack names hit ${index}, but the kernel has ${hits.length} ` +
          `hit${hits.length === 1 ? '' : 's'} for ${ability} in this state`,
      )
    }
    if (!(hit.scaling !== undefined && hit.scaling > 0)) {
      throw new Error(
        `${attacker.key}'s ${ability} hit ${index} has no ATK, HP or DEF multiple from the kernel, so its damage cannot be priced per 100%`,
      )
    }
    return hit.damage / hit.scaling
  }
}
