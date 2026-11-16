import type { Battle, HitPart, Member } from '../battle/battle'
import type { UnitId } from '../engine/events'
import { EXTRA_ABILITY } from '../kernel/types'
import type { ExtraHit } from '../kernel/types'
import { levelsOf } from '../levels/levels'
import type { Kit, KitInstance, TeammateState } from './kit'

/**
 * Dan Heng • Permansor Terrae (1414), from the 4.7.0 in-game text (`node tools/gamedata/kit-text.mjs 1414`).
 * All traces are taken as unlocked, as Fribbels does. His damage and his shields scale on his ATK.
 *
 * - Energy 135. Basic ATK (Aegis Vitae): +20 energy, +1 Skill Point, 100% ATK Physical to one enemy (110% at E3),
 *   toughness 30. Skill (Terra Omnibus): +30 energy, -1 Skill Point, no damage: designates one ally as the
 *   Bondmate and gives all allies a Shield of 20% ATK + 400 (21.2% + 445 at E5) for 3 turns. Ultimate (A Dragon's
 *   Zenith Knows No Rue): costs 135, +5 energy, 300% ATK Physical to all enemies (330% at E3), toughness 60 to every
 *   enemy, and all allies get a Shield of 20% ATK + 400 (21.2% + 445 at E3) for 3 turns; the Souldragon becomes
 *   enhanced for 2 of its actions. Every Shield stacks on the holder's Shield from him, up to 300% of the Skill's.
 * - The Bondmate is the ally the Skill was last used on. It gets, as Fribbels models it, +15% of his ATK as ATK
 *   (Empyreanity trace), and with E1 +18% All-Type RES PEN for 3 turns after his Ultimate, with E4 -20% damage
 *   taken (here a damage reduction on the Bondmate in the party), with E6 +12% DEF ignored and all enemies taking
 *   +20% DMG (the +20% also reaches the other allies and himself).
 * - The Souldragon (talent, Of Virtue, Forms Unfold) is a summon with its own gauge (`Battle.addSummon`, K6 first
 *   kind, as Jing Yuan's Lightning-Lord): SPD 165, no HP, nothing enemies can target. The text gives it no HP and
 *   no way to be hit, and Fribbels declares it a summon and not a memosprite (`memosprite: false`), so it is not
 *   the K6 second kind. It appears when an ally becomes the Bondmate and disappears when he or the Bondmate is
 *   knocked down (the battle removes it with him; this kit removes it with the Bondmate). Each action of it dispels 1
 *   debuff from all allies and gives all allies a Shield of 10% ATK + 200 (10.6% + 222.5 at E5) for 3 turns. While
 *   enhanced (after his Ultimate) it also launches a Follow-Up ATK: 80% of his ATK Physical to all enemies (88% at
 *   E3), the Follow-Up the kernel prices as `FUA`. The Sublimity trace adds a Shield of 5% ATK + 100 to the ally whose
 *   Shield is lowest. E2: the enhancement lasts 4 actions, the Souldragon advances 100% after his Ultimate, and the
 *   shield of an enhanced action is doubled.
 * - Sylvanity trace: at the start of combat he advances 40%. When the Bondmate uses an attack he gets 6 energy and
 *   the Souldragon advances 15%. E1: Ultimate also recovers 1 Skill Point.
 *
 * Pricing: Fribbels prices his Basic ATK (`BASIC` hit 0), Ultimate (`ULT` hit 0) and the Souldragon's Follow-Up
 * (`FUA` hit 0); the shield hits carry no ATK multiple and are not priced. The Bondmate's buffs go through
 * `teammateState` only when the attacker is the current Bondmate, with live values: the kernel's `bondmate` switch
 * is on for the Bondmate and off for everyone else, `sourceAtk` is his ATK when the Skill was used, `e1ResPen` is
 * on while the E1 buff is up, `e4DmgReduction` and `e6Buffs` are on for the Bondmate (E6 only with E6).
 * Fribbels' `e6Buffs` switch also gates a 12% DEF ignore, and applies the 20% Vulnerability only to a teammate's
 * attack, never to his own. The text gives the 20% to every ally's damage including his, and the DEF ignore only to
 * the Bondmate, so for every attacker that is not the Bondmate (and for himself) the kit injects the Vulnerability
 * itself (K15a) and leaves `e6Buffs` off.
 *
 * His ATK (for the shields and for the Bondmate's ATK buff) is `Battle.combatStats(me).ATK`, the kernel's in-combat
 * stat for him. It is read only from actions and listeners, never from `attackerState` or `teammateState`.
 *
 * The Bondmate's Additional DMG (K23) is the Bondmate's own damage on the Bondmate's own stats, so it is not a hit of his
 * kit: `teammateState` gives the Bondmate one extra Additional hit (`ExtraHit`, 1.0 x ATK, the Bondmate's element), and
 * the kit deals it as a bare `battle.attack({ attacker: <Bondmate>, ability: 'EXTRA' })` with parts flagged `additional`,
 * priced per 100% by the kernel in the Bondmate's own request (ATK, CRIT, element, RES PEN from E1, DEF ignore and the
 * +20% Vulnerability from E6, ...). It is credited to the Bondmate. It is not inside a `performAction` for the Bondmate, so
 * it is not an attack of his: no Sylvanity, no "after an ally attacks" effect. Three forms, each with the multiple the text
 * gives: the enhanced Souldragon's (the Follow-Up's multiple, 80%, 88% at E3, of the Bondmate's ATK, to all enemies, doubled
 * at E2), Sublimity's (40% of the Bondmate's ATK to the one enemy with the highest HP, `Battle.highestHpAmong`, doubled at E2
 * on the enhanced action) and E6's (330% of the Bondmate's ATK to all enemies when he uses the Ultimate, not doubled: it is
 * not in the Souldragon's action).
 *
 * Toughness (K7), internal units from the kit text ("toughness a/b/c"): Basic 30 on the target, Ultimate 60 to every
 * enemy, the enhanced Souldragon's Follow-Up 60 to every enemy. IN-GAME CHECK: the text puts 60 on the talent's line, and
 * Fribbels has `toughnessDmg` 10 on the Follow-Up, which is 30 here. The kit follows the text; both are pinned in the tests.
 * The Additional DMG removes none.
 *
 * NOT MODELLED:
 * - The Technique (Earthrend): it gives him the Bondmate role, passes it to the active character, and at the start of
 *   the next battle uses the Skill once at no cost. Who the Bondmate is at the start of the battle is a setting the
 *   scenario does not have, so the battle starts with no Bondmate and the first Skill sets it (it costs the Skill
 *   Point and the energy the Technique would have saved, and the Souldragon starts a Skill later). The Technique's
 *   Dazed enemies do not attack is not modelled either (enemies here are not dazed by anything).
 * - Cyrene's "Ode to Earth" beyond its DMG boost (see "Cyrene" below).
 * - The Bondmate being himself: the Skill stops with an error. His own Empyreanity, E1 and E6 buffs would need to come
 *   through his own attacker state, not the teammate path the kernel has.
 * - Dispelling a debuff: nothing here puts a debuff on an ally.
 * - Shield Effect bonuses on the wearer (Self-Enshrouded Recluse), which the kernel's stats do not carry.
 *
 * Cyrene's "Ode to Earth" (`node tools/gamedata/kit-text.mjs 1415`, the skill for teammate Dan Heng PT, Lv6 / Lv7 at Cyrene E3): while
 * `Battle.cyreneEffect` is active for him, "the Bondmate deals 24% (26.4%) increased DMG". That is Fribbels' (`PermansorTerrae.ts` ~320-323,
 * the teammate's `cyreneSpecialEffect`: a DMG boost on the attacker): `teammateState` passes the effect's `active` for the Bondmate's
 * attacks only (Fribbels applies it to whichever attacker it prices; the text gives it to the Bondmate), and Fribbels reads 24% or 26.4%
 * from Cyrene's eidolon. The rest of the skill is NOT MODELLED: the next 3 Souldragon attacks' Additional DMG of "80% (88%) of the
 * Bondmate's Shield Effect" (Fribbels has no number for it, and "the Bondmate's Shield Effect" has no reading in this kit that is not a
 * guess: his shield amounts, or a stat of the Bondmate's, AMBIGUOUS, ask Smitty), and the one-time advance of the Souldragon with an
 * enhanced action at 150% shield when the skill is used on him.
 *
 * IN-GAME CHECK notes mark the readings Smitty will check in game.
 */

