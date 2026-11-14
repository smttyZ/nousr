import type { SetModule } from './equipment'

/**
 * Giant Tree of Rapt Brooding (set 320), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 320`).
 * Summary: an ornament, 2 pieces: SPD +6%. When the wearer's SPD is 135 or higher, the wearer's and their
 * memosprite's Outgoing Healing +12%; at 180 or higher, +20% in total.
 *
 * Kind of each part:
 * - SPD +6%: always on. Fribbels adds it itself (`p2c`), so the wearer's out-of-battle SPD already has it.
 * - Outgoing Healing 12% / 20%: a threshold on the wearer's SPD. Fribbels checks it itself, in two dynamic
 *   conditionals (`sets/ornaments/GiantTreeOfRaptBrooding.ts`), against the SPD action value its rotation gives the
 *   wearer. There is no `setConditionals` key. Outgoing Healing changes healing only, never damage, so the damage
 *   kernel's numbers do not depend on it.
 *
 * NOT MODELLED: Outgoing Healing. The engine has no outgoing-healing modifier for kits to read (`Party.heal` takes the
 * amount the kit gives), and no memosprite heals. The 2-piece's healing bonus would change every heal the wearer makes.
 * `create` cannot tell whether the wearer will heal, so the module subscribes to `healed` and throws the first time
 * the wearer, or a summon it owns (`Battle.summonsOf`), heals. That is the earliest point the missing part changes a result: a wearer that never heals is simulated
 * correctly, and the run stops on its first heal rather than produce numbers that leave the bonus out.
 *
 * IN-GAME CHECK: "When the wearer's SPD is 135/180 or higher": whether this is the SPD in battle (after the team's
 * SPD buffs) or the SPD out of battle. Fribbels reads the SPD its rotation gives the wearer when it acts.
 */
export const GiantTreeOfRaptBrooding: SetModule = {
  kind: 'set',
  type: 'ornament',
  name: 'Giant Tree of Rapt Brooding',
  setId: '320',

  create(battle, wearer) {
    const me = wearer.key
    battle.timeline.bus.on('healed', ({ source, amount }) => {
      // The wearer's own heals, and its summons' (the bonus covers the wearer's and its memosprite's Outgoing Healing).
      if (source !== me && !battle.summonsOf(me).includes(source)) return
      throw new Error(
        `Giant Tree of Rapt Brooding on ${me}: NOT MODELLED: its Outgoing Healing bonus (SPD 135/180) is not built, and ${me} ` +
          `has just healed for ${amount}, which that bonus would change. Kits have no outgoing-healing modifier yet (DESIGN.md K4).`,
      )
    })
    return {}
  },
}
