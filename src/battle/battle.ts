import type { EngineEvents, TurnInfo, UnitId } from '../engine/events'
import type { EquipmentInstance, MemberEquipment } from '../equipment/equipment'
import { attackerEquipmentState, createEquipment, teammateEquipmentState } from '../equipment/equipment'
import type { ModifierSpec } from '../engine/modifiers'
import { Timeline } from '../engine/timeline'
import type { EnemyProfile } from '../enemy/profile'
import type { DamageKernel, DamageRequest, DamageResult, HitResult, InjectedBuff, KernelBuild, KernelTeammate, KernelUnit } from '../kernel/types'
import type { Kit, KitInstance } from '../kits/kit'
import type { RunWarning } from '../run/warnings'
import type { Condition, Element, Rule } from '../scenario/types'
import { BREAK_BASE_DELAY, ENTANGLEMENT_DELAY, Enemies, IMPRISONMENT_DELAY, IMPRISONMENT_SLOW } from './enemies'
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
  stats: {
    maxHp: number
    def: number
    baseSpd: number
    spdFlat?: number
    energyRegen?: number
    /** Basic (out-of-combat) Effect RES as a fraction, from the kernel's basic stats. For equipment modules (Broken Keel). */
    effectRes?: number
  }
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

/**
 * An untargetable summon with its own action gauge (DESIGN.md, K6, first kind): Jing Yuan's Lightning-Lord.
 * It is a timeline unit owned by one member. It has no HP, no aggro and no place in the party, so enemies
 * never choose it and nothing damages it. Its turn is run by the owner's kit through `takeTurn`, never by the
 * policy; the Ultimate window opens before and after it as it does around an ally's turn. What it deals is
 * asked from the kernel as the owner's ability (`performAction` and `attack` with `attacker: owner`), so the
 * damage and the action log are credited to the owner. It leaves the timeline when the owner is downed, or
 * when the kit calls `removeSummon`.
 */
export interface SummonSpec {
  /** Its timeline unit id. Must not collide with a member or an enemy. Convention: `${owner}.${name}`. */
  id: UnitId
  /** The member that owns it, by key. */
  owner: string
  /** The SPD that percentage buffs scale from. */
  baseSpd: number
  spdPct?: number
  spdFlat?: number
  /** Starting gauge. Defaults to a full gauge. */
  gauge?: number
  /** Runs the summon's turn. Called with the gauge already refilled, like an ally's turn. */
  takeTurn(turn: TurnInfo): void
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
export type HitPart = HitShape & {
  hit: number
  /**
   * Marks the part as one slice of random-target hits (K17), so the battle can tell how likely each enemy is to be
   * hit at least once. Its damage and toughness are not changed: the kit still states them as the expected share.
   * Parts of one group (default group 'random') are the disjoint choices of ONE random hit, one part per possible
   * target: `chance` is the probability, per hit, that this part is the one that lands (1 / enemies), and `hits`
   * is how many such random hits the family stands for (it may be fractional). The enemies a part reaches (its
   * target, plus the neighbours if it is a blast with adjacent damage) are each hit by it with probability
   * `chance` per hit. A 'bounce' needs none of this: it is random by shape.
   */
  random?: { hits: number, chance: number, group?: string }
  /**
   * Toughness this part removes from each enemy it reaches (the main target, for a blast; each hit, for a
   * bounce, split evenly like its damage), in INTERNAL units, the unit of the profile's `toughness` and of the
   * three-number "toughness a/b/c" that `node tools/gamedata/kit-text.mjs` prints (a Basic ATK is 30; in game
   * and in Fribbels' `toughnessDmg` it is 10, so multiply those by 3). In that list a is the designated
   * target, b every enemy and c the adjacent ones. Left out: 0. Before Weakness Break Efficiency.
   */
  toughness?: number
  /** Blast only: toughness the adjacent enemies lose (c in the in-game list). Left out: 0. */
  adjacentToughness?: number
  /**
   * The part removes toughness whatever the enemy's weaknesses (Acheron's Ultimate always, and at E6 her Basic
   * ATK and Skill). Without it, the part removes toughness only from an enemy weak to the attacker's element.
   */
  ignoresWeakness?: boolean
}

export interface AttackSpec {
  attacker: string
  /** Kernel ability kind whose hits the parts name: 'BASIC', 'SKILL', 'ULT', 'FUA', ... */
  ability: string
  parts: HitPart[]
}

/**
 * Who attacks with which ability and hit, for a choice between enemies that depends on how the hit would be
 * priced against each of them (`Battle.highestHpAmong`). `hit` is the position from 0 in the kernel's list for
 * `ability`, as in `HitPart`.
 */
export interface HitPricing {
  attacker: string
  ability: string
  hit: number
}

/** Two prices are the same when they differ by less than this, as a share of the larger one. */
export const PRICE_TIE = 1e-9

/** Two enemies' HP are tied when they differ by less than this, as a share of the larger (at least 1). */
export const HP_TIE = 1e-9

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
  /**
   * What the run says about its own numbers (K19). Today: an undecided "highest HP" tie that changed the
   * price of a hit (`Battle.highestHpAmong`), code `undecided-tie`. No team or enemy count is set here: the
   * runner in src/run adds them.
   */
  warnings: RunWarning[]
}

