import type { SetModule } from './equipment'

/**
 * Pioneer Diver of Dead Waters (set 117), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 117`).
 * Summary: 2 pieces, more DMG to enemies with debuffs. 4 pieces: +4% CRIT Rate; more CRIT DMG to enemies with
 * at least 2 / at least 3 debuffs (8% / 12%); after the wearer inflicts a debuff on enemies, those effects
 * are doubled for 1 turn.
 *
 * The kernel's value for the set is a menu: -1 no debuff on the target, 0 one debuff, 1 two, 2 three or more,
 * 3 two and doubled, 4 three or more and doubled (Fribbels' own `valuePioneerDiverOfDeadWaters`). It is read
 * every time the wearer's damage is priced, from the debuffs the enemy has right now (any source) and
 * whether the doubling is up.
 *
 * The doubling is a modifier on the wearer: whenever a debuff of the wearer's lands on an enemy it is
 * (re)applied for 1 of the wearer's turns, with the engine's default of not counting the turn it was
 * applied in. Fribbels' menu cannot express "doubled with fewer than 2 debuffs", so that state is read as
 * 0 or -1.
 *
 * IN-GAME CHECK: whether the doubling's 1 turn is the wearer's next turn (as implemented) or ends with the
 * turn it was applied in.
 * IN-GAME CHECK: whether the +4% CRIT Rate also doubles with fewer than 2 debuffs. Fribbels doubles it only
 * when the CRIT DMG tier is also reached (menu 3 and 4); this module follows Fribbels.
 * IN-GAME CHECK: whether a debuff that a trace or eidolon applies on entering battle (Acheron's E4) counts as
 * "the wearer inflicts a debuff". Counted as yes: any debuff whose source is the wearer.
 */

const DOUBLED = 'set.117.doubled'

export const PioneerDiverOfDeadWaters: SetModule = {
  kind: 'set',
  type: 'relic',
  name: 'Pioneer Diver of Dead Waters',
  setId: '117',

  create(battle, wearer) {
    const me = wearer.key
    const { timeline } = battle

    timeline.bus.on('modifierApplied', ({ modifier }) => {
      if (!modifier.debuff || modifier.source !== me || !battle.enemies.has(modifier.target)) return
      timeline.modifiers.apply({ id: DOUBLED, target: me, source: me, duration: { turns: 1, tick: 'turnEnd' } })
    })

    return {
      attackerState: (enemy) => {
        const debuffs = battle.debuffCount(enemy)
        const doubled = timeline.modifiers.has(me, DOUBLED)
        const value = debuffs < 1 ? -1 : debuffs < 2 ? 0 : doubled ? (debuffs >= 3 ? 4 : 3) : debuffs >= 3 ? 2 : 1
        return { setConditionals: { 'Pioneer Diver of Dead Waters': value } }
      },
    }
  },
}
