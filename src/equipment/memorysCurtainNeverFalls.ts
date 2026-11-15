import type { LightConeModule } from './equipment'

/**
 * Memory's Curtain Never Falls (24005), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs 24005`).
 * Summary: the wearer's SPD +6% (S1; 7.5 / 9 / 10.5 / 12%), always on, which Fribbels adds itself. After the wearer uses its Skill,
 * all allies deal 8% more DMG (S1; 10 / 12 / 14 / 16%) for 3 turns.
 *
 * Fribbels has one switch, `teamDmgBoost` (a FullTeam DMG boost, value by superimposition, default on). This module supplies it
 * live: on for an attacker that holds the buff, for the wearer's own attacks and for a teammate's.
 *
 * The buff is a modifier on every ally character (clock: that ally's own turns, ticking at the end of each, the application turn
 * not counted) and on every memosprite on the field at that moment, whose turns are its own. A memosprite's damage is priced as its
 * owner's, so while a memosprite is the unit acting (the active turn is its own) its own modifier decides, not the owner's: a
 * memosprite that only acts in bursts (Robin's Summer Songbirds, who have no turns outside Fever) must not keep a buff that the
 * owner's turns would never count down.
 *
 * Supplied through the active turn: a hit priced while the unit acting is a memosprite of the attacker is read from that memosprite;
 * any other hit (an ally's own turn, a follow-up or Ultimate out of turn, a summon) from the attacker itself.
 *
 * IN-GAME CHECK: "3 turns" is read as the holder's own turns, counted at the end of each, and not the application turn.
 * IN-GAME CHECK: a memosprite summoned after the Skill is read as not holding the buff (it covers the allies there when the Skill is
 * used). A memosprite removed loses it with its modifiers.
 */

const KEY = 'lightcone.24005'
const DMG_BY_SUPERIMPOSITION = [0.08, 0.1, 0.12, 0.14, 0.16] as const
const BUFF_TURNS = 3

export const MemorysCurtainNeverFalls: LightConeModule = {
  kind: 'lightCone',
  id: '24005',
  name: "Memory's Curtain Never Falls",

  create(battle, wearer) {
    const me = wearer.key
    const { timeline } = battle
    const level = wearer.kernel.unit.superimposition
    if (DMG_BY_SUPERIMPOSITION[level - 1] === undefined) {
      throw new Error(`Memory's Curtain Never Falls: superimposition must be 1 to 5, got ${level}`)
    }
    const modifierId = `${KEY}.dmg:${me}`

    timeline.bus.on('actionUsed', (action) => {
      if (action.actor !== me || action.kind !== 'skill') return
      for (const member of battle.members) {
        if (battle.party.get(member.key).downed) continue
        for (const unit of [member.key, ...battle.memospritesOf(member.key)]) {
          timeline.modifiers.apply({ id: modifierId, target: unit, source: me, duration: { turns: BUFF_TURNS, tick: 'turnEnd' } })
        }
      }
    })

    /** Whether the buff is on the unit that is acting for `owner` right now. */
    const holds = (owner: string): boolean => {
      const acting = timeline.activeTurn?.unit
      const unit = acting !== undefined && battle.isMemosprite(acting) && battle.ownerOf(acting) === owner ? acting : owner
      return timeline.modifiers.has(unit, modifierId)
    }

    return {
      attackerState: () => ({ lightConeConditionals: { teamDmgBoost: holds(me) } }),
      teammateState: (attacker) => ({ lightConeConditionals: { teamDmgBoost: holds(attacker.key) } }),
    }
  },
}
