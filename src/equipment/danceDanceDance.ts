import type { LightConeModule } from './equipment'

/**
 * Dance! Dance! Dance! (21018), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs 21018`).
 * Summary: when the wearer uses their Ultimate, all allies' actions are Advanced Forward by 16%, 18%,
 * 20%, 22% or 24% by superimposition. It has no stat or conditional Fribbels models (its controller is
 * empty), so this module acts on the timeline only and supplies no conditionals.
 *
 * Applied once the Ultimate has resolved (its `actionUsed`), so the advance cannot shorten a gauge that
 * the Ultimate's own actions are still using.
 *
 * IN-GAME CHECK: "all allies" read as every party member including the wearer. Memosprites are not allies
 * of this model yet (K6).
 */

const ADVANCE_BY_SUPERIMPOSITION = [0.16, 0.18, 0.2, 0.22, 0.24] as const

export const DanceDanceDance: LightConeModule = {
  kind: 'lightCone',
  id: '21018',
  name: 'Dance! Dance! Dance!',

  create(battle, wearer) {
    const me = wearer.key
    const level = wearer.kernel.unit.superimposition
    const advance = ADVANCE_BY_SUPERIMPOSITION[level - 1]
    if (advance === undefined) throw new Error(`Dance! Dance! Dance!: superimposition must be 1 to 5, got ${level}`)

    battle.timeline.bus.on('actionUsed', (action) => {
      if (action.actor !== me || action.kind !== 'ultimate') return
      for (const member of battle.members) {
        if (battle.party.get(member.key).downed || !battle.timeline.has(member.key)) continue
        battle.timeline.advance(member.key, advance)
      }
    })
    return {}
  },
}
