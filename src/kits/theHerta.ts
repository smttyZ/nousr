import type { Battle, HitPart, Member } from '../battle/battle'
import { reachedSetDistribution } from '../battle/hitProbability'
import type { EngineEvents, UnitId } from '../engine/events'
import type { InjectedBuff } from '../kernel/types'
import { levelsOf } from '../levels/levels'
import type { Kit, KitInstance } from './kit'

/**
 * The Herta (1401), from the 4.7.0 in-game text (`node tools/gamedata/kit-text.mjs 1401`) and Fribbels' `TheHerta.ts`
 * (`vendor/hsr-optimizer/src/lib/conditionals/character/1400/TheHerta.ts`). Erudition, Ice, 220 energy. All traces are taken as
 * unlocked, abilities at the kit text's levels (Lv10 / Lv12 with E3 for Skill and Talent, E5 for Ultimate and Basic ATK).
 *
 * Numbers (kit text; Lv10 -> Lv12): Basic 100% -> 110% (E5). Skill 70% -> 77%. Enhanced Skill 80% -> 88%, final AoE 40% -> 44%, stack
 * bonus 8% / 4% -> 8.8% / 4.4% per stack (Talent, E3). Ultimate 200% -> 220%, ATK +80% -> +88% (E5). Technique ATK +60%, 2 turns.
 * Energy: Basic +20 and +1 SP, Skill and Enhanced Skill +30 and -1 SP, Ultimate costs 220 and gives +5.
 *
 * What is kept where
 * - Interpretation (cap 42) is kit state per enemy (K1), an expected value: random-target hits add fractional stacks (K17/K22), and
 *   the cap is applied to the expectation (a threshold on an expected value, DESIGN.md "Known approximations").
 * - Answer (cap 99), Inspiration (cap 4), and the Ultimate's ATK buff / Technique buff (modifiers on her).
 * - Fribbels prices her with switches: `enhancedSkill`, `ultAtkBuff` (the +80% ATK), `interpretationStacks` and
 *   `totalInterpretationStacks` (only to scale the lumped hit, which NouSR normalises away: every part is priced per 100% of the
 *   kernel's hit, K11), `eruditionTeammate`, `e4EruditionSpdBuff`, `e6Buffs`. The one thing besides scaling that
 *   `interpretationStacks` changes is the +50% Skill DMG at the threshold, so the kit sends 42 while that boost is on and 1 otherwise.
 *   The Technique's ATK +60% is not in Fribbels: it is an injected `ATK_PERCENT` while the modifier lasts.
 *   Message From Beyond the Veil's +80% CRIT DMG (2+ Erudition) and E4's SPD reach teammates through Fribbels' own team count;
 *   the kit still sends the switches explicitly (a teammate's defaults count buffs as always on).
 *
 * Hit pattern of the Skill ("deals X to one designated enemy ... then to the targets hit by this instance and their adjacent targets,
 * repeating 2 times"): three instances. Instance 1 hits the designated enemy only, instance 2 that enemy and its neighbours, instance 3
 * those and THEIR neighbours (enemies within 2 places). So the designated enemy takes 3 hits (Fribbels: 3 x 80%), an adjacent one 2, a
 * second-neighbour (5 enemies) 1. The Enhanced Skill ends with 40% on all enemies. Each instance is its own `Battle.attack` call, so a
 * break in instance 1 prices the later instances as broken, like consecutive hits in game.
 * IN-GAME CHECK: this pattern (do the repeats widen each time, or hit the same set again?). Look at a 5-enemy fight: use the Skill and
 * see whether the outer enemies take damage once, and how many damage numbers the middle enemy shows.
 *
 * Toughness (K7), internal units, kit text "toughness a/b/c": Skill 45/0/30, Enhanced 60/0/30. Read as 15 per hit received, with the
 * designated enemy's first hit of the Enhanced Skill at 30 (45 + 15 = 60; adjacent 2 hits = 30; the 40% AoE removes none, b = 0).
 * IN-GAME CHECK: only the totals are in the text; the split among hits is assumed. Matters only for where a break lands inside the
 * action. Basic 30/0/0, Ultimate 0/60/0.
 *
 * Enhanced Skill, in order (K30: aimed at the enemy with the most Interpretation, ties to the one nearest the middle enemy, then
 * first in standing order; every other action and her teammates use the middle enemy)
 *   1. Consumes 1 Inspiration. N = the aimed enemy's stacks, plus (E1) 50% of the most among it and its neighbours. N is read BEFORE the
 *      stack the Skill inflicts. Erudition count >= 2 doubles the per-stack bonus (8.8% -> 17.6% primary, 4.4% -> 8.8% others).
 *   2. Inflicts 1 stack on it (Answer +1). The aimed enemy then takes 3 x X plus N x 8.8% (x2), added ONCE to its first hit
 *      (Fribbels adds it once to the whole Skill, not per repeat); every other enemy hit takes N x 4.4% (x2), once, on its first hit.
 *      Then 44% on all.
 *   3. +50% Ice DMG for this attack if N >= 42 (Aloofly Honest), for every part of the action.
 *   4. The aimed enemy's stacks are reset to 1 (E1: 15, even if it had fewer), AFTER the hits. Her own after-attack stacks then land.
 *   5. E2: advance 35%.
 * IN-GAME CHECK: (a) the stack bonus once per target or once per hit (Fribbels: once; per hit would triple it); (b) whether the stack the
 * Skill inflicts is counted in N and whether the reset happens before or after the after-attack stacks (kit: N before, reset before);
 * (c) the +50% threshold with E1: N (counted, Fribbels' 28 x 1.5 = 42, the kit's reading) or the enemy's own stacks (the text's
 * literal "the primary target's stack reaches 42"); (d) E1's reset to 15 on an enemy with fewer than 15. Look at the stack count on the
 * target before and after Hear Me Out and at the damage with 41 / 42 stacks.
 *
 * Aloofly Honest and Message From Beyond the Veil react after any ALLY attack (`actionUsed` of a character or memosprite; a summon's action
 * is its owner's, as in the rest of the repo; Additional DMG parts are not attacks, nor are actions with no damage part):
 *   - 1 stack on each enemy hit (scaled by the chance it was hit);
 *   - 3 fixed energy (no Energy Regeneration Rate) per enemy hit, at most 5 targets, at least 3 with 2+ Erudition. Expected value over
 *     the exact distribution of the number of distinct enemies hit (`reachedSetDistribution`);
 *   - Message: 1 stack on the hit enemy with the most stacks (ties: nearest the middle), +2 if the attacker is an Erudition CHARACTER
 *     (a memosprite is not; a summon's action is logged as its owner's, so Jing Yuan's Lightning-Lord gives the +2). Exact over the
 *     random hit sets.
 *   "Ally" includes The Herta herself (the text says "ally targets", not "other"). All stacks, including those at the cap, count as
 *   inflicted for Answer. Stacks are all inflicted after the action (the Skill's own are before its hits).
 * IN-GAME CHECK: (a) does her own attack trigger these (stacks and energy on her own Basic/Skill)? Use Basic ATK and compare the target's
 * stacks and her energy (20 + 3 per target). (b) Does the Message stack need 2+ Erudition in the team? The text puts the CRIT DMG and the
 * "at least 3 targets" under "if the team has 2 or more", and the stack in its own sentence; built as unconditional
 * (`STACKS_NEED_TWO_ERUDITION`). Test with a team of one Erudition (her): attack and read the stacks. (c) Does a stack inflicted at
 * the cap of 42 still give an Answer? Built: yes. (d) Do memosprite and summon attacks count (built: yes, memosprites as allies, a
 * summon as its owner)? (e) Does a summon's hit count as an Erudition attacker for Message's +2 (Lightning-Lord with Jing Yuan)? Built:
 * yes, about 6 extra stacks per Jing Yuan turn. Look: the most-stacked enemy's count before and after one Lightning-Lord action (+3
 * per hit, or +1). docs/in-game-checks.md, check 32.
 *
 * Talent: 1 stack on each enemy at battle start, then 25 on the primary (K2: "a random enemy, prioritizing Elite" is the middle enemy). Both
 * count for Answer. Waves are not modelled (S6), so only the first wave. Stacks "transferred" when an enemy dies never happen (enemies
 * do not die).
 *
 * Ultimate: Rearrangement is no change (every generic enemy is Elite-level, K30). ATK +80% for 3 of HER turns, applied before the hit
 * (the text lists it first) and counted at the end of her turns, the immediate turn after the Ultimate being the first (the Ultimate is
 * cast between turns). Then: she acts at once (advance 100%), +1 Inspiration (max 4; E2 +1 more, also +1 when entering combat).
 * Multiple = 200% (+1% per Answer, Answer is kept: the text does not say the Ultimate spends it) (+ E6: 140% for 3+ enemies, 250% for 2, 400% for 1;
 * Fribbels uses 140% for 2).
 * IN-GAME CHECK: does the Ultimate spend Answer? Check the Answer count before and after.
 *
 * Teammates: E4 SPD +12% for every Erudition character in the team (a timeline modifier on each, base-SPD percent); Fribbels'
 * switch reaches the kernel. The 80% CRIT DMG needs 2+ Erudition: the kernel counts it from the team.
 *
 * Team policy: `skill` is the Enhanced Skill while she has Inspiration and costs 1 Skill Point either way, so a rule like
 * "skill when team.skill_points >= N, else basic" works. Quantities: `inspiration`, `enhanced`, `answer`, `interpretation_target` (stacks
 * on the enemy her Enhanced Skill would aim at), `interpretation_primary`, `interpretation_1`..`_5` (by standing position), `ult_buff`.
 *
 * NOT MODELLED
 * - Rearrangement of stacks to Elite-level targets, and transfer on death (see above).
 * - The Technique's Simulated Universe part; its own Attack hit (no toughness-only hit in the engine).
 * - Loss of her traces' effects when she is downed: only the stack and energy reactions stop; CRIT DMG / SPD buffs stay.
 * - Stacks are not capped per random outcome (expected value), see above.
 */

