import { certain } from '../battle/battle'
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
 * Expected-value stacks (DESIGN.md, K22). A debuff that landed with a probability (a random-target hit) gives the talent's
 * Slashed Dream and Crimson Knot at the chance that at least one debuff landed in the action, so Slashed Dream and knots
 * are numbers that can be fractional. The chance is 1 - the product over the debuffed enemies of the chance none landed on
 * each (`actionUsed.debuffChance`; enemies taken as independent, which overstates it slightly when one random hit can
 * only land on one of them; any enemy hit for certain makes it 1). The knot goes to the debuffed enemy with the most knots:
 * the enemies are ranked (the primary wins ties) and each gets the chance that it is debuffed and no higher-ranked one is.
 * Thresholds that read these numbers are thresholds on an expected value (DESIGN.md, "Known approximations"):
 * - the Ultimate at 9 Slashed Dream is available when the expected Slashed Dream is 9 (within 1e-9): a discrete action
 *   cannot be scaled by a chance, so it waits for the expected value, not for the chance of 9;
 * - a Rainblade "hits a knotted enemy" (Thunder Core, the detonation) counts min(1, knots held) of an occurrence, the
 *   chance of a knot being there when the knots are 0 or 1 with that mean (exact for whole knots);
 * - the Affinitive Eidolon follow-up needs "an enemy that has Crimson Knot": it is used at the chance that some enemy the
 *   attack hit had one (K21: the follow-up's damage, toughness and stack are scaled by it, and what it did not use of
 *   its once-per-turn stays available to the next attack). Its `actionUsed` still reports the hits it would have made.
 * All three are exact whenever the knots are whole numbers, as they are with deterministic debuffs.
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
/** Expected-value stacks (K22) are compared with this tolerance, so a sum that should reach 9 does. */
const EPSILON = 1e-9
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
    /** How much of the follow-up's once-per-turn has been used this turn: 0 to 1 (K21, fractional when it fired at a chance). */
    let followUpUsed = 0

    const knots = (enemy: UnitId) => timeline.modifiers.get(enemy, KNOT)?.stacks ?? 0
    const setKnots = (enemy: UnitId, stacks: number) => {
      if (stacks > EPSILON) timeline.modifiers.apply({ id: KNOT, target: enemy, source: me, stacks: Math.min(MAX_KNOTS, stacks) })
      else timeline.modifiers.remove(enemy, KNOT)
    }
    /** The enemy with the most knots among the candidates; the primary target wins ties. */
    const mostKnotted = (candidates: readonly UnitId[] = battle.enemies.ids) => {
      let best = candidates.includes(battle.primary) ? battle.primary : candidates[0]!
      for (const enemy of candidates) if (knots(enemy) > knots(best) + EPSILON) best = enemy
      return best
    }
    /** The candidates in the order the knot would go to them: most knots first, the primary target first among equals, then in the order given. */
    const rankByKnots = (candidates: readonly UnitId[]) =>
      [...candidates].sort((a, b) => {
        const byKnots = knots(b) - knots(a)
        if (Math.abs(byKnots) > EPSILON) return byKnots
        return (a === battle.primary ? 0 : 1) - (b === battle.primary ? 0 : 1) || candidates.indexOf(a) - candidates.indexOf(b)
      })
    const thunderCore = () => timeline.modifiers.get(me, THUNDER_CORE)?.stacks ?? 0

    const gainSlashedDream = (n: number) => {
      const total = slashedDream + n
      slashedDream = Math.min(MAX_SLASHED_DREAM, total)
      quadrivalent = Math.min(MAX_QUADRIVALENT, quadrivalent + Math.max(0, total - MAX_SLASHED_DREAM))
    }
    /** One Slashed Dream and one knot on `enemy`, or `amount` of each (an expected value, K22). */
    const gainStack = (enemy: UnitId, amount = 1) => {
      gainSlashedDream(amount)
      setKnots(enemy, knots(enemy) + amount)
    }

    // Talent: a debuff landing during any action. Once per action, on the debuffed enemy with the most knots, at the chance
    // that a debuff landed (K22, see the header).
    timeline.bus.on('actionUsed', (action) => {
      if (action.debuffed.length === 0) return
      let none = 1
      for (const enemy of action.debuffed) none *= 1 - (action.debuffChance[enemy] ?? 0)
      const landed = 1 - none
      if (landed <= EPSILON) return
      gainSlashedDream(landed)
      let nobodyAhead = 1
      for (const enemy of rankByKnots(action.debuffed)) {
        const chance = action.debuffChance[enemy] ?? 0
        setKnots(enemy, knots(enemy) + nobodyAhead * chance)
        nobodyAhead *= 1 - chance
      }
    })

    timeline.bus.on('turnStart', (turn) => {
      if (turn.unit !== me) return
      followUpUsed = 0
      // E2: at the start of her turn, 1 Slashed Dream and 1 knot on the enemy with the most.
      if (e >= 2) gainStack(mostKnotted())
    })

    // Affinitive Eidolon: after a teammate attacks an enemy that has Crimson Knot. Once per turn of hers.
    if (self.affinitiveEidolon) {
      timeline.bus.on('actionUsed', (action) => {
        if (followUpUsed >= 1 - EPSILON || action.actor === me || !battle.isAlly(action.actor)) return
        // The chance that some enemy the attack hit had a knot (a knot count below 1 is the chance of one being there).
        let none = 1
        for (const enemy of action.enemiesHit) none *= 1 - (action.hitChance[enemy] ?? 0) * Math.min(1, knots(enemy))
        const chance = 1 - none
        if (chance <= EPSILON) return
        const weight = Math.min(chance, 1) * (1 - followUpUsed)
        followUpUsed += weight
        battle.performAction(me, 'affinitive_follow_up', 'followUp', () => {
          battle.attack({
            attacker: me,
            ability: 'FUA',
            parts: [
              { shape: 'aoe', scaling: FOLLOW_UP_AOE * weight, hit: 0, toughness: TOUGHNESS_FOLLOW_UP_AOE * weight },
              { shape: 'bounce', scaling: FOLLOW_UP_BOUNCE * weight, hits: FOLLOW_UP_BOUNCES, hit: 0 },
            ],
          })
          gainStack(mostKnotted(), weight)
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
          canUse: () => slashedDream >= MAX_SLASHED_DREAM - EPSILON,
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
                if (held <= EPSILON) continue
                // Thunder Core: a Rainblade that hits a knotted enemy (min(1, knots) of one, see the header). 3 turns, refreshed each time.
                timeline.modifiers.apply({
                  id: THUNDER_CORE,
                  target: me,
                  source: me,
                  stacks: Math.min(MAX_THUNDER_CORE, thunderCore() + Math.min(1, held)),
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
          // A boolean kernel switch: priced in each debuff state and weighted (K21, `Battle.kernelResult`).
          e1EnemyDebuffed: certain(battle.debuffChance(enemy)),
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
