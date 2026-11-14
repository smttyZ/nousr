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
 *   Nothing in NouSR changes a unit's Max HP during battle yet (`Party.setStats` has no caller in a kit), so the
 *   out-of-battle Max HP that Fribbels uses and the in-battle one agree for now. If a kit adds an HP% buff in battle,
 *   this needs revisiting.
 *
 * NOT MODELLED: the memosprite's CRIT DMG +28%. Memosprites are not built (DESIGN.md K6) and none deals damage in
 * the simulator, so this changes no result yet. It must be added with the memosprite's own damage.
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
    '(dynamic conditional, no setConditionals key); the memosprite part changes no result while no memosprite deals damage',
})