const MAX_ENERGY = 220
const BASIC_ENERGY = 20
const SKILL_ENERGY = 30
const ULT_ENERGY = 5
const ALOOFLY_ENERGY_PER_TARGET = 3
const ALOOFLY_MAX_TARGETS = 5
const ALOOFLY_MIN_TARGETS_ERUDITION = 3

const STACK_CAP = 42
const ANSWER_CAP = 99
const INSPIRATION_CAP = 4
const START_STACKS = 1
const WAVE_STACKS = 25
const E1_RESET = 15
const NORMAL_RESET = 1
const E1_SHARE = 0.5
const MESSAGE_STACKS = 1
const MESSAGE_ERUDITION_STACKS = 2
const ANSWER_PER_STACK = 0.01
const TECHNIQUE_ATK = 0.6
const E2_ADVANCE = 0.35
const E4_SPD = 0.12
const ULT_ATK_TURNS = 3
const TECHNIQUE_TURNS = 2
const INSTANCES = 3

/** Whether Message From Beyond the Veil's after-attack stack needs 2+ Erudition in the team (IN-GAME CHECK). */
const STACKS_NEED_TWO_ERUDITION = false

const TOUGHNESS_BASIC = 30
const TOUGHNESS_HIT = 15
const TOUGHNESS_ENHANCED_FIRST = 30
const TOUGHNESS_ULT = 60

