import { setWithoutBehaviour } from './equipment'

/**
 * Bone Collection's Serene Demesne (set 319), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 319`).
 * Summary: 2 pieces (an ornament): +12% Max HP. When the wearer's Max HP is 5000 or higher, the wearer's and
 * their memosprite's CRIT DMG +28%.
 *
 * Kind of each part:
 * - Max HP +12%: always on. Fribbels adds it itself (`p2c`).
 * - CRIT DMG +28% at Max HP 5000 or more: a threshold on the wearer's Max HP. Fribbels checks it itself, in its
 *   dynamic conditional `BoneCollectionsSereneDemesneConditional` (`sets/ornaments/BoneCollectionsSereneDemesne.ts`),
 *   against the Max HP its rotation gives the wearer. It has no `setConditionals` key, so there is nothing to supply.
 *   In-battle HP buffs on the timeline (`Party.setStats`: World-Remaking Deliverer, Hyacine's After Rain, Fu Xuan)
 *   reach Fribbels only through the kernel's own switches. Every roster wearer is far above 5,000, so the threshold
 *   does not flip either way today.
 * - The memosprite's CRIT DMG +28%: Fribbels' conditional targets the wearer and the memosprite
 *   (`TargetTag.SelfAndMemosprite`), and memosprite hits are priced through the kernel as the owner's (K6), so it
 *   reaches the memosprite's damage with nothing to supply. (Corrected 2026-11-15: this header used to say
 *   memosprites were not built.)
 *
 * IN-GAME CHECK: "When the wearer's Max HP is 5000 or higher": whether this is the wearer's Max HP out of battle or
 * in battle (after the team's HP buffs). Fribbels reads the Max HP its rotation gives the wearer when it acts.
 */
export const BoneCollectionsSereneDemesne = setWithoutBehaviour({
  type: 'ornament',
  name: "Bone Collection's Serene Demesne",
  setId: '319',
  reason:
    'the Max HP +12% is always on and Fribbels adds it; the CRIT DMG +28% at Max HP 5000 is a threshold Fribbels evaluates itself ' +
    '(dynamic conditional, no setConditionals key), for the wearer and the memosprite alike',
})
