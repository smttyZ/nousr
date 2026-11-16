import type { SetModule } from './equipment'

/**
 * Eagle of Twilight Line (set 110), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 110`).
 * Summary: 2 pieces, Wind DMG +10% (always on). 4 pieces: after the wearer uses its Ultimate, its action is Advanced Forward by 25%.
 *
 * Kind of each part:
 * - Wind DMG +10%: always on. Fribbels adds it itself (`p2c`), and it has no conditional for the 4 pieces. Nothing is supplied to it.
 * - The advance is a timeline effect, which Fribbels has no clock for: when the wearer's own Ultimate resolves (`actionUsed`,
 *   `actor` the wearer, `kind` 'ultimate'), the wearer's gauge is advanced by 25% (`Timeline.advance`). It runs from the same
 *   event as every other `actionUsed` listener, so a kit's own advance on that Ultimate is applied independently and the two add.
 *
 * Only the wearer's Ultimate counts. A memosprite's Ultimate-like action is not the wearer's (its `actor` is the memosprite), and
 * a wearer who is not on the timeline (downed) cannot Ultimate, so nothing is skipped silently.
 *
 * IN-GAME CHECK: that the advance applies when the Ultimate is used in the Ultimate window between turns as well as during the
 *   wearer's own turn. Both are the same call here; if the game gives the advance only to the next turn's gauge after the
 *   action, the two readings differ for an Ultimate used in the wearer's own turn (the engine puts every Ultimate between turns).
 */

const ADVANCE = 0.25

export const EagleOfTwilightLine: SetModule = {
  kind: 'set',
  type: 'relic',
  name: 'Eagle of Twilight Line',
  setId: '110',

  create(battle, wearer, pieces) {
    if (pieces !== 4) return {}
    const me = wearer.key
    const { timeline } = battle
    timeline.bus.on('actionUsed', (action) => {
      if (action.actor !== me || action.kind !== 'ultimate' || !timeline.has(me)) return
      timeline.advance(me, ADVANCE)
    })
    return {}
  },
}
