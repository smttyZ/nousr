import { setWithoutBehaviour } from './equipment'

/**
 * Rutilant Arena (ornament set 309), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 309`).
 * Summary: 2 pieces, +8% CRIT Rate (always on). When the wearer's current CRIT Rate is 70% or more, the wearer's
 * Basic ATK and Skill DMG rise 20%.
 *
 * Registered with `setWithoutBehaviour`: Fribbels evaluates the 70% threshold itself (its `p2t` reads the wearer's
 * CRIT Rate from the build's computed stats, vendor/hsr-optimizer/src/lib/sets/ornaments/RutilantArena.ts), so nothing
 * for a module to supply. The integration test in sets-batch1.integration.test.ts shows the step at 70%.
 * A CRIT Rate a kit injects (K15a) counts towards the 70% too: injected buffs go into the stats Fribbels computes before the
 * set's effect reads the final CRIT Rate (integration test, same file).
 */

export const RutilantArena = setWithoutBehaviour({
  type: 'ornament',
  name: 'Rutilant Arena',
  setId: '309',
  reason: "its 70% CRIT Rate threshold is evaluated by Fribbels itself from the wearer's CRIT Rate",
})
