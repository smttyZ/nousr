import type { SetModule } from './equipment'

/**
 * Scholar Lost in Erudition (set 122), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 122`).
 * Summary: 2 pieces, +8% CRIT Rate (always on). 4 pieces: +20% DMG for the wearer's Skill and Ultimate (always on);
 * after the wearer uses its Ultimate, the next Skill of the wearer deals +25% more DMG.
 *
 * The kernel's value is the conditional "the next Skill, after an Ultimate": on from the wearer's Ultimate until the
 * wearer's next Skill. It is kept as a modifier on the wearer. The Ultimate turns it on when it ends; the Skill turns
 * it off when it ends, so the Skill that uses it is priced with it on. Fribbels' default is on, so without this the
 * kernel would count the +25% on every Skill.
 *
 * IN-GAME CHECK: "After using Ultimate, additionally increases the DMG dealt by the next Skill by 25%." Read as the
 * wearer's own Ultimate and the wearer's own next Skill, however many turns in between. An Ultimate used while the
 * flag is already on refreshes it, it does not stack.
 */

const AFTER_ULTIMATE = 'set.122.after-ultimate'

export const ScholarLostInErudition: SetModule = {
  kind: 'set',
  type: 'relic',
  name: 'Scholar Lost in Erudition',
  setId: '122',

  create(battle, wearer, pieces) {
    // The 2-piece CRIT Rate and the Skill and Ultimate +20% are always on; Fribbels applies them itself.
    if (pieces !== 4) return {}

    const me = wearer.key
    const { timeline } = battle

    timeline.bus.on('actionUsed', (action) => {
      if (action.actor !== me) return
      if (action.kind === 'ultimate') timeline.modifiers.apply({ id: AFTER_ULTIMATE, target: me, source: me })
      else if (action.kind === 'skill') timeline.modifiers.remove(me, AFTER_ULTIMATE)
    })

    return {
      attackerState: () => ({
        setConditionals: { 'Scholar Lost in Erudition': timeline.modifiers.has(me, AFTER_ULTIMATE) },
      }),
    }
  },
}