/** An undecided "highest HP" tie that priced differently, kept once per (attacker, ability, hit, tied set). */
interface TieRecord {
  pricing: HitPricing
  tied: UnitId[]
  prices: number[]
  chosen: UnitId
  at: number
  cycle: number
  count: number
}

interface ActionInProgress {
  serial: number
  enemiesHit: Set<UnitId>
  debuffed: Set<UnitId>
  /** Per enemy, the probability that NO part of the action so far hit it (K17). Absent: not hit. */
  miss: Map<UnitId, number>
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
  private readonly tieRecords = new Map<string, TieRecord>()
  private readonly summonMap = new Map<UnitId, SummonSpec>()

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
    this.timeline.bus.on('unitDowned', (e) => {
      this.downed.push(e.unit)
      // A summon leaves with its owner (Lightning-Lord's text: "when Jing Yuan is knocked down ... disappear").
      for (const summon of [...this.summonMap.values()]) if (summon.owner === e.unit) this.removeSummon(summon.id)
    })

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

  /** Puts an untargetable summon on the timeline (see `SummonSpec`). */
  addSummon(spec: SummonSpec): void {
    if (!this.members.some((m) => m.key === spec.owner)) throw new Error(`Summon ${spec.id}: no member "${spec.owner}" to own it`)
    if (this.party.get(spec.owner).downed) throw new Error(`Summon ${spec.id}: its owner ${spec.owner} is downed`)
    if (this.summonMap.has(spec.id) || this.timeline.has(spec.id)) throw new Error(`Summon ${spec.id}: that unit is already on the timeline`)
    this.summonMap.set(spec.id, spec)
    this.timeline.addUnit({
      id: spec.id,
      baseSpd: spec.baseSpd,
      ...(spec.spdPct !== undefined && { spdPct: spec.spdPct }),
      ...(spec.spdFlat !== undefined && { spdFlat: spec.spdFlat }),
      ...(spec.gauge !== undefined && { gauge: spec.gauge }),
    })
  }

  /** Takes a summon off the timeline. A summon that is already gone is ignored. */
  removeSummon(id: UnitId): void {
    if (!this.summonMap.delete(id)) return
    if (this.timeline.has(id)) this.timeline.removeUnit(id)
  }

  isSummon(id: UnitId): boolean {
    return this.summonMap.has(id)
  }

  /** The ids of the summons on the field that `owner` (a member key) owns, from each summon's `SummonSpec.owner`. Read-only. */
  summonsOf(owner: string): UnitId[] {
    return [...this.summonMap.values()].filter((s) => s.owner === owner).map((s) => s.id)
  }

