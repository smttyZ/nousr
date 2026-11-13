import type { Battle, Member } from '../battle/battle'
import type { UnitId } from '../engine/events'
import type { Kit, KitInstance } from './kit'

/**
 * Acheron (1308), from the 4.7.0 in-game text (`node tools/gamedata/kit-text.mjs 1308`).
 * All traces are taken as unlocked, as Fribbels does.
 *
 * - No energy. The Ultimate needs 9 Slashed Dream. Points past 9 become Quadrivalent Ascendance
 *   (up to 3), each of which gives 1 Slashed Dream and 1 Crimson Knot back after an Ultimate.
 * - Crimson Knot is a mark on an enemy (not a debuff), up to 9 per enemy.
 * - Talent: when any action puts a debuff on an enemy, +1 Slashed Dream and 1 Crimson Knot, once per action.
 *
 * Who she aims at: the enemy with the most Crimson Knots, which is the primary target unless a
 * teammate's debuff put knots elsewhere (DESIGN.md, K2 and K3).
 *
 * Open (DESIGN.md): Thunder Core's +30% is applied from the hit after the Rainblade that grants it.
 * Not modelled: the technique's own 200% ATK hit.
 *
 * Toughness (K7), internal units from `node tools/gamedata/kit-text.mjs 1308` ("toughness a/b/c": the
 * designated target / every enemy / adjacent): Basic 30/0/0, Skill 60/0/30, each Rainblade 15/15/0, Stygian
 * Resurge 0/15/0. The 15 to every enemy of a Rainblade goes with its Crimson Knot detonation, so a Rainblade on
 * an enemy with no knots removes only the 15 on its target. A full-knot Ultimate removes 105 from the primary
 * target, which is Fribbels' 35 (`toughnessDmg(35)`, vendor/hsr-optimizer/src/lib/conditionals/character/
 * 1300/Acheron.ts:287) times 3. Her Ultimate ignores weaknesses (talent text); from E6 so do her Basic ATK and
 * Skill. Thunder Core's six hits have no toughness in the game data.
 * IN-GAME CHECK: the Affinitive Eidolon's follow-up. The data lists no toughness for it. Fribbels gives the
 * follow-up `toughnessDmg(10)` (30 here) on its one hit; read as 30 to every enemy on the 300% AoE part and 0 on
 * the bounces, and as following weaknesses (the talent text only names the Ultimate and E6's Basic and Skill).
 */

const MAX_SLASHED_DREAM = 9
const MAX_KNOTS = 9
const MAX_QUADRIVALENT = 3
const MAX_THUNDER_CORE = 3
const THUNDER_CORE_HIT = 0.25
const THUNDER_CORE_HITS = 6
const FOLLOW_UP_AOE = 3.0
const FOLLOW_UP_BOUNCE = 0.8
const FOLLOW_UP_BOUNCES = 6

/** Toughness per part, internal units (see the header). */
const TOUGHNESS_BASIC = 30
const TOUGHNESS_SKILL = 60
const TOUGHNESS_SKILL_ADJACENT = 30
const TOUGHNESS_RAINBLADE = 15
const TOUGHNESS_RAINBLADE_ALL = 15
const TOUGHNESS_STYGIAN_RESURGE = 15
const TOUGHNESS_FOLLOW_UP_AOE = 30

const KNOT = 'acheron.crimson_knot'
const THUNDER_CORE = 'acheron.thunder_core'
const E4_VULNERABILITY = 'acheron.e4_ultimate_vulnerability'

/** Ability multipliers by eidolon. E3 raises the Ultimate and Basic ATK, E5 the Skill. */
export function acheronScalings(eidolon: number) {
  return {
    basic: eidolon >= 3 ? 1.1 : 1.0,
    skillMain: eidolon >= 5 ? 1.76 : 1.6,
    skillAdjacent: eidolon >= 5 ? 0.66 : 0.6,
    rainblade: eidolon >= 3 ? 0.2592 : 0.24,
    /** Per Rainblade that removes knots: this much to all enemies, plus this much again per knot removed. */
    knot: eidolon >= 3 ? 0.162 : 0.15,
    stygianResurge: eidolon >= 3 ? 1.296 : 1.2,
  }
}

