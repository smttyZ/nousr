import { certain } from '../battle/battle'
import type { Battle, HitPart, Member } from '../battle/battle'
import type { UnitId } from '../engine/events'
import type { InjectedBuff } from '../kernel/types'
import { levelBuff, levelsOf } from '../levels/levels'
import type { Kit, KitInstance } from './kit'
import { MAX_WEAKNESS_TYPES, registerWeaknessCounter, scenarioWeaknessTypes } from './weaknessTypes'

/**
 * Anaxa (1405), from the 4.7.0 in-game text (`node tools/gamedata/kit-text.mjs 1405`) and Fribbels' `Anaxa.ts`
 * (vendor/hsr-optimizer/src/lib/conditionals/character/1400/Anaxa.ts). All traces are taken as unlocked. hsr-simulator's Anaxa was not read for
 * this kit, so nothing is ported from it.
 *
 * - Energy 140. Basic ATK: +20 energy and Roaming Signifier's +10, +1 Skill Point. Skill: +6 energy per instance (30 for 1 + 4), -1 Skill Point. Ultimate:
 *   costs 140, +5 energy. All energy is scaled by Energy Regeneration Rate, as the other kits' trace and battle-start energy is
 *   (DESIGN.md: Silver Wolf, Welt and Fu Xuan rows).
 * - Skill, Fractal Exiles Fallacy: 70% (E5: 77%) on the designated enemy, then 4 more instances of the same on random enemies,
 *   "prioritizing enemies not hit by this Skill", and +20% Skill DMG per attackable enemy (Fribbels prices that itself from the
 *   request's enemy count, which the battle fills from the scenario). The target distribution is exact, as expected values:
 *   the designated enemy (the primary, K3) is hit once; the next min(4, others) instances cover other enemies, each other enemy
 *   once with probability min(4, others) / others (1 with 1, 3 or 5 enemies); the instances left over (with 1 enemy: all four,
 *   with 3: two, with 5: none) each land on a uniformly random enemy. Each instance is its own `attack` call, so an instance
 *   sees the weaknesses and the DEF debuff the instances before it left (the covering instances are one call: they hit different
 *   enemies, so none sees another's state). Fribbels prices the Skill as one lumped hit (0.7 x (1 + skillHits)); the kit asks the
 *   kernel at the hit's price per 100% (K11), so the instances are priced one by one.
 * - Talent, Tetrad Wisdom Reigns Thrice: every hit he lands implants 1 Weakness of a random Type for 3 of that enemy's turns,
 *   with priority to Types the enemy lacks (below). Qualitative Disclosure: while he is on the field, an enemy with 5 or more
 *   Types takes 30% (E5: 32.4%) more DMG from him, and after his Basic ATK or Skill on it he unleashes 1 more Skill on it (below).
 * - Ultimate, Sprouting Life Sculpts Earth: Sublimation on every enemy, then 160% (E3: 176%) to all enemies, 60 toughness each.
 *   Sublimation gives all seven Types until the start of that enemy's turn; with no Control RES the enemy cannot act (K29).
 * - Traces: Roaming Signifier (+10 energy on Basic ATK; at his turn start, +30 energy if no enemy is in Disclosure), Imperative
 *   Hiatus (1 Erudition character on the team: his CRIT DMG +140%; 2 or more: all allies' DMG +50%; E6: both), Qualitative Shift
 *   (4% DEF ignored per Weakness Type of the target, up to 7). Fribbels counts the Erudition characters itself
 *   (`eruditionTeammateBuffs`, `countTeamPath`), from the same paths the kits declare; the kit passes the switch on and publishes
 *   the count it sees as `anaxa.erudition_members`.
 * - Technique (scenario `techniques` on): after entering battle, 1 Weakness of the attacker's Type on every enemy for 3 turns.
 * - E1: after the first Skill, +1 Skill Point; Skill hits lower the targets' DEF by 16% for 2 turns (a debuff, Fribbels' `e1DefPen`
 *   for the whole team). E2: enemies entering the battlefield get 1 implant and All-Type RES -20% (a debuff, Fribbels' `e2ResPen`
 *   for the whole team). E3, E5: levels. E4: Skill +30% ATK for 2 turns, 2 stacks. E6: his DMG x1.3 and both Hiatus effects.
 * - Cyrene's Ode to Reason (`Battle.cyreneEffect`): the SP and the 100% advance are Cyrene's kit; here his Skill has 3 more
 *   instances while the effect is up, and the next Basic ATK or Skill gives True Knowledge until the start of his next turn:
 *   every Erudition character's ATK +60% and Skill DMG +40% (Cyrene E3: 66% and 44%; Fribbels' `cyreneSpecialEffect`, which reads
 *   Cyrene's eidolon from her request entry).
 *
 * WEAKNESS TYPES (DESIGN.md, K28). The kit counts each enemy's Weakness Types itself, as expected values. The count is the
 * scenario's (7 for 'all', else the list's length) plus the implants that are alive, capped at 7: a new implant always takes a
 * Type the enemy lacks while one exists, so each live implant is exactly one more Type. Sublimation makes it 7. A hit that lands
 * at a chance (a random instance) leaves an implant present with that chance, for 3 of that enemy's turns; the distribution of
 * the number of live implants is exact (independent implants), so Disclosure's threshold is K21's scaled form: the damage bonus
 * is applied at P(5 or more Types) x 30%, the extra Skill is cast at that weight, and Roaming Signifier's 30 energy comes at
 * the chance that no enemy is in Disclosure. The Qualitative Shift DEF ignore and The Great Cosmic Enterprise read the expected
 * count (a linear DMG term for the light cone; for the DEF ignore the kernel's DEF formula is not linear in it, so this is a
 * small approximation, as is the independence of the count and Disclosure). Under the default scenario weaknesses 'all' every
 * enemy has 7 Types from the start, nothing is fractional, Disclosure is always on and the DEF ignore is 28%. The count is
 * published to equipment through `weaknessTypes.ts`. Teammates' RES and toughness use the scenario's list (the engine does not
 * know about implants), and so do his own: a documented approximation until per-enemy weaknesses are in the engine, except that
 * Sublimation (certain: it gives every Type) lets his Ultimate's hit ignore the scenario's list for toughness and, when the
 * scenario's list lacks Wind, removes the Wind RES (an injected RES PEN equal to the profile's RES).
 *
 * Toughness (K7), internal units (3 x the in-game number): Basic ATK 30 on the target, the Skill's designated hit 30 and each
 * further instance 15 (the text prints only 30/0/0 for the Skill; the 15 is Fribbels' 10 + 5 per added hit, times 3, so a Skill with
 * 4 added hits removes 90, Fribbels' 30), the Ultimate 60 on every enemy (text: 0/60/0; Fribbels 20).
 *
 * IN-GAME CHECK: the Skill's toughness per added instance (15 internal, 5 in game, from Fribbels). Look: use the Skill on a lone
 *   enemy with a known bar, and read how much of it one Skill removes. 30 + 4 x 15 = 90 (shown 30) supports the reading; 30 total
 *   (shown 10) means the added instances remove none.
 * The extra Skill is priced in the state that triggers it (the repo's rule for conditional hits, K22, HitPart.worldWeight): E[damage] =
 * P(cast) x E[damage | cast]. Given the cast, its designated enemy is in Disclosure for certain (no partial bonus, `exposedNature` on)
 * and its Type count is E[Types | 5 or more] (the Type distribution conditioned on the cast, moved up by the extra Skill's own
 * implants on that enemy), which Qualitative Shift and The Great Cosmic Enterprise read. Exact for the designated enemy. The other
 * enemies the extra Skill reaches keep their unconditioned state (their chance of being in Disclosure given the cast is not
 * conditioned on the designated enemy's state: an approximation, as is treating the enemies as independent). The implants it leaves are
 * saved at their unconditioned chance (land x weight), and as independent of one another although the extra Skill is all or nothing.
 *
 * IN-GAME CHECK: each Skill instance is priced before its own implant lands, and the next instance sees it (the text says "each time
 *   Anaxa lands 1 hit ... inflicts 1 Weakness", which does not say whether the hit's own DMG already counts the Type it implants).
 *   Look: Anaxa on a lone enemy with 4 Types (one short of Disclosure), a Basic ATK or one Skill instance: is that hit's damage
 *   without Disclosure (and with 4 x 4% DEF ignored), or with 5 Types already? The Types shown in the weakness bar mid-Skill help.
 * IN-GAME CHECK: "them" in the Talent's extra Skill. Read as the designated enemy of the Basic ATK or Skill, tested after the action
 *   (so a hit that takes it to 5 Types already counts). Look: Anaxa on an enemy with 4 Types (one implant short of Disclosure): does
 *   a Basic ATK that adds the fifth Type make him cast the extra Skill at once? If not, Disclosure is read before the action.
 * IN-GAME CHECK: Skill energy is 6 PER INSTANCE, by analogy with Welt (not yet checked for Anaxa): for Welt's 5-hit Skill the data
 *   also prints 6 and Smitty measured 30 in game (DESIGN.md in-game table). 30 for a Skill of 1 + 4, 48 with the Ode's 3 more.
 *   Look: energy before and after one Skill on a lone enemy (30, not 6), and with the Ode (48 vs 30). docs/in-game-checks.md, check 7.
 * IN-GAME CHECK: the extra Skill is a Skill use: it gives its energy (per instance, times its chance), counts for E1's first-Skill Skill Point, E4's ATK stack and
 *   E1's DEF debuff, and a Skill-kind action for teammates' "after an ally attacks" reactions. Look: energy before and after a
 *   Basic ATK that casts the extra Skill (20 + 10 + 30, or 30 without the extra Skill's); with E4, the ATK stacks after it (2 or 1); with E1, the Skill
 *   Points after a first Basic ATK that cast the extra Skill (+1 more or not).
 * IN-GAME CHECK: the extra Skill is a Skill in the turn of an Ode to Reason too, so it also has the 3 more instances. Look: the
 *   number of hits of the extra Skill in a turn he got the Ode (8, or 5).
 * IN-GAME CHECK: True Knowledge applies to the Basic ATK or Skill that grants it (gained on use, before the damage; Fribbels'
 *   preprocessor switches it on at the start of that ability too), and E4's ATK stack likewise applies to the Skill that gives it.
 *   Look: the ATK shown on the character panel during the Skill's hits, or the damage of the first Skill after the Ode against
 *   a repeat.
 * IN-GAME CHECK: Sublimation counts as a debuff on the enemy (so teammates' "debuffed enemy" effects and Acheron's talent see it),
 *   and so does every weakness implant (as one marker per enemy: "has an implant"). Look: Acheron (or any "debuff inflicted" effect)
 *   after Anaxa's Ultimate or Skill.
 * IN-GAME CHECK: an enemy with Control RES above 0 acts normally in Sublimation (implemented: any Control RES above 0 means it
 *   acts). Look: his Ultimate on a boss with some Control RES; does it still take its turn (and does 50% Control RES change it)?
 * IN-GAME CHECK: Sublimation's implant. Hits during Sublimation implant a random Type of the 7 (all are possessed), so the implant
 *   adds a Type that outlasts Sublimation only with the chance that it is a Type the enemy lacks apart from Sublimation; implemented
 *   so. Look: the weakness icons on an enemy after his Ultimate and its next turn.
 * IN-GAME CHECK: E2 and the Technique: "entering the battlefield" is the start of the battle (waves are not modelled), the E2
 *   implant comes first and the Technique's Wind implant adds a Type only if Wind is still missing, with Anaxa as the one who
 *   entered. Look: the weakness icons at the start of a battle.
 * IN-GAME CHECK: E1's "first time" Skill Point is once per battle.
 *
 * NOT MODELLED:
 * - Per-enemy weaknesses for the teammates and the engine (K28): RES, toughness and the kernel's element-weak flag for hits that
 *   are not his Ultimate use the scenario's list, so an implanted Wind weakness does not remove his Wind RES or let his Skill
 *   break toughness. Under the default 'all' this changes nothing.
 * - Waves (enemies entering later): E2's trigger happens once, at the start of the battle.
 * - Dispelling or replacing implants. Defeated enemies (S6).
 */

