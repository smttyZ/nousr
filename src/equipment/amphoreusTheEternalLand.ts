import type { EquipmentInstance, SetModule } from './equipment'
import { hasMemosprite } from './worldRemakingDeliverer'

/**
 * Amphoreus, The Eternal Land (set 323), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 323`).
 * Summary: an ornament, 2 pieces: CRIT Rate +8%. While the wearer's memosprite is on the field, all allies' SPD +8%.
 * The effect cannot be stacked.
 *
 * Kind of each part:
 * - CRIT Rate +8%: always on. Fribbels adds it itself (`p2c`).
 * - All allies' SPD +8%: conditional on the wearer's memosprite. Fribbels has one switch,
 *   `setConditionals['Amphoreus, The Eternal Land']` (`enabledAmphoreusTheEternalLand`), and it applies only when the
 *   attacker itself has a memosprite (`x.config.hasMemosprite`). Its default depends on the path: its presets turn it ON
 *   for the Remembrance path and OFF otherwise (`conditionals/evaluation/applyPresets.ts`). Its team form is
 *   `teamOrnamentSet`, which Fribbels reads from a teammate wearing this set as a flat team SPD +8% with no memosprite
 *   condition (`optimization/teammateSetUtils.ts`, and the set's `teammate` effect).
 *
 * NOT MODELLED: the memosprite, and with it the team SPD +8% for a wearer that has one (DESIGN.md K6, not built). A
 * wearer whose character has a memosprite stops at `create`: the effect would be on for part of the fight, and the
 * simulator cannot tell when.
 *
 * For a wearer without a memosprite the switch is passed OFF, its live value, and no team flag is given: the team flag
 * would give the whole team +8% SPD with no memosprite condition at all.
 */
export const AmphoreusTheEternalLand: SetModule = {
  kind: 'set',
  type: 'ornament',
  name: 'Amphoreus, The Eternal Land',
  setId: '323',

  create(battle, wearer): EquipmentInstance {
    if (hasMemosprite(wearer)) {
      throw new Error(
        `Amphoreus, The Eternal Land on ${wearer.key} (${wearer.kernel.unit.characterId}): NOT MODELLED: the team's SPD +8% ` +
          'needs the wearer\'s memosprite on the field, and memosprites are not built (DESIGN.md K6). It would change this run.',
      )
    }
    return {
      attackerState: () => ({ setConditionals: { 'Amphoreus, The Eternal Land': false } }),
    }
  },
}
