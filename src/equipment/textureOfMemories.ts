import type { LightConeModule } from './equipment'

/**
 * Texture of Memories (24002), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs 24002`).
 * Summary: Effect RES (always on, Fribbels adds it). If the wearer is attacked and has no Shield, they gain a Shield of a
 * share of their Max HP for 2 turns, at most once every 3 turns. While the wearer has a Shield when attacked, the DMG it
 * receives is reduced. Superimposition 1 to 5: Shield 16 / 20 / 24 / 28 / 32% of Max HP, DMG reduction 12 / 15 / 18 / 21 / 24%.
 *
 * Fribbels has one switch for it, `activeShieldDmgDecrease` (the DMG reduction, which matters for the wearer's survival
 * and not for the damage it deals), on by default. This module supplies it live (on while the wearer holds a Shield) and
 * does the rest on the party:
 * - Before each enemy attack (the `enemyAttack` event, which comes before the damage is worked out), if the wearer has no
 *   Shield and the cooldown is not running, it gets the Shield, and the cooldown starts. Then, if the wearer has a
 *   Shield, a damage reduction is set on it for this attack, else cleared.
 * - The Shield is stored under its own key, so it never adds to another Shield the wearer holds (the party takes the
 *   largest, and every Shield loses the hit's amount). It ends with a modifier counted on the wearer's turns, 2 turns
 *   from the end of the turn it was gained in; the cooldown is a modifier of 3 turns on the same clock.
 *
 * Expected value: an enemy attack hits the wearer with some probability p (its share of the attack's targets: 1 for an AoE,
 * its aggro share for a single-target attack, 1 - (1 - share)^hits for a bounce, its own plus its neighbours' shares for a
 * blast). The Shield is gained with that probability, so its amount is p x the full amount, which is exactly what the
 * party's expected hit damage (p x the hit) needs to be absorbed. The cooldown starts whenever p > 0: the game starts it
 * only on the attacks that really hit the wearer, so the cooldown here is longer than the real one on average. That is
 * the known approximation of a threshold on an expected value (DESIGN.md). Taunt is not read: shares are by aggro only.
 *
 * IN-GAME CHECK: "attacked" read as before the damage lands, so the very hit that grants the Shield is reduced.
 * IN-GAME CHECK: the Shield's 2 turns and the cooldown's 3 are counted on the wearer's own turns and end at the end of
 * one; the text does not say whose turns or which end.
 */

const KEY = 'lightcone.24002'
const SHIELD_SHARE = [0.16, 0.2, 0.24, 0.28, 0.32] as const
const DMG_REDUCTION = [0.12, 0.15, 0.18, 0.21, 0.24] as const
const SHIELD_TURNS = 2
const COOLDOWN_TURNS = 3
const EPSILON = 1e-9

export const TextureOfMemories: LightConeModule = {
  kind: 'lightCone',
  id: '24002',
  name: 'Texture of Memories',

  create(battle, wearer) {
    const me = wearer.key
    const { timeline, party } = battle
    const level = wearer.kernel.unit.superimposition
    const shieldShare = SHIELD_SHARE[level - 1]
    const reduction = DMG_REDUCTION[level - 1]
    if (shieldShare === undefined || reduction === undefined) {
      throw new Error(`Texture of Memories: superimposition must be 1 to 5, got ${level}`)
    }
    const shieldKey = `${KEY}.shield:${me}`
    const cooldownId = `${KEY}.cooldown:${me}`
    const reductionKey = `${KEY}.dmg_reduction:${me}`

    /** The chance the wearer is hit at least once by this enemy attack. */
    const hitChance = (attackId: string): number => {
      const attack = battle.enemies.profile.attacks.find((a) => a.id === attackId)
      if (!attack) throw new Error(`Texture of Memories: no enemy attack "${attackId}" in the profile`)
      const shares = party.targetShares()
      const share = shares.get(me) ?? 0
      switch (attack.target) {
        case 'aoe':
          return party.standing().includes(me) ? 1 : 0
        case 'single':
          return share
        case 'bounce':
          return 1 - (1 - share) ** attack.hits
        case 'blast': {
          const line = party.standing()
          const i = line.indexOf(me)
          if (i < 0) return 0
          const neighbours = [line[i - 1], line[i + 1]].filter((id): id is string => id !== undefined)
          return Math.min(1, share + neighbours.reduce((sum, id) => sum + (shares.get(id) ?? 0), 0))
        }
      }
    }

    timeline.bus.on('enemyAttack', ({ attack }) => {
      if (party.get(me).downed) return
      const p = hitChance(attack)
      if (p > 0 && party.shield(me) <= EPSILON && !timeline.modifiers.has(me, cooldownId)) {
        party.setShield(me, shieldKey, p * shieldShare * party.get(me).maxHp)
        timeline.modifiers.apply({ id: shieldKey, target: me, source: me, duration: { turns: SHIELD_TURNS, tick: 'turnEnd' } })
        timeline.modifiers.apply({ id: cooldownId, target: me, source: me, duration: { turns: COOLDOWN_TURNS, tick: 'turnEnd' } })
      }
      party.setDamageReduction(me, reductionKey, party.shield(me) > EPSILON ? reduction : undefined)
    })

    timeline.bus.on('modifierRemoved', ({ modifier }) => {
      if (modifier.id === shieldKey && party.has(me)) party.setShield(me, shieldKey, undefined)
    })

    return {
      attackerState: () => ({ lightConeConditionals: { activeShieldDmgDecrease: party.shield(me) > EPSILON } }),
    }
  },
}
