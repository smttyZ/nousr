import type { EquipmentInstance, SetModule } from './equipment'

/**
 * Longevous Disciple (set 113), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 113`).
 * Summary: 2 pieces, Max HP +12% (always on). 4 pieces: when the wearer is hit or has its HP consumed by an ally or itself, its
 * CRIT Rate rises 8% for 2 turns, up to 2 stacks.
 *
 * Kind of each part:
 * - Max HP +12%: always on. Fribbels adds it itself (`p2c`).
 * - The CRIT Rate is Fribbels' menu `setConditionals['Longevous Disciple']`, the stack count (0 to 2), applied as CRIT Rate +8% x
 *   the value to the wearer's own attacks. Its default is 2 stacks, so the module always gives its live value. The set has no
 *   team form: only the wearer's CRIT Rate moves, so `teammateState` gives nothing.
 *
 * How the stacks move (the module's reading):
 * - A stack comes from each time the wearer is hit (`allyHit` from an enemy turn) and from each time the wearer's HP is consumed
 *   (`hpLost` with cause 'consume', by anyone: Hyacine's Take Sky in Hand, the wearer's own cost). A hit in the engine is an expected count
 *   (`hits`, a chance for a single-target attack, a count for a bounce): a bounce is `attack.hits` independent trials, each landing on the
 *   wearer with probability `hits / attack.hits` (as Trend of the Universal Market reads it), a single-target, blast or AoE hit is one trial
 *   with probability `min(1, hits)`. A consumption is a certain trial. HP lost to damage that is not a hit (a redirect from Fu
 *   Xuan's Matrix, `hpLost` cause 'damage' without an `allyHit`) is not counted.
 * - The stack count is a distribution over 0, 1 and 2 stacks (each trial moves probability up one stack, the top stack absorbs), and
 *   the kernel gets its mean, `P(1) + 2 P(2)`. That is exact for the CRIT Rate (linear in the stacks) up to the 100% cap, and it applies
 *   the cap of 2 stacks to each outcome rather than to the mean.
 * - All stacks share one duration of 2 of the wearer's turns, counted at the end of each (the turn a stack was gained in does not count),
 *   refreshed whenever a trial with a chance above 0 happens. When the duration runs out the distribution returns to 0 stacks.
 *
 * Approximation: the refresh happens whenever a stack COULD have been gained, so with a small chance the stacks are kept alive longer than
 *   they would be in the average outcome (it can only overstate).
 * IN-GAME CHECK: whether a new stack refreshes the 2 turns of the stack(s) already held, or each stack runs its own 2 turns. Read as one shared timer.
 * IN-GAME CHECK: whether a hit that deals no damage (fully absorbed by a shield) counts as "hit". Read as yes.
 * IN-GAME CHECK: whether damage Fu Xuan's Matrix moves onto the wearer counts as the wearer being hit. Read as no.
 * IN-GAME CHECK: 2 turns counted on the wearer's turns (not the enemies'), the way the set's other timed buffs are.
 */

const NAME = 'Longevous Disciple'
const STACKS = 'set.113.stacks'
const MAX_STACKS = 2
const DURATION_TURNS = 2

export const LongevousDisciple: SetModule = {
  kind: 'set',
  type: 'relic',
  name: NAME,
  setId: '113',

  create(battle, wearer, pieces): EquipmentInstance {
    if (pieces !== 4) return {}

    const me = wearer.key
    const { timeline } = battle
    /** The probability of holding 0, 1, 2 stacks. */
    let dist: [number, number, number] = [1, 0, 0]
    const mean = (): number => dist[1] + MAX_STACKS * dist[2]

    /** One chance `p` of gaining a stack. */
    const trial = (p: number): void => {
      const [d0, d1, d2] = dist
      dist = [d0 * (1 - p), d1 * (1 - p) + d0 * p, d2 + d1 * p]
    }

    /** Runs the trials, then records the stacks on the wearer and refreshes the duration. */
    const gain = (trials: number, p: number): void => {
      if (!(p > 0)) return
      for (let i = 0; i < trials; i++) trial(p)
      timeline.modifiers.apply({
        id: STACKS,
        target: me,
        source: me,
        stacks: mean(),
        duration: { turns: DURATION_TURNS, tick: 'turnEnd' },
      })
    }

    timeline.bus.on('modifierRemoved', ({ modifier }) => {
      if (modifier.id === STACKS && modifier.target === me) dist = [1, 0, 0]
    })

    timeline.bus.on('allyHit', ({ unit, attack, hits }) => {
      if (unit !== me || !(hits > 0)) return
      const profileAttack = battle.enemies.profile.attacks.find((a) => a.id === attack)
      if (!profileAttack) throw new Error(`${NAME}: no enemy attack "${attack}" in the profile`)
      if (profileAttack.target === 'bounce') gain(profileAttack.hits, Math.min(1, hits / profileAttack.hits))
      else gain(1, Math.min(1, hits))
    })

    timeline.bus.on('hpLost', ({ unit, cause, amount }) => {
      if (unit === me && cause === 'consume' && amount > 0) gain(1, 1)
    })

    return {
      attackerState: () => ({ setConditionals: { [NAME]: timeline.modifiers.get(me, STACKS)?.stacks ?? 0 } }),
    }
  },
}
