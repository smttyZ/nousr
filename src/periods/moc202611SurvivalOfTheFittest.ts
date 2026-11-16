import type { Battle } from '../battle/battle'
import type { PeriodModule } from './period'

/**
 * Memory of Chaos, Survival of the Fittest (runs 2026-11-02 to 2026-12-14; DESIGN.md, decision 4b).
 *
 * In-game rule text (Smitty, 2026-11-16):
 *
 *   "When an ally target uses their Ultimate, they gain 5 Punchlines. At the start of each Cycle, Aha
 *    immediately gains 1 extra turn with a fixed 20 Punchlines taken into account. This turn does not
 *    consume Punchlines."
 *
 * Punchlines and Aha belong to the Elation path, which is not modelled. The rule only matters to a team
 * with an Elation-path character (Punchlines are what Elation damage scales with), so:
 *
 * - A team with no Elation-path character: the module does nothing. The result is the same as with
 *   `period: null`.
 * - A team with an Elation-path character: the run stops with an error naming the member, because the
 *   period would change that character's result and the simulator cannot say how.
 *
 * The Elation check is on the kit's `path`. Fribbels writes the path as 'Elation' too.
 */
export const MOC_2026_11_SURVIVAL_OF_THE_FITTEST = 'moc-2026-11-survival-of-the-fittest'

export const SurvivalOfTheFittest: PeriodModule = {
  id: MOC_2026_11_SURVIVAL_OF_THE_FITTEST,
  name: 'Survival of the Fittest',
  check: (members) =>
    members
      .filter((m) => m.kit.path === 'Elation')
      .map((m) => `member "${m.key}" (character ${m.kit.characterId}): Elation's Punchlines and Aha are not modelled yet; this period would change the result`),
  create(battle: Battle): void {
    const problems = SurvivalOfTheFittest.check!(battle.members)
    if (problems.length > 0) throw new Error(`Period "${MOC_2026_11_SURVIVAL_OF_THE_FITTEST}": ${problems.join('; ')}`)
    // Nothing else to do: with no Elation-path ally there are no Punchlines to gain, and Aha's turn does not touch the team.
  },
}
