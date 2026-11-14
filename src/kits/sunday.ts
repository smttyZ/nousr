import type { Battle, Member } from '../battle/battle'
import type { UnitId } from '../engine/events'
import type { Kit, KitInstance, TeammateState } from './kit'

/**
 * Sunday (1313), from the 4.7.0 in-game text (`node tools/gamedata/kit-text.mjs 1313`). All traces are taken as unlocked, as
 * Fribbels does. Harmony, Imaginary, 130 energy. His damage scales on his ATK; what matters about him is what he gives an ally.
 *
 * - Basic ATK (Gleaming Admonition): +20 energy, +1 Skill Point, 100% ATK Imaginary to one enemy (110% at E3), toughness 30.
 * - Skill (Benison of Paper and Rites): +30 energy, -1 Skill Point, no damage, aimed at one ally (the policy rule's `target`,
 *   never himself): the ally and their summon take action at once (advance 100%, not for a Harmony ally), and deal 30% more
 *   DMG (33% at E5) for 2 turns, 50% more again (55%) when the ally has a summon. After a Skill on The Beatified he recovers
 *   1 Skill Point. The Talent gives the target +20% CRIT Rate (22% at E5) for 3 turns. The Haven in Palm trace dispels 1
 *   debuff from it.
 * - Ultimate (Ode to Caress and Cicatrix): costs 130, +5 energy, aimed at one ally: that ally regenerates 20% of its Max
 *   Energy (at least 40, the Rest Day's Longing trace) and the ally and their summon become "The Beatified": CRIT DMG +30% of
 *   Sunday's CRIT DMG + 12% (33.6% + 12.8% at E3). It is counted down at the start of each of his turns, 3 in all, only the most
 *   recent target (never himself) holds it, and it is dispelled when he is knocked down.
 * - Traces: he starts the battle with 25 energy more (Exalted Sweep).
 * - E1: the Skill's target ignores 16% of enemy DEF, its summon 40%, for 2 turns. E2: after the first Ultimate, +2 Skill
 *   Points; The Beatified deal 30% more DMG. E3: Ultimate +2, Basic ATK +1. E4: +8 energy at the start of the turn. E5: Skill
 *   +2, Talent +2. E6: the Talent's CRIT Rate stacks to 3 and lasts 4 turns, the Ultimate also gives the target one stack, and a
 *   target above 100% CRIT Rate turns every 1% above into 2% CRIT DMG.
 * - Technique (The Glorious Mysteries): the first time he uses an ability on an ally in the battle, the target deals 50% more
 *   DMG for 2 turns. Applied only when the scenario has techniques on.
 *
 * Pricing: his Basic ATK is Fribbels' `BASIC` hit 0. Everything he gives an ally goes through `teammateState`, per attacker
 * and per moment, never as Fribbels' defaults (its teammate defaults have every buff on):
 * - `skillDmgBuff` is on while the 2-turn modifier from the Skill is on that ally. Fribbels also gates E1's DEF PEN on this
 *   switch (and adds the summon's extra 24% itself); the two last as long as each other, so one switch is exact.
 * - `talentCrBuffStacks` is the live stack count (0 or 1, up to 3 from E6).
 * - `beatified` is on for the ally holding it, and `teammateCDValue` is Sunday's own CRIT DMG, read from `Battle.combatStats`
 *   whenever the battle could have changed it (when the Ultimate is used, at every turn start and after every action), as the
 *   text says "30% of Sunday's CRIT DMG". `teammateState` cannot ask the kernel, so the kit keeps the last read.
 * - `e2DmgBuff` is on for The Beatified only (the text gives the 30% to them), `techniqueDmgBuff` while that modifier is on,
 *   `e6CrToCdConversion` for an ally holding the Talent's CRIT Rate boost (the conversion is "when the boost takes effect").
 * Fribbels' CRIT Rate and Skill DMG buffs reach the target's summon too (`SelfAndSummon`); a summon's hits are priced as its
 * owner's, so the ally's modifiers cover them.
 *
 * IN-GAME CHECK notes mark the readings Smitty will check in game.
 *
 * Memosprites (`Battle.memospritesOf`): the Skill advances the target's memosprites with the target (and its summons). Their
 * damage is priced in the owner's request (`attack({ attacker: owner, ability: 'MEMO_SKILL', ... })`), and Fribbels declares a
 * memosprite as a summon entity (`summon: true, memosprite: true`), so its `SelfAndSummon` Skill DMG, E1 DEF PEN, Talent CRIT
 * Rate, Technique, E2 and Beatified buffs reach every memosprite hit from the same switches, and `e6CrToCdConversion` also
 * drives its `SundayMemoCrConditional` (the memosprite's own CRIT Rate over 100%). The owner's modifiers are the state, so a memosprite holds the
 * buffs exactly while its owner does. IN-GAME CHECK: a memosprite summoned after the Skill or Ultimate is read as covered too (the
 * text says "and their summon"; it does not say whether one summoned later is).
 *
 * NOT MODELLED:
 * - Haven in Palm (dispels 1 debuff from the Skill's target): nothing puts a debuff on an ally.
 * - "Has a summon" for the Skill's extra 50% (and E1's 40%) is Fribbels' own static flag for the attacker (its kit declares a
 *   summon entity), not whether the summon is on the field this turn.
 * - Sunday being the target of his own Ultimate gives him the energy and nothing else (the text excludes him from The
 *   Beatified).
 */