const MAX_ENERGY = 135
const BASIC_ENERGY = 20
const SKILL_ENERGY = 30
const ULT_ENERGY = 5
const SYLVANITY_ENERGY = 6

export const SOULDRAGON_SPD = 165
const START_ADVANCE = 0.4
const SYLVANITY_ADVANCE = 0.15
const E2_ADVANCE = 1
const ENHANCED_ACTIONS = 2
const E2_ENHANCED_ACTIONS = 2

const SHIELD_TURNS = 3
const SHIELD_CAP_OF_SKILL = 3
const E1_TURNS = 3
const E1_RES_PEN = 0.18
const E4_REDUCTION = 0.2
const E6_VULNERABILITY = 0.2

const TOUGHNESS_BASIC = 30
const TOUGHNESS_ULT = 60
/** IN-GAME CHECK: the text says 60; Fribbels' `toughnessDmg(10)` would be 30. */
export const TOUGHNESS_FOLLOW_UP = 60

/** The Additional DMG of Sublimity: "1 instance ... 40% of the Bondmate's ATK". */
const SUBLIMITY_ADDITIONAL = 0.4
/** E6: "the Bondmate will deal Additional DMG ... equal to 330% of the Bondmate's ATK", when he uses the Ultimate. */
const E6_ADDITIONAL = 3.3

