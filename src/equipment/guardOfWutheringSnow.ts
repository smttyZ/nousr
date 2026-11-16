import type { SetModule } from './equipment'

/**
 * Guard of Wuthering Snow (set 106), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 106`).
 * Summary: 2 pieces, the wearer takes 8% less DMG. 4 pieces: at the beginning of the wearer's turn, if its HP is 50% or less of
 * its Max HP, it restores HP equal to 8% of its Max HP and regenerates 5 Energy.
 *
 * Kind of each part:
 * - Nothing is conditional for the KERNEL: the set has no Fribbels conditional for the wearer's damage (its DMG reduction is a
 *   defensive stat, `p2x` in `sets/relics/GuardOfWutheringSnow.ts`). Nothing is supplied to it.
 * - 2 pieces, 8% less DMG taken: a damage reduction on the wearer in the party (`Party.setDamageReduction`), which `Enemies.takeTurn`
 *   multiplies with every other reduction (Fu Xuan's Misfortune Avoidance). It is on from the start of the battle, at 2 and 4 pieces.
 * - 4 pieces: a listener on the wearer's `turnStart`. If the wearer's current HP is at or below half its current Max HP, it
 *   restores 8% of the party's Max HP for the wearer (the Max HP the sim holds, which kits that buff Max HP keep in step) as a
 *   heal with the wearer as source, and gives 5 Energy. The check is before the turn's action, after any other `turnStart` listener
 *   that runs first (default priority, subscription order).
 *
 * Approximation: HP is the engine's expected value (DESIGN.md, Known approximations), so "50% or less" is tested on the mean HP. An
 * expected HP of 49% is "low", although in the real fight the wearer is low in only some of the outcomes.
 *
 * IN-GAME CHECK: whether the 5 Energy is scaled by Energy Regeneration Rate. Read as a flat 5 (`fixed`), as Sunday's Ultimate energy.
 * IN-GAME CHECK: whether the heal counts as the wearer's Outgoing Healing (no: a flat set effect, no Outgoing Healing Boost applied) and
 *   whether the heal is affected by the wearer's Incoming Healing (not modelled in the sim).
 * IN-GAME CHECK: "HP percentage is equal to or less than 50%" on the wearer's HP at the very start of the turn, after damage over time
 *   (not modelled here) and before anything else the turn begins with.
 */

const DAMAGE_REDUCTION = 0.08
const REDUCTION_KEY = 'set.106.reduction'
const HP_THRESHOLD = 0.5
const HEAL_SHARE = 0.08
const ENERGY = 5
/** A float comparison at the threshold. */
const EPSILON = 1e-9

export const GuardOfWutheringSnow: SetModule = {
  kind: 'set',
  type: 'relic',
  name: 'Guard of Wuthering Snow',
  setId: '106',

  create(battle, wearer, pieces) {
    const me = wearer.key
    const { party, timeline } = battle

    party.setDamageReduction(me, REDUCTION_KEY, DAMAGE_REDUCTION)

    if (pieces === 4) {
      timeline.bus.on('turnStart', (turn) => {
        if (turn.unit !== me) return
        const self = party.get(me)
        if (self.downed || self.hp > HP_THRESHOLD * self.maxHp + EPSILON) return
        party.heal(me, HEAL_SHARE * self.maxHp, me)
        party.gainEnergy(me, ENERGY, { fixed: true })
      })
    }
    return {}
  },
}
