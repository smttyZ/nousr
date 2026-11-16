/**
 * The damage kernel boundary. Nothing in this file imports Fribbels, so the timeline engine and the
 * kits depend only on this interface and tests can swap in a fake kernel.
 *
 * Ids and names (characters, light cones, sets, stats, conditional keys, ability kinds) are
 * Fribbels' own strings, passed through unchanged.
 */

/** Switches and counters on a character, light cone or set: the sim's live buff state. */
export type ConditionalValues = Record<string, number | boolean>

export interface KernelUnit {
  /** Fribbels character id, e.g. '1308' for Acheron, '1006b1' for the buffed Silver Wolf. */
  characterId: string
  /** 0 to 6. */
  eidolon: number
  /** Affinitive Eidolon flags as Fribbels stores them: 0 = off, 1 = on. Defaults to 0. */
  ex?: number
  lightConeId: string
  /** 1 to 5. */
  superimposition: number
  /** Laid over Fribbels' defaults for this character. An unknown key is an error. */
  characterConditionals?: ConditionalValues
  /** Laid over Fribbels' defaults for this light cone. An unknown key is an error. */
  lightConeConditionals?: ConditionalValues
}

export interface KernelTeammate extends KernelUnit {
  /** A team-wide 4-piece relic effect this teammate carries, by Fribbels set name. */
  teamRelicSet?: string
  /** A team-wide ornament effect this teammate carries, by Fribbels set name. */
  teamOrnamentSet?: string
}

/**
 * The attacker's relics in the form Fribbels' own simulations use: sets, four main stats and a
 * number of max-value substat rolls per stat. A benchmark-style build, for members on `"standard"`
 * relics and for tests.
 */
export interface BenchmarkBuild {
  relicSet1: string
  relicSet2: string
  ornamentSet: string
  body: string
  feet: string
  planarSphere: string
  linkRope: string
  /** Rolls per substat type. A type left out has none. */
  substatRolls: Record<string, number>
  /**
   * Value of one roll of every substat but SPD, as Fribbels' stat simulation takes it (its `quality`):
   * 1 is the high value of a 5-star roll, 0.9 the mid value (the average, K14), 0.8 the low value.
   * Left out: 1, the high value. (K14d)
   */
  rollQuality?: number
  /** Value of one SPD roll (Fribbels' `speedRollValue`). Left out: 2.6, the high value. K14's average is 2.3. (K14d) */
  speedRollValue?: number
}

/**
 * One substat as an HSR-Scanner v4 / Reliquary Archiver file writes it. `count` and `step` are only
 * in Reliquary Archiver files.
 */
export interface ScannedSubstat {
  key: string
  value: number
  count?: number
  step?: number
}

/** One relic exactly as the scanner file writes it (HSR-Scanner v4 shape). Not translated by NouSR. */
export interface ScannedRelic {
  set_id: string
  name?: string
  slot: string
  rarity: number
  level: number
  mainstat: string
  substats: ScannedSubstat[]
  location?: string
  _uid?: string
}

/**
 * Real relics, as scanned: at most one per slot. The kernel reads them with the importer for
 * `source` (DESIGN.md, K5), so the relic objects go in as they are in the file.
 */
export interface ScannedBuild {
  /** The `source` string of the scan file the relics came from, e.g. 'HSR-Scanner' or 'reliquary_archiver'. */
  source: string
  relics: ScannedRelic[]
}

/** Either kind of build. Tell them apart with `isScannedBuild`. */
export type KernelBuild = BenchmarkBuild | ScannedBuild

export function isScannedBuild(build: KernelBuild): build is ScannedBuild {
  return 'relics' in build
}

export interface KernelEnemy {
  level: number
  count: number
  /** Damage RES when the enemy is not weak to the attacker's element. */
  resistance: number
  effectResistance: number
  maxToughness: number
  elementalWeak: boolean
  weaknessBroken: boolean
}

/**
 * A stat an injected buff can change. Names are NouSR's own; each kernel maps them to its stat keys
 * and stops with an error naming the buff when it cannot (DESIGN.md, K15a).
 *
 * Fractions are fractions (0.24 is +24%). Flat stats (ATK, HP, DEF, SPD) are in points.
 * `UNCONVERTIBLE_*` is the companion a stat-to-stat conversion cannot read: a teammate buff to HP or
 * CRIT DMG that is meant to be copied into a conversion must be given on both the stat and its
 * companion, as the kernel's own characters do (e.g. Fu Xuan's HP, Bronya's CRIT DMG).
 */
