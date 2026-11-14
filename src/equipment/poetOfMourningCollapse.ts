import { setWithoutBehaviour } from './equipment'

/**
 * Poet of Mourning Collapse (set 124), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 124`).
 * Summary: 2 pieces: Quantum DMG +10%. 4 pieces: SPD -8%. Before entering battle, if the wearer's SPD is lower than
 * 110 (+20% CRIT Rate) or 95 (+32% CRIT Rate in total), the CRIT Rate boost also applies to the wearer's memosprite.
 *
 * Kind of each part:
 * - Quantum DMG +10% and SPD -8%: always on. Fribbels adds both itself (`p2c`, `p4c`).
 * - CRIT Rate by SPD: a threshold read before battle on the wearer's SPD. Fribbels checks it itself in the set's
 *   `p4x` (`sets/relics/PoetOfMourningCollapse.ts`) against `x.c.a[BasicKey.SPD]`, the wearer's SPD from the build
 *   after this set's own -8%. It has no `setConditionals` key (its display is not modifiable), so nothing is supplied.
 *   The threshold is evaluated from the build's SPD, which is the out-of-battle SPD the timeline starts from.
 *
 * NOT MODELLED: the CRIT Rate boost on the memosprite. Memosprites are not built (DESIGN.md K6) and none deals damage
 * here, so it changes no result yet.
 *
 * IN-GAME CHECK: "if the wearer's SPD is lower than 110/95": whether this compares the SPD after the set's own -8%
 * (as Fribbels does) or before it. Fribbels compares after it.
 */
export const PoetOfMourningCollapse = setWithoutBehaviour({
  type: 'relic',
  name: 'Poet of Mourning Collapse',
  setId: '124',
  reason:
    'the Quantum DMG and SPD -8% are always on and Fribbels adds them; the CRIT Rate by SPD is a threshold Fribbels evaluates itself ' +
    'from the build SPD (p4x, no setConditionals key); the memosprite part changes no result while no memosprite deals damage',
})
