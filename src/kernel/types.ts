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
 * number of max-value substat rolls per stat. Real scanned relics arrive after the scenario schema
 * review (step 4).
 */
export interface KernelBuild {
  relicSet1: string
  relicSet2: string
  ornamentSet: string
  body: string
  feet: string
  planarSphere: string
  linkRope: string
  substatRolls: Record<string, number>
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

export interface DamageResult {
  /**
   * Output of one use of each ability the attacker has, keyed by Fribbels ability kind
   * ('BASIC', 'SKILL', 'ULT', 'FUA', 'BREAK', ...), under the requested state. Expected value
   * over crits, against the primary target.
   */
  damage: Record<string, number>
  /** The attacker's in-combat stats under the requested state. */
  stats: CombatStats
}

export interface DamageKernel {
  actionDamage(request: DamageRequest): DamageResult
}
