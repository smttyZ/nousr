import type { SetModule } from './equipment'

/**
 * Genius of Brilliant Stars (set 108), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 108`).
 * Summary: 2 pieces, +10% Quantum DMG (always on, Fribbels applies it). 4 pieces: the wearer ignores 10% DEF when it
 * deals DMG to the target, and another 10% DEF if the target has Quantum Weakness.
 *
 * The 4-piece's second 10% DEF PEN is Fribbels' `setConditionals.enabledGeniusOfBrilliantStars`. Fribbels sets it by
 * the wearer's element (its preset: on only for a Quantum wearer), not by the target, so its value is wrong for a
 * non-Quantum wearer. The module supplies the in-game condition instead: the flag is on when the scenario's enemies are
 * weak to Quantum (`Battle.weaknesses` is 'all' or lists 'Quantum'). The weaknesses are one set for every enemy of the
 * scenario, so the flag does not depend on which enemy is hit. With 2 pieces nothing is supplied.
 */

export const GeniusOfBrilliantStars: SetModule = {
  kind: 'set',
  type: 'relic',
  name: 'Genius of Brilliant Stars',
  setId: '108',

  create(battle, _wearer, pieces) {
    if (pieces !== 4) return {}
    const weaknesses = battle.weaknesses
    const quantumWeak = weaknesses === 'all' || weaknesses.includes('Quantum')
    return {
      attackerState: () => ({ setConditionals: { 'Genius of Brilliant Stars': quantumWeak } }),
    }
  },
}
