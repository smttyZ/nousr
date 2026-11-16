import type { SetModule } from './equipment'

/**
 * Giant Tree of Rapt Brooding (set 320), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 320`).
 * Summary: an ornament, 2 pieces: SPD +6%. When the wearer's SPD is 135 or higher, the wearer's and their
 * memosprite's Outgoing Healing +12%; at 180 or higher, +20% in total (Fribbels: +12%, then +8% more).
 *
 * Kind of each part:
 * - SPD +6%: always on. Fribbels adds it itself (`p2c`), so the wearer's out-of-battle SPD already has it.
 * - Outgoing Healing 12% / 20%: a threshold on the wearer's SPD, and Fribbels evaluates it itself. Its two dynamic conditionals
 *   (`sets/ornaments/GiantTreeOfRaptBrooding.ts`) test `x.getActionValueByIndex(StatKey.SPD, SELF_ENTITY_INDEX) >= 135` / `>= 180`,
 *   which is the wearer's IN-COMBAT SPD for the request being priced: the basic SPD plus every SPD buff the request carries
 *   (teammates' conditionals, light cones, injected buffs), and they buff `StatKey.OHB` on the wearer and its memosprite.
 *   There is no `setConditionals` key, so this module supplies nothing to the kernel.
 *
 * So the bonus is already in every heal the kernel prices for the wearer: a kit reads its heal with `Battle.healAmount`
 * (a heal hit's amount carries the healer's Outgoing Healing Boost, `HealDamageFunction`) and applies it with `Party.heal`.
 * Checked against the real kernel (`giantTreeHeal.integration.test.ts`, Fu Xuan's Dunjia): under 135 SPD gives 0, from 135 +12%, from 180 +20%.
 *
 * Which SPD: the kernel's in-combat SPD, not the timeline's. The two can differ, because the timeline has SPD buffs Fribbels is
 * not told about (a timed `spdPct` modifier from Warrior Goddess' Gentle Rain, Eternal Calculus) and Fribbels has SPD buffs the
 * timeline does not carry. The threshold is a property of the in-battle SPD in the game, and the sim holds two readings of it, so this
 * module checks them at the wearer's heals: when the two SPDs are on different sides of 135 or of 180, the run STOPS with an
 * error naming both, rather than price a heal with a bonus one reading says it should not have. Where they agree (no SPD buffs
 * on the wearer, or buffs that move neither past a threshold) nothing changes.
 *
 * What the module cannot see: a heal whose amount the kit worked out by hand and passed to `Party.heal` without the kernel
 * does not carry the bonus, and nothing here can tell. Kits read heals with `Battle.healAmount`.
 *
 * IN-GAME CHECK: "When the wearer's SPD is 135/180 or higher": whether this is the SPD in battle (after the team's SPD buffs) or the
 * SPD out of battle. Fribbels reads the in-combat SPD, and so does this module.
 */

const THRESHOLD_LOW = 135
const THRESHOLD_HIGH = 180
/** The tolerance of a float comparison at a threshold. */
const EPSILON = 1e-9

/** 0 below 135, 1 from 135, 2 from 180. */
const tier = (spd: number): number => (spd + EPSILON >= THRESHOLD_HIGH ? 2 : spd + EPSILON >= THRESHOLD_LOW ? 1 : 0)

export const GiantTreeOfRaptBrooding: SetModule = {
  kind: 'set',
  type: 'ornament',
  name: 'Giant Tree of Rapt Brooding',
  setId: '320',

  create(battle, wearer) {
    const me = wearer.key
    battle.timeline.bus.on('healed', ({ source }) => {
      // The wearer's own heals, and its summons' and memosprites' (the bonus covers the wearer's and its memosprite's Outgoing Healing).
      if (source !== me && !battle.summonsOf(me).includes(source) && !battle.memospritesOf(me).includes(source)) return
      const live = battle.timeline.spd(me)
      const priced = battle.combatStats(me).SPD
      if (tier(live) === tier(priced)) return
      throw new Error(
        `Giant Tree of Rapt Brooding on ${me}: the timeline has ${me} at SPD ${live.toFixed(2)} and the kernel at ${priced.toFixed(2)}, ` +
          `on different sides of the 135 / 180 Outgoing Healing thresholds, so a heal from ${source} is priced with a bonus the timeline's ` +
          `SPD would not give (or the other way round). The kernel's SPD is what Fribbels applies the bonus on; make the two agree ` +
          `(an SPD buff one side does not carry), see the module's header.`,
      )
    })
    return {}
  },
}