export const ANAXA_ID = '1405'

const MAX_ENERGY = 140
const BASIC_ENERGY = 20
/** Roaming Signifier: "When using Basic ATK, additionally regenerates 10 Energy". */
const BASIC_TRACE_ENERGY = 10
/** Roaming Signifier: "At the start of the turn, if there are no enemy targets in the Disclosure state, regenerates 30 Energy". */
const IDLE_ENERGY = 30
const SKILL_ENERGY = 6
const ULT_ENERGY = 5

/** The Skill's added instances: "additionally deals 4 instance(s) of DMG". Ode to Reason adds 3 for the turn. */
const SKILL_ADDED_INSTANCES = 4
const ODE_ADDED_INSTANCES = 3

const IMPLANT_TURNS = 3
const DISCLOSURE_TYPES = 5
const E1_DEF_TURNS = 2
const E4_MAX_STACKS = 2

/** Toughness in internal units (see the header). */
const TOUGHNESS_BASIC = 30
const TOUGHNESS_SKILL_DESIGNATED = 30
const TOUGHNESS_SKILL_INSTANCE = 15
const TOUGHNESS_ULT = 60

/** Under this a chance is zero (float noise), over 1 minus it a chance is one. */
const EPSILON = 1e-9

const IMPLANT = 'anaxa.weakness_implant'
const SUBLIMATION = 'anaxa.sublimation'
const E1_DEF = 'anaxa.e1_def_down'
const E2_RES = 'anaxa.e2_res_down'
const E4_ATK = 'anaxa.e4_atk'
const TRUE_KNOWLEDGE = 'anaxa.true_knowledge'

