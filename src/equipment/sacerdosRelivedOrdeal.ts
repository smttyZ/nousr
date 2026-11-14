import type { SetModule } from './equipment'

/**
 * Sacerdos' Relived Ordeal (set 121), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 121`).
 * Summary: 2 pieces +6% SPD (the scenario's SPD, as for the other always-on stats). 4 pieces: when the wearer uses
 * a Skill or Ultimate on one ally target, that target's CRIT DMG is +18% for 2 turns, up to 2 stacks.
 *
 * The 4-piece effect needs to know which ally the wearer's Skill or Ultimate targets. The kit's `use(target)` takes the
 * target, but the events do not carry it: `actionUsed` has the actor and what was hit, not the chosen ally. So the
 * stacks and their turns cannot be placed on the right unit, and the module refuses at create() for 4 pieces.
 *
 * NOT MODELLED: the chosen ally of the wearer's Skill and Ultimate, and so the ally's CRIT DMG stacks (Fribbels' teamRelicSet
 * values 1x and 2x). Fix: `actionUsed` (or the action's event) carries the target the kit chose.
 * The 2-piece SPD is not added here, as in the other modules.
 */

const NAME = "Sacerdos' Relived Ordeal"

export const SacerdosRelivedOrdeal: SetModule = {
  kind: 'set',
  type: 'relic',
  name: NAME,
  setId: '121',

  create(battle, wearer, pieces) {
    if (pieces >= 4) {
      throw new Error(
        `${NAME} (wearer ${wearer.key}): the 4-piece CRIT DMG goes on the ally that the wearer's Skill or Ultimate targets, ` +
          'and the engine does not report that target (actionUsed has no target). Not modelled yet, so this would be a guess.',
      )
    }
    return {}
  },
}
