import type { EngineEvents, TurnInfo, UnitId } from '../engine/events'
import type { EquipmentInstance, MemberEquipment } from '../equipment/equipment'
import { attackerEquipmentState, createEquipment, teammateEquipmentState } from '../equipment/equipment'
import type { Modifier, ModifierSpec } from '../engine/modifiers'
import { CHANCE_EPSILON } from '../engine/modifiers'
import { Timeline } from '../engine/timeline'
import type { EnemyProfile } from '../enemy/profile'
import type { CombatStats, DamageKernel, DamageRequest, DamageResult, ExtraHit, HitResult, InjectedBuff, KernelBuild, KernelTeammate, KernelUnit } from '../kernel/types'
import type { Kit, KitInstance } from '../kits/kit'
import type { LevelView } from '../levels/levels'
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

/** The shared Imprisoned state (K24): a break's Imprisonment, Welt's Ultimate and technique all apply this one modifier. */
export const IMPRISONED = 'status.imprisoned'
/** Entanglement (a Quantum break), a debuff for 1 turn while it lasts (K24). */
export const ENTANGLED = 'status.entangled'
/** Freeze (an Ice break), a debuff until the frozen enemy's skipped turn ends (K24). */
export const FROZEN = 'status.frozen'

/** A presence probability counts as certain at this distance from 1. Inside a priced world every read is exactly 0 or 1. */
export const CERTAIN = 1 - 1e-9

/** Whether a probability from `Battle.presence`, `debuffChance` or `anyPresent` is a certainty (for a kernel switch built in a priced world). */
export function certain(probability: number): boolean {
  return probability >= CERTAIN
}

/** The expected value of `min(cap, N)` for a count N with `distribution` (`Battle.debuffCountDistribution`). */
export function expectedCapped(distribution: readonly number[], cap: number): number {
  return distribution.reduce((sum, p, k) => sum + p * Math.min(cap, k), 0)
}

/** More uncertain modifiers than this around one enemy make the debuff states too many to enumerate (2^n). */
export const MAX_UNCERTAIN_MODIFIERS = 14

/** Fribbels' id for Cyrene: its `cyreneActionExists` looks for this character in the request's team. */
export const CYRENE_KERNEL_ID = '1415'

/** Cyrene's ally-specific memosprite-skill effect on one ally (`Battle.cyreneEffect`). */
export interface CyreneEffect {
  /** Fribbels' `cyreneSpecialEffect` switch for the ally. */
  active: boolean
  /** Cyrene is E3 or above: the skill's Lv+1 values (Fribbels' `cyreneSpecialEffectEidolonUpgraded`). */
  upgraded: boolean
}

const worldKey = (modifier: Modifier): string => `${modifier.target}\u0000${modifier.id}`