const MAX_ENERGY = 130
const BASIC_ENERGY = 20
const SKILL_ENERGY = 30
const ULT_ENERGY = 5
const START_ENERGY = 25
const E4_ENERGY = 8
/** Rest Day's Longing: the ally regenerates at least this much from the Ultimate. */
const ULT_MIN_ENERGY = 40
const ULT_ENERGY_SHARE = 0.2

const SKILL_TURNS = 2
const BEATIFIED_TURNS = 3
const TECHNIQUE_TURNS = 2
const TALENT_TURNS = 3
const E6_TALENT_TURNS = 4
const E6_TALENT_STACKS = 3
const E2_SKILL_POINTS = 2

const TOUGHNESS_BASIC = 30

export const SKILL_MODIFIER = 'sunday.skill_dmg'
export const TECHNIQUE_MODIFIER = 'sunday.technique_dmg'
export const TALENT_MODIFIER = 'sunday.talent_crit_rate'
export const BEATIFIED_MODIFIER = 'sunday.beatified'

/** Ability numbers by eidolon, from the in-game Lv10 / Lv12 lines. */
export function sundayScalings(eidolon: number) {
  const ultLevel12 = eidolon >= 3 // E3: Ultimate +2, Basic ATK +1
  const skillLevel12 = eidolon >= 5 // E5: Skill +2, Talent +2
  return {
    basic: eidolon >= 3 ? 1.1 : 1.0,
    skillDmg: skillLevel12 ? 0.33 : 0.3,
    /** Added to `skillDmg` when the target has a summon. */
    skillDmgSummon: skillLevel12 ? 0.55 : 0.5,
    ultCritDmgShare: ultLevel12 ? 0.336 : 0.3,
    ultCritDmgFlat: ultLevel12 ? 0.128 : 0.12,
    talentCritRate: skillLevel12 ? 0.22 : 0.2,
  }
}

