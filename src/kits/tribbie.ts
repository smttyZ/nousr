import type { Battle, Member } from '../battle/battle'
import type { EngineEvents, UnitId } from '../engine/events'
import type { Kit, KitInstance } from './kit'

/**
 * Tribbie (1403), from the 4.7.0 in-game text (`node tools/gamedata/kit-text.mjs 1403`).
 * All traces are taken as unlocked, as Fribbels does. Her damage scales on her Max HP.
 *
 * - Energy 120. Basic ATK: +20 energy, +1 Skill Point. Skill: +30 energy, -1 Skill Point, no damage.
 *   Ultimate: costs all 120, then +5 energy.
 * - Numinosity (Skill, and the technique at battle start): 3 turns, counted down at the start of her turns.
 *   While it lasts, every ally's All-Type RES PEN goes up (24%, 26.4% at E5). E4 adds 18% DEF ignored.
 * - Zone (Ultimate): 2 turns, counted down at the start of her turns. While it lasts, enemies take 30%
 *   more DMG (33% at E3), and Tribbie's Max HP is raised by 9% of the other allies' Max HP (trace).
 *   After any ally attacks, the Zone deals one Quantum Additional DMG instance per enemy that attack hit,
 *   all to the hit enemy with the highest current HP (K10). E1 adds True DMG on top, E2 enlarges it.
 * - Talent (Busy as Tribbie): when another ally uses its Ultimate, she follows up against all enemies,
 *   once per ally until she uses her own Ultimate. Each follow-up gives her +5 energy.
 * - Trace (Lamb Outside the Wall...): after her talent follow-up, +72% DMG for 3 turns, up to 3 stacks.
 * - Trace (Pebble at Crossroads?): 30 energy at the start of battle, and 1.5 energy per enemy hit by another
 *   ally's attack. The text does not call this flat, so both scale with Energy Regeneration Rate.
 *
 * Who she aims at: the primary target (K2, K3, DESIGN.md). Adjacent enemies take half the Basic's primary
 * multiple.
 *
 * The Zone's Additional DMG has two sources:
 * - Her own Basic ATK, Ultimate and follow-up. Fribbels builds these as two hits, hit 0 the ability and hit 1
 *   the Additional DMG. After the main hit lands, the kit deals one instance per enemy the attack hit, all on
 *   the hit enemy with the highest current HP (ties go to the primary target), priced at hit 1 (K11).
 * - Another ally's attack. Priced as Fribbels' UNIQUE ability (its only hit), one instance per enemy hit,
 *   same target rule. It is a bare attack, not an action: Additional DMG is not an attack, so it triggers no
 *   "after an ally attacks" effect of any kit and adds no enemy to any action's hit list.
 *
 * NOT MODELLED:
 * - Cyrene's effect on the Zone's Additional DMG. `cyreneSpecialEffect` is passed as off until a Cyrene kit
 *   exists; Fribbels' default (on) would double the Additional DMG's multiple.
 * - Memosprite attacks now count: `isAlly` covers memosprites, so a memosprite's action triggers the Zone's Additional DMG
 *   and the Pebble energy like an ally target's attack (the text says "ally target"). The Additional DMG is priced as hers.
 * - The talent follow-up's retarget when its target is defeated before it lands. Enemies are never defeated
 *   in this model.
 * - The technique's own Attack hit: Fribbels does not price it and the engine has no toughness-only hit.
 * - The Zone's Max HP trace as a change to her party HP: it is only reflected in the damage multiple, through
 *   Fribbels' own HP buff (the alliesMaxHp conditional).
 *
 * Toughness (K7), internal units from `node tools/gamedata/kit-text.mjs 1403` ("toughness a/b/c": the designated
 * target / every enemy / adjacent): Basic 30/0/15, Ultimate 0/60/0, talent follow-up 0/15/0 (Fribbels:
 * `toughnessDmg` 10, 20 and 5, times 3). The Zone's Additional DMG removes none. She follows weaknesses.
 *
 * IN-GAME CHECK notes mark the readings Smitty will check in game. AMBIGUOUS notes mark other places where
 * the text can be read two ways.
 */