const EPS = 1e-9

export const ULT_ATK_MODIFIER = 'theHerta.ult_atk'
export const TECHNIQUE_MODIFIER = 'theHerta.technique_atk'
export const E4_MODIFIER = 'theHerta.e4_spd'

/** Ability multiples by eidolon (E3: Skill and Talent Lv12; E5: Ultimate and Basic ATK Lv12). */
export function theHertaScalings(eidolon: number) {
  const l3 = eidolon >= 3
  const l5 = eidolon >= 5
  return {
    basic: l5 ? 1.1 : 1.0,
    skill: l3 ? 0.77 : 0.7,
    enhanced: l3 ? 0.88 : 0.8,
    enhancedAoe: l3 ? 0.44 : 0.4,
    /** Per stack, on the designated enemy; the others get half. */
    stackPrimary: l3 ? 0.088 : 0.08,
    stackOther: l3 ? 0.044 : 0.04,
    ult: l5 ? 2.2 : 2.0,
    ultAtk: l5 ? 0.88 : 0.8,
  }
}

/** The Ultimate's multiple: base + 1% per Answer + E6's bonus by enemy count (140% for 3+, 250% for 2, 400% for 1). */
export function theHertaUltMultiple(eidolon: number, answer: number, enemyCount: number): number {
  const e6 = eidolon >= 6 ? (enemyCount >= 3 ? 1.4 : enemyCount === 2 ? 2.5 : 4.0) : 0
  return theHertaScalings(eidolon).ult + answer * ANSWER_PER_STACK + e6
}

