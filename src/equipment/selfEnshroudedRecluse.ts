import type { SetModule } from './equipment'

/**
 * Self-Enshrouded Recluse (set 128), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 128`).
 * Summary: 2 pieces +10% Shield Effect provided by the wearer. 4 pieces: +12% Shield Effect provided by the wearer, and
 * while an ally holds a Shield the wearer provided, that ally's CRIT DMG is +15%.
 *
 * Fribbels' conditional for the set is that CRIT DMG flag (default on). Its value depends on which allies hold a
 * shield from this wearer. The engine does not track a shield's source: `Party.setShield` takes a key and an amount,
 * with no source, and no event reports a shield being set. So the module cannot know the flag, and it refuses at
 * create() for 4 pieces. Fribbels' default (on) would count it as always on.
 *
 * NOT MODELLED: the Shield Effect boost (+10% at 2 pieces, +12% at 4). Shield amounts are not priced by the kernel,
 * and no kit sets a shield yet, so nothing in a result depends on it today. It must be wired in when a shield-setting
 * kit exists.
 * NOT MODELLED: the ally's shield source, which the 4-piece CRIT DMG flag depends on. Fix: `Party.setShield` takes the
 * source, or a shield event carries it.
 */

const NAME = 'Self-Enshrouded Recluse'

export const SelfEnshroudedRecluse: SetModule = {
  kind: 'set',
  type: 'relic',
  name: NAME,
  setId: '128',

  create(battle, wearer, pieces) {
    if (pieces >= 4) {
      throw new Error(
        `${NAME} (wearer ${wearer.key}): the 4-piece CRIT DMG depends on which ally holds a shield from the wearer, ` +
          'and the engine does not record a shield\'s source. Not modelled yet, so this would be a guess.',
      )
    }
    return {}
  },
}