/** Ability multipliers by eidolon: E3 raises the Basic ATK and Ultimate, E5 the Skill and the Talent (Fribbels' `AbilityEidolon`). */
export function anaxaScalings(eidolon: number) {
  return {
    basic: eidolon >= 3 ? 1.1 : 1.0,
    skill: eidolon >= 5 ? 0.77 : 0.7,
    ult: eidolon >= 3 ? 1.76 : 1.6,
    /** Qualitative Disclosure's DMG bonus. */
    disclosure: eidolon >= 5 ? 0.324 : 0.3,
  }
}

/** One call of the Skill's plan: the chance (given that the Skill is used) that it puts an instance on each enemy. */
interface Call {
  designated: boolean
  landings: Array<{ enemy: UnitId, land: number }>
}

/** A weakness implant: alive with `chance`, for `turnsLeft` more of its enemy's turns. */
interface Implant {
  chance: number
  turnsLeft: number
  /** The serial of the turn it was applied in (the enemy's own turn does not count down at its end), if any. */
  appliedIn: number | undefined
}

export const Anaxa: Kit = {
  characterId: ANAXA_ID,
  path: 'Erudition',
  element: 'Wind',
  maxEnergy: MAX_ENERGY,
  // Fribbels has no buffed version of him: only the original kit (K13).
  abilityVersions: [0],
  // Ability levels (K15, K15a): every ability. No major trace is modelled: a locked one warns.
  levelsModelled: { abilities: ['basic', 'skill', 'ult', 'talent'], majorTraces: [] },

  create(battle: Battle, self: Member): KitInstance {
    const { timeline } = battle
    const me = self.key
    const e = self.eidolon
    // Ability levels (K15, K15a): multiples and Qualitative Disclosure's DMG bonus scale by the table's ratio. Fribbels applies the
    // bonus at the maximum level when the Disclosure is certain (`exposedNature`), so that case injects the difference.
    const lv = levelsOf(self)
    const base = anaxaScalings(e)
    const s = {
      ...base,
      basic: base.basic * lv.ratio('basic', '140501', 0),
      skill: base.skill * lv.ratio('skill', '140502', 0),
      ult: base.ult * lv.ratio('ult', '140503', 0),
      disclosure: base.disclosure * lv.ratio('talent', '140504', 0),
    }
    const disclosureDelta = lv.delta('talent', '140504', 0)

    /** The scenario's count of Weakness Types, the same for every enemy. */
    const baseTypes = scenarioWeaknessTypes(battle)
    const scenarioHasWind = battle.weaknesses === 'all' || battle.weaknesses.includes('Wind')
    const implants = new Map<UnitId, Implant[]>()
    /** The Skill Point of E1 not yet given (a share of 1, K21: the first Skill may be an extra Skill that happened at a chance). */
    let firstSkillPoint = 1
    /** The Skill's added instances now in the kernel's request (`skillHits`). Pricing is per 100%, so it moves no number. */
    let kernelSkillHits = SKILL_ADDED_INSTANCES
    /** The serial of the turn True Knowledge was gained in for the Ode window now open (undefined: not gained yet). */
    let trueKnowledgeTurn: number | undefined

    // ---------------------------------------------------------------- Weakness Types (K28)

    const sublimated = (enemy: UnitId) => timeline.modifiers.has(enemy, SUBLIMATION)
    /**
     * The extra Skill is cast only in the states where its designated enemy has 5 or more Types, so while it resolves that enemy's
     * Type distribution is the one conditioned on that (E[damage] = P(cast) x E[damage | cast], K21/K22): `dist` is P(k Types |
     * 5 or more), moved up by the implants the extra Skill itself lands on it (at their chance given the cast, `landed / weight`).
     * Every other enemy keeps its unconditioned state. Undefined outside the extra Skill, and when the cast is certain.
     */
    let conditioned: { enemy: UnitId, dist: number[], weight: number } | undefined

    /** P(an enemy has exactly k Types), k = 0 to 7. `withSublimation` false ignores the Sublimation state. */
    const typeDistribution = (enemy: UnitId, withSublimation = true): number[] => {
      const distribution = new Array<number>(MAX_WEAKNESS_TYPES + 1).fill(0)
      if (withSublimation && sublimated(enemy)) {
        distribution[MAX_WEAKNESS_TYPES] = 1
        return distribution
      }
      if (conditioned !== undefined && conditioned.enemy === enemy) return [...conditioned.dist]
      // The number of live implants: independent, each present with its own chance (a Poisson-binomial).
      let live = [1]
      for (const { chance } of implants.get(enemy) ?? []) {
        const next = new Array<number>(live.length + 1).fill(0)
        live.forEach((q, k) => {
          next[k]! += q * (1 - chance)
          next[k + 1]! += q * chance
        })
        live = next
      }
      live.forEach((q, k) => {
        distribution[Math.min(MAX_WEAKNESS_TYPES, baseTypes + k)]! += q
      })
      return distribution
    }
    /** The expected Type count, with float noise from the sums taken out (a whole number stays whole). */
    const expectedTypes = (enemy: UnitId): number => {
      const mean = typeDistribution(enemy).reduce((sum, p, k) => sum + p * k, 0)
      return Math.abs(mean - Math.round(mean)) < EPSILON ? Math.round(mean) : mean
    }
    /** The chance the enemy is in Qualitative Disclosure: 5 or more Types, while Anaxa is on the field. */
    const disclosure = (enemy: UnitId): number => {
      if (battle.party.get(me).downed) return 0
      const chance = typeDistribution(enemy)
        .slice(DISCLOSURE_TYPES)
        .reduce((sum, p) => sum + p, 0)
      return chance >= 1 - EPSILON ? 1 : chance <= EPSILON ? 0 : chance
    }
    registerWeaknessCounter(battle, me, expectedTypes)

    /**
     * An implant on `enemy`, alive with `chance`. The marker debuff stands for "has an implant" (one id per enemy); a hit that
     * lands where the enemy already holds every Type (Sublimation) implants a random one of the seven, which is a new Type only
     * with the chance that it is one the enemy lacks apart from Sublimation.
     */
    const implant = (enemy: UnitId, chance: number) => {
      const landed = Math.min(1, chance)
      if (landed <= EPSILON) return
      const lacking = sublimated(enemy) ? Math.max(0, MAX_WEAKNESS_TYPES - typeDistribution(enemy, false).reduce((sum, p, k) => sum + p * k, 0)) / MAX_WEAKNESS_TYPES : 1
      if (conditioned !== undefined && conditioned.enemy === enemy) {
        // Inside the extra Skill: the implant lands with its chance given the cast.
        const given = Math.min(1, landed / conditioned.weight) * lacking
        const next = new Array<number>(MAX_WEAKNESS_TYPES + 1).fill(0)
        conditioned.dist.forEach((q, k) => {
          next[k]! += q * (1 - given)
          next[Math.min(MAX_WEAKNESS_TYPES, k + 1)]! += q * given
        })
        conditioned.dist = next
      }
      const list = implants.get(enemy) ?? []
      if (landed * lacking > EPSILON) list.push({ chance: landed * lacking, turnsLeft: IMPLANT_TURNS, appliedIn: timeline.activeTurn?.serial })
      implants.set(enemy, list)
      battle.applyDebuff({ id: IMPLANT, target: enemy, source: me, chance: landed, duration: { turns: IMPLANT_TURNS, tick: 'turnEnd' } })
    }

    // An implant lasts for 3 of its enemy's turns, counted at the end of each (not the turn it was applied in).
    timeline.bus.on('turnEnd', (turn) => {
      if (!battle.enemies.has(turn.unit)) return
      const list = implants.get(turn.unit)
      if (list === undefined) return
      for (const entry of list) {
        if (entry.appliedIn === turn.serial) continue
        entry.turnsLeft -= 1
      }
      implants.set(
        turn.unit,
        list.filter((entry) => entry.turnsLeft > 0),
      )
    })

    // ---------------------------------------------------------------- Cyrene's Ode to Reason

    /** Whether Ode to Reason's effect is up; a closed window lets the next one give True Knowledge again. */
    const odeActive = (): boolean => {
      const on = battle.cyreneEffect(me).active
      if (!on) trueKnowledgeTurn = undefined
      return on
    }
    const trueKnowledge = () => timeline.modifiers.has(me, TRUE_KNOWLEDGE)
    /** "The next time Anaxa uses Basic ATK or Skill, he gains True Knowledge": once per Ode window, until the start of his next turn. */
    const grantTrueKnowledge = () => {
      if (!odeActive()) return
      const serial = timeline.activeTurn?.serial ?? -1
      if (trueKnowledgeTurn === serial) return
      trueKnowledgeTurn = serial
      timeline.modifiers.apply({ id: TRUE_KNOWLEDGE, target: me, source: me, duration: { turns: 1, tick: 'turnStart' } })
    }

    // ---------------------------------------------------------------- the Skill

    const e4Stacks = () => timeline.modifiers.get(me, E4_ATK)?.stacks ?? 0

    /** The plan of one Skill: a call for the designated hit, one for the covering instances, one per instance left over. */
    const planSkill = (added: number): Call[] => {
      const ids = battle.enemies.ids
      const primary = battle.primary
      const calls: Call[] = [{ designated: true, landings: [{ enemy: primary, land: 1 }] }]
      const others = ids.filter((id) => id !== primary)
      const cover = Math.min(added, others.length)
      if (cover > 0) calls.push({ designated: false, landings: others.map((enemy) => ({ enemy, land: cover / others.length })) })
      for (let i = 0; i < added - cover; i++) calls.push({ designated: false, landings: ids.map((enemy) => ({ enemy, land: 1 / ids.length })) })
      return calls
    }

    /**
     * One Skill. `weight` is the chance it happens at all: 1 for the Skill itself, the Disclosure chance for the extra Skill
     * the Talent unleashes (K21: the damage, toughness, implants, debuffs and energy all scale by it, and no Skill Point is spent).
     */
    const castSkill = (weight: number, extra: boolean) => {
      if (!extra) battle.spendSkillPoints(1)
      grantTrueKnowledge()
      if (e >= 4) {
        timeline.modifiers.apply({
          id: E4_ATK,
          target: me,
          source: me,
          stacks: Math.min(E4_MAX_STACKS, e4Stacks() + weight),
          duration: { turns: 2, tick: 'turnEnd' },
        })
      }
      const added = SKILL_ADDED_INSTANCES + (odeActive() ? ODE_ADDED_INSTANCES : 0)
      // The data prints +6 energy per instance of a bounce Skill (Welt's settled 30 for 5 hits): 1 + the added instances.
      battle.party.gainEnergy(me, SKILL_ENERGY * (1 + added) * weight)
      kernelSkillHits = added
      const calls = planSkill(added)
      /** The chance each enemy is hit at least once by the Skill (given that it happens). */
      const reached = new Map<UnitId, number>()
      for (const call of calls) for (const { enemy, land } of call.landings) reached.set(enemy, 1 - (1 - (reached.get(enemy) ?? 0)) * (1 - land))
      const carried = new Set<UnitId>()
      for (const call of calls) {
        const parts: HitPart[] = call.landings.map(({ enemy, land }): HitPart => {
          // At full weight the calls' independent misses multiply to the true miss chance. A Skill that happens at a chance is
          // all or nothing, so one part per enemy carries its hit chance (weight x the chance the Skill reaches it) and the
          // others carry none (K17).
          let random: HitPart['random']
          if (weight >= 1 - EPSILON) random = call.designated ? undefined : { hits: 1, chance: land, group: 'skill' }
          else {
            random = { hits: 1, chance: carried.has(enemy) ? 0 : weight * reached.get(enemy)!, group: 'skill' }
            carried.add(enemy)
          }
          return {
            shape: 'single',
            target: enemy,
            scaling: s.skill * land * weight,
            hit: 0,
            toughness: (call.designated ? TOUGHNESS_SKILL_DESIGNATED : TOUGHNESS_SKILL_INSTANCE) * land * weight,
            ...(random !== undefined && { random }),
          }
        })
        battle.attack({ attacker: me, ability: 'SKILL', parts })
        // The talent implants a Type with every hit; E1 lowers the DEF of every enemy the Skill hits, 2 of its turns.
        for (const { enemy, land } of call.landings) {
          implant(enemy, land * weight)
          if (e >= 1 && land * weight > EPSILON) {
            battle.applyDebuff({ id: E1_DEF, target: enemy, source: me, chance: Math.min(1, land * weight), duration: { turns: E1_DEF_TURNS, tick: 'turnEnd' } })
          }
        }
      }
      // E1: after using Skill for the first time, +1 Skill Point (once per battle; a share of it when the first Skill was an extra one).
      if (e >= 1 && firstSkillPoint > EPSILON) {
        const gain = firstSkillPoint * weight
        battle.gainSkillPoints(gain)
        firstSkillPoint -= gain
      }
    }

    /** The Talent's extra Skill: after a Basic ATK or Skill, on the designated enemy if it is in Disclosure (see the header). */
    const afterAction = () => {
      const target = battle.primary
      const chance = disclosure(target)
      if (chance <= EPSILON) return
      // Priced in the state that triggers it: the designated enemy is in Disclosure for certain, with the Types conditioned on 5 or more.
      if (chance < 1) {
        conditioned = { enemy: target, dist: typeDistribution(target).map((p, k) => (k >= DISCLOSURE_TYPES ? p / chance : 0)), weight: chance }
      }
      try {
        battle.performAction(me, 'skill_extra', 'skill', () => castSkill(chance, true))
      } finally {
        conditioned = undefined
      }
    }

    // Roaming Signifier: at the start of his turn, +30 energy if no enemy is in Disclosure (the chance none is, enemies independent).
    timeline.bus.on('turnStart', (turn) => {
      if (turn.unit !== me) return
      const none = battle.enemies.ids.reduce((product, enemy) => product * (1 - disclosure(enemy)), 1)
      if (none > EPSILON) battle.party.gainEnergy(me, IDLE_ENERGY * none)
    })

    return {
      actions: {
        basic: {
          kind: 'basic',
          canUse: () => true,
          use: () => {
            battle.performAction(me, 'basic', 'basic', () => {
              battle.gainSkillPoints(1)
              battle.party.gainEnergy(me, BASIC_ENERGY + BASIC_TRACE_ENERGY)
              grantTrueKnowledge()
              const target = battle.primary
              battle.attack({ attacker: me, ability: 'BASIC', parts: [{ shape: 'single', scaling: s.basic, target, hit: 0, toughness: TOUGHNESS_BASIC }] })
              implant(target, 1)
            })
            afterAction()
          },
        },
        skill: {
          kind: 'skill',
          canUse: () => battle.skillPoints >= 1,
          use: () => {
            battle.performAction(me, 'skill', 'skill', () => castSkill(1, false))
            afterAction()
          },
        },
        ultimate: {
          kind: 'ultimate',
          canUse: () => battle.party.get(me).energy >= MAX_ENERGY - EPSILON,
          use: () =>
            battle.performAction(me, 'ultimate', 'ultimate', () => {
              battle.party.setEnergy(me, 0)
              const controllable = battle.enemies.profile.controlRes <= 0
              // Sublimation first: every enemy has all seven Types before the hit. With no Control RES it cannot act until its turn starts.
              for (const enemy of battle.enemies.ids) {
                battle.applyDebuff({ id: SUBLIMATION, target: enemy, source: me, duration: { turns: 1, tick: 'turnStart' } })
                if (controllable) battle.enemies.skipNextTurn(enemy, 'sublimation')
              }
              // Every Type is a weakness in Sublimation, Wind included, so the toughness is removed whatever the scenario's list says.
              battle.attack({
                attacker: me,
                ability: 'ULT',
                parts: [{ shape: 'aoe', scaling: s.ult, hit: 0, toughness: TOUGHNESS_ULT, ignoresWeakness: true }],
              })
              for (const enemy of battle.enemies.ids) implant(enemy, 1)
              battle.party.gainEnergy(me, ULT_ENERGY)
            }),
        },
      },

      quantities: {
        weakness_types: () => expectedTypes(battle.primary),
        disclosure: () => disclosure(battle.primary),
        true_knowledge: () => trueKnowledge(),
        e4_stacks: () => e4Stacks(),
        erudition_members: () => battle.members.filter((m) => m.kit.path === 'Erudition').length,
      },

      attackerState: (enemy: UnitId) => {
        const chance = disclosure(enemy)
        const injected: InjectedBuff[] = chance >= 1 ? levelBuff('DMG_PERCENT', disclosureDelta, 'self', 'Anaxa Qualitative Disclosure') : []
        // A partial Disclosure is its DMG bonus times the chance (DMG% is additive in the kernel, so this is its expected value).
        if (chance > 0 && chance < 1) injected.push({ stat: 'DMG_PERCENT', value: chance * s.disclosure, target: 'self', label: 'Qualitative Disclosure' })
        // Sublimation gives the enemy every Type, Wind too, so a scenario list without Wind no longer costs his Wind hits the enemy's RES.
        if (sublimated(enemy) && !scenarioHasWind) injected.push({ stat: 'RES_PEN', value: battle.enemies.profile.res, target: 'self', label: 'Sublimation' })
        return {
          characterConditionals: {
            skillHits: kernelSkillHits,
            exposedNature: chance >= 1,
            eruditionTeammateBuffs: true,
            enemyWeaknessTypes: expectedTypes(enemy),
            cyreneSpecialEffect: trueKnowledge(),
            e1DefPen: e >= 1 && certain(battle.presence(enemy, E1_DEF)),
            e2ResPen: e >= 2 && certain(battle.presence(enemy, E2_RES)),
            e4AtkBuffStacks: e >= 4 ? e4Stacks() : 0,
            e6Buffs: e >= 6,
          },
          ...(injected.length > 0 && { injectedBuffs: injected }),
        }
      },

      // Imperative Hiatus and E6 reach every ally; E1's and E2's debuffs are on the enemy, so they reach every ally's price; True
      // Knowledge reaches the Erudition characters (Fribbels filters by the attacker's path itself).
      teammateState: (_attacker: Member, enemy: UnitId) => ({
        characterConditionals: {
          eruditionTeammateBuffs: true,
          cyreneSpecialEffect: trueKnowledge(),
          e1DefPen: e >= 1 && certain(battle.presence(enemy, E1_DEF)),
          e2ResPen: e >= 2 && certain(battle.presence(enemy, E2_RES)),
          e6Buffs: e >= 6,
        },
      }),

      onBattleStart: ({ techniques }) => {
        for (const enemy of battle.enemies.ids) {
          // E2: enemies entering the battlefield get 1 implant and All-Type RES -20% (a debuff, for as long as the enemy is there).
          if (e >= 2) {
            implant(enemy, 1)
            battle.applyDebuff({ id: E2_RES, target: enemy, source: me })
          }
          // Technique: 1 Weakness of the attacker's Type (Anaxa's, Wind) for 3 turns. It adds a Type only if Wind is not already
          // one, and with E2's random implant first, only if that implant did not take Wind.
          if (techniques && !scenarioHasWind && baseTypes < MAX_WEAKNESS_TYPES) {
            implant(enemy, e >= 2 ? 1 - 1 / (MAX_WEAKNESS_TYPES - baseTypes) : 1)
          }
        }
      },
    }
  },
}
