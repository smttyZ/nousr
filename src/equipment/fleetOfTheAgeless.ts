import type { SetModule } from './equipment'

/**
 * Fleet of the Ageless (set 302), an ornament, from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 302`).
 * Summary: 2 pieces, the wearer's Max HP +12% (always on). When the wearer's SPD is 120 or higher, all allies' ATK +8%.
 *
 * Kind of each part:
 * - Max HP +12%: always on. Fribbels adds it itself (`p2c`).
 * - The wearer's own attacks: Fribbels' dynamic conditional (`FleetOfTheAgelessConditional`) reads the wearer's in-combat SPD from the
 *   kernel's stats and, at 120 or more, adds 8% of base ATK to the wearer. It has no `setConditionals` key, so there is nothing
 *   to supply: Fribbels decides on the kernel's SPD (basic SPD plus every SPD buff the request carries).
 * - A teammate's attacks: Fribbels' team form `teamOrnamentSet` is a flat team ATK +8% with no SPD check, so the module decides the
 *   flag: `teammateState` gives `teamOrnamentSet: 'Fleet of the Ageless'` only while the wearer is standing and its SPD is 120 or more.
 *
 * Which SPD, and keeping the two readings consistent. The sim holds the wearer's SPD twice: the kernel's (what Fribbels' own check
 * for the wearer reads) and the timeline's (basic SPD plus the timed SPD modifiers the timeline carries). `teammateState` runs
 * while the kernel's request is being built, so it cannot ask the kernel for the SPD: it reads the timeline's. To keep the wearer's
 * own attacks and the team's flag on the same side of 120, the module compares the two at the start of every turn and after every
 * action, and STOPS with an error naming both when they fall on different sides of 120 (an SPD buff one side does not carry), as
 * Giant Tree of Rapt Brooding does at 135 and 180. Where they agree, nothing changes. Messenger Traversing Hackerspace and Amphoreus
 * keep both sides in step, so a team SPD buff that lifts the wearer over 120 raises the flag at the same moment on both.
 *
 * Downed wearer: the effect ends (the flag is off, nothing is checked).
 *
 * IN-GAME CHECK: "SPD reaches 120 or higher" is read as the in-battle SPD (after buffs), as Fribbels reads it, and as "120 or
 *   more" (an SPD of exactly 120 counts).
 * IN-GAME CHECK: two wearers' +8% stack (Fribbels' teammate entry is not marked non-stackable). The roster has one wearer.
 */

const NAME = 'Fleet of the Ageless'
const THRESHOLD = 120
/** A float comparison at the threshold. */
const EPSILON = 1e-9

const reached = (spd: number): boolean => spd + EPSILON >= THRESHOLD

export const FleetOfTheAgeless: SetModule = {
  kind: 'set',
  type: 'ornament',
  name: NAME,
  setId: '302',

  create(battle, wearer) {
    const me = wearer.key
    const { timeline, party } = battle
    const standing = (): boolean => timeline.has(me) && !party.get(me).downed

    /** Stops the run when the timeline's SPD and the kernel's are on different sides of 120. Called from listeners only (it asks the kernel). */
    const check = (): void => {
      if (!standing()) return
      const live = timeline.spd(me)
      const priced = battle.combatStats(me).SPD
      if (reached(live) === reached(priced)) return
      throw new Error(
        `${NAME} on ${me}: the timeline has ${me} at SPD ${live.toFixed(2)} and the kernel at ${priced.toFixed(2)}, on different sides of the ` +
          `${THRESHOLD} SPD threshold, so the wearer's own ATK (Fribbels reads the kernel's SPD) and the team's ATK (the module reads the ` +
          "timeline's) would disagree about whether the effect is on. Make the two agree (an SPD buff one side does not carry), see the module's header.",
      )
    }
    timeline.bus.on('turnStart', check)
    timeline.bus.on('actionUsed', check)

    return {
      teammateState: () => (standing() && reached(timeline.spd(me)) ? { teamOrnamentSet: NAME } : {}),
    }
  },
}
