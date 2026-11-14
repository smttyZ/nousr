import type { Battle, HitPart } from '../battle/battle'
import type { SetModule } from './equipment'

/**
 * The Ashblazing Grand Duke (set 115), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 115`).
 * Summary: 2 pieces, +20% DMG for the wearer's Follow-Up ATKs. 4 pieces: each time a Follow-Up ATK of the wearer
 * deals damage, the wearer's ATK rises 6%, up to 8 stacks, lasting 3 turns; the next Follow-Up ATK of the wearer
 * removes the stacks.
 *
 * The kernel's value is the stack count (0 to 8). It is read at every pricing from the modifier the module keeps
 * on the wearer: no modifier, no stacks.
 *
 * How the stacks move (the module's reading):
 * - Each hit of a Follow-Up ATK of the wearer on each enemy counts once, as in the game and in Fribbels
 *   (`ashblazingCompute.ts`). The module counts them from the attack's own parts, which the battle gives it in the
 *   `attackResolved` event (`damageDealt` is one event per enemy with all parts summed, so it cannot count hits).
 *   Per part: single = 1; blast = 1 plus the adjacent enemies it reaches (adjacent scaling above 0); AoE = 1 per
 *   enemy; bounce of n = n hits. A part marked `random` (K17) counts its expected hits: `hits x chance x enemies
 *   reached` per part, which over the parts of one random group adds up to `hits` (plus the splash for a blast).
 *   Every attack shape is countable, so no wearer is refused. One Follow-Up ATK is every `attackResolved` of the
 *   wearer's FUA ability between two `actionUsed` events of kind followUp, summed (Acheron's Affinitive Follow-Up is
 *   an AoE part and a 6-hit bounce in one attack; Jing Yuan's Lightning-Lord is several attacks in one action).
 *   Approximation: the count is an expected value (K17) and is capped at 8 after summing, so the cap is applied to
 *   the mean and not to each outcome.
 * - The Follow-Up that removes the stacks is priced with them. When it ends (`actionUsed`, kind followUp) they are
 *   replaced by the stacks its own hits built, so every hit of one Follow-Up sees the same count, whichever enemy it
 *   hits.
 * - Stacks last 3 of the wearer's turns from the last time they were set, counted as the engine counts a buff the
 *   wearer's own turn ends (`turnEnd`). Setting them again refreshes the 3 turns.
 *
 * IN-GAME CHECK: "for every time the Follow-Up ATK deals DMG". Read as each hit on each enemy (Fribbels' reading), so
 * one AoE Follow-Up hit on 3 enemies is 3 stacks. The other reading is one stack per hit, whatever the enemies, which
 * counts a 3-enemy AoE hit once. With 3 enemies that is a factor of 3 on every AoE Follow-Up, so this choice moves
 * results a lot for those teams.
 * IN-GAME CHECK: "This effect is removed the next time the wearer uses a Follow-Up ATK." Read as the
 * Follow-Up that removes the stacks is still priced with them (the stacks are gone once it has resolved).
 * IN-GAME CHECK: whether each new stack refreshes the 3-turn duration, or each stack lasts 3 turns on its own.
 * Read as the whole effect refreshing (one duration for all stacks).
 */

const STACKS = 'set.115.stacks'
const MAX_STACKS = 8
const DURATION_TURNS = 3

/**
 * The (expected) number of hits on enemies that an attack's parts make: see the header for the rules. A part with no
 * damage (scaling of 0 or less) is no hit. Exported for the tests.
 */
export function hitsOfParts(battle: Battle, parts: readonly HitPart[]): number {
  let total = 0
  for (const part of parts) {
    if (!(part.scaling > 0)) continue
    let reach: number
    switch (part.shape) {
      case 'single':
        reach = 1
        break
      case 'blast':
        reach = 1 + (part.adjacent > 0 ? battle.adjacentEnemies(part.target ?? battle.primary).length : 0)
        break
      case 'aoe':
        // A random marker is ignored on an AoE, as `Battle.attack` ignores it.
        total += battle.enemies.ids.length
        continue
      case 'bounce':
        total += part.hits
        continue
    }
    total += part.random ? part.random.hits * part.random.chance * reach : reach
  }
  return total
}

export const TheAshblazingGrandDuke: SetModule = {
  kind: 'set',
  type: 'relic',
  name: 'The Ashblazing Grand Duke',
  setId: '115',

  create(battle, wearer, pieces) {
    // The 2-piece effect (Follow-Up DMG +20%) is always on and Fribbels applies it itself: nothing to track.
    if (pieces !== 4) return {}

    const me = wearer.key
    const { timeline } = battle
    /** Follow-Up hits of the wearer since its last Follow-Up ended. */
    let instances = 0

    timeline.bus.on('attackResolved', (attack) => {
      if (attack.attacker !== me || attack.ability !== 'FUA') return
      instances += hitsOfParts(battle, attack.parts)
    })

    timeline.bus.on('actionUsed', (action) => {
      if (action.actor !== me || action.kind !== 'followUp') return
      const stacks = Math.min(MAX_STACKS, instances)
      instances = 0
      if (stacks === 0) {
        timeline.modifiers.remove(me, STACKS)
        return
      }
      timeline.modifiers.apply({
        id: STACKS,
        target: me,
        source: me,
        stacks,
        duration: { turns: DURATION_TURNS, tick: 'turnEnd' },
      })
    })

    return {
      attackerState: () => ({
        setConditionals: { 'The Ashblazing Grand Duke': timeline.modifiers.get(me, STACKS)?.stacks ?? 0 },
      }),
    }
  },
}