  /** The scenario's enemy weaknesses: 'all', or the list of elements every enemy is weak to. Read-only. */
  get weaknesses(): 'all' | readonly Element[] {
    return this.setup.weaknesses
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
    const mine: ActionInProgress = { serial: ++this.actionSerial, enemiesHit: new Set(), debuffed: new Set(), miss: new Map() }
    this.current = mine
    try {
      body()
    } finally {
      this.current = outer
    }
    const hitChance: Record<UnitId, number> = {}
    let expectedEnemiesHit = 0
    for (const enemy of mine.enemiesHit) {
      const chance = Math.min(1, Math.max(0, 1 - (mine.miss.get(enemy) ?? 0)))
      hitChance[enemy] = chance
      expectedEnemiesHit += chance
    }
    const event = {
      actor,
      action,
      kind,
      serial: mine.serial,
      enemiesHit: [...mine.enemiesHit],
      hitChance,
      expectedEnemiesHit,
      debuffed: [...mine.debuffed],
    }
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
    /** Enemies a deterministic part reaches. */
    const certain = new Set<UnitId>()
    /** Random-target groups (K17): per group, the hits it stands for and each enemy's chance per hit. */
    const randomGroups = new Map<string, { hits: number, perHit: Map<UnitId, number> }>()
    const add = (enemy: UnitId, hit: number, scaling: number, random?: { hits: number, chance: number, group?: string }) => {
      if (!(scaling > 0)) return
      const byHit = multiples.get(enemy) ?? new Map<number, number>()
      byHit.set(hit, (byHit.get(hit) ?? 0) + scaling)
      multiples.set(enemy, byHit)
      if (random === undefined) {
        certain.add(enemy)
        return
      }
      const key = random.group ?? 'random'
      const group = randomGroups.get(key) ?? { hits: random.hits, perHit: new Map<UnitId, number>() }
      if (group.hits !== random.hits) {
        throw new Error(`${spec.attacker}'s ${spec.ability} attack: random group "${key}" has parts with different hit counts`)
      }
      randomGroups.set(key, group)
      group.perHit.set(enemy, (group.perHit.get(enemy) ?? 0) + random.chance)
    }
    for (const part of spec.parts) {
      if (!Number.isInteger(part.hit) || part.hit < 0) {
        throw new Error(`${spec.attacker}'s ${spec.ability} attack names hit ${part.hit}: a hit is a position from 0`)
      }
      switch (part.shape) {
        case 'single':
          add(part.target ?? this.primary, part.hit, part.scaling, part.random)
          break
        case 'blast': {
          const target = part.target ?? this.primary
          add(target, part.hit, part.scaling, part.random)
          for (const neighbour of this.adjacentEnemies(target)) add(neighbour, part.hit, part.adjacent, part.random)
          break
        }
        case 'aoe':
          for (const enemy of ids) add(enemy, part.hit, part.scaling)
          break
        case 'bounce':
          // Each of the bounce's hits lands on a given enemy with probability 1 / enemies. One group per part.
          for (const enemy of ids) {
            add(enemy, part.hit, (part.scaling * part.hits) / ids.length, {
              hits: part.hits,
              chance: 1 / ids.length,
              group: `bounce:${spec.parts.indexOf(part)}`,
            })
          }
          break
      }
    }
    /** The probability that none of this attack's parts hit the enemy (K17). */
    const missChance = (enemy: UnitId): number => {
      if (certain.has(enemy)) return 0
      let miss = 1
      for (const group of randomGroups.values()) {
        const perHit = group.perHit.get(enemy)
        if (perHit !== undefined) miss *= (1 - Math.min(1, perHit)) ** group.hits
      }
      return miss
    }

    const toughness = this.toughnessByEnemy(attacker, spec.parts)

    let total = 0
    for (const enemy of ids) {
      const byHit = multiples.get(enemy)
      const base = toughness.get(enemy)
      if (byHit === undefined && base === undefined) continue
      // The kernel's state for this enemy as it is when the attack lands: a hit that breaks the enemy is
      // priced as against an enemy that is not yet broken, like every other hit of the same attack.
      const result = this.kernelResult(attacker, enemy)
      if (byHit !== undefined) {
        const hits = this.hitsOf(attacker, spec.ability, result)
        let scaling = 0
        let damage = 0
        for (const [index, multiple] of byHit) {
          damage += this.damagePerUnitScaling(attacker, spec.ability, index, hits) * multiple
          scaling += multiple
        }
        total += damage
        if (this.current) {
          this.current.enemiesHit.add(enemy)
          this.current.miss.set(enemy, (this.current.miss.get(enemy) ?? 1) * missChance(enemy))
        }
        this.recordDamage(attacker, enemy, spec.ability, scaling, damage)
      }
      if (base !== undefined && base > 0) {
        // Weakness Break Efficiency raises what the attack removes (K7). Toughness vulnerability is not modelled.
        const removed = base * (1 + (result.stats.breakEfficiency ?? 0))
        if (this.enemies.reduceToughness(enemy, removed)) total += this.weaknessBreak(attacker, enemy)
      }
    }
    this.timeline.bus.emit('attackResolved', { attacker: spec.attacker, ability: spec.ability, parts: spec.parts })
    return total
  }

