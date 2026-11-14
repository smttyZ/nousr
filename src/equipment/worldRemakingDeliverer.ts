import type { Member } from '../battle/battle'
import type { EquipmentInstance, SetModule, SetPieces } from './equipment'

/**
 * World-Remaking Deliverer (set 127), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 127`).
 * Summary: 2 pieces: CRIT Rate +8%. 4 pieces: after the wearer uses Basic ATK or Skill, if the wearer's memosprite is
 * on the field, the wearer's and their memosprite's Max HP +24%, and all allies' DMG +15%, until after the wearer's
 * next Basic ATK or Skill.
 *
 * Kind of each part:
 * - CRIT Rate +8% (2 pieces): always on. Fribbels adds it itself (`p2c`).
 * - The 4-piece effect is entirely conditional on the wearer's memosprite being on the field. Fribbels has one switch
 *   for it, `setConditionals['World-Remaking Deliverer']` (`enabledWorldRemakingDeliverer`), which gates the Max HP +24%
 *   and the team's DMG +15%. Its default depends on the path: its presets turn it ON for the Remembrance path and OFF
 *   otherwise (`conditionals/evaluation/applyPresets.ts`). So the switch is given its live value, OFF, for a wearer
 *   with no memosprite, rather than left to that default.
 * - Its team form is `teamRelicSet`, which Fribbels reads from a teammate. None is given: for a wearer with no
 *   memosprite the team DMG +15% is off.
 *
 * NOT MODELLED: the memosprite, and with it the 4-piece effect for a wearer that has one (DESIGN.md K6, not built). A
 * wearer whose character has a memosprite (`MEMOSPRITE_CHARACTERS`) stops at `create` with a 4-piece set: the
 * effect would be on for part of the fight and the simulator cannot tell when. A memosprite wearer with 2 pieces is
 * simulated, since its 2-piece text has no memosprite part.
 */

/**
 * Character ids of the characters that have a memosprite, from Fribbels' config (its `memosprite` entities): Aglaea,
 * Castorice, Cyrene, Evernight, Hyacine, Robin Summeretto, and the Trailblazer (Remembrance) Caelus and Stelle.
 * Shared with Amphoreus, The Eternal Land, whose SPD effect has the same memosprite condition.
 */
export const MEMOSPRITE_CHARACTERS: ReadonlySet<string> = new Set(['1402', '1407', '1409', '1413', '1415', '1512', '8007', '8008'])

/**
 * Whether the wearer's character has a memosprite. The memosprite itself is not built (DESIGN.md K6). The kernel id
 * of a buffed ability version ends in `b<n>` ('1407b1'); that suffix is the same character, so it is stripped
 * before the lookup.
 */
export function hasMemosprite(wearer: Member): boolean {
  return MEMOSPRITE_CHARACTERS.has(wearer.kernel.unit.characterId.replace(/b\d+$/, ''))
}

export const WorldRemakingDeliverer: SetModule = {
  kind: 'set',
  type: 'relic',
  name: 'World-Remaking Deliverer',
  setId: '127',

  create(battle, wearer, pieces: SetPieces): EquipmentInstance {
    if (hasMemosprite(wearer) && pieces === 4) {
      throw new Error(
        `World-Remaking Deliverer (4 pieces) on ${wearer.key} (${wearer.kernel.unit.characterId}): NOT MODELLED: the 4-piece effect ` +
          'needs the wearer\'s memosprite on the field, and memosprites are not built (DESIGN.md K6). It would change this run.',
      )
    }
    return {
      attackerState: () => ({ setConditionals: { 'World-Remaking Deliverer': false } }),
    }
  },
}
