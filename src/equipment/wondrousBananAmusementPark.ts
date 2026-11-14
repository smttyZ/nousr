import type { SetModule } from './equipment'
import { hasMemosprite } from './worldRemakingDeliverer'

/**
 * The Wondrous BananAmusement Park (set 318), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 318`).
 * Summary: 2 pieces, +16% CRIT DMG (always on). When a target the wearer summoned is on the field, +32% CRIT DMG more.
 *
 * The kernel's value is the yes/no "a summon of the wearer is on the field", read at every pricing. Fribbels applies
 * the +32% only when its own `hasSummons` is true for the team (a summon entity in the form), and then only with this
 * flag on. Fribbels' default for the flag is on in this kernel path (measured, see the integration test), so without
 * this module a wearer with no summon would still get the bonus. That is why the module supplies the value live.
 *
 * "Summoned by the wearer" is read from `Battle.summonsOf(wearer.key)`, which lists the summons on the field by the
 * owner each `SummonSpec` names (Jing Yuan's Lightning-Lord is one).
 *
 * A memosprite wearer (`MEMOSPRITE_CHARACTERS`) is refused at create(): memosprites are not built (K6), and a
 * memosprite counts as a target the wearer summoned, so the flag would read off when it is on in the game. This module
 * would otherwise silently give a wrong answer for such a wearer.
 */

export const TheWondrousBananAmusementPark: SetModule = {
  kind: 'set',
  type: 'ornament',
  name: 'The Wondrous BananAmusement Park',
  setId: '318',

  create(battle, wearer) {
    if (hasMemosprite(wearer)) {
      throw new Error(
        `The Wondrous BananAmusement Park on ${wearer.key} (${wearer.kernel.unit.characterId}): NOT MODELLED: a memosprite is a ` +
          'target the wearer summoned, and memosprites are not built (DESIGN.md K6), so the +32% CRIT DMG could not be told on or off',
      )
    }
    const me = wearer.key
    return {
      attackerState: () => ({
        setConditionals: {
          'The Wondrous BananAmusement Park': battle.summonsOf(me).length > 0,
        },
      }),
    }
  },
}