const SHIELD_KEY = 'dhpt.shield'
const SHIELD_MODIFIER = 'dhpt.shield'
const E1_MODIFIER = 'dhpt.e1_res_pen'
const E4_KEY = 'dhpt.e4_damage_reduction'

/** A shield as a share of ATK plus a flat amount. */
export interface ShieldFormula {
  atkShare: number
  flat: number
}

/** Ability multiples and shield formulas by eidolon, from the in-game Lv10 / Lv12 lines. */
export function danHengPTScalings(eidolon: number) {
  const ultLevel12 = eidolon >= 3 // E3: Ultimate +2, Basic ATK +1
  const skillLevel12 = eidolon >= 5 // E5: Skill +2, Talent +2
  const shield = (up: boolean): ShieldFormula => (up ? { atkShare: 0.212, flat: 445 } : { atkShare: 0.2, flat: 400 })
  return {
    basic: eidolon >= 3 ? 1.1 : 1.0,
    ult: ultLevel12 ? 3.3 : 3.0,
    /** The enhanced Souldragon's Follow-Up on his ATK. */
    followUp: ultLevel12 ? 0.88 : 0.8,
    skillShield: shield(skillLevel12),
    ultShield: shield(ultLevel12),
    talentShield: skillLevel12 ? { atkShare: 0.106, flat: 222.5 } : { atkShare: 0.1, flat: 200 },
    /** Sublimity trace: not level-scaled. */
    sublimityShield: { atkShare: 0.05, flat: 100 },
  }
}

export const shieldAmount = (formula: ShieldFormula, atk: number): number => formula.atkShare * atk + formula.flat

