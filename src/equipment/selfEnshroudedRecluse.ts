import type { EquipmentInstance, SetModule, SetPieces } from './equipment'

/**
 * Self-Enshrouded Recluse (set 128), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 128`).
 * Summary: 2 pieces: "The provided Shield Effect increases by 10%." 4 pieces: "Increases the Shield Effect provided by the wearer by
 * 12%. When an ally target holds a Shield provided by the wearer, the ally target's CRIT DMG increases by 15%."
 *
 * Kind of each part:
 * - The 4-piece CRIT DMG +15% is conditional on the holder. Fribbels has the wearer's switch `setConditionals['Self-Enshrouded
 *   Recluse']` (`enabledSelfEnshroudedRecluse`, default ON, so left alone it would count as always on) and the team form
 *   `teamRelicSet: 'Self-Enshrouded Recluse'` (CRIT DMG +15% on the attacker).
 * - The Shield Effect +10% / +12%: see NOT MODELLED.
 *
 * Modelled from the party's shields, read live at every pricing (`Party.shieldFrom`, which keeps each shield's `source`):
 * - the wearer attacking: the switch is "the wearer holds a shield it provided" (Dan Heng PT's Skill shields every ally, himself
 *   included; Texture of Memories' shield on him is his too);
 * - a teammate attacking: while the attacker holds a shield the wearer provided, the wearer gives `teamRelicSet`. A memosprite's
 *   attack is priced as its owner's (K6), so it is the owner's shield that counts.
 * Shields are expected values (each expected hit wears them down by its expected damage), so "holds a shield" is the expected shield
 * being above 0: the documented approximation for thresholds on expected values (DESIGN.md, Known approximations).
 *
 * IN-GAME CHECK: "an ally target" includes the wearer itself (his own attacks get +15% while he holds his own shield).
 * IN-GAME CHECK: the CRIT DMG stays while the shield is held after the wearer is downed (the text conditions only the shield).
 * NOT MODELLED: the Shield Effect +10% (2 pieces) and +12% (4 pieces). Dan Heng PT's kit computes his shield amounts itself and nothing
 *   passes the wearer's Shield Effect to it, so his shields are 22% smaller than in game at 4 pieces. Effect on results: HP and shield
 *   duration only (more HP lost, a lower stack cap, a shield that runs out sooner). No damage number changes, except that a shield
 *   running out sooner can end this 4-piece CRIT DMG slightly earlier. On the roadmap (Smitty, 2026-11-15: it does not change MVP damage
 *   numbers).
 */

const NAME = 'Self-Enshrouded Recluse'

export const SelfEnshroudedRecluse: SetModule = {
  kind: 'set',
  type: 'relic',
  name: NAME,
  setId: '128',

  create(battle, wearer, pieces: SetPieces): EquipmentInstance {
    if (pieces < 4) return {}
    const me = wearer.key
    const { party } = battle
    const holds = (unit: string): boolean => party.has(unit) && party.shieldFrom(unit, me) > 0

    return {
      attackerState: () => ({ setConditionals: { [NAME]: holds(me) } }),
      teammateState: (attacker) => (holds(attacker.key) ? { teamRelicSet: NAME } : {}),
    }
  },
}