const MAX_ENERGY = 120
const MAX_TRACE_STACKS = 3

const BASIC_ENERGY = 20
const SKILL_ENERGY = 30
const ULT_ENERGY = 5
const TALENT_ENERGY = 5
const PEBBLE_START_ENERGY = 30
const PEBBLE_PER_HIT = 1.5

/** Toughness per part, internal units (see the header). */
const TOUGHNESS_BASIC = 30
const TOUGHNESS_BASIC_ADJACENT = 15
const TOUGHNESS_ULT = 60
const TOUGHNESS_TALENT = 15

const NUMINOSITY_TURNS = 3
const ZONE_TURNS = 2
const LAMB_TURNS = 3

const NUMINOSITY = 'tribbie.numinosity'
const ZONE = 'tribbie.zone'
const LAMB = 'tribbie.lamb'

/** Fribbels builds BASIC, ULT and FUA as hit 0, her own damage, then hit 1, the Zone's Additional DMG while the Zone is up. */
const ZONE_ADDITIONAL_HIT = 1

/** Fribbels prices an ally-triggered instance as the only hit of its UNIQUE ability. */
const ALLY_ADDITIONAL_ABILITY = 'UNIQUE'

/** Ability multiples by eidolon. E3 raises the Basic ATK, Ultimate and Zone additional; E5 the Talent. */
export function tribbieScalings(eidolon: number) {
  return {
    basic: eidolon >= 3 ? 0.33 : 0.3,
    ult: eidolon >= 3 ? 0.33 : 0.3,
    /** Per Zone Additional DMG instance, before E2. */
    zoneAdditional: eidolon >= 3 ? 0.132 : 0.12,
    talent: eidolon >= 5 ? 0.198 : 0.18,
  }
}

/**
 * The Zone's Additional DMG for one enemy hit, as a multiple of her Max HP: one instance, or 2.4 times it
 * at E2 (two instances at 120% each).
 */
// IN-GAME CHECK: E2 raises the Zone's Additional DMG to 120% and adds one more instance, without saying how
// big the extra one is. Read as another 120%, once per instance (2N instances for N hit enemies), which is
// what Fribbels does (1.20 x 2 in its additionalScaling). Total: 2.4 x the base instance, per enemy hit.
export function tribbieZoneAdditional(eidolon: number): number {
  return tribbieScalings(eidolon).zoneAdditional * (eidolon >= 2 ? 2.4 : 1)
}

