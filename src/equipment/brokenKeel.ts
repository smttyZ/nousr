import type { SetModule } from './equipment'

/**
 * Broken Keel (set 310), an ornament, from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 310`).
 * Summary: 2 pieces +10% Effect RES for the wearer. While the wearer's Effect RES is 30% or more, all allies' CRIT DMG
 * is +10%.
 *
 * The wearer's own attacks are right without a module value: Fribbels' dynamic conditional (BrokenKeelConditional)
 * reads the wearer's Effect RES from the build and applies the team CRIT DMG only at 30% or more.
 *
 * A teammate's attack takes the team effect from Fribbels' teamOrnamentSet flag, which Fribbels applies with no Effect
 * RES check. So the module decides the flag: `teammateState` gives `teamOrnamentSet: 'Broken Keel'` only when the
 * wearer's Effect RES is 30% or more.
 *
 * APPROXIMATION: the wearer's Effect RES is the member's basic (out-of-combat) Effect RES, `wearer.stats.effectRes`,
 * which the runner fills from the kernel's basic stats (it includes this set's own +10%). In-combat Effect RES buffs
 * (a teammate's or the wearer's own) are ignored, so a wearer just under 30% who is buffed over it in the fight still
 * reads as under, and the reverse cannot happen (no in-combat effect lowers it here).
 *
 * A wearer without `stats.effectRes` (a test member built by hand) is refused at create(): without the number the flag
 * cannot be decided.
 */

/** The wearer's Effect RES, as a fraction, at which the team effect turns on. */
const THRESHOLD = 0.3

export const BrokenKeel: SetModule = {
  kind: 'set',
  type: 'ornament',
  name: 'Broken Keel',
  setId: '310',

  create(_battle, wearer) {
    const effectRes = wearer.stats.effectRes
    if (effectRes === undefined) {
      throw new Error(`Broken Keel (wearer ${wearer.key}): the member has no stats.effectRes, so whether its Effect RES is 30% or more is unknown`)
    }
    const on = effectRes >= THRESHOLD
    return {
      teammateState: () => (on ? { teamOrnamentSet: 'Broken Keel' } : {}),
    }
  },
}
