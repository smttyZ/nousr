/**
 * Two layers of types:
 * - `ScenarioFile` and friends are the JSON exactly as schema/scenario.schema.json defines it
 *   (snake_case, optional fields still optional).
 * - `Scenario` and friends are what the simulator consumes: defaults filled in, every member's
 *   eidolon, light cone and relics resolved against the account scan.
 */

import type { LevelsFile } from '../levels/resolve'
import type { MemberLevels } from '../levels/levels'

export type Element = 'Physical' | 'Fire' | 'Ice' | 'Lightning' | 'Wind' | 'Quantum' | 'Imaginary'

// ---------------------------------------------------------------- HSR-Scanner v4 (the parts NouSR reads)

export interface ScanSubstat {
  key: string
  value: number
}

export interface ScanRelic {
  set_id: string
  name?: string
  slot: 'Head' | 'Hands' | 'Body' | 'Feet' | 'Planar Sphere' | 'Link Rope'
  rarity: number
  level: number
  mainstat: string
  substats: ScanSubstat[]
  /** Id of the character wearing it, or '' when unequipped. */
  location?: string
  _uid?: string
}

export interface ScanCharacter {
  id: string
  eidolon?: number
  ability_version?: number
  /** Ability levels as the game shows them (eidolon bonus included). Reliquary Archiver and HSR-Scanner v4 write it; older fixtures do not. */
  skills?: Partial<Record<string, number>>
  /** Memosprite ability levels (Remembrance characters only). */
  memosprite?: Partial<Record<string, number>>
  /** `ability_1..3` (major traces B1..B3) and `stat_1..10` (minor traces S1..S10): true = unlocked. */
  traces?: Partial<Record<string, boolean>>
}

export interface ScanLightCone {
  id: string
  superimposition?: number
  /** Id of the character holding it, or '' when unequipped. */
  location?: string
}

export interface AccountScan {
  source: string
  build?: string
  version: 4
  characters: ScanCharacter[]
  light_cones: ScanLightCone[]
  relics: ScanRelic[]
}

// ---------------------------------------------------------------- standard build overrides (K14c)

/** A slot whose main stat the scenario may change. The values are Fribbels' stat names. */
export type OverridableSlot = 'Body' | 'Feet' | 'Planar Sphere' | 'Link Rope'

/** `standard_build` as the file writes it. */
export interface StandardBuildOverrideFile {
  main_stats?: Partial<Record<OverridableSlot, string>>
  distributed?: { rolls: Record<string, number>, priority?: string[], notes?: string }
  notes?: string
}

/** What a member's `standard_build` asks for. Checked against the character's file in src/standard. */
export interface StandardBuildOverride {
  /** Slots to change; the others keep the file's value. */
  mainStats?: Partial<Record<OverridableSlot, string>>
  /** A whole split of the 24 distributed rolls, replacing the file's. */
  distributed?: Record<string, number>
}

// ---------------------------------------------------------------- the file as written

export interface ConditionFile {
  what: string
  min?: number
  max?: number
  is?: boolean
}

export interface RuleFile {
  unit: string
  use: string
  target?: string
  when?: ConditionFile[]
  notes?: string
}

export interface MemberFile {
  /** Ability levels and traces (K15, K18). Left out: "scan" with an account, else "max". */
  levels?: LevelsFile
  key: string
  character: string
  ability_version?: number
  eidolon?: number
  affinitive_eidolon?: boolean
  light_cone?: { id: string, superimposition: number }
  relics?: 'equipped' | 'standard' | (string | ScanRelic)[]
  standard_build?: StandardBuildOverrideFile
  /** Checked against schema/kit-options/<character>.schema.json (src/scenario/kitOptions.ts). */
  kit_options?: Record<string, unknown>
  /** Whether this member uses their technique before the battle (K31). Left out: `battle.start.techniques`. */
  technique?: boolean
  notes?: string
}

export interface TeamFile {
  id: string
  name?: string
  notes?: string
  members: MemberFile[]
  policy: RuleFile[]
}

export interface ScenarioFile {
  $schema?: string
  format: 'nousr-scenario'
  version: 1
  game_version: string
  name?: string
  notes?: string
  account?: string | AccountScan
  battle: {
    mode: 'moc'
    cycles: number
    period?: string | null
    start?: { energy?: number, skill_points?: number, techniques?: boolean }
    notes?: string
  }
  enemies: {
    profile: string
    counts: number[]
    weaknesses?: 'all' | Element[]
    notes?: string
  }
  teams: TeamFile[]
}

// ---------------------------------------------------------------- resolved, for the simulator

export interface Condition {
  what: string
  min?: number
  max?: number
  is?: boolean
}

export interface Rule {
  unit: string
  use: string
  target?: string
  /** All must hold. Empty = always. */
  when: Condition[]
}

export interface Member {
  key: string
  /** Game character id, e.g. '1308'. */
  character: string
  /** 0 = original kit, 1 = buffed kit, undefined = the newest version the kernel knows. */
  abilityVersion: number | undefined
  eidolon: number
  affinitiveEidolon: boolean
  lightCone: { id: string, superimposition: number }
  /** 'standard' = Fribbels' benchmark build; otherwise the actual relics, at most one per slot. */
  relics: 'standard' | ScanRelic[]
  /** Only with `relics: 'standard'` (K14c). */
  standardBuild?: StandardBuildOverride
  /**
   * The member's kit options with the schema's defaults filled in (K25, K26), keys as in the scenario file. Absent for a character
   * whose kit takes no options. Given even when the scenario left `kit_options` out, so the run can echo what was used.
   */
  kitOptions?: Record<string, unknown>
  /** The option names the scenario itself gave (the rest came from defaults). */
  kitOptionsGiven?: string[]
  /**
   * Ability levels and trace flags (K15). Absent for a character with no level table (nothing is modelled for it) and in hand-built
   * members; a kit then reads everything as maximum.
   */
  levels?: MemberLevels
  /** Whether this member uses their technique before the battle: the member's own `technique`, else `battle.start.techniques` (K31). */
  technique: boolean
  /** True when the scenario gave this member's `technique` itself; false when `battle.start.techniques` decided. */
  techniqueGiven: boolean
}

export interface Team {
  id: string
  name?: string
  /** In party order, left to right. */
  members: Member[]
  policy: Rule[]
}

export interface Scenario {
  name?: string
  gameVersion: string
  battle: {
    mode: 'moc'
    cycles: number
    /** Period module id, or null for none. */
    period: string | null
    start: { energy: number, skillPoints: number, techniques: boolean }
  }
  enemies: {
    profile: string
    /** One run per value. */
    counts: number[]
    weaknesses: 'all' | Element[]
  }
  teams: Team[]
  /** The account scan's `source` ('HSR-Scanner', 'reliquary_archiver'), when the scenario has an account. */
  scanSource?: string
}