export const DanHengPT: Kit = {
  characterId: '1414',
  path: 'Preservation',
  element: 'Physical',
  maxEnergy: MAX_ENERGY,
  // Fribbels has no buffed version of him: only the original kit (K13).
  abilityVersions: [0],
  // Ability levels (K15, K15a): every ability. No major trace is modelled: a locked one warns.
  levelsModelled: { abilities: ['basic', 'skill', 'ult', 'talent'], majorTraces: [] },

  create(battle: Battle, self: Member): KitInstance {
    const { timeline, party } = battle
    const me = self.key
    const e = self.eidolon
    // Ability levels (K15, K15a): every multiple and shield formula below is the maximum level's, scaled by the table's ratio. Fribbels
    // has no level-dependent buff for him (its Bondmate switches are traces and eidolons), so nothing is injected.
    const lv = levelsOf(self)
    const base = danHengPTScalings(e)
    const shield = (f: ShieldFormula, kind: 'skill' | 'ult' | 'talent', skillId: string, share: number, flat: number): ShieldFormula => ({
      atkShare: f.atkShare * lv.ratio(kind, skillId, share),
      flat: f.flat * lv.ratio(kind, skillId, flat),
    })
    const s = {
      ...base,
      basic: base.basic * lv.ratio('basic', '141401', 0),
      ult: base.ult * lv.ratio('ult', '141403', 0),
      followUp: base.followUp * lv.ratio('ult', '141403', 1),
      skillShield: shield(base.skillShield, 'skill', '141402', 0, 1),
      ultShield: shield(base.ultShield, 'ult', '141403', 3, 4),
      talentShield: shield(base.talentShield, 'talent', '141404', 0, 1),
    }
    const dragon: UnitId = `${me}.souldragon`
    /** The Bondmate's extra Additional hit (K23): 1.0 x ATK, so the kernel's price is per 100% and the parts carry the text's multiples. */
    const additionalHit: ExtraHit = { id: `${me}.bondmate_additional`, damageType: 'ADDITIONAL', scalingStat: 'ATK', multiple: 1 }

    let bondmate: string | undefined
    /** His ATK when the Skill designated the current Bondmate: the Bondmate's ATK buff is 15% of it. */
    let sourceAtk = 0
    let enhancedLeft = 0

    const atk = () => battle.combatStats(me).ATK
    const hasDragon = () => timeline.has(dragon)

    /** The Bondmate is on the field: designated, and standing. */
    const bondmateOnField = () => bondmate !== undefined && !party.get(bondmate).downed

    // ---------------------------------------------------------------- shields

    /**
     * Adds a Shield to one ally on top of the one he holds from this kit, up to 300% of the Skill's own Shield at his
     * current ATK, and renews the duration. IN-GAME CHECK: the shield is a number that only stacks to the cap; a new
     * application renews the 3 turns of the whole stack, counted on the holder's turns and ending at the end of the
     * third. The text does not say whose turns, or whether it ends at the start or the end of one.
     */
    const addShield = (ally: string, amount: number, cap: number) => {
      if (party.get(ally).downed) return
      // His own shield only: another source's (Texture of Memories) neither counts toward the cap nor is touched.
      const current = party.shieldOf(ally, SHIELD_KEY)
      party.setShield(ally, SHIELD_KEY, Math.max(current, Math.min(current + amount, cap)), me)
      timeline.modifiers.apply({ id: SHIELD_MODIFIER, target: ally, source: me, duration: { turns: SHIELD_TURNS, tick: 'turnEnd' } })
    }

    const standingAllies = () => battle.members.map((m) => m.key).filter((key) => !party.get(key).downed)
    const shieldCap = (currentAtk: number) => SHIELD_CAP_OF_SKILL * shieldAmount(s.skillShield, currentAtk)

    /** `amount` to every standing ally. */
    const shieldAll = (formula: ShieldFormula, currentAtk: number, factor = 1) => {
      const amount = shieldAmount(formula, currentAtk) * factor
      const cap = shieldCap(currentAtk)
      for (const ally of standingAllies()) addShield(ally, amount, cap)
    }

    timeline.bus.on('modifierRemoved', ({ modifier }) => {
      if (modifier.id === SHIELD_MODIFIER && party.has(modifier.target)) party.setShield(modifier.target, SHIELD_KEY, undefined)
    })

    // ---------------------------------------------------------------- Bondmate and Souldragon

    const removeDragon = () => {
      battle.removeSummon(dragon)
      enhancedLeft = 0
    }

    /**
     * Additional DMG the Bondmate deals because of this kit (K23): a bare attack of ability 'EXTRA' by the Bondmate, not an
     * action of his, so nothing reacts to it as an ally attacking. Each part names the one extra hit `teammateState` gives
     * him and carries the text's multiple of his ATK. Nothing happens without a Bondmate on the field.
     */
    const bondmateAdditional = (parts: Array<{ shape: 'aoe', scaling: number } | { shape: 'single', scaling: number, target: UnitId }>) => {
      if (!bondmateOnField() || parts.length === 0) return
      const who = bondmate!
      const hit = battle.extraHitIndex(who, additionalHit.id)
      battle.attack({
        attacker: who,
        ability: EXTRA_ABILITY,
        parts: parts.map((part): HitPart => ({ ...part, hit, additional: true })),
      })
    }

    /** One action of the Souldragon. Enhanced: the Follow-Up ATK, and the Bondmate's Additional DMG (K23). */
    const dragonTurn = () => {
      const enhanced = enhancedLeft > 0
      const currentAtk = atk()
      // IN-GAME CHECK: E2's "the Shield Effect provided in this instance becomes 200%" read as every shield of the
      // enhanced action (the talent's and Sublimity's), and "the Additional DMG dealt by the Bondmate becomes 200%" as both
      // of the enhanced action's Additional DMG (the Follow-Up's and Sublimity's).
      const factor = enhanced && e >= 2 ? 2 : 1
      battle.performAction(me, 'souldragon', 'followUp', () => {
        if (enhanced) {
          battle.attack({
            attacker: me,
            ability: 'FUA',
            parts: [{ shape: 'aoe', scaling: s.followUp, hit: 0, toughness: TOUGHNESS_FOLLOW_UP }],
          })
          // The Follow-Up's Additional DMG: the same multiple of the Bondmate's ATK, to all enemies. Then Sublimity's one
          // instance on the enemy whose HP is highest after that (IN-GAME CHECK: the order of the two).
          bondmateAdditional([{ shape: 'aoe', scaling: s.followUp * factor }])
          if (bondmateOnField()) {
            const target = battle.highestHpAmong(battle.enemies.ids, { attacker: bondmate!, ability: EXTRA_ABILITY, hit: battle.extraHitIndex(bondmate!, additionalHit.id) })
            bondmateAdditional([{ shape: 'single', target, scaling: SUBLIMITY_ADDITIONAL * factor }])
          }
        }
        shieldAll(s.talentShield, currentAtk, factor)
        // Sublimity: the ally whose Shield is lowest, the first in party order on a tie.
        const lowest = standingAllies().reduce<string | undefined>(
          (best, key) => (best === undefined || party.shield(key) < party.shield(best) - 1e-9 ? key : best),
          undefined,
        )
        if (lowest !== undefined) addShield(lowest, shieldAmount(s.sublimityShield, currentAtk) * factor, shieldCap(currentAtk))
      })
      if (enhanced) enhancedLeft -= 1
    }

    const ensureDragon = () => {
      if (hasDragon()) return
      battle.addSummon({ id: dragon, owner: me, baseSpd: SOULDRAGON_SPD, takeTurn: dragonTurn })
    }

    /**
     * IN-GAME CHECK: "summons Souldragon for them" when an ally becomes the Bondmate. Read as one Souldragon at a time:
     * naming a new Bondmate moves it (keeping its gauge and its enhancement) and naming the same one changes nothing.
     * The other reading, a new Souldragon with a full gauge each time, is not modelled.
     */
    const setBondmate = (key: string) => {
      if (bondmate !== undefined) party.setDamageReduction(bondmate, E4_KEY, undefined)
      bondmate = key
      if (e >= 4) party.setDamageReduction(key, E4_KEY, E4_REDUCTION)
      ensureDragon()
    }

    const clearBondmate = () => {
      if (bondmate !== undefined && party.has(bondmate)) party.setDamageReduction(bondmate, E4_KEY, undefined)
      bondmate = undefined
      removeDragon()
    }

    timeline.bus.on('unitDowned', ({ unit }) => {
      // The Souldragon disappears when he or the Bondmate is knocked down (the battle removes it with him).
      if (unit === me || unit === bondmate) clearBondmate()
    })

    // Sylvanity: when the Bondmate uses an attack. IN-GAME CHECK: read as any action of the Bondmate that hit at least
    // one enemy (Basic ATK, Skill, Ultimate or follow-up), once per action.
    timeline.bus.on('actionUsed', (action) => {
      if (bondmate === undefined || action.actor !== bondmate || action.enemiesHit.length === 0 || !(action.expectedEnemiesHit > 0)) return
      party.gainEnergy(me, SYLVANITY_ENERGY)
      if (hasDragon()) timeline.advance(dragon, SYLVANITY_ADVANCE)
    })

    // ---------------------------------------------------------------- the kit

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
                parts: [{ shape: 'single', scaling: s.basic, hit: 0, toughness: TOUGHNESS_BASIC }],
              })
            }),
        },
        skill: {
          kind: 'skill',
          canUse: () => battle.skillPoints >= 1,
          use: (target) => {
            if (target === undefined) throw new Error(`${me}'s Skill needs a target: the ally that becomes the Bondmate (the policy rule's "target")`)
            if (!battle.isCharacter(target)) throw new Error(`${me}'s Skill target "${target}" is not an ally`)
            if (target === me) {
              throw new Error(`${me}'s Skill on himself (as the Bondmate) is not modelled: his own Bondmate buffs have no path through the kernel`)
            }
            if (party.get(target).downed) throw new Error(`${me}'s Skill target "${target}" is downed`)
            battle.performAction(me, 'skill', 'skill', () => {
              const currentAtk = atk()
              battle.spendSkillPoints(1)
              party.gainEnergy(me, SKILL_ENERGY)
              setBondmate(target)
              // Empyreanity: the Bondmate's ATK is raised by 15% of his ATK at this moment. IN-GAME CHECK: read as a
              // snapshot taken when the Skill is used, lasting while the ally is the Bondmate (the text gives no duration).
              sourceAtk = currentAtk
              shieldAll(s.skillShield, currentAtk)
            })
          },
        },
        ultimate: {
          kind: 'ultimate',
          canUse: () => party.get(me).energy >= MAX_ENERGY,
          use: () => {
            battle.performAction(me, 'ultimate', 'ultimate', () => {
              party.setEnergy(me, 0)
              const currentAtk = atk()
              battle.attack({
                attacker: me,
                ability: 'ULT',
                parts: [{ shape: 'aoe', scaling: s.ult, hit: 0, toughness: TOUGHNESS_ULT }],
              })
              shieldAll(s.ultShield, currentAtk)
              party.gainEnergy(me, ULT_ENERGY)
              // E6: the Bondmate deals Additional DMG to all enemies. IN-GAME CHECK: after his Ultimate's own damage and before
              // E1's RES PEN lands on the Bondmate (both trigger on the Ultimate; the text gives no order).
              if (e >= 6) bondmateAdditional([{ shape: 'aoe', scaling: E6_ADDITIONAL }])
              if (e >= 1) {
                battle.gainSkillPoints(1)
                // E1: on the Bondmate when the Ultimate is used. With no Bondmate there is nobody to give it to.
                if (bondmate !== undefined && !party.get(bondmate).downed) {
                  timeline.modifiers.apply({ id: E1_MODIFIER, target: bondmate, source: me, duration: { turns: E1_TURNS, tick: 'turnEnd' } })
                }
              }
              if (hasDragon()) enhancedLeft = ENHANCED_ACTIONS + (e >= 2 ? E2_ENHANCED_ACTIONS : 0)
            })
            if (e >= 2 && hasDragon()) timeline.advance(dragon, E2_ADVANCE)
          },
        },
      },

      quantities: {
        has_bondmate: () => bondmateOnField(),
        souldragon: () => hasDragon(),
        enhanced_actions: () => enhancedLeft,
      },

      // The Bondmate's buffs are on the Bondmate's attacks (teammateState). His own attacks get E6's Vulnerability,
      // which Fribbels leaves out for him, but the text gives to every ally's damage.
      attackerState: () => ({
        ...(e >= 6 && bondmateOnField() && {
          injectedBuffs: [{ stat: 'VULNERABILITY' as const, value: E6_VULNERABILITY, target: 'self' as const, label: 'Dan Heng PT E6 (own attacks)' }],
        }),
      }),

      teammateState: (attacker: Member): TeammateState => {
        const isBondmate = bondmateOnField() && attacker.key === bondmate
        const e6 = e >= 6 && bondmateOnField()
        return {
          // K23: the Bondmate's Additional DMG is priced in the Bondmate's own request, at 1.0 x ATK per 100%.
          ...(isBondmate && { extraHits: [additionalHit] }),
          characterConditionals: {
            bondmate: isBondmate,
            sourceAtk: isBondmate ? sourceAtk : 0,
            // Cyrene's "Ode to Earth" on him (Battle.cyreneEffect, off by default): the Bondmate's DMG boost (see the header).
            cyreneSpecialEffect: isBondmate && battle.cyreneEffect(me).active,
            e1ResPen: isBondmate && timeline.modifiers.has(attacker.key, E1_MODIFIER),
            e4DmgReduction: isBondmate,
            e6Buffs: isBondmate && e6,
          },
          ...(e6 && !isBondmate && {
            injectedBuffs: [{ stat: 'VULNERABILITY' as const, value: E6_VULNERABILITY, target: 'team' as const, label: 'Dan Heng PT E6' }],
          }),
        }
      },

      onBattleStart: () => {
        // Sylvanity: advances 40% when combat starts. The Technique is not modelled (see the header).
        timeline.advance(me, START_ADVANCE)
      },
    }
  },
}
