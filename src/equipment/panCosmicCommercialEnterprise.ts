import { setWithoutBehaviour } from './equipment'

/**
 * Pan-Cosmic Commercial Enterprise (set 303), an ornament, from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 303`).
 * Summary: 2 pieces, the wearer's Effect Hit Rate +10%, and its ATK rises by 25% of its current Effect Hit Rate, up to 25% of its base ATK.
 *
 * Registered with `setWithoutBehaviour`: the EHR +10% is always on (`p2c`), and the ATK conversion is a continuous dynamic conditional that
 * Fribbels evaluates itself on the wearer's in-combat EHR (`sets/ornaments/PanCosmicCommercialEnterprise.ts`:
 * `min(0.25, 0.25 x EHR) x base ATK`, recomputed as the EHR changes). It has no `setConditionals` key (its display default is unused by the
 * conditional) and no team form, so there is nothing for a module to supply. Effect Hit Rate is a full stat in the simulator
 * (CLAUDE.md), so every EHR buff the kernel carries (teammates' conditionals, light cones) counts towards the conversion.
 */

export const PanCosmicCommercialEnterprise = setWithoutBehaviour({
  type: 'ornament',
  name: 'Pan-Cosmic Commercial Enterprise',
  setId: '303',
  reason: "its ATK conversion is a continuous function of the wearer's in-combat Effect Hit Rate that Fribbels evaluates itself",
})