  /**
   * Per enemy, the base toughness (internal units, before Weakness Break Efficiency) the attack's parts remove.
   * A part removes toughness only from an enemy weak to the attacker's element, unless it ignores weakness;
   * with `weaknesses: 'all'` every element is a weakness (S5). An enemy no part touches has no entry.
   */
  private toughnessByEnemy(attacker: Member, parts: readonly HitPart[]): Map<UnitId, number> {
    const out = new Map<UnitId, number>()
    const { weaknesses } = this.setup
    const ids = this.enemies.ids
    const add = (enemy: UnitId, amount: number | undefined) => {
      if (amount === undefined) return
      if (!(amount >= 0)) throw new Error(`${attacker.key} has a part with negative toughness ${amount}`)
      out.set(enemy, (out.get(enemy) ?? 0) + amount)
    }
    for (const part of parts) {
      const weak = part.ignoresWeakness === true || weaknesses === 'all' || weaknesses.includes(attacker.kit.element)
      if (!weak) continue
      switch (part.shape) {
        case 'single':
          add(part.target ?? this.primary, part.toughness)
          break
        case 'blast': {
          const target = part.target ?? this.primary
          add(target, part.toughness)
          for (const neighbour of this.adjacentEnemies(target)) add(neighbour, part.adjacentToughness)
          break
        }
        case 'aoe':
          for (const enemy of ids) add(enemy, part.toughness)
          break
        case 'bounce':
          for (const enemy of ids) add(enemy, part.toughness === undefined ? undefined : (part.toughness * part.hits) / ids.length)
          break
      }
    }
    return out
  }

  /** Books one enemy's damage: its HP, the attacker's and the cycle's totals, and the `damageDealt` event. */
  private recordDamage(attacker: Member, enemy: UnitId, ability: string, scaling: number, damage: number): void {
    this.enemies.takeDamage(enemy, damage)
    this.damageByMember[attacker.key]! += damage
    const cycleIndex = Math.min(this.timeline.cycle, this.setup.cycles) - 1
    this.damageByCycle[cycleIndex]! += damage
    this.timeline.bus.emit('damageDealt', {
      attacker: attacker.key,
      enemy,
      ability,
      scaling,
      damage,
      at: this.timeline.now,
      cycle: this.timeline.cycle,
    })
  }

