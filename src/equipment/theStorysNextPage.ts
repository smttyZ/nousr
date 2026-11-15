import type { LightConeModule } from './equipment'

/**
 * The Story's Next Page (21054), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs 21054`).
 * Summary: the wearer's Max HP +16% (S1; 20 / 24 / 28 / 32%), always on, which Fribbels adds itself. After the wearer's memosprite
 * attacks, the Outgoing Healing of the wearer and their memosprite +12% (S1; 15 / 18 / 21 / 24%) for 1 turn.
 *
 * Fribbels has one switch, `ohbBuff` (Outgoing Healing on the wearer and its memosprite, value by superimposition, default on). This
 * module supplies it live: on while the wearer holds the modifier. The modifier is applied on the wearer when an action by a memosprite
 * it owns resolves (`actionUsed.owner`), counted down at the end of the wearer's turns.
 *
 * IN-GAME CHECK: "1 turn" is the wearer's next turn (the application turn is not counted: a memosprite's extra turn comes right after
 * the wearer's action, so the buff covers the wearer's next turn and ends with it). Outgoing Healing is read on the wearer's own heals
 * only; the memosprite's heals are priced through the wearer by the kit (Hyacine's Little Ica), so they carry it too.
 */

const KEY = 'lightcone.21054.ohb'
const BUFF_TURNS = 1

export const TheStorysNextPage: LightConeModule = {
  kind: 'lightCone',
  id: '21054',
  name: "The Story's Next Page",

  create(battle, wearer) {
    const me = wearer.key
    const { timeline } = battle

    timeline.bus.on('actionUsed', (action) => {
      if (action.owner !== me || action.actor === me) return
      timeline.modifiers.apply({ id: KEY, target: me, source: me, duration: { turns: BUFF_TURNS, tick: 'turnEnd' } })
    })

    return { attackerState: () => ({ lightConeConditionals: { ohbBuff: timeline.modifiers.has(me, KEY) } }) }
  },
}