export interface SkillPartPlan {
  /** Position in standing order, from 0. */
  enemy: number
  scaling: number
  toughness: number
}

/**
 * One Skill's attack parts, in the order of the text. `instances` are the three attacks of "repeating 2 times", `tail` the Enhanced
 * Skill's final 40% on all (a multiple per enemy). `counted` is N, the stack count the Enhanced Skill's bonus is read from, and
 * `eruditionBonus` whether 2+ Erudition double it. The bonus is added once per enemy, on its first hit.
 */
export function theHertaSkillPlan(args: {
  eidolon: number
  enemyCount: number
  target: number
  enhanced: boolean
  counted?: number
  eruditionBonus?: boolean
}): { instances: SkillPartPlan[][], tail: number } {
  const s = theHertaScalings(args.eidolon)
  const x = args.enhanced ? s.enhanced : s.skill
  const doubled = args.eruditionBonus === true ? 2 : 1
  const counted = args.enhanced ? (args.counted ?? 0) : 0
  const seen = new Set<number>()
  const instances: SkillPartPlan[][] = []
  for (let k = 0; k < INSTANCES; k++) {
    const hits: SkillPartPlan[] = []
    for (let i = 0; i < args.enemyCount; i++) {
      if (Math.abs(i - args.target) > k) continue
      const first = !seen.has(i)
      seen.add(i)
      const bonus = first ? counted * (i === args.target ? s.stackPrimary : s.stackOther) * doubled : 0
      const designatedFirst = args.enhanced && k === 0 && i === args.target
      hits.push({ enemy: i, scaling: x + bonus, toughness: designatedFirst ? TOUGHNESS_ENHANCED_FIRST : TOUGHNESS_HIT })
    }
    instances.push(hits)
  }
  return { instances, tail: args.enhanced ? s.enhancedAoe : 0 }
}

