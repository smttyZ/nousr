import type { LightConeModule } from './equipment'

/**
 * Past and Future (21025), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs 21025`).
 * Summary: when the wearer uses their Skill, the next ally taking action (except the wearer) deals 16%, 20%, 24%, 28% or
 * 32% increased DMG (by superimposition) for 1 turn.
 *
 * Fribbels has it as a teammate switch, `postSkillDmgBuff`, whose default is on (its teammate defaults count every buff as
 * always on), so a teammate would be priced with the buff on every hit. Here the switch is on only for the ally the effect
 * landed on and only during that ally's one turn, and off for everyone else, including the wearer. Fribbels applies it to the
 * attacker alone (`SingleTarget`), not to a summon; the ally's summon hits are priced as the ally's and the modifier lasts
 * only through the ally's own turn, so a summon acting on its own turn does not get it.
 *
 * "The next ally taking action": the wearer's Skill marks the effect pending, and it lands on the first turn of an ally other
 * than the wearer that starts after that. It is not tied to the Skill's target (a Harmony target takes no immediate action
 * from Sunday's Skill, so the next ally to act can be someone else).
 * IN-GAME CHECK: "taking action" is read as the start of an ally's turn. An ally's Ultimate used before its turn (in the
 * window between two turns) is not read as "taking action", so the buff goes to the next turn and not to that Ultimate.
 * IN-GAME CHECK: a memosprite taking its turn is not read as "an ally taking action" (Fribbels gives the buff to the character only); its
 * damage, priced as its owner's, gets the buff only during the owner's own turn.
 * IN-GAME CHECK: the 1 turn counts the ally's turn it landed on, so the buff covers that whole turn and ends with it.
 */

const DMG_BY_SUPERIMPOSITION = [0.16, 0.2, 0.24, 0.28, 0.32] as const

export const PAST_AND_FUTURE_ID = '21025'

export const PastAndFuture: LightConeModule = {
  kind: 'lightCone',
  id: PAST_AND_FUTURE_ID,
  name: 'Past and Future',

  create(battle, wearer) {
    const me = wearer.key
    const { timeline } = battle
    const level = wearer.kernel.unit.superimposition
    if (DMG_BY_SUPERIMPOSITION[level - 1] === undefined) throw new Error(`Past and Future: superimposition must be 1 to 5, got ${level}`)
    const id = `lightcone.${PAST_AND_FUTURE_ID}.dmg:${me}`
    let pending = false

    timeline.bus.on('actionUsed', (action) => {
      if (action.actor === me && action.kind === 'skill') pending = true
    })

    timeline.bus.on('turnStart', (turn) => {
      if (!pending || turn.unit === me || !battle.isCharacter(turn.unit) || battle.party.get(turn.unit).downed) return
      pending = false
      timeline.modifiers.apply({
        id,
        target: turn.unit,
        source: me,
        duration: { turns: 1, tick: 'turnEnd', countApplicationTurn: true },
      })
    })

    return {
      // Fribbels' own value for the superimposition is applied when the switch is on; only whether it is on is live.
      teammateState: (attacker) => ({
        lightConeConditionals: { postSkillDmgBuff: attacker.key !== me && timeline.modifiers.has(attacker.key, id) },
      }),
    }
  },
}