export const Sunday: Kit = {
  characterId: '1313',
  path: 'Harmony',
  element: 'Imaginary',
  maxEnergy: MAX_ENERGY,
  // Fribbels has no buffed version of him: only the original kit (K13).
  abilityVersions: [0],

  create(battle: Battle, self: Member): KitInstance {
    const { timeline, party } = battle
    const me = self.key
    const e = self.eidolon

    /** The one ally holding The Beatified, or undefined. */
    let beatifiedAlly: string | undefined
    /** Sunday's CRIT DMG as `Battle.combatStats` last gave it, which The Beatified's CRIT DMG is a share of. */
    let beatifiedCd = 0
    let ultUsed = false
    /** The Technique is waiting for the first ability he uses on an ally. */
    let techniqueReady = false

    const modifiers = timeline.modifiers
    const ownTurnsClock = (turns: number) => ({ turns, tick: 'turnEnd' as const })

    const beatifiedOn = (ally: string) => ally === beatifiedAlly && modifiers.has(ally, BEATIFIED_MODIFIER) && !party.get(me).downed
    const talentStacks = (ally: string) => modifiers.get(ally, TALENT_MODIFIER)?.stacks ?? 0

    const refreshCd = () => {
      if (beatifiedAlly !== undefined && modifiers.has(beatifiedAlly, BEATIFIED_MODIFIER) && !party.get(me).downed) {
        beatifiedCd = battle.combatStats(me).CD
      }
    }

    const checkTarget = (action: string, target: string | undefined, allowSelf: boolean): string => {
      if (target === undefined) throw new Error(`${me}'s ${action} needs a target: an ally (the policy rule's "target")`)
      if (!battle.isCharacter(target)) throw new Error(`${me}'s ${action} target "${target}" is not an ally character`)
      if (!allowSelf && target === me) throw new Error(`${me}'s ${action} cannot target himself`)
      if (party.get(target).downed) throw new Error(`${me}'s ${action} target "${target}" is downed`)
      return target
    }

    /** The Talent's CRIT Rate on `ally`: one stack, or up to 3 from E6 (all stacks renewed together: IN-GAME CHECK). */
    const giveTalent = (ally: string) => {
      const stacks = e >= 6 ? Math.min(E6_TALENT_STACKS, talentStacks(ally) + 1) : 1
      modifiers.apply({ id: TALENT_MODIFIER, target: ally, source: me, stacks, duration: ownTurnsClock(e >= 6 ? E6_TALENT_TURNS : TALENT_TURNS) })
    }

    /** The Technique's 50% DMG on the first ability used on an ally in the battle. */
    const giveTechnique = (ally: string) => {
      if (!techniqueReady) return
      techniqueReady = false
      modifiers.apply({ id: TECHNIQUE_MODIFIER, target: ally, source: me, duration: ownTurnsClock(TECHNIQUE_TURNS) })
    }

    const dispelBeatified = () => {
      if (beatifiedAlly !== undefined) modifiers.remove(beatifiedAlly, BEATIFIED_MODIFIER)
      beatifiedAlly = undefined
    }

    timeline.bus.on('modifierRemoved', ({ modifier }) => {
      if (modifier.id === BEATIFIED_MODIFIER && modifier.target === beatifiedAlly) beatifiedAlly = undefined
    })
    timeline.bus.on('unitDowned', ({ unit }) => {
      if (unit === me) dispelBeatified()
    })

    // E4: "when the turn starts, regenerates 8 Energy". IN-GAME CHECK: read as the start of his own turn.
    timeline.bus.on('turnStart', (turn) => {
      if (turn.unit === me && e >= 4) party.gainEnergy(me, E4_ENERGY)
      refreshCd()
    })
    timeline.bus.on('actionUsed', () => refreshCd())

    return {
      actions: {
        basic: {
          kind: 'basic',
          canUse: () => true,
          use: () =>
            battle.performAction(me, 'basic', 'basic', () => {
              battle.gainSkillPoints(1)
              party.gainEnergy(me, BASIC_ENERGY)
              battle.attack({
                attacker: me,
                ability: 'BASIC',
                parts: [{ shape: 'single', scaling: sundayScalings(e).basic, hit: 0, toughness: TOUGHNESS_BASIC }],
              })
            }),
        },

        skill: {
          kind: 'skill',
          canUse: () => battle.skillPoints >= 1,
          use: (target) => {
            const ally = checkTarget('Skill', target, false)
            battle.performAction(me, 'skill', 'skill', () => {
              battle.spendSkillPoints(1)
              party.gainEnergy(me, SKILL_ENERGY)
              // "After using Skill on The Beatified, recovers 1 Skill Point."
              if (beatifiedOn(ally)) battle.gainSkillPoints(1)
              modifiers.apply({ id: SKILL_MODIFIER, target: ally, source: me, duration: ownTurnsClock(SKILL_TURNS) })
              giveTalent(ally)
              giveTechnique(ally)
              // The ally and their summon act at once, unless the ally follows the Path of Harmony.
              if (battle.member(ally).kit.path !== 'Harmony') {
                timeline.advance(ally, 1)
                // IN-GAME CHECK: the text says "their summon"; memosprites are read as included.
                for (const summon of [...battle.summonsOf(ally), ...battle.memospritesOf(ally)]) if (timeline.has(summon)) timeline.advance(summon, 1)
              }
            })
          },
        },

        ultimate: {
          kind: 'ultimate',
          canUse: () => party.get(me).energy >= MAX_ENERGY,
          use: (target) => {
            const ally = checkTarget('Ultimate', target, true)
            battle.performAction(me, 'ultimate', 'ultimate', () => {
              party.setEnergy(me, 0)
              party.gainEnergy(me, ULT_ENERGY)
              // IN-GAME CHECK: "regenerates Energy by 20% of Max Energy" read as a flat amount that Energy Regeneration Rate
              // does not scale; the Rest Day's Longing trace lifts it to 40 when it would be less.
              party.gainEnergy(ally, Math.max(ULT_MIN_ENERGY, ULT_ENERGY_SHARE * party.get(ally).maxEnergy), { fixed: true })
              if (ally !== me) {
                // Only the most recent target holds it.
                if (beatifiedAlly !== undefined && beatifiedAlly !== ally) modifiers.remove(beatifiedAlly, BEATIFIED_MODIFIER)
                beatifiedAlly = ally
                // IN-GAME CHECK: 3 turns counted down at the start of each of his turns, so it is up for two of them.
                modifiers.apply({
                  id: BEATIFIED_MODIFIER,
                  target: ally,
                  source: me,
                  duration: { turns: BEATIFIED_TURNS, tick: 'turnStart', clock: me },
                })
                if (e >= 6) giveTalent(ally)
                giveTechnique(ally)
              }
              if (e >= 2 && !ultUsed) battle.gainSkillPoints(E2_SKILL_POINTS)
              ultUsed = true
              // Refresh The Beatified's CRIT DMG value now, so anything that prices damage before the next
              // turnStart/actionUsed listener runs (another kit reacting to this Ultimate) reads it (review fix).
              refreshCd()
            })
          },
        },
      },

      quantities: {
        has_beatified: () => beatifiedAlly !== undefined && modifiers.has(beatifiedAlly, BEATIFIED_MODIFIER),
        beatified_turns_left: () => (beatifiedAlly === undefined ? 0 : (modifiers.get(beatifiedAlly, BEATIFIED_MODIFIER)?.turnsLeft ?? 0)),
      },

      // He attacks with his Basic ATK only, which none of his own buffs reach.
      attackerState: () => ({}),

      teammateState: (attacker: Member): TeammateState => {
        const who: UnitId = attacker.key
        const beatified = beatifiedOn(who)
        const stacks = talentStacks(who)
        const skill = modifiers.has(who, SKILL_MODIFIER)
        return {
          characterConditionals: {
            skillDmgBuff: skill,
            talentCrBuffStacks: stacks,
            beatified,
            teammateCDValue: beatified ? beatifiedCd : 0,
            techniqueDmgBuff: modifiers.has(who, TECHNIQUE_MODIFIER),
            // Fribbels needs the Skill switch on as well for the DEF PEN: both modifiers are applied together and last the same.
            e1DefPen: e >= 1 && skill,
            e2DmgBuff: e >= 2 && beatified,
            e6CrToCdConversion: e >= 6 && stacks > 0,
          },
        }
      },

      onBattleStart: ({ techniques }) => {
        // Exalted Sweep. IN-GAME CHECK: scaled by Energy Regeneration Rate, as the other kits' start-of-battle energy is.
        party.gainEnergy(me, START_ENERGY)
        techniqueReady = techniques
      },
    }
  },
}