export interface MemberSetup {
  /** The member's key from the scenario. Doubles as its unit id. */
  key: string
  kit: Kit
  eidolon: number
  affinitiveEidolon: boolean
  /**
   * The member's ability levels and traces (K15) with the character's level table, for a kit that models them. Left out (tests,
   * hand-built setups): everything at maximum, which a kit reads through `levelsOf`.
   */
  levels?: LevelView
  /**
   * Whether this member uses their technique before the battle (K31). Left out, `BattleSetup.start.techniques` decides, which is
   * the default for every member; a scenario run always sets it from the member's resolved `technique`.
   */
  technique?: boolean
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

/**
 * Memosprites whose default is untargetable (DESIGN.md K6, second kind). The key is `MemospriteSpec.name`.
 * - netherwing: settled by Smitty (2026-11-14): enemies cannot target it; its in-game status is "Backup" (tooltip, 2026-11-15).
 *   It has real HP (it bears HP loss for allies).
 * - summer_songbirds: NOT in the set. Settled by Smitty (2026-11-15): no Backup / Out-of-Bounds tag, and a boss's "Target
 *   Locked On" and two enemy DoTs were on them in Memory of Chaos. The 2026-11-14 note ("cannot be targeted") was wrong.
 * - little_ica: NOT in the set. Settled by Smitty (2026-11-15, seen in Memory of Chaos): enemies target Little Ica and hit
 *   it (hsr-simulator marks it "backup", untargetable; that is wrong).
 * - demiurge: its own text says it "is considered as Out-of-Bounds" while on the field, and it has no SPD; untargetable.
 * A kit overrides it per memosprite with `MemospriteSpec.targetable`, and `Battle.setMemospriteTargetable` switches it later.
 */
export const UNTARGETABLE_MEMOSPRITES: Set<string> = new Set(['netherwing', 'demiurge'])

/**
 * A memosprite (DESIGN.md, K6, second kind): a party member with its own HP and aggro, and, when it has SPD, a unit on the
 * timeline. Its turn is run by the owner's kit through `takeTurn`, never by the policy. What it deals is priced as the owner's
 * ability: the kit calls `performAction(spec.id, ...)` (the log's actor is the memosprite, with the owner recorded) and
 * `attack({ attacker: owner, ability: 'MEMO_SKILL', ... })`, so the kernel prices it with the owner's stats and the damage is
 * credited to the owner. The Ultimate window opens before and after its turn as around an ally's. It leaves when its HP reaches
 * 0 (`memospriteRemoved` with reason 'hp'; it is not a downed character), when its owner is downed, or when the kit calls
 * `removeMemosprite`.
 *
 * With no `baseSpd` it is not on the timeline and acts only through extra turns its owner grants (`Battle.grantExtraTurn`):
 * Little Ica, Cyrene's Demiurge.
 */
export interface MemospriteSpec {
  /** Its unit id; collides with nothing. Convention: `${owner}.${name}`. */
  id: UnitId
  /** The member that owns it, by key. */
  owner: string
  /** Which memosprite it is, for the targetability default (`UNTARGETABLE_MEMOSPRITES`): 'netherwing', 'little_ica', ... */
  name: string
  /** Max HP, as the owner's kit computes it from the owner's stats. */
  maxHp: number
  /** Starting HP. Defaults to max HP. */
  hp?: number
  /** Defaults to the owner's DEF. */
  def?: number
  /** In BASE_AGGRO points: the game data's memosprite Aggro over 25 (Netherwing's 100 is 4). */
  baseAggro: number
  /** SPD that percentage buffs scale from. Leave out for a memosprite that is not on the timeline (acts only on extra turns). */
  baseSpd?: number
  spdPct?: number
  spdFlat?: number
  /** Starting gauge. Defaults to a full gauge. */
  gauge?: number
  /**
   * Put it on the timeline suspended (`Timeline.suspend`): it has its gauge but no place in the order until the kit calls
   * `timeline.resume(id)`. Needs `baseSpd`. For a memosprite that only joins the Action Order later (Summer Songbirds: in Fever).
   */
  suspended?: boolean
  /** Whether enemies can choose it. Defaults from `UNTARGETABLE_MEMOSPRITES` by `name`. */
  targetable?: boolean
  /** Position in the line (blasts); defaults to just after its owner (owner index + 0.5). */
  position?: number
  /** Runs its turn: a regular one when it has SPD, or an extra one. Called with the gauge already refilled, like an ally's turn. */
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
  /**
   * The part is Additional DMG (Welt's Talent, Tribbie's Zone, Dan Heng PT's Bondmate hits, ...): damage that rides on
   * an attack or follows it but is not itself an attack. Listeners that react to "an ally attacked" skip these parts.
   * It changes no number: the damage is whatever kernel hit the part names.
   */
  additional?: boolean
  /**
   * A multiplier on this part's `scaling` that depends on the debuff state (K22), read once in each state ("world") the
   * enemy's debuffs can be in, with `Battle.presence`, `debuffCount` and the like returning exact 0 / 1 values there. The
   * part deals `scaling x weight` priced in that state, and the states are averaged by their probabilities. Use it for a
   * part that exists only in some states or scales with something random: Welt's Talent hit only against a Slowed enemy
   * (weight 1 or 0), Silver Wolf's E4 hit at 20% per debuff (weight min(5, debuffs)). That prices the hit in the state that
   * triggers it, which a plain `scaling` times a chance (the price averaged over all states) does not. The recorded
   * `damageDealt.scaling` is `scaling` times the mean weight. Must not ask the kernel.
   */
  worldWeight?: () => number
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
  /**
   * Damage that belongs to no logged action: booked with no action in progress and no `actionUsed` being answered (a Technique at
   * battle start, a reaction to an enemy's turn). `actions[].damage` summed plus this equals `totalDamage` (K35).
   */
  unattributedDamage: number
  /** Every ally action in order. */
  actions: EngineEvents['actionUsed'][]
  /** Allies that were downed. Non-empty fails the "no downed characters" objective. */
  downed: string[]
  /** The same allies as `downed`, in the same order, with the action value and cycle they were downed at. */
  downedAt: { member: string, at: number, cycle: number }[]
  /**
   * Damage per member and ability name, as `damageDealt.ability` names it (Break DMG and flat amounts included; a memosprite's
   * damage is under its owner). Every member of the team has an entry, possibly empty. Sums to `damageByMember`.
   */
  damageByAbility: Record<string, Record<string, number>>
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
  at: number
  cycle: number
  skillPointsBefore: number
  /** Damage booked while this was the innermost action in progress. */
  damage: number
  enemiesHit: Set<UnitId>
  debuffed: Set<UnitId>
  /** Per enemy, the probability that NO part of the action so far hit it (K17). Absent: not hit. */
  miss: Map<UnitId, number>
  /** Per enemy, the probability that NO debuff has landed on it so far in the action (K22). Absent: none applied. */
  debuffMiss: Map<UnitId, number>
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
  /**
   * The logged action whose `actionUsed` listeners are running: damage booked now, outside any action of its own, is a reaction
   * to it and is added to its `damage` (K35). Cleared inside a nested action's body, which books its own damage.
   */
  private reactingTo: { damage: number } | undefined
  /** Damage booked with no action in progress and no `actionUsed` being answered (battle start, enemy turns). */
  private unattributed = 0
  private readonly kernelCache = new Map<string, DamageResult>()
  private kernelCalls = 0
  private readonly damageByCycle: number[]
  private readonly damageByMember: Record<string, number> = {}
  private readonly actionLog: EngineEvents['actionUsed'][] = []
  private readonly downed: string[] = []
  private readonly downedAt: { member: string, at: number, cycle: number }[] = []
  private readonly damageByAbility: Record<string, Record<string, number>> = {}
  private readonly tieRecords = new Map<string, TieRecord>()
  private readonly summonMap = new Map<UnitId, SummonSpec>()
  /** Cyrene's effect per ally (`cyreneEffect`, `setCyreneEffect`). */
  private readonly cyreneEffects = new Map<string, { active: boolean, source: string }>()
  private readonly memospriteMap = new Map<UnitId, MemospriteSpec>()
  /** True while `kernelResult` is collecting the kits' and modules' state: the kernel must not be asked from there. */
  private collectingState = false
  /**
   * The debuff state ("world") being priced: the keys of the uncertain modifiers (presence below 1) that are present in
   * it. Set only while `kernelResult` collects state; undefined means reads give probabilities.
   */
  private world: ReadonlySet<string> | undefined

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
      this.damageByAbility[m.key] = {}
    })
    this.enemies = new Enemies(this.timeline, this.party, setup.profile, setup.enemyCount)
    this.primary = this.enemies.ids[Math.floor(setup.enemyCount / 2)]!
    removeDownedFromTimeline(this.timeline)
    this.timeline.bus.on('unitDowned', (e) => {
      this.downed.push(e.unit)
      this.downedAt.push({ member: e.unit, at: e.at, cycle: this.timeline.cycle })
      // A summon leaves with its owner (Lightning-Lord's text: "when Jing Yuan is knocked down ... disappear").
      for (const summon of [...this.summonMap.values()]) if (summon.owner === e.unit) this.removeSummon(summon.id)
      // A memosprite leaves with its owner. IN-GAME CHECK: assumed, as for the summon.
      for (const memosprite of [...this.memospriteMap.values()]) if (memosprite.owner === e.unit) this.removeMemosprite(memosprite.id, 'ownerDowned')
    })
    // A memosprite at 0 HP is removed, and it is not a downed character (the objective is about characters).
    // Low priority: other listeners (a kit's Newbud, a relic) see the defeated memosprite before it is taken off the field.
    this.timeline.bus.on('memospriteDefeated', (e) => this.removeMemosprite(e.unit, 'hp'), { priority: -100 })

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

  /**
   * Puts a memosprite on the field (see `MemospriteSpec`): a party member, and a timeline unit when it has SPD. A kit calls it
   * when its ability summons one, and again for each new summoning (a removed id may be added again). Emits `memospriteAdded`.
   */
  addMemosprite(spec: MemospriteSpec): void {
    const owner = this.members.find((m) => m.key === spec.owner)
    if (!owner) throw new Error(`Memosprite ${spec.id}: no member "${spec.owner}" to own it`)
    if (this.party.get(spec.owner).downed) throw new Error(`Memosprite ${spec.id}: its owner ${spec.owner} is downed`)
    if (this.memospriteMap.has(spec.id) || this.summonMap.has(spec.id) || this.timeline.has(spec.id) || this.party.has(spec.id)) {
      throw new Error(`Memosprite ${spec.id}: that unit is already on the field`)
    }
    if (spec.suspended && spec.baseSpd === undefined) {
      throw new Error(`Memosprite ${spec.id}: suspended needs a baseSpd (it is not on the timeline)`)
    }
    this.party.add({
      id: spec.id,
      kind: 'memosprite',
      maxHp: spec.maxHp,
      def: spec.def ?? this.party.get(spec.owner).def,
      baseAggro: spec.baseAggro,
      position: spec.position ?? owner.index + 0.5,
      targetable: spec.targetable ?? !UNTARGETABLE_MEMOSPRITES.has(spec.name),
      ...(spec.hp !== undefined && { hp: spec.hp }),
    })
    this.memospriteMap.set(spec.id, spec)
    if (spec.baseSpd !== undefined) {
      this.timeline.addUnit({
        id: spec.id,
        baseSpd: spec.baseSpd,
        ...(spec.spdPct !== undefined && { spdPct: spec.spdPct }),
        ...(spec.spdFlat !== undefined && { spdFlat: spec.spdFlat }),
        ...(spec.gauge !== undefined && { gauge: spec.gauge }),
      })
      if (spec.suspended) this.timeline.suspend(spec.id)
    }
    this.timeline.bus.emit('memospriteAdded', { unit: spec.id, owner: spec.owner, at: this.timeline.now })
  }

  /** Takes a memosprite off the field and drops its modifiers, redirect and backup rules and queued extra turns. One that is already gone is ignored. */
  removeMemosprite(id: UnitId, reason: EngineEvents['memospriteRemoved']['reason'] = 'removed'): void {
    const spec = this.memospriteMap.get(id)
    if (!spec) return
    this.memospriteMap.delete(id)
    if (this.timeline.has(id)) this.timeline.removeUnit(id)
    else {
      this.timeline.cancelExtraTurns(id)
      this.timeline.modifiers.removeAllOn(id)
    }
    if (this.party.has(id)) this.party.remove(id)
    this.timeline.bus.emit('memospriteRemoved', { unit: id, owner: spec.owner, reason, at: this.timeline.now })
  }

  /** Whether enemies can choose the memosprite from now on (the per-memosprite switch; see `UNTARGETABLE_MEMOSPRITES`). */
  setMemospriteTargetable(id: UnitId, targetable: boolean): void {
    if (!this.memospriteMap.has(id)) throw new Error(`${id} is not a memosprite on the field`)
    this.party.setTargetable(id, targetable)
  }

  isMemosprite(id: UnitId): boolean {
    return this.memospriteMap.has(id)
  }

  /** The member key that owns a member (itself), a summon or a memosprite; undefined for anything else. */
  ownerOf(id: UnitId): string | undefined {
    if (this.members.some((m) => m.key === id)) return id
    return this.summonMap.get(id)?.owner ?? this.memospriteMap.get(id)?.owner
  }

  /** The ids of the memosprites on the field that `owner` owns. Read-only. */
  memospritesOf(owner: string): UnitId[] {
    return [...this.memospriteMap.values()].filter((s) => s.owner === owner).map((s) => s.id)
  }

  /**
   * Gives a unit (a member, a summon or a memosprite) an extra turn: taken right after the action in progress resolves, with
   * the Ultimate window around it like any turn, and without touching its gauge. For a memosprite with no SPD it is the only
   * way it acts. Several grants queue in order. A unit that has left the field by then does not take it.
   */
  grantExtraTurn(unit: UnitId): void {
    if (!this.isAlly(unit) && !this.summonMap.has(unit)) throw new Error(`Extra turn for ${unit}: not an ally, memosprite or summon`)
    this.timeline.grantExtraTurn(unit)
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

  /**
   * A character or a memosprite: anything on the allied side that "ally targets" covers. Summons are not (Lightning-Lord is
   * not an ally). Use `isCharacter` where only the party's characters qualify.
   */
  isAlly(id: UnitId): boolean {
    return this.members.some((m) => m.key === id) || this.memospriteMap.has(id)
  }

  /** A party character (a member of the scenario), not a memosprite or a summon. */
  isCharacter(id: UnitId): boolean {
    return this.members.some((m) => m.key === id)
  }

  /** The enemies standing next to this one. */
  adjacentEnemies(enemy: UnitId): UnitId[] {
    const i = this.enemies.ids.indexOf(enemy)
    if (i < 0) throw new Error(`${enemy} is not an enemy`)
    return [this.enemies.ids[i - 1], this.enemies.ids[i + 1]].filter((x): x is UnitId => x !== undefined)
  }

  /**
   * The member's in-combat stats as the kernel reports them for that member as the attacker against the primary enemy,
   * in the state it is in now: ATK, HP, DEF, SPD, CRIT Rate (`CR`), CRIT DMG (`CD`), Effect RES (`RES`), Break Effect
   * (`BE`) and the rest of `CombatStats`. It reads the same cached kernel result that `attack` prices with, so the
   * numbers a kit sizes a shield or a buff from are the numbers the damage uses. Returns a copy.
   *
   * RECURSION HAZARD: building that result asks every kit's `attackerState` and `teammateState` (and every equipment
   * module's state) for the member. A kit must therefore not call this from its own `attackerState` or `teammateState`:
   * those run while the request is being built, so the call would need the request it is part of. The battle detects
   * it and throws a clear error instead of looping. Call it from actions and event listeners.
   *
   * Fribbels fills its stats once per action and the kernel reports them after the last default action, so a stat that
   * only some action's conditionals change reflects the last one. For ATK, HP, DEF, SPD and the CRIT stats that is the
   * attacker's own state either way.
   */
  combatStats(member: string): CombatStats {
    return { ...this.kernelResult(this.member(member), this.primary).stats }
  }

  /**
   * Where the extra hit `id` (an `ExtraHit` a teammate's `teammateState` gives `attacker`, K23) stands in the kernel's
   * 'EXTRA' hit list for `attacker`, for a part's `hit`. Stops with an error when no teammate gives that hit now.
   */
  extraHitIndex(attacker: string, id: string, enemy: UnitId = this.primary): number {
    const index = this.collectExtraHits(this.member(attacker), enemy).findIndex((hit) => hit.id === id)
    if (index < 0) throw new Error(`No extra hit "${id}" for ${attacker}: no teammate's teammateState gives it in the current state`)
    return index
  }

  /**
   * What one heal hit of `healer`'s heals for, as the kernel prices it now: the amount for ONE target, with the healer's
   * live stats (Max HP, ATK, DEF), Outgoing Healing Boost (relics, light cones, set effects, buffs) and heal boosts
   * in it. `ability` and `hit` name the kernel's heal hit the way `attack` names a damage hit: Fribbels' ability kinds
   * ('SKILL_HEAL', 'ULT_HEAL', 'TALENT_HEAL', ...) and the hit's position in that ability's list. The kit applies the amount
   * itself, to whoever the text says, with `party.heal(target, amount, source)`.
   *
   * A heal hit has no ATK/HP/DEF multiple in the result (`HitResult.scaling` is undefined for it, K11), so it is never priced per
   * 100%; the hit's `damage` field IS the healed amount (`HitResult.output === 'HEAL'`). Stops with an error when the named hit is
   * not a heal hit, so a damage hit is never read as a heal.
   *
   * Same recursion rule as `combatStats`: call it from actions and listeners, never from `attackerState` or `teammateState`.
   */
  healAmount(healer: string, ability: string, hit = 0, enemy: UnitId = this.primary): number {
    const member = this.member(healer)
    const hits = this.abilityHits(member, ability, enemy)
    const found = hits[hit]
    if (found === undefined) {
      throw new Error(`${healer}'s ${ability} has no hit ${hit} in the kernel's answer (it has ${hits.length}); a heal is read with Battle.healAmount(healer, ability, hit)`)
    }
    if (found.output !== 'HEAL') {
      throw new Error(`${healer}'s ${ability} hit ${hit} is not a heal hit in the kernel's answer (output: ${found.output ?? 'damage'}), so Battle.healAmount cannot read it`)
    }
    return found.damage
  }

  // ---------------------------------------------------------------- Cyrene's ally-specific effects

  /**
   * What Cyrene's memosprite skill "This Ode, to All Lives" family has done to `ally`, for the ally's kit to read (default: off).
   * Fribbels keeps each ally-specific effect inside that ally's own conditionals behind a switch named `cyreneSpecialEffect`, and
   * a second fact, whether Cyrene is at E3 or above (`upgraded`: the skill's Lv+1 values), which it reads from Cyrene's own request
   * entry. A kit that has such an effect passes `active` as that switch (`attackerState` or `teammateState`, whichever Fribbels
   * reads it in) and applies the effect's attack multiplier itself where Fribbels does not price it. `upgraded` is for the values a kit
   * supplies itself (Fribbels' own switch already picks its numbers from Cyrene's eidolon).
   *
   * Reads only the battle's own state, so it is safe to call from `attackerState` and `teammateState`.
   */
  cyreneEffect(ally: string): CyreneEffect {
    const entry = this.cyreneEffects.get(ally)
    if (entry === undefined || !entry.active) return { active: false, upgraded: false }
    return { active: true, upgraded: this.member(entry.source).eidolon >= 3 }
  }

  /**
   * Turns Cyrene's effect on `ally` on or off. For a Cyrene kit (`source` is her member key). Fribbels' effects only
   * exist while a Cyrene is in the request's team (`cyreneActionExists`), so `source` must be a member whose kernel character is
   * Cyrene (1415) and the ally another member: anything else would switch the effect on in the kit while Fribbels leaves it out.
   */
  setCyreneEffect(ally: string, active: boolean, source: string): void {
    const cyrene = this.member(source)
    if (cyrene.kernel.unit.characterId !== CYRENE_KERNEL_ID) {
      throw new Error(`setCyreneEffect: ${source} is not Cyrene (kernel character ${cyrene.kernel.unit.characterId}, expected ${CYRENE_KERNEL_ID}), and Fribbels only has the effect for a Cyrene in the team`)
    }
    if (ally === source) throw new Error(`setCyreneEffect: Cyrene's effect is on a teammate, not on ${source} itself`)
    this.member(ally)
    this.cyreneEffects.set(ally, { active, source })
  }

  /**
   * Wraps one Basic ATK, Skill, Ultimate or follow-up. Everything the body does counts as that one
   * action; `actionUsed` is emitted when it has fully resolved.
   */
  performAction(actor: string, action: string, kind: EngineEvents['actionUsed']['kind'], body: () => void): void {
    const outer = this.current
    const mine: ActionInProgress = {
      serial: ++this.actionSerial,
      at: this.timeline.now,
      cycle: this.timeline.cycle,
      skillPointsBefore: this.skillPointCount,
      damage: 0,
      enemiesHit: new Set(),
      debuffed: new Set(),
      miss: new Map(),
      debuffMiss: new Map(),
    }
    const outerReaction = this.reactingTo
    this.current = mine
    this.reactingTo = undefined
    try {
      body()
    } finally {
      this.current = outer
      this.reactingTo = outerReaction
    }
    const hitChance: Record<UnitId, number> = {}
    let expectedEnemiesHit = 0
    for (const enemy of mine.enemiesHit) {
      const chance = Math.min(1, Math.max(0, 1 - (mine.miss.get(enemy) ?? 0)))
      hitChance[enemy] = chance
      expectedEnemiesHit += chance
    }
    const debuffChance: Record<UnitId, number> = {}
    for (const enemy of mine.debuffed) debuffChance[enemy] = Math.min(1, Math.max(0, 1 - (mine.debuffMiss.get(enemy) ?? 1)))
    const owner = this.memospriteMap.get(actor)?.owner
    const event = {
      actor,
      ...(owner !== undefined && { owner }),
      action,
      kind,
      serial: mine.serial,
      at: mine.at,
      cycle: mine.cycle,
      damage: mine.damage,
      skillPointsBefore: mine.skillPointsBefore,
      skillPointsAfter: this.skillPointCount,
      enemiesHit: [...mine.enemiesHit],
      hitChance,
      expectedEnemiesHit,
      debuffed: [...mine.debuffed],
      debuffChance,
    }
    this.actionLog.push(event)
    // K35: damage the listeners book in reaction (Tribbie's Zone, a follow-up's own reactions) is credited to this action. A
    // reaction to a reaction books while this is still set, so it lands here too. A listener that performs an action of its own
    // clears it for that body (above) and gets its own line.
    this.reactingTo = event
    try {
      this.timeline.bus.emit('actionUsed', event)
    } finally {
      this.reactingTo = outerReaction
    }
  }

  /**
   * Puts a debuff on an enemy and records it against the action in progress. `spec.chance` (default 1) is the
   * probability the debuff landed on this enemy (K22): a random-target hit applies it with the chance it hit there. The
   * action's `debuffChance` for the enemy combines the action's applications as independent ones.
   */
  applyDebuff(spec: Omit<ModifierSpec, 'debuff'>): void {
    if (!this.enemies.has(spec.target)) throw new Error(`${spec.target} is not an enemy`)
    const chance = spec.chance ?? 1
    if (chance <= CHANCE_EPSILON) return
    this.timeline.modifiers.apply({ ...spec, debuff: true })
    this.recordDebuffLanding(spec.target, chance)
  }

  /**
   * One random debuff from a list ("1 random Bug": ATK, DEF or SPD), all on one enemy. Each option is present with the
   * chance `landing / options.length` (K22); the application counts once in the action's `debuffChance`, at `landing`
   * (the chance the application happened at all: 1 for an attack that always hits the enemy). The options are applied
   * as independent modifiers, not as mutually exclusive ones (DESIGN.md, K22): their expected count is exact, the chance
   * that at least one is present is not (3 options at 1/3 each give 1 - (2/3)^3 = 0.70 where one is surely there).
   * `optionChance` replaces the per-option presence (`landing / options.length`) for a caller that has already accounted
   * for earlier applications of the same draw (Silver Wolf's E2, one Bug per enemy per action over several attack calls).
   */
  applyRandomDebuff(
    options: ReadonlyArray<Omit<ModifierSpec, 'debuff' | 'chance'>>,
    landing = 1,
    optionChance = landing / options.length,
  ): void {
    const first = options[0]
    if (first === undefined) throw new Error('applyRandomDebuff needs at least one option')
    if (options.some((o) => o.target !== first.target)) throw new Error('applyRandomDebuff: every option must be on the same enemy')
    if (!this.enemies.has(first.target)) throw new Error(`${first.target} is not an enemy`)
    if (!(landing >= 0 && landing <= 1)) throw new Error(`applyRandomDebuff: landing must be in [0, 1], got ${landing}`)
    if (landing <= CHANCE_EPSILON) return
    for (const option of options) this.timeline.modifiers.apply({ ...option, debuff: true, chance: Math.min(1, optionChance) })
    this.recordDebuffLanding(first.target, landing)
  }

  private recordDebuffLanding(enemy: UnitId, chance: number): void {
    if (!this.current) return
    this.current.debuffed.add(enemy)
    this.current.debuffMiss.set(enemy, (this.current.debuffMiss.get(enemy) ?? 1) * (1 - Math.min(1, chance)))
  }

  /**
   * Imprisons an enemy (DESIGN.md, K24): the one shared Imprisoned state, whoever imprisons (a break, Welt's Ultimate or
   * technique). It is a debuff for 1 turn with the Imprisonment SPD cut; applying it again refreshes it and never stacks
   * the SPD cut. The delay stays separate, as the text says for each source: it is applied every time.
   * `inflicted` is whether this counts as a debuff an ability inflicted during the action in progress (an ability's own
   * Imprison does; a Weakness Break's does not, see `weaknessBreak`).
   */
  imprison(enemy: UnitId, source: UnitId, delay: number, inflicted: boolean): void {
    const spec = { id: IMPRISONED, target: enemy, source, spdPct: -IMPRISONMENT_SLOW, duration: { turns: 1, tick: 'turnEnd' } as const }
    if (inflicted) this.applyDebuff(spec)
    else this.timeline.modifiers.apply({ ...spec, debuff: true })
    this.timeline.delay(enemy, delay)
  }

  // ---- debuff state: probabilities, and certain facts inside a priced world (see `kernelResult`)

  private chanceOf(modifier: Modifier): number {
    if (this.world === undefined || modifier.chance >= 1) return modifier.chance
    return this.world.has(worldKey(modifier)) ? 1 : 0
  }

  /**
   * The probability that modifier `id` is on `unit` (K22): its chance, or 0 when it is not there. While the battle is
   * building a kernel request (inside a kit's or module's `attackerState` / `teammateState`) the debuff states are
   * enumerated one at a time and this returns exactly 0 or 1, so a kernel switch is `certain(battle.presence(...))`.
   */
  presence(unit: UnitId, id: string): number {
    const modifier = this.timeline.modifiers.get(unit, id)
    return modifier === undefined ? 0 : this.chanceOf(modifier)
  }

  /** The probability that at least one modifier on `unit` that `matches` is present (independent modifiers). Exactly 0 or 1 in a priced world. */
  anyPresent(unit: UnitId, matches: (modifier: Modifier) => boolean): number {
    let none = 1
    for (const modifier of this.timeline.modifiers.on(unit)) if (matches(modifier)) none *= 1 - this.chanceOf(modifier)
    return none <= CHANCE_EPSILON ? 1 : 1 - none
  }

  /** The probability that an enemy has at least one debuff, from any source (K22). Exactly 0 or 1 in a priced world. */
  debuffChance(enemy: UnitId): number {
    return this.anyPresent(enemy, (m) => m.debuff)
  }

  /** The expected number of debuffs an enemy has, from any source (K22). A whole number in a priced world. */
  debuffCount(enemy: UnitId): number {
    let count = 0
    for (const modifier of this.timeline.modifiers.on(enemy)) if (modifier.debuff) count += this.chanceOf(modifier)
    return count
  }

  /**
   * The distribution of an enemy's debuff count: `result[k]` is the probability of exactly k debuffs, k = 0 to the
   * number of debuff modifiers on it (independent presences, so a Poisson-binomial). For a cap on a count whose
   * expectation is not the cap of the expectation (`expectedCapped`). Not for use inside a priced world.
   */
  debuffCountDistribution(enemy: UnitId): number[] {
    let distribution = [1]
    for (const modifier of this.timeline.modifiers.on(enemy)) {
      if (!modifier.debuff) continue
      const p = this.chanceOf(modifier)
      const next = new Array<number>(distribution.length + 1).fill(0)
      distribution.forEach((q, k) => {
        next[k]! += q * (1 - p)
        next[k + 1]! += q * p
      })
      distribution = next
    }
    return distribution
  }

  /** Serial of the action in progress, or undefined between actions (a bare attack). */
  get actionSerialInProgress(): number | undefined {
    return this.current?.serial
  }

  /** Deals an attack's damage. Returns the total across all enemies. */
  attack(spec: AttackSpec): number {
    const attacker = this.member(spec.attacker)
    const ids = this.enemies.ids
    /** Per enemy: the multiple each kernel hit is asked for, plain and with a debuff-state weight (`HitPart.worldWeight`). */
    interface Asked { plain: number, weighted: Array<{ scaling: number, weight: () => number }> }
    const multiples = new Map<UnitId, Map<number, Asked>>()
    /** Enemies a deterministic part reaches. */
    const certain = new Set<UnitId>()
    /** Random-target groups (K17): per group, the hits it stands for and each enemy's chance per hit. */
    const randomGroups = new Map<string, { hits: number, perHit: Map<UnitId, number> }>()
    const add = (
      enemy: UnitId,
      hit: number,
      scaling: number,
      random?: { hits: number, chance: number, group?: string },
      weight?: () => number,
    ) => {
      if (!(scaling > 0)) return
      const byHit = multiples.get(enemy) ?? new Map<number, Asked>()
      const asked = byHit.get(hit) ?? { plain: 0, weighted: [] }
      if (weight === undefined) asked.plain += scaling
      else asked.weighted.push({ scaling, weight })
      byHit.set(hit, asked)
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
          add(part.target ?? this.primary, part.hit, part.scaling, part.random, part.worldWeight)
          break
        case 'blast': {
          const target = part.target ?? this.primary
          add(target, part.hit, part.scaling, part.random, part.worldWeight)
          for (const neighbour of this.adjacentEnemies(target)) add(neighbour, part.hit, part.adjacent, part.random, part.worldWeight)
          break
        }
        case 'aoe':
          for (const enemy of ids) add(enemy, part.hit, part.scaling, undefined, part.worldWeight)
          break
        case 'bounce':
          // Each of the bounce's hits lands on a given enemy with probability 1 / enemies. One group per part.
          for (const enemy of ids) {
            add(
              enemy,
              part.hit,
              (part.scaling * part.hits) / ids.length,
              { hits: part.hits, chance: 1 / ids.length, group: `bounce:${spec.parts.indexOf(part)}` },
              part.worldWeight,
            )
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
      const worlds = this.kernelWorlds(attacker, enemy)
      const result = mixWorlds(worlds)
      if (byHit !== undefined) {
        const hits = this.hitsOf(attacker, spec.ability, result)
        let scaling = 0
        let damage = 0
        for (const [index, asked] of byHit) {
          if (asked.plain > 0) {
            damage += this.damagePerUnitScaling(attacker, spec.ability, index, hits) * asked.plain
            scaling += asked.plain
          }
          for (const { scaling: multiple, weight } of asked.weighted) {
            // Priced state by state: the part's weight is read in each world, and so is the hit's own price there.
            for (const world of worlds) {
              const w = world.weight * this.readInWorld(world.present, weight)
              if (!(w > 0)) continue
              const worldHits = this.hitsOf(attacker, spec.ability, world.result)
              damage += w * multiple * this.damagePerUnitScaling(attacker, spec.ability, index, worldHits)
              scaling += w * multiple
            }
          }
        }
        total += damage
        if (this.current) {
          this.current.enemiesHit.add(enemy)
          this.current.miss.set(enemy, (this.current.miss.get(enemy) ?? 1) * missChance(enemy))
        }
        this.recordDamage(attacker, enemy, spec.ability, scaling, damage, 1 - missChance(enemy))
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
  private recordDamage(
    attacker: Member,
    enemy: UnitId,
    ability: string,
    scaling: number,
    damage: number,
    chance: number,
    kind?: 'TRUE' | 'FLAT',
  ): void {
    this.enemies.takeDamage(enemy, damage)
    this.damageByMember[attacker.key]! += damage
    const byAbility = this.damageByAbility[attacker.key]!
    byAbility[ability] = (byAbility[ability] ?? 0) + damage
    if (this.reactingTo) this.reactingTo.damage += damage
    else if (this.current) this.current.damage += damage
    else this.unattributed += damage
    const cycleIndex = Math.min(this.timeline.cycle, this.setup.cycles) - 1
    this.damageByCycle[cycleIndex]! += damage
    this.timeline.bus.emit('damageDealt', {
      attacker: attacker.key,
      enemy,
      ability,
      scaling,
      damage,
      ...(kind !== undefined && { kind }),
      chance,
      at: this.timeline.now,
      cycle: this.timeline.cycle,
    })
  }

  /**
   * Deals a stated amount of damage that the kernel does not price (Robin Summeretto's E1 True DMG, computed from a tally).
   * Booked like any hit: it lowers the enemy's HP, counts in the attacker's and the cycle's totals, and emits `damageDealt`
   * (`ability` is `label`, `scaling` 0, `chance` 1, and `kind` says it was flat so tallies of "non-True DMG" can skip it).
   * Nothing multiplies it and it takes no toughness. `attacker` is a member key; damage dealt by a summon or memosprite is
   * credited to its owner as everywhere else. Returns the amount dealt.
   */
  dealFlatDamage(spec: { attacker: string, enemy: UnitId, amount: number, kind: 'TRUE' | 'FLAT', label: string }): number {
    const attacker = this.member(spec.attacker)
    if (!this.enemies.ids.includes(spec.enemy)) throw new Error(`dealFlatDamage: "${spec.enemy}" is not an enemy`)
    if (!(spec.amount >= 0)) throw new Error(`dealFlatDamage: amount must not be negative, got ${spec.amount}`)
    if (spec.amount === 0) return 0
    this.recordDamage(attacker, spec.enemy, spec.label, 0, spec.amount, 1, spec.kind)
    return spec.amount
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
   * Break effects are debuffs while they last (K24): Entanglement (Entangled, 1 turn), Imprisonment (the shared Imprisoned
   * state, with its SPD cut) and Freeze (Frozen, until the skipped turn ends) are modifiers with `debuff: true`, so every
   * debuff count and "against debuffed" check sees them. They ARE recorded as debuffs inflicted during the action that
   * broke the enemy (`actionUsed.debuffed`), so they trigger Acheron's talent: checked in game by Smitty 2026-11-15
   * (a Quantum break by Fu Xuan's Basic ATK, which applies no debuff of its own, gave Acheron a Slashed Dream).
   * The damage-over-time break effects (Shock, Burn, Bleed, Wind Shear) are not modelled at all, not even as debuffs.
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
    this.recordDamage(attacker, enemy, 'BREAK', 0, damage, 1)

    const be = result.stats.BE
    this.timeline.delay(enemy, BREAK_BASE_DELAY)
    const element = attacker.kit.element
    switch (element) {
      case 'Quantum':
        this.timeline.delay(enemy, ENTANGLEMENT_DELAY * (1 + be))
        this.applyDebuff({
          id: ENTANGLED,
          target: enemy,
          source: attacker.key,
          duration: { turns: 1, tick: 'turnEnd' },
        })
        break
      case 'Imaginary':
        this.imprison(enemy, attacker.key, IMPRISONMENT_DELAY * (1 + be), true)
        break
      case 'Ice':
        this.enemies.freeze(enemy)
        // The frozen enemy's skipped turn is its next one; the debuff ends with it.
        this.applyDebuff({
          id: FROZEN,
          target: enemy,
          source: attacker.key,
          duration: { turns: 1, tick: 'turnEnd' },
        })
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

  /** Warnings kits raised (`warn`), one per code and member. */
  private readonly kitWarnings = new Map<string, RunWarning>()

  /**
   * Records a warning for the run result (K19), once per code and member: a later call with the same code and member replaces the
   * message (so a kit can keep a count current). No team or enemy count here: the runner in src/run adds them.
   */
  warn(warning: RunWarning): void {
    this.kitWarnings.set(`${warning.code}\u0000${warning.member ?? ''}`, warning)
  }

  // ---------------------------------------------------------------- running

  run(): BattleResult {
    for (const member of this.members) member.instance.onBattleStart?.({ techniques: member.technique ?? this.setup.start.techniques })
    this.ultimateWindow()
    this.timeline.run({ cycles: this.setup.cycles, takeTurn: (turn) => this.takeTurn(turn) })
    return {
      cycles: this.setup.cycles,
      enemyCount: this.setup.enemyCount,
      totalDamage: this.damageByCycle.reduce((a, b) => a + b, 0),
      damageByCycle: [...this.damageByCycle],
      damageByMember: { ...this.damageByMember },
      unattributedDamage: this.unattributed,
      actions: [...this.actionLog],
      downed: [...this.downed],
      downedAt: this.downedAt.map((d) => ({ ...d })),
      damageByAbility: Object.fromEntries(Object.entries(this.damageByAbility).map(([k, v]) => [k, { ...v }])),
      kernelCalls: this.kernelCalls,
      warnings: [...this.tieWarnings(), ...this.kitWarnings.values()],
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
    const memosprite = this.memospriteMap.get(turn.unit)
    if (memosprite) {
      // Run by the owner's kit, like a summon; a regular turn (it has SPD) or an extra one.
      this.ultimateWindow()
      if (this.memospriteMap.has(memosprite.id)) memosprite.takeTurn(turn)
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
    // K36: a rule whose target is downed (or not on the field) does not apply, like an unmet condition.
    if (rule.target !== undefined && !this.onField(rule.target)) return false
    const action = this.member(rule.unit).instance.actions[rule.use]!
    return action.canUse() && rule.when.every((c) => this.holds(c))
  }

  /** An enemy, or an ally that is in the party and not downed. */
  private onField(target: UnitId): boolean {
    if (this.enemies.has(target)) return true
    return this.party.has(target) && !this.party.get(target).downed
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

  /**
   * What the kernel says for the attacker against one enemy, in the enemy's current state (cached by request).
   *
   * Debuffs are present with a probability (K22). The expected damage is the weighted mean over the debuff states
   * ("worlds"): the uncertain modifiers (presence below 1) on this enemy and on the allies are taken as independent, each
   * combination of present / absent is one world with the product of its probabilities, and the kernel prices each world
   * with every debuff read as a certain fact (`presence`, `debuffCount`, `debuffChance` return 0 or 1 there). With no
   * uncertain modifier there is one world and nothing changes. A hit that exists in only some worlds (Silver Wolf's E4
   * Additional DMG needs one debuff) is the mean over the worlds that have it, and the kit scales it by the expected
   * count. Because every consumer reads the same world, two effects that depend on the same debuff stay consistent.
   */
  private kernelResult(attacker: Member, enemy: UnitId): DamageResult {
    return mixWorlds(this.kernelWorlds(attacker, enemy))
  }

  /**
   * The debuff states of `enemy` with their probabilities and the kernel's answer in each (see `kernelResult`). States
   * that price to the same request are one entry. A single entry with `present` undefined means nothing is uncertain.
   */
  private kernelWorlds(attacker: Member, enemy: UnitId): KernelWorld[] {
    const uncertain = [...this.timeline.modifiers.on(enemy), ...this.members.flatMap((m) => this.timeline.modifiers.on(m.key))].filter(
      (m) => m.chance < 1,
    )
    if (uncertain.length === 0) return [{ weight: 1, present: undefined, result: this.priceWorld(attacker, enemy, undefined) }]
    if (uncertain.length > MAX_UNCERTAIN_MODIFIERS) {
      throw new Error(
        `${uncertain.length} uncertain modifiers (presence below 1) around ${enemy} is more than the ${MAX_UNCERTAIN_MODIFIERS} the debuff states are enumerated for`,
      )
    }
    const worlds: KernelWorld[] = []
    for (let mask = 0; mask < 1 << uncertain.length; mask++) {
      let weight = 1
      const present = new Set<string>()
      uncertain.forEach((modifier, i) => {
        if (mask & (1 << i)) {
          weight *= modifier.chance
          present.add(worldKey(modifier))
        } else weight *= 1 - modifier.chance
      })
      if (weight <= 0) continue
      worlds.push({ weight, present, result: this.priceWorld(attacker, enemy, present) })
    }
    return worlds
  }

  /** Runs `read` with the debuff state `world` in force (`presence` and the like return its exact values). */
  private readInWorld<T>(world: ReadonlySet<string> | undefined, read: () => T): T {
    const before = this.world
    this.world = world
    try {
      return read()
    } finally {
      this.world = before
    }
  }

  /** The kernel's answer for the attacker against one enemy with the debuff state `world` (undefined: probabilities, see `presence`). */
  private priceWorld(attacker: Member, enemy: UnitId, world: ReadonlySet<string> | undefined): DamageResult {
    if (this.collectingState) {
      throw new Error(
        `The kernel was asked (Battle.combatStats, attack or a price) for ${attacker.key} while the battle was collecting a ` +
          "kit's or module's attackerState / teammateState for another request. A kit must not ask the kernel from its own " +
          'attackerState or teammateState: it would loop. Read it from an action or an event listener instead.',
      )
    }
    this.collectingState = true
    this.world = world
    let state: ReturnType<KitInstance['attackerState']>
    let gear: ReturnType<typeof attackerEquipmentState>
    const injectedBuffs: InjectedBuff[] = []
    const extraHits: ExtraHit[] = []
    let teammates: KernelTeammate[]
    try {
      state = attacker.instance.attackerState(enemy)
      gear = attackerEquipmentState(attacker.equipmentInstances, enemy, attacker.key)
      // Injected buffs (K15a): the attacker's own, then each teammate's that are aimed at the team. A teammate's
      // 'self' buff changes only that teammate, so it does not reach the attacker's damage. Extra hits (K23) are the
      // teammates' gifts to the attacker, merged in the same pass.
      injectedBuffs.push(...(state.injectedBuffs ?? []))
      teammates = this.members
        .filter((m) => m !== attacker)
        .map((m) => {
          const own = m.instance.teammateState(attacker, enemy)
          injectedBuffs.push(...(own.injectedBuffs ?? []).filter((b) => b.target === 'team'))
          extraHits.push(...(own.extraHits ?? []))
          const worn = teammateEquipmentState(m.equipmentInstances, attacker, enemy, m.key)
          return {
            ...m.kernel.unit,
            ...(own.characterConditionals && { characterConditionals: own.characterConditionals }),
            ...(worn.lightConeConditionals && { lightConeConditionals: worn.lightConeConditionals }),
            ...(worn.teamRelicSet !== undefined && { teamRelicSet: worn.teamRelicSet }),
            ...(worn.teamOrnamentSet !== undefined && { teamOrnamentSet: worn.teamOrnamentSet }),
          }
        })
    } finally {
      this.collectingState = false
      this.world = undefined
    }
    this.checkExtraHits(attacker, extraHits)
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
      ...(extraHits.length > 0 && { extraHits }),
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

  /** The extra hits the teammates give `attacker` against `enemy` now, in the order a request lists them (K23). */
  private collectExtraHits(attacker: Member, enemy: UnitId): ExtraHit[] {
    if (this.collectingState) {
      throw new Error("Battle.extraHitIndex was called while the battle was collecting a kit's teammateState: ask it from an action instead")
    }
    this.collectingState = true
    const extraHits: ExtraHit[] = []
    try {
      for (const m of this.members) if (m !== attacker) extraHits.push(...(m.instance.teammateState(attacker, enemy).extraHits ?? []))
    } finally {
      this.collectingState = false
    }
    this.checkExtraHits(attacker, extraHits)
    return extraHits
  }

  private checkExtraHits(attacker: Member, extraHits: readonly ExtraHit[]): void {
    const seen = new Set<string>()
    for (const hit of extraHits) {
      if (seen.has(hit.id)) throw new Error(`Two teammates give ${attacker.key} an extra hit with the id "${hit.id}": ids must be unique`)
      seen.add(hit.id)
    }
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

/** One debuff state of an enemy: its probability, the uncertain modifiers present in it, and the kernel's answer for it. */
interface KernelWorld {
  weight: number
  present: ReadonlySet<string> | undefined
  result: DamageResult
}

/** The kernel's answer averaged over the states, one result per distinct kernel answer. */
function mixWorlds(worlds: readonly KernelWorld[]): DamageResult {
  if (worlds.length === 1) return worlds[0]!.result
  const byResult = new Map<DamageResult, number>()
  for (const { weight, result } of worlds) byResult.set(result, (byResult.get(result) ?? 0) + weight)
  return byResult.size === 1 ? [...byResult.keys()][0]! : mixResults([...byResult])
}

/**
 * The weighted mean of kernel results (weights sum to 1). A number is the weighted mean over the results that have it,
 * so a hit that exists in only some debuff states is its mean over those (the kit scales it by how often it exists).
 */
function mixResults(parts: ReadonlyArray<readonly [DamageResult, number]>): DamageResult {
  const mean = (pick: (result: DamageResult) => number | undefined): number | undefined => {
    let sum = 0
    let weight = 0
    for (const [result, w] of parts) {
      const value = pick(result)
      if (value === undefined) continue
      sum += w * value
      weight += w
    }
    return weight > 0 ? sum / weight : undefined
  }
  const damage: Record<string, number> = {}
  for (const ability of new Set(parts.flatMap(([r]) => Object.keys(r.damage)))) damage[ability] = mean((r) => r.damage[ability])!
  const hits: Record<string, HitResult[]> = {}
  for (const ability of new Set(parts.flatMap(([r]) => Object.keys(r.hits)))) {
    const length = Math.max(...parts.map(([r]) => r.hits[ability]?.length ?? 0))
    hits[ability] = Array.from({ length }, (_, i) => {
      const d = mean((r) => r.hits[ability]?.[i]?.damage)!
      const scaling = mean((r) => r.hits[ability]?.[i]?.scaling)
      const output = parts.map(([r]) => r.hits[ability]?.[i]?.output).find((o) => o !== undefined)
      return { damage: d, ...(output !== undefined && { output }), ...(scaling !== undefined && { scaling }) }
    })
  }
  const stats = { ...parts[0]![0].stats }
  for (const key of Object.keys(stats) as Array<keyof CombatStats>) {
    const value = mean((r) => r.stats[key])
    if (value !== undefined) stats[key] = value
  }
  return { damage, hits, stats }
}