export type InjectedStat =
  | 'DMG_PERCENT'
  | 'CRIT_RATE'
  | 'CRIT_DMG'
  | 'RES_PEN'
  | 'DEF_PEN'
  | 'VULNERABILITY'
  | 'TRUE_DMG'
  | 'FINAL_DMG'
  | 'BREAK_EFFECT'
  | 'EFFECT_HIT_RATE'
  | 'ATK_PERCENT'
  | 'HP_PERCENT'
  | 'DEF_PERCENT'
  | 'SPD_PERCENT'
  | 'ATK'
  | 'HP'
  | 'DEF'
  | 'SPD'
  | 'UNCONVERTIBLE_ATK'
  | 'UNCONVERTIBLE_HP'
  | 'UNCONVERTIBLE_DEF'
  | 'UNCONVERTIBLE_SPD'
  | 'UNCONVERTIBLE_CRIT_RATE'
  | 'UNCONVERTIBLE_CRIT_DMG'
  | 'UNCONVERTIBLE_BREAK_EFFECT'
  | 'UNCONVERTIBLE_EFFECT_HIT_RATE'

/** The kind of damage a hit-level filter selects. Only stats that apply per hit accept one. */
export type InjectedDamageType =
  | 'BASIC'
  | 'SKILL'
  | 'ULT'
  | 'FUA'
  | 'DOT'
  | 'BREAK'
  | 'SUPER_BREAK'
  | 'MEMO'
  | 'ADDITIONAL'
  | 'ELATION'
  | 'ASSIST'

/**
 * A buff the sim adds on top of whatever the kernel already applies (DESIGN.md, K15a). `value` may be
 * negative: a kit that models a level below the maximum injects the difference between the right
 * level's value and the maximum-level value the kernel applied itself.
 */
export interface InjectedBuff {
  stat: InjectedStat
  value: number
  /** `'self'` is the attacker; `'team'` is everyone, so the attacker too. */
  target: 'self' | 'team'
  /**
   * Only for the kernel's ability of this kind ('BASIC', 'SKILL', 'ULT', 'FUA', 'BREAK', ...); the
   * same strings as `DamageResult.damage`. Valid on every stat.
   */
  abilityKind?: string
  /** Only for hits of this damage type. A stat the kernel cannot filter by hit makes the request an error. */
  damageType?: InjectedDamageType
  /** Free text for error messages, e.g. the ability the buff belongs to. */
  label?: string
}

/** The kernel's ability kind for the hits a request's `extraHits` name, in the order the request lists them. */
export const EXTRA_ABILITY = 'EXTRA'

/** The element of an extra hit when it is not the attacker's own. Fribbels' own element names. */
export type ExtraHitElement = 'Physical' | 'Fire' | 'Ice' | 'Lightning' | 'Wind' | 'Quantum' | 'Imaginary'

/**
 * A hit of Additional DMG that another unit gives the attacker (DESIGN.md, K23): "the Bondmate deals Additional DMG equal
 * to 80% of its ATK". The kernel prices it as a standard Additional DMG hit of the ATTACKER (the attacker's own scaling
 * stat, CRIT, element and buffs, including hit-level buffs aimed at Additional DMG) and returns it in
 * `DamageResult.hits.EXTRA`, at the position it has in the request's list.
 */
export interface ExtraHit {
  /** Names the hit in messages and for `Battle.extraHitIndex`. Unique within one request. */
  id: string
  damageType: 'ADDITIONAL'
  /** The attacker's stat the hit scales on. */
  scalingStat: 'ATK' | 'HP' | 'DEF'
  /** 1.0 is 100% of the stat. A kit that wants a price per 100% asks for 1 and scales the part itself. */
  multiple: number
  /** Left out: the attacker's own element. */
  element?: ExtraHitElement
}

export interface DamageRequest {
  attacker: KernelUnit
  /** Up to three. */
  teammates: KernelTeammate[]
  build: KernelBuild
  /** By Fribbels set name. Laid over Fribbels' defaults. An unknown set is an error. */
  setConditionals?: ConditionalValues
  /** Laid over Fribbels' default enemy (level 95, one target, weak to the element, not broken). */
  enemy?: Partial<KernelEnemy>
  /**
   * Buffs added after the kernel has built its own (DESIGN.md, K15a). Part of the request, so two
   * requests that differ only here are different requests (the battle runner caches by request).
   */
  injectedBuffs?: InjectedBuff[]
  /**
   * Extra Additional DMG hits added to the attacker's actions (K23). Part of the request, so two requests that differ
   * only here are different requests. Priced as the attacker's, returned as `hits.EXTRA` (and `damage.EXTRA`).
   */
  extraHits?: ExtraHit[]
}