  /**
   * An enemy has just been broken by `attacker` (K7, K7b). In order: Break DMG, the base delay, the element's
   * effect, then the `weaknessBroken` event. Returns the Break DMG.
   *
   * Break DMG is the kernel's own BREAK number for this attacker against this enemy, priced with the enemy
   * broken (the multiplier 1.0 instead of 0.9; srsim reads the enemy's toughness, now 0, when the Break DMG
   * lands). Fribbels' BREAK ability has no ATK-style multiple, so it does not go through the per-100% path.
   * IN-GAME CHECK: Break DMG at x1.0 (broken). Fribbels' own default prices its BREAK number at 0.9.
   * Damage over time (Bleed, Burn, Shock, Wind Shear, Entanglement's and Freeze's damage) is out of scope.
   *
   * Break effects are not counted as debuffs inflicted (no Crimson Knot or Slashed Dream from the Shock, no
   * "against debuffed" checks on the Imprisonment slow). IN-GAME CHECK: whether Acheron's talent counts the
   * Lightning break's Shock when her own hit breaks the enemy.
   */
  private weaknessBreak(attacker: Member, enemy: UnitId): number {
    const result = this.kernelResult(attacker, enemy)
    const breakHits = result.hits.BREAK
    if (breakHits === undefined) {
      throw new Error(
        `The kernel has no BREAK ability for ${attacker.key}, so its Break DMG cannot be priced (it has: ${Object.keys(result.hits).join(', ')})`,
      )
    }
    const damage = breakHits.reduce((sum, hit) => sum + hit.damage, 0)
    this.recordDamage(attacker, enemy, 'BREAK', 0, damage)

    const be = result.stats.BE
    this.timeline.delay(enemy, BREAK_BASE_DELAY)
    const element = attacker.kit.element
    switch (element) {
      case 'Quantum':
        this.timeline.delay(enemy, ENTANGLEMENT_DELAY * (1 + be))
        break
      case 'Imaginary':
        this.timeline.delay(enemy, IMPRISONMENT_DELAY * (1 + be))
        this.timeline.modifiers.apply({
          id: 'break.imprisonment',
          target: enemy,
          source: attacker.key,
          spdPct: -IMPRISONMENT_SLOW,
          duration: { turns: 1, tick: 'turnEnd' },
        })
        break
      case 'Ice':
        this.enemies.freeze(enemy)
        break
      default:
        break
    }
    this.timeline.bus.emit('weaknessBroken', {
      enemy,
      attacker: attacker.key,
      element,
      at: this.timeline.now,
      cycle: this.timeline.cycle,
    })
    return damage
  }

  /**
   * An enemy's max HP and current HP. Current HP is below 0 once the enemy has taken more than its
   * max, because enemies do not die (S6, K10). Stops with an error if the profile has no HP.
   */
  enemyHp(enemy: UnitId): { current: number, max: number } {
    return { current: this.enemies.hp(enemy), max: this.enemies.maxHp(enemy) }
  }

  /**
   * The enemy among `candidates` with the highest current HP (K10), for effects that say "the enemy with the
   * highest HP". Enemies within `HP_TIE` of the top are tied. A tie goes to the primary target if it is among
   * the tied, else to the first in standing order.
   *
   * KNOWN APPROXIMATION, undecided (DESIGN.md, "Known approximations"): the game does not say how a tie
   * without the primary is broken. That choice changes damage once the tied enemies can differ, so it is
   * guarded: when the primary is not among the tied, the hit that `pricing` names is priced per unit multiple
   * against each tied enemy, the way `attack` prices it, and if the prices differ by more than `PRICE_TIE`
   * a warning is recorded (once per attacker, ability, hit and tied set, with a count) in `BattleResult.warnings`.
   * When the primary is tied, or nothing is tied, the rule is decided and nothing is priced.
   */
  highestHpAmong(candidates: readonly UnitId[], pricing: HitPricing): UnitId {
    if (candidates.length === 0) throw new Error('highestHpAmong needs at least one candidate')
    const standing = this.enemies.ids
    const ordered = [...candidates].sort((a, b) => standing.indexOf(a) - standing.indexOf(b))
    const hp = ordered.map((enemy) => this.enemies.hp(enemy))
    const top = Math.max(...hp)
    const tied = ordered.filter((_, i) => top - hp[i]! <= HP_TIE * Math.max(1, Math.abs(top)))
    if (tied.includes(this.primary)) return this.primary
    const chosen = tied[0]!
    if (tied.length > 1) this.guardTie(tied, chosen, pricing)
    return chosen
  }