export const Acheron: Kit = {
  characterId: '1308',
  path: 'Nihility',
  element: 'Lightning',
  maxEnergy: 0,
  // Fribbels has no buffed version of her: only the original kit (K13).
  abilityVersions: [0],

  create(battle: Battle, self: Member): KitInstance {
    const { timeline } = battle
    const me = self.key
    const e = self.eidolon
    const s = acheronScalings(e)

    let slashedDream = 0
    let quadrivalent = 0
    let followUpUsedThisTurn = false

    const knots = (enemy: UnitId) => timeline.modifiers.get(enemy, KNOT)?.stacks ?? 0
    const setKnots = (enemy: UnitId, stacks: number) => {
      if (stacks > 0) timeline.modifiers.apply({ id: KNOT, target: enemy, source: me, stacks: Math.min(MAX_KNOTS, stacks) })
      else timeline.modifiers.remove(enemy, KNOT)
    }
    /** The enemy with the most knots among the candidates; the primary target wins ties. */
    const mostKnotted = (candidates: readonly UnitId[] = battle.enemies.ids) => {
      let best = candidates.includes(battle.primary) ? battle.primary : candidates[0]!
      for (const enemy of candidates) if (knots(enemy) > knots(best)) best = enemy
      return best
    }
    const thunderCore = () => timeline.modifiers.get(me, THUNDER_CORE)?.stacks ?? 0

    const gainSlashedDream = (n: number) => {
      const total = slashedDream + n
      slashedDream = Math.min(MAX_SLASHED_DREAM, total)
      quadrivalent = Math.min(MAX_QUADRIVALENT, quadrivalent + Math.max(0, total - MAX_SLASHED_DREAM))
    }
    const gainStack = (enemy: UnitId) => {
      gainSlashedDream(1)
      setKnots(enemy, knots(enemy) + 1)
    }

    // Talent: a debuff landing during any action. Once per action, on the debuffed enemy with the most knots.
    timeline.bus.on('actionUsed', (action) => {
      if (action.debuffed.length > 0) gainStack(mostKnotted(action.debuffed))
    })

    timeline.bus.on('turnStart', (turn) => {
      if (turn.unit !== me) return
      followUpUsedThisTurn = false
      // E2: at the start of her turn, 1 Slashed Dream and 1 knot on the enemy with the most.
      if (e >= 2) gainStack(mostKnotted())
    })

    // Affinitive Eidolon: after a teammate attacks an enemy that has Crimson Knot. Once per turn of hers.
    if (self.affinitiveEidolon) {
      timeline.bus.on('actionUsed', (action) => {
        if (followUpUsedThisTurn || action.actor === me || !battle.isAlly(action.actor)) return
        if (!action.enemiesHit.some((enemy) => knots(enemy) > 0)) return
        followUpUsedThisTurn = true
        battle.performAction(me, 'affinitive_follow_up', 'followUp', () => {
          battle.attack({
            attacker: me,
            ability: 'FUA',
            parts: [
              { shape: 'aoe', scaling: FOLLOW_UP_AOE, hit: 0, toughness: TOUGHNESS_FOLLOW_UP_AOE },
              { shape: 'bounce', scaling: FOLLOW_UP_BOUNCE, hits: FOLLOW_UP_BOUNCES, hit: 0 },
            ],
          })
          gainStack(mostKnotted())
        })
      })
    }

    return {
      actions: {
        basic: {
          kind: 'basic',
          canUse: () => true,
          use: () =>
            battle.performAction(me, 'basic', 'basic', () => {
              battle.gainSkillPoints(1)
              battle.attack({ attacker: me, ability: 'BASIC', parts: [{ shape: 'single', scaling: s.basic, target: mostKnotted(), hit: 0, toughness: TOUGHNESS_BASIC, ignoresWeakness: e >= 6 }],
              })
            }),
        },
        skill: {
          kind: 'skill',
          canUse: () => battle.skillPoints >= 1,
          use: () =>
            battle.performAction(me, 'skill', 'skill', () => {
              battle.spendSkillPoints(1)
              const target = mostKnotted()
              gainStack(target)
              battle.attack({
                attacker: me,
                ability: 'SKILL',
                parts: [{
                  shape: 'blast',
                  scaling: s.skillMain,
                  adjacent: s.skillAdjacent,
                  target,
                  hit: 0,
                  toughness: TOUGHNESS_SKILL,
                  adjacentToughness: TOUGHNESS_SKILL_ADJACENT,
                  ignoresWeakness: e >= 6,
                }],
              })
            }),
        },
        ultimate: {
          kind: 'ultimate',
          canUse: () => slashedDream >= MAX_SLASHED_DREAM,
          use: () =>
            battle.performAction(me, 'ultimate', 'ultimate', () => {
              slashedDream = 0
              for (let blade = 0; blade < 3; blade++) {
                const target = mostKnotted()
                const held = knots(target)
                battle.attack({
                  attacker: me,
                  ability: 'ULT',
                  parts: [{ shape: 'single', scaling: s.rainblade, target, hit: 0, toughness: TOUGHNESS_RAINBLADE, ignoresWeakness: true }],
                })
                if (held <= 0) continue
                // Thunder Core: a Rainblade that hits a knotted enemy. 3 turns, refreshed each time.
                timeline.modifiers.apply({
                  id: THUNDER_CORE,
                  target: me,
                  source: me,
                  stacks: Math.min(MAX_THUNDER_CORE, thunderCore() + 1),
                  duration: { turns: 3, tick: 'turnEnd' },
                })
                const removed = Math.min(3, held)
                setKnots(target, held - removed)
                battle.attack({
                  attacker: me,
                  ability: 'ULT',
                  parts: [{
                    shape: 'aoe',
                    scaling: s.knot * (Math.min(1, removed) + removed),
                    hit: 0,
                    toughness: TOUGHNESS_RAINBLADE_ALL,
                    ignoresWeakness: true,
                  }],
                })
              }
              // Stygian Resurge: all enemies, then every remaining knot is removed without detonating.
              battle.attack({
                attacker: me,
                ability: 'ULT',
                parts: [{ shape: 'aoe', scaling: s.stygianResurge, hit: 0, toughness: TOUGHNESS_STYGIAN_RESURGE, ignoresWeakness: true }],
              })
              for (const enemy of battle.enemies.ids) setKnots(enemy, 0)
              battle.attack({
                attacker: me,
                ability: 'ULT',
                parts: [{ shape: 'bounce', scaling: THUNDER_CORE_HIT, hits: THUNDER_CORE_HITS, hit: 0 }],
              })
              // Quadrivalent Ascendance: after the Ultimate, on a random enemy (the primary target, K2).
              if (quadrivalent > 0) {
                quadrivalent -= 1
                gainStack(battle.primary)
              }
            }),
        },
      },

      quantities: {
        slashed_dream: () => slashedDream,
        crimson_knots: () => knots(mostKnotted()),
        quadrivalent_ascendance: () => quadrivalent,
        thunder_core: () => thunderCore(),
      },

      attackerState: (enemy) => ({
        characterConditionals: {
          // The kit deals the knot detonations and Thunder Core hits itself, part by part.
          crimsonKnotStacks: 0,
          stygianResurgeHitsOnTarget: 0,
          thunderCoreStacks: thunderCore(),
          nihilityTeammatesBuff: true,
          e1EnemyDebuffed: battle.hasDebuff(enemy),
          e4UltVulnerability: true,
          e6UltBuffs: true,
        },
      }),

      // E4: enemies take 8% more Ultimate DMG from everyone. Fribbels checks the eidolon itself.
      teammateState: () => ({ characterConditionals: { e4UltVulnerability: true } }),

      onBattleStart: ({ techniques }) => {
        // Red Oni: 5 Slashed Dream, and 5 Crimson Knots on a random enemy (the primary target, K2).
        gainSlashedDream(5)
        setKnots(battle.primary, 5)
        // Technique: one stack of Quadrivalent Ascendance at the start of the wave.
        if (techniques) quadrivalent = Math.min(MAX_QUADRIVALENT, quadrivalent + 1)
        // E4: enemies entering combat are inflicted with the Ultimate DMG vulnerability. Fribbels
        // adds the 8% itself; what matters here is that every enemy now counts as debuffed (her
        // E1, and anyone else's "against debuffed enemies"). Not an ability use, so no talent stack.
        if (e >= 4) {
          for (const enemy of battle.enemies.ids) {
            timeline.modifiers.apply({ id: E4_VULNERABILITY, target: enemy, source: me, debuff: true })
          }
        }
      },
    }
  },
}
