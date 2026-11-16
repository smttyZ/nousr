import type { LightConeModule } from './equipment'

/**
 * This Love, Forever (23052), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs 23052`). S1: the wearer's SPD +18%
 * (S2..S5: 21 / 24 / 27 / 30%), always on, which Fribbels adds itself. "When the wearer's memosprite uses Memosprite Skill on one ally,
 * gains Blank": all enemies take 10% more DMG (12 / 14 / 16 / 18%). "On an enemy, gains Verse": all allies' CRIT DMG +16% (19 / 22 /
 * 25 / 28%). "When the wearer's memosprite has both, both effects are raised by 60%" (65 / 70 / 75 / 80%).
 *
 * Fribbels has two switches, `vulnerability` (Blank) and `cdBoost` (Verse), both on by default, and applies the "both" rise itself when
 * both are on (`precomputeMutualEffectsContainer`), for the wearer and as a teammate alike. This module supplies them live: Blank is a
 * modifier the wearer's memosprite gets from a Memosprite Skill action that hits no enemy (an Ode on an ally), Verse from one that hits
 * enemies (Minuet). Both are held by the memosprite, so they go when it leaves the field.
 *
 * IN-GAME CHECK: the text gives neither effect a duration, so each lasts until the memosprite leaves the field (for Cyrene's Demiurge:
 * the rest of the battle). Fribbels has them always on.
 * Settled by Smitty in game, 2026-11-15: "This Ode, to All Lives" cannot target Cyrene herself, so no Ode on the wearer herself exists to count.
 * IN-GAME CHECK: "has both" is read across the wearer's memosprites together (one memosprite for every kit here that wears it).
 *
 * "The wearer's memosprite uses Memosprite Skill" is read as a `'skill'` action of a memosprite the wearer owns (`actionUsed.owner`).
 * That is what every memosprite kit in the repo uses for its Memosprite Skills (Little Ica's, Netherwing's Breath, Demiurge's).
 */

const KEY = 'lightcone.23052'
export const BLANK_MODIFIER = `${KEY}.blank`
export const VERSE_MODIFIER = `${KEY}.verse`

export const ThisLoveForever: LightConeModule = {
  kind: 'lightCone',
  id: '23052',
  name: 'This Love, Forever',

  create(battle, wearer) {
    const me = wearer.key
    const level = wearer.kernel.unit.superimposition
    if (!(Number.isInteger(level) && level >= 1 && level <= 5)) {
      throw new Error(`This Love, Forever: superimposition must be 1 to 5, got ${level}`)
    }
    const { modifiers } = battle.timeline

    battle.timeline.bus.on('actionUsed', (action) => {
      if (action.owner !== me || action.kind !== 'skill') return
      // On an enemy: Verse. On an ally (it hit no enemy): Blank.
      modifiers.apply({ id: action.enemiesHit.length > 0 ? VERSE_MODIFIER : BLANK_MODIFIER, target: action.actor, source: me })
    })

    const held = (id: string): boolean => battle.memospritesOf(me).some((unit) => modifiers.has(unit, id))
    const state = () => ({ vulnerability: held(BLANK_MODIFIER), cdBoost: held(VERSE_MODIFIER) })
    return {
      attackerState: () => ({ lightConeConditionals: state() }),
      teammateState: () => ({ lightConeConditionals: state() }),
    }
  },
}
