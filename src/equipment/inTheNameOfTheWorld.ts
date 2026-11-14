import { certain } from '../battle/battle'
import type { LightConeModule } from './equipment'

/**
 * In the Name of the World (23004), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs 23004`).
 * Summary: the wearer deals more DMG to debuffed enemies (24% at superimposition 1, up to 40%). When the wearer
 * uses their Skill, their Effect Hit Rate for that attack rises (18% to 30%) and so does their ATK (24% to 40%).
 *
 * Fribbels has three switches (`vendor/hsr-optimizer/src/lib/conditionals/lightcone/5star/InTheNameOfTheWorld.ts`),
 * all on by default, which would count the DMG bonus against every enemy:
 * - `enemyDebuffedDmgBoost`: read at every pricing from whether the enemy being hit has any debuff right now
 *   (`Battle.debuffChance`, from any source, break effects included, K24). A debuff lands after the damage that applies
 *   it, like every other debuff in this repo, so the hit that debuffs an enemy does not get the bonus (the next hit does).
 *   Debuffs are present with a probability (K22), so this is a boolean kernel switch priced in the scaled form (K21): the
 *   battle prices the hit in each debuff state and weights the two by the chance the enemy is debuffed, so the DMG bonus
 *   counts at that chance. (A switch rather than an injected buff, so no superimposition table is repeated here.)
 * - `skillAtkBoost` and `skillEhrBoost`: Fribbels applies both to the SKILL ability only (`actionKind(SKILL)`), so
 *   "when the wearer uses their Skill" is decided by the ability being priced and the switches stay on. The
 *   EHR rise matters through the wearer's own EHR conversions (Welt's EHR-to-ATK trace). A test pins that a
 *   Basic ATK and an Ultimate get neither.
 *
 * The superimposition is the wearer's (`wearer.kernel.unit.superimposition`); Fribbels reads it itself. The
 * light cone has no teammate effect.
 *
 * Settled: any debuff counts as "debuffed" here, SPD reductions (the slow, Imprison, Weightless) included, and so do break
 * effects while they last (K24).
 */

export const InTheNameOfTheWorld: LightConeModule = {
  kind: 'lightCone',
  id: '23004',
  name: 'In the Name of the World',

  create(battle) {
    return {
      attackerState: (enemy) => ({
        lightConeConditionals: {
          enemyDebuffedDmgBoost: certain(battle.debuffChance(enemy)),
          skillAtkBoost: true,
          skillEhrBoost: true,
        },
      }),
    }
  },
}
