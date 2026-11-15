import type { LightConeModule } from './equipment'

/**
 * Make Farewells More Beautiful (23040), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs 23040`). S1: Max HP +30%
 * (S2..S5: 37.5 / 45 / 52.5 / 60%), always on, which Fribbels adds itself. "When the wearer or their memosprite loses HP during their
 * own turn, the wearer gains Death Flower": the wearer and their memosprite ignore 30% of the target's DEF (35 / 40 / 45 / 50%) for 2
 * turns. "When the wearer's memosprite disappears, advances the wearer's action by 12%" (15 / 18 / 21 / 24%), at most once, the count
 * resetting every time the wearer uses its Ultimate.
 *
 * Fribbels has one switch, `deathFlower` (a DEF PEN on the wearer and its memosprite, default on). This module supplies it live: on
 * while the wearer holds the Death Flower modifier. Fribbels has nothing for the advance, which acts on the timeline.
 *
 * Death Flower is one modifier on the wearer (the wearer's own turns count it down, ticking at the end of each, the application turn
 * not counted: it is up for the wearer's next two turns). It covers the wearer's memosprite's hits too, which are priced as the wearer's.
 *
 * IN-GAME CHECK: "during their own turn" is read as the turn of the unit that loses the HP: the wearer losing HP in its turn, or
 * the memosprite losing HP in its own turn (Netherwing paying for Breath). HP lost in any other unit's turn (an enemy's hit) does not
 * give it. The Death Flower is already up for the hit that follows the HP loss within the same action (Castorice's Skill takes the
 * HP first, then hits).
 * IN-GAME CHECK: the 12% advance is given when the memosprite leaves for any reason (its turns, 0 HP, or the owner being downed is
 * skipped because a downed wearer takes no turn), and once per Ultimate use of the wearer (the Ultimate is any action of kind
 * 'ultimate' by the wearer).
 */

const KEY = 'lightcone.23040'
export const DEATH_FLOWER_MODIFIER = `${KEY}.death_flower`
export const DEF_IGNORE_BY_SUPERIMPOSITION = [0.3, 0.35, 0.4, 0.45, 0.5] as const
export const ADVANCE_BY_SUPERIMPOSITION = [0.12, 0.15, 0.18, 0.21, 0.24] as const
const FLOWER_TURNS = 2

export const MakeFarewellsMoreBeautiful: LightConeModule = {
  kind: 'lightCone',
  id: '23040',
  name: 'Make Farewells More Beautiful',

  create(battle, wearer) {
    const me = wearer.key
    const { timeline, party } = battle
    const level = wearer.kernel.unit.superimposition
    const advance = ADVANCE_BY_SUPERIMPOSITION[level - 1]
    if (advance === undefined) throw new Error(`Make Farewells More Beautiful: superimposition must be 1 to 5, got ${level}`)
    let advanced = false

    timeline.bus.on('hpLost', ({ unit }) => {
      const mine = unit === me || (battle.isMemosprite(unit) && battle.ownerOf(unit) === me)
      if (!mine || timeline.activeTurn?.unit !== unit) return
      timeline.modifiers.apply({ id: DEATH_FLOWER_MODIFIER, target: me, source: me, duration: { turns: FLOWER_TURNS, tick: 'turnEnd' } })
    })

    timeline.bus.on('actionUsed', (action) => {
      if (action.actor === me && action.kind === 'ultimate') advanced = false
    })

    timeline.bus.on('memospriteRemoved', ({ owner, reason }) => {
      if (owner !== me || advanced || reason === 'ownerDowned') return
      if (party.get(me).downed || !timeline.has(me)) return
      advanced = true
      timeline.advance(me, advance)
    })

    return {
      attackerState: () => ({ lightConeConditionals: { deathFlower: timeline.modifiers.has(me, DEATH_FLOWER_MODIFIER) } }),
      // Fribbels has no teammate content for it: nothing it gives reaches another ally.
      teammateState: () => ({}),
    }
  },
}