  private guardTie(tied: UnitId[], chosen: UnitId, pricing: HitPricing): void {
    const attacker = this.member(pricing.attacker)
    const prices = tied.map((enemy) =>
      this.damagePerUnitScaling(attacker, pricing.ability, pricing.hit, this.abilityHits(attacker, pricing.ability, enemy)),
    )
    const lo = Math.min(...prices)
    const hi = Math.max(...prices)
    if (hi - lo <= PRICE_TIE * Math.max(Math.abs(hi), Math.abs(lo))) return
    const key = [pricing.attacker, pricing.ability, pricing.hit, ...tied].join('|')
    const seen = this.tieRecords.get(key)
    if (seen) {
      seen.count += 1
      return
    }
    this.tieRecords.set(key, { pricing, tied, prices, chosen, at: this.timeline.now, cycle: this.timeline.cycle, count: 1 })
  }

  private tieWarnings(): RunWarning[] {
    return [...this.tieRecords.values()].map((r): RunWarning => {
      const prices = r.tied.map((enemy, i) => `${enemy} ${r.prices[i]!.toPrecision(7)}`).join(', ')
      const message = (
        `Undecided "highest HP" tie: ${r.pricing.attacker}'s ${r.pricing.ability} hit ${r.pricing.hit} had the enemies ` +
        `${r.tied.join(', ')} tied for the highest HP, the primary target not among them, and they price it differently ` +
        `(damage per 100% of the scaling stat: ${prices}). It went to ${r.chosen} (first in standing order); the game does ` +
        `not say how such a tie is broken, so this choice changes damage. First at AV ${r.at.toFixed(1)}, cycle ${r.cycle}; ` +
        `${r.count} time${r.count === 1 ? '' : 's'} in this battle. See DESIGN.md, "Known approximations".`
      )
      return { severity: 'warning', code: 'undecided-tie', message }
    })
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
      warnings: this.tieWarnings(),
    }
  }

  private takeTurn(turn: TurnInfo): void {
    if (this.enemies.has(turn.unit)) {
      this.enemies.takeTurn(turn)
      this.ultimateWindow()
      return
    }
    const summon = this.summonMap.get(turn.unit)
    if (summon) {
      // The owner's kit runs it; no policy rule is read for a summon.
      this.ultimateWindow()
      if (this.summonMap.has(summon.id)) summon.takeTurn(turn)
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
    return this.hitsOf(attacker, ability, this.kernelResult(attacker, enemy))
  }

  /** What the kernel says for the attacker against one enemy, in the enemy's current state (cached by request). */
  private kernelResult(attacker: Member, enemy: UnitId): DamageResult {
    const state = attacker.instance.attackerState(enemy)
    const gear = attackerEquipmentState(attacker.equipmentInstances, enemy, attacker.key)
    // Injected buffs (K15a): the attacker's own, then each teammate's that are aimed at the team. A teammate's
    // 'self' buff changes only that teammate, so it does not reach the attacker's damage.
    const injectedBuffs: InjectedBuff[] = [...(state.injectedBuffs ?? [])]
    const teammates: KernelTeammate[] = this.members
      .filter((m) => m !== attacker)
      .map((m) => {
        const own = m.instance.teammateState(attacker, enemy)
        injectedBuffs.push(...(own.injectedBuffs ?? []).filter((b) => b.target === 'team'))
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
      ...(injectedBuffs.length > 0 && { injectedBuffs }),
      enemy: {
        count: enemyCount,
        level: profile.level,
        maxToughness: profile.toughness,
        resistance: profile.res,
        elementalWeak: weaknesses === 'all' || weaknesses.includes(attacker.kit.element),
        weaknessBroken: this.enemies.isBroken(enemy),
      },
    }
    const key = JSON.stringify(request)
    let result = this.kernelCache.get(key)
    if (!result) {
      result = this.setup.kernel.actionDamage(request)
      this.kernelCache.set(key, result)
      this.kernelCalls += 1
    }
    return result
  }

  private hitsOf(attacker: Member, ability: string, result: DamageResult): HitResult[] {
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
