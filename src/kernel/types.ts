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
  substatRolls: Record<string, number>
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

export interface DamageRequest {
  attacker: KernelUnit
  /** Up to three. */
  teammates: KernelTeammate[]
  build: KernelBuild
  /** By Fribbels set name. Laid over Fribbels' defaults. An unknown set is an error. */
  setConditionals?: ConditionalValues
  /** Laid over Fribbels' default enemy (level 95, one target, weak to the element, not broken). */
  enemy?: Partial<KernelEnemy>
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
}

/**
 * One hit of an ability, as the kernel builds it. Fribbels builds every ability from a list of hits
 * (a main hit, an Additional DMG hit, ...) and each hit gets its own buffs, so the hits of one ability
 * can have different damage per point of ATK.
 */
export interface HitResult {
  /** Expected value over crits, against the primary target. */
  damage: number
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