export const Tribbie: Kit = {
  characterId: '1403',
  path: 'Harmony',
  element: 'Quantum',
  maxEnergy: MAX_ENERGY,
  // Fribbels has no buffed version of her: only the original kit (K13).
  abilityVersions: [0],

  create(battle: Battle, self: Member): KitInstance {
    const { timeline } = battle
    const me = self.key
    const e = self.eidolon
    const s = tribbieScalings(e)

    /** Allies whose Ultimate has already triggered her talent since her last Ultimate. */
    const talentUsedBy = new Set<UnitId>()

    const numinosity = () => timeline.modifiers.has(me, NUMINOSITY)
    const zoneUp = () => timeline.modifiers.has(me, ZONE)
    const lambStacks = () => timeline.modifiers.get(me, LAMB)?.stacks ?? 0
    // IN-GAME CHECK: the Max HP trace adds 9% of the sum of all ally characters' Max HP. Read as the other
    // allies only: counting Tribbie herself would make her Max HP depend on itself. Fribbels takes the sum
    // as an input (alliesMaxHp); the kit passes the other allies' sum.
    const alliesMaxHp = () =>
      battle.members.filter((m) => m.key !== me).reduce((sum, m) => sum + battle.party.get(m.key).maxHp, 0)

    /**
     * The Zone's Additional DMG after an attack of hers, if the Zone is up: one instance per enemy the
     * attack hit, all on the hit enemy with the highest current HP, read after the main hit has landed.
     * The choice is `Battle.highestHpAmong` (K10), which guards its undecided tie-break.
     */
    const ownZoneAdditional = (ability: string, hit: readonly UnitId[]) => {
      if (!zoneUp() || hit.length === 0) return
      battle.attack({
        attacker: me,
        ability,
        parts: [{
          shape: 'single',
          target: battle.highestHpAmong(hit, { attacker: me, ability, hit: ZONE_ADDITIONAL_HIT }),
          scaling: hit.length * tribbieZoneAdditional(e),
          hit: ZONE_ADDITIONAL_HIT,
          additional: true,
        }],
      })
    }

    /**
     * The same, after another ally's attack. One instance per enemy hit, counted as the expected number of
     * distinct enemies (K17), so the multiple is `expectedEnemiesHit` times the per-instance value.
     * The target is still chosen among every enemy the attack could have hit (`enemiesHit`): see the report
     * note on K17 and K10 (the highest-HP choice over a random hit set is not probability-weighted).
     */
    const allyZoneAdditional = (action: EngineEvents['actionUsed']) => {
      if (!zoneUp() || action.enemiesHit.length === 0 || !(action.expectedEnemiesHit > 0)) return
      // A bare attack, deliberately not an action. It is emitted after the ally's action has resolved, so
      // it is never counted into an action's hit list.
      battle.attack({
        attacker: me,
        ability: ALLY_ADDITIONAL_ABILITY,
        parts: [{
          shape: 'single',
          target: battle.highestHpAmong(action.enemiesHit, { attacker: me, ability: ALLY_ADDITIONAL_ABILITY, hit: 0 }),
          scaling: action.expectedEnemiesHit * tribbieZoneAdditional(e),
          hit: 0,
          additional: true,
        }],
      })
    }

    /**
     * Her talent: one follow-up against all enemies. +5 energy, then the Lamb trace stacks (after the hit,
     * so the hit itself uses the stacks she already had).
     */
    const talentFollowUp = () => {
      battle.performAction(me, 'talent_follow_up', 'followUp', () => {
        battle.party.gainEnergy(me, TALENT_ENERGY)
        battle.attack({ attacker: me, ability: 'FUA', parts: [{ shape: 'aoe', scaling: s.talent, hit: 0, toughness: TOUGHNESS_TALENT }] })
        ownZoneAdditional('FUA', battle.enemies.ids)
        // AMBIGUOUS: the Lamb trace triggers "after using Talent's Follow-Up ATK". Read as: each talent
        // follow-up adds a stack and refreshes the 3-turn duration. The E6 follow-up counts too.
        timeline.modifiers.apply({
          id: LAMB,
          target: me,
          source: me,
          stacks: Math.min(MAX_TRACE_STACKS, lambStacks() + 1),
          duration: { turns: LAMB_TURNS, tick: 'turnEnd' },
        })
      })
    }

    // After another ally has attacked (its action has resolved): the Zone's Additional DMG, the Pebble
    // energy, and, if it was an Ultimate, her talent (one follow-up per ally until she uses her own).
    timeline.bus.on('actionUsed', (action) => {
      if (action.actor === me || !battle.isAlly(action.actor)) return
      allyZoneAdditional(action)
      battle.party.gainEnergy(me, PEBBLE_PER_HIT * action.expectedEnemiesHit)
      if (action.kind === 'ultimate' && !talentUsedBy.has(action.actor)) {
        talentUsedBy.add(action.actor)
        talentFollowUp()
      }
    })

    // E6: after her own Ultimate has resolved (its actionUsed event), her talent follow-up against all enemies.
    if (e >= 6) {
      timeline.bus.on('actionUsed', (action) => {
        if (action.actor === me && action.kind === 'ultimate') talentFollowUp()
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
              battle.party.gainEnergy(me, BASIC_ENERGY)
              battle.attack({
                attacker: me,
                ability: 'BASIC',
                parts: [{
                  shape: 'blast',
                  scaling: s.basic,
                  adjacent: s.basic / 2,
                  hit: 0,
                  toughness: TOUGHNESS_BASIC,
                  adjacentToughness: TOUGHNESS_BASIC_ADJACENT,
                }],
              })
              ownZoneAdditional('BASIC', [battle.primary, ...battle.adjacentEnemies(battle.primary)])
            }),
        },
        skill: {
          kind: 'skill',
          canUse: () => battle.skillPoints >= 1,
          use: () =>
            battle.performAction(me, 'skill', 'skill', () => {
              battle.spendSkillPoints(1)
              battle.party.gainEnergy(me, SKILL_ENERGY)
              // Refreshes Numinosity if it is already up.
              timeline.modifiers.apply({
                id: NUMINOSITY,
                target: me,
                source: me,
                duration: { turns: NUMINOSITY_TURNS, tick: 'turnStart' },
              })
            }),
        },
        ultimate: {
          kind: 'ultimate',
          canUse: () => battle.party.get(me).energy >= MAX_ENERGY,
          use: () =>
            battle.performAction(me, 'ultimate', 'ultimate', () => {
              battle.party.setEnergy(me, 0)
              talentUsedBy.clear()
              // IN-GAME CHECK: the text lists the Zone before the damage. Read as the Zone being up for this
              // hit, so it gets the vulnerability and the Zone's Additional DMG. The Zone is applied first.
              timeline.modifiers.apply({
                id: ZONE,
                target: me,
                source: me,
                duration: { turns: ZONE_TURNS, tick: 'turnStart' },
              })
              battle.attack({ attacker: me, ability: 'ULT', parts: [{ shape: 'aoe', scaling: s.ult, hit: 0, toughness: TOUGHNESS_ULT }] })
              ownZoneAdditional('ULT', battle.enemies.ids)
              battle.party.gainEnergy(me, ULT_ENERGY)
            }),
        },
      },

      quantities: {
        zone: () => zoneUp(),
        numinosity: () => numinosity(),
        lamb_stacks: () => lambStacks(),
      },

      attackerState: () => ({
        characterConditionals: {
          numinosity: numinosity(),
          ultZone: zoneUp(),
          alliesMaxHp: alliesMaxHp(),
          talentFuaStacks: lambStacks(),
          // Fribbels multiplies a UNIQUE hit by this (its default is 8). One instance per priced hit.
          uniqueTickCoefficient: 1,
          // NOT MODELLED until a Cyrene kit exists (see the header).
          cyreneSpecialEffect: false,
          // E1 is on whenever the Zone is up, since the Zone deals Additional DMG after every ally attack
          // that hits a target. Fribbels gates it on the eidolon and the Zone itself.
          e1TrueDmg: true,
          // E2, E4 and E6 are read by Fribbels from the eidolon itself.
          e2AdditionalDmg: true,
          e4DefPen: true,
          e6FuaScaling: true,
        },
      }),

      teammateState: () => ({
        characterConditionals: {
          numinosity: numinosity(),
          ultZone: zoneUp(),
          e1TrueDmg: true,
          e4DefPen: true,
        },
      }),

      onBattleStart: ({ techniques }) => {
        // Technique (If You're Happy and You Know It): Numinosity for 3 turns on entering battle.
        if (techniques) {
          timeline.modifiers.apply({
            id: NUMINOSITY,
            target: me,
            source: me,
            duration: { turns: NUMINOSITY_TURNS, tick: 'turnStart' },
          })
        }
        // Pebble at Crossroads?: 30 energy at the start of battle, scaled by Energy Regeneration Rate.
        battle.party.gainEnergy(me, PEBBLE_START_ENERGY)
      },
    }
  },
}
