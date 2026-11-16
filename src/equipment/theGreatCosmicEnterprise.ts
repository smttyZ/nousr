import { weaknessTypesFor } from '../kits/weaknessTypes'
import type { LightConeModule } from './equipment'

/**
 * The Great Cosmic Enterprise (22004), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs 22004`).
 * Summary: the wearer's ATK +8% (S1; 10 / 12 / 14 / 16%), always on, which Fribbels adds itself (its game data lists it as
 * `AttackAddedRatio`). For every different Weakness Type an enemy target has, the wearer deals 4% more DMG to it (S1; 5 / 6 / 7 /
 * 8%), up to 7 Types.
 *
 * Fribbels has one switch, `weaknessTypes` (a slider 0 to 7, default 7), and applies `weaknessTypes x DMG%` as a DMG boost
 * (`vendor/hsr-optimizer/src/lib/conditionals/lightcone/4star/TheGreatCosmicEnterprise.ts`). This module supplies it per enemy and
 * live. The count is the one the wearer's kit keeps when it keeps one (Anaxa's, with his implants and Sublimation, DESIGN.md K28),
 * and the scenario's own count otherwise (7 for the default 'all', else the list's length): see `src/kits/weaknessTypes.ts`. The
 * count may be fractional (implants that landed at a chance); the DMG term is linear in it, so that is its expected value.
 * Fribbels caps the slider at 7, and so does the count.
 *
 * It is a light cone effect of the wearer only: no teammate content, nothing for a teammate's attack.
 *
 * IN-GAME CHECK: a wearer other than Anaxa reads the scenario's count and not the implants Anaxa put on the enemy (the lead's reading,
 *   K28: the engine has no per-enemy weaknesses yet). Look: any character wearing it, on an enemy after Anaxa's Skill; the DMG
 *   bonus the tooltip shows against the enemy's weakness icons.
 * NOT MODELLED: the weakness Types a teammate's own effects add (Silver Wolf's implant) do not raise the count: the engine has one
 *   weakness list for the whole scenario.
 */

export const TheGreatCosmicEnterprise: LightConeModule = {
  kind: 'lightCone',
  id: '22004',
  name: 'The Great Cosmic Enterprise',

  create(battle, wearer) {
    const me = wearer.key
    const level = wearer.kernel.unit.superimposition
    if (!Number.isInteger(level) || level < 1 || level > 5) {
      throw new Error(`The Great Cosmic Enterprise: superimposition must be 1 to 5, got ${level}`)
    }
    return {
      attackerState: (enemy) => ({ lightConeConditionals: { weaknessTypes: weaknessTypesFor(battle, me, enemy) } }),
    }
  },
}