export const TheHerta: Kit = {
  characterId: '1401',
  path: 'Erudition',
  element: 'Ice',
  maxEnergy: MAX_ENERGY,
  // Fribbels has no buffed version of her: only the original kit (K13).
  abilityVersions: [0],
  levelsModelled: { abilities: ['basic'], majorTraces: [] },

  create(battle: Battle, self: Member): KitInstance {
    const { timeline, party } = battle
    const me = self.key
    const e = self.eidolon
    // Ability levels (K15, K15a): Basic ATK's multiple scales by the table's ratio. The Skill, Ultimate and Talent are not level-aware
    // (their Fribbels-side parts are priced at the maximum level), so a lower level of those warns.
    const lv = levelsOf(self)
    const base = theHertaScalings(e)
    const s = { ...base, basic: base.basic * lv.ratio('basic', '140101', 0) }
    const ids = battle.enemies.ids
    const modifiers = timeline.modifiers

    const stacks = new Map<UnitId, number>(ids.map((id) => [id, 0]))
    let answer = 0
    let inspiration = 0
    /** What she is pricing right now, so `attackerState` sends the switches of that action. */
    let inFlight: { enhanced: boolean, boost: boolean } | undefined
    /** The attacks of each ally action in progress, by action serial (Additional DMG parts left out). */
    const pending = new Map<number, HitPart[][]>()

    const stackOf = (id: UnitId) => stacks.get(id) ?? 0
    const eruditionCount = () => battle.members.filter((m) => m.kit.path === 'Erudition').length
    const downed = () => party.get(me).downed

    /** Inflicts `amount` (expected) stacks: capped at 42, and every stack inflicted counts for Answer. */
    const inflict = (enemy: UnitId, amount: number) => {
      if (!(amount > 0)) return
      stacks.set(enemy, Math.min(STACK_CAP, stackOf(enemy) + amount))
      answer = Math.min(ANSWER_CAP, answer + amount)
    }

    /** Enemy indexes, the one with the most stacks first; ties go nearest the middle enemy, then standing order. */
    const ranking = (): number[] => {
      const primary = ids.indexOf(battle.primary)
      return ids
        .map((_, i) => i)
        .sort((a, b) => {
          const d = stackOf(ids[b]!) - stackOf(ids[a]!)
          if (Math.abs(d) > EPS) return d
          return Math.abs(a - primary) - Math.abs(b - primary) || a - b
        })
    }
    const aim = () => ids[ranking()[0]!]!

    /** N: the stacks the Enhanced Skill's bonus counts (E1: plus half of the most among the target and its neighbours). */
    const countedStacks = (target: UnitId) => {
      const own = stackOf(target)
      if (e < 1) return own
      const most = Math.max(own, ...battle.adjacentEnemies(target).map(stackOf))
      return own + E1_SHARE * most
    }

    const ultBuffUp = () => modifiers.has(me, ULT_ATK_MODIFIER)

    const runSkill = (enhanced: boolean) => {
      const target = enhanced ? aim() : battle.primary
      const targetIndex = ids.indexOf(target)
      const counted = enhanced ? countedStacks(target) : 0
      const boost = enhanced && counted >= STACK_CAP - EPS
      const plan = theHertaSkillPlan({
        eidolon: e,
        enemyCount: ids.length,
        target: targetIndex,
        enhanced,
        counted,
        eruditionBonus: eruditionCount() >= 2,
      })
      if (enhanced) inspiration -= 1
      inFlight = { enhanced, boost }
      try {
        inflict(target, 1)
        for (const hits of plan.instances) {
          battle.attack({
            attacker: me,
            ability: 'SKILL',
            parts: hits.map((h) => ({
              shape: 'single' as const,
              target: ids[h.enemy]!,
              scaling: h.scaling,
              hit: 0,
              toughness: h.toughness,
            })),
          })
        }
        if (plan.tail > 0) battle.attack({ attacker: me, ability: 'SKILL', parts: [{ shape: 'aoe', scaling: plan.tail, hit: 0 }] })
      } finally {
        inFlight = undefined
      }
      if (enhanced) {
        stacks.set(target, e >= 1 ? E1_RESET : NORMAL_RESET)
        if (e >= 2) timeline.advance(me, E2_ADVANCE)
      }
    }

    timeline.bus.on('attackResolved', (attack) => {
      const serial = battle.actionSerialInProgress
      if (serial === undefined) return
      const parts = attack.parts.filter((p) => p.additional !== true)
      if (parts.length === 0) return
      const list = pending.get(serial) ?? []
      list.push([...parts])
      pending.set(serial, list)
    })

    // After an ally attacked: Aloofly Honest (stacks and energy) and Message From Beyond the Veil (stacks).
    timeline.bus.on('actionUsed', (action: EngineEvents['actionUsed']) => {
      const attacks = pending.get(action.serial)
      pending.delete(action.serial)
      if (attacks === undefined || !battle.isAlly(action.actor) || downed()) return
      const erudition = eruditionCount()
      const distribution = reachedSetDistribution({ attacks, enemies: ids, primary: battle.primary })
      const order = ranking()
      const attackerIsErudition = battle.isCharacter(action.actor) && battle.member(action.actor).kit.path === 'Erudition'
      const messageOn = !STACKS_NEED_TWO_ERUDITION || erudition >= 2
      const messageStacks = messageOn ? MESSAGE_STACKS + (attackerIsErudition ? MESSAGE_ERUDITION_STACKS : 0) : 0
      const gain = ids.map(() => 0)
      /** P(K >= n) for the number K of distinct enemies hit. */
      const atLeast = Array<number>(ids.length + 2).fill(0)
      for (const [mask, p] of distribution) {
        if (mask === 0) continue
        let k = 0
        ids.forEach((_, i) => {
          if (mask & (1 << i)) {
            gain[i]! += p
            k++
          }
        })
        for (let n = 1; n <= k; n++) atLeast[n]! += p
        const best = order.find((i) => mask & (1 << i))!
        gain[best]! += p * messageStacks
      }
      const floor = erudition >= 2 ? ALOOFLY_MIN_TARGETS_ERUDITION : 0
      let targets = floor
      for (let n = floor + 1; n <= ALOOFLY_MAX_TARGETS; n++) targets += atLeast[n] ?? 0
      ids.forEach((id, i) => inflict(id, gain[i]!))
      party.gainEnergy(me, ALOOFLY_ENERGY_PER_TARGET * targets, { fixed: true })
    })

    return {
      actions: {
        basic: {
          kind: 'basic',
          canUse: () => true,
          use: () =>
            battle.performAction(me, 'basic', 'basic', () => {
              battle.gainSkillPoints(1)
              party.gainEnergy(me, BASIC_ENERGY)
              battle.attack({ attacker: me, ability: 'BASIC', parts: [{ shape: 'single', scaling: s.basic, hit: 0, toughness: TOUGHNESS_BASIC }] })
            }),
        },
        skill: {
          kind: 'skill',
          canUse: () => battle.skillPoints >= 1,
          use: () =>
            battle.performAction(me, 'skill', 'skill', () => {
              battle.spendSkillPoints(1)
              party.gainEnergy(me, SKILL_ENERGY)
              runSkill(inspiration >= 1)
            }),
        },
        ultimate: {
          kind: 'ultimate',
          canUse: () => party.get(me).energy >= MAX_ENERGY - EPS,
          use: () =>
            battle.performAction(me, 'ultimate', 'ultimate', () => {
              party.setEnergy(me, 0)
              modifiers.apply({ id: ULT_ATK_MODIFIER, target: me, source: me, duration: { turns: ULT_ATK_TURNS, tick: 'turnEnd' } })
              battle.attack({
                attacker: me,
                ability: 'ULT',
                parts: [{ shape: 'aoe', scaling: theHertaUltMultiple(e, answer, ids.length), hit: 0, toughness: TOUGHNESS_ULT }],
              })
              party.gainEnergy(me, ULT_ENERGY)
              inspiration = Math.min(INSPIRATION_CAP, inspiration + (e >= 2 ? 2 : 1))
              if (timeline.has(me)) timeline.advance(me, 1)
            }),
        },
      },

      quantities: {
        inspiration: () => inspiration,
        enhanced: () => inspiration >= 1,
        answer: () => answer,
        interpretation_target: () => stackOf(aim()),
        interpretation_primary: () => stackOf(battle.primary),
        ult_buff: () => ultBuffUp(),
        ...Object.fromEntries(ids.map((id, i) => [`interpretation_${i + 1}`, () => stackOf(id)])),
      },

      attackerState: () => {
        const injected: InjectedBuff[] = modifiers.has(me, TECHNIQUE_MODIFIER)
          ? [{ stat: 'ATK_PERCENT', value: TECHNIQUE_ATK, target: 'self', label: "The Herta's Technique" }]
          : []
        return {
          characterConditionals: {
            enhancedSkill: inFlight?.enhanced ?? false,
            ultAtkBuff: ultBuffUp(),
            // Only the +50% Skill DMG at the threshold depends on this in the kernel once scaling is normalised away.
            interpretationStacks: inFlight?.boost === true ? STACK_CAP : 1,
            totalInterpretationStacks: Math.max(1, Math.min(ANSWER_CAP, Math.round(answer))),
            eruditionTeammate: true,
            e1BonusStacks: true,
            e4EruditionSpdBuff: true,
            e6Buffs: true,
          },
          injectedBuffs: injected,
        }
      },

      teammateState: () => ({
        characterConditionals: { eruditionTeammate: true, e4EruditionSpdBuff: true },
      }),

      onBattleStart: ({ techniques }) => {
        for (const id of ids) inflict(id, START_STACKS)
        inflict(battle.primary, WAVE_STACKS)
        if (e >= 2) inspiration = Math.min(INSPIRATION_CAP, inspiration + 1)
        if (techniques) {
          modifiers.apply({ id: TECHNIQUE_MODIFIER, target: me, source: me, duration: { turns: TECHNIQUE_TURNS, tick: 'turnEnd' } })
        }
        if (e >= 4) {
          for (const m of battle.members) {
            if (m.kit.path === 'Erudition') modifiers.apply({ id: E4_MODIFIER, target: m.key, source: me, spdPct: E4_SPD })
          }
        }
      },
    }
  },
}