export interface CombatStats {
  ATK: number
  DEF: number
  HP: number
  SPD: number
  CR: number
  CD: number
  EHR: number
  RES: number
  BE: number
  ERR: number
  OHB: number
  /**
   * Weakness Break Efficiency as a fraction (0.5 is +50%): what a part's toughness is multiplied by, plus 1
   * (K7). Optional: a kernel that does not report it counts as 0. Fribbels has it as
   * `StatKey.BREAK_EFFICIENCY_BOOST`, and `FribbelsKernel` copies it into `stats`.
   */
  breakEfficiency?: number
}

/**
 * One hit of an ability, as the kernel builds it. Fribbels builds every ability from a list of hits
 * (a main hit, an Additional DMG hit, ...) and each hit gets its own buffs, so the hits of one ability
 * can have different damage per point of ATK.
 */
export interface HitResult {
  /**
   * The hit's number. For a damage hit (`output` undefined): expected damage over crits, against the primary target. For a heal
   * hit (`output: 'HEAL'`): the amount healed, with the healer's live Outgoing Healing Boost and heal boosts already in it
   * (`Battle.healAmount` reads it). For a shield hit: the shield's size. The name is kept for the damage case.
   */
  damage: number
  /**
   * What the hit produces when it is not damage. Undefined means damage. A heal, shield or buff hit has no `scaling` (below), so the
   * runner cannot price it per 100%: kits read a heal's amount through `Battle.healAmount`.
   */
  output?: 'HEAL' | 'SHIELD' | 'BUFF'
  /**
   * The multiple of the scaling stat (ATK, HP or DEF) the kernel used for this hit: 1.6 is 160%. A
   * hit that scales on more than one stat has the multiples added, and a part priced from it must use
   * the same mix. Undefined when the hit is not plain damage on one of those stats (healing, a shield,
   * Break, damage over time, or scaling on a stat such as Break Effect), so its damage cannot be
   * turned into damage per 100%. The runner stops with an error if a part asks for such a hit.
   */
  scaling?: number
}

export interface DamageResult {
  /**
   * The kernel's own total for one use of each ability the attacker has, keyed by Fribbels ability
   * kind ('BASIC', 'SKILL', 'ULT', 'FUA', 'BREAK', ...), under the requested state. Expected value
   * over crits, against the primary target. Equal to the sum of that ability's `hits` that the
   * kernel counts towards it. Kept to check single actions against Fribbels' own numbers; the runner
   * prices from `hits`.
   */
  damage: Record<string, number>
  /**
   * Every hit of each ability, in the kernel's own order, under the requested state. A kit names a hit
   * by ability kind and position in this list. An ability with no hits has an empty list. Which hits
   * exist can depend on the state (Tribbie's Zone adds one), so a kit asks about the state it models.
   */
  hits: Record<string, HitResult[]>
  /** The attacker's in-combat stats under the requested state. */
  stats: CombatStats
}

export interface DamageKernel {
  actionDamage(request: DamageRequest): DamageResult
}

/**
 * A unit's stats outside combat, as the game's character screen shows them: character and light
 * cone base stats, the light cone's always-on stat bonus, traces, relic main and sub stats, and
 * the always-on parts of relic and ornament set effects. No buffs from abilities, teammates or
 * conditional effects. Same units as CombatStats (percentages as fractions).
 */
export interface BasicStats extends CombatStats {
  /** Character plus light cone base SPD: the part that SPD% bonuses scale. */
  baseSPD: number
}

/** What a scenario run needs from the kernel besides per-action damage. */
export interface ScenarioKernel extends DamageKernel {
  /**
   * The kernel's id for a game character id and ability version (DESIGN.md, S2): 0 = the original
   * kit, n > 0 = buffed version n, undefined = the newest version the kernel has. Throws when the
   * kernel has no such character or version.
   */
  characterId(gameId: string, abilityVersion: number | undefined): string
  /** The unit's out-of-combat stats with this build. */
  basicStats(unit: KernelUnit, build: KernelBuild): BasicStats
  /**
   * What the kernel knows about a scan file's `source` string. Throws for a source the kernel's
   * importer does not read. `speedVerified` is false when that scanner writes SPD rounded down as
   * the game shows it, so a relic's SPD substat may be understated by just under 1.
   */
  scanSource(source: string): { speedVerified: boolean }
}
