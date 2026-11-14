import type { Battle, Member, HitPart } from '../battle/battle'
import type { TurnInfo, UnitId } from '../engine/events'
import type { Kit, KitInstance } from './kit'

/**
 * Jing Yuan (1204), from the 4.7.0 in-game text (`node tools/gamedata/kit-text.mjs 1204`).
 * All traces are taken as unlocked, as Fribbels does. Everything scales on ATK. Abilities are at the kit text's
 * levels: no eidolon gives Basic 100%, Skill 100%, Ultimate 200%, talent 66% per hit; E3 raises the Basic ATK
 * to 110% and the Ultimate to 216%, E5 the Skill to 110% and the talent to 72.6% (the in-game Lv7 / Lv12 lines).
 *
 * - Energy 130. Basic ATK: +20 energy, +1 Skill Point. Skill: +30 energy, -1 Skill Point, AoE. Ultimate: costs
 *   130, +5 energy, AoE. Trace Savant Providence: +15 energy at the start of battle.
 * - Lightning-Lord (the talent): a summon on the timeline (`Battle.addSummon`, K6 first kind) with 60 base SPD
 *   and 3 base Hits Per Action. Each hit is 66% ATK (72.6% at E5) on a random enemy; the enemies next to it take
 *   25% of that (50% at E1). Hits Per Action reach at most 10 (30 with the Affinitive Eidolon). Every +1 Hits Per
 *   Action is +10 SPD. The Skill adds 2 and the Ultimate 3 for the next turn; the technique adds 3 for the first
 *   turn. After its action it returns to 3 hits and 60 SPD. It disappears with Jing Yuan (the battle removes it).
 *   Its hits are "considered Follow-Up ATKs" of Jing Yuan, so they are priced as his FUA, and the action is
 *   logged and credited to him as a follow-up (`performAction(me, 'lightning_lord', 'followUp', ...)`); other
 *   kits' "after an ally attacks" listeners (Tribbie's Zone, Acheron's Affinitive Eidolon) therefore see it.
 * - Trace War Marshal: after the Skill, +10% CRIT Rate for 2 turns. Trace Battalia Crush: Lightning-Lord's
 *   CRIT DMG +25% when its Hits Per Action in that turn are 6 or more (Fribbels reads the hit count itself).
 * - E1: the adjacent multiplier is 25% more of the primary's (so 50%). E2: after Lightning-Lord's action, the
 *   Basic ATK, Skill and Ultimate deal +20% for 2 turns. E4: +2 energy per hit of Lightning-Lord. E6: each hit
 *   makes its target Vulnerable (+12% DMG taken, up to 3 stacks, until the end of Lightning-Lord's turn).
 * - Affinitive Eidolon: max hits +20 (30); at the cap Lightning-Lord immediately acts; at the start of combat
 *   and after every Lightning-Lord action it is "enhanced" and Jing Yuan deals +240% DMG; Skill and Ultimate
 *   add 6 and 12 more hits.
 *
 * Pricing (K11): the FUA is one Fribbels hit whose multiple is the talent's multiple times the hit count, so the
 * kit declares one part per possible target at 1 / enemies of the hits each (an expected value over the
 * random targets, as for Acheron's bounces) and tells the kernel the hit count through `talentAttacks` and
 * `talentHitsPerAction` (they feed the Ashblazing Grand Duke stacks and the 6-hit CRIT DMG).
 *
 * Toughness (K7), internal units from the kit text ("toughness a/b/c"): Basic 30 on the target, Skill 30 to
 * every enemy, Ultimate 60 to every enemy, each Lightning-Lord hit 15 on its target (Fribbels: `toughnessDmg` 10,
 * 10, 20 and 5 per hit, times 3). The adjacent enemies of a Lightning-Lord hit take no toughness damage.
 *
 * IN-GAME CHECK notes mark the readings Smitty will check in game.
 */

const MAX_ENERGY = 130
const BASIC_ENERGY = 20
const SKILL_ENERGY = 30
const ULT_ENERGY = 5
const START_ENERGY = 15
const E4_ENERGY_PER_HIT = 2

export const LIGHTNING_LORD_BASE_SPD = 60
export const LIGHTNING_LORD_BASE_HITS = 3
export const LIGHTNING_LORD_SPD_PER_HIT = 10
export const LIGHTNING_LORD_MAX_HITS = 10
/** The Affinitive Eidolon's +20. */
export const LIGHTNING_LORD_MAX_HITS_AFFINITIVE = 30

const SKILL_HITS = 2
const ULT_HITS = 3
const TECHNIQUE_HITS = 3
const AFFINITIVE_SKILL_HITS = 6
const AFFINITIVE_ULT_HITS = 12
const AFFINITIVE_TURNS = 4
const ADJACENT_SHARE = 0.25
const E1_ADJACENT_SHARE = 0.25

const WAR_MARSHAL_TURNS = 2
const E2_TURNS = 2
const E6_MAX_STACKS = 3

/**
 * E6's Vulnerable stacks on the hit enemy as the text has them: each hit adds a stack to its target, so a
 * hit gets the stacks left by the earlier hits on the same enemy (expected value over the random targets).
 * Fribbels instead puts all 3 stacks on every hit. `true` is the text's reading, `false` is Fribbels'.
 * IN-GAME CHECK: whether the hit that applies a stack already gets it (read as no), and whether the stacks
 * the adjacent enemies take from a hit's splash exist (read as no: only the target is made Vulnerable).
 */
export const E6_VULNERABILITY_RAMP = true

const TOUGHNESS_BASIC = 30
const TOUGHNESS_SKILL = 30
const TOUGHNESS_ULT = 60
const TOUGHNESS_LORD_HIT = 15

const WAR_MARSHAL = 'jingyuan.war_marshal'
const E2_BUFF = 'jingyuan.e2_dmg'
const ENHANCED = 'jingyuan.enhanced'
const LORD_HITS = 'jingyuan.lightning_lord_hits'

/** Ability multiples by eidolon (the in-game Lv7 / Lv12 lines come with E3 and E5). */
export function jingYuanScalings(eidolon: number) {
  return {
    basic: eidolon >= 3 ? 1.1 : 1.0,
    skill: eidolon >= 5 ? 1.1 : 1.0,
    ult: eidolon >= 3 ? 2.16 : 2.0,
    /** Per Lightning-Lord hit, on its target. */
    lordHit: eidolon >= 5 ? 0.726 : 0.66,
    /** The share of the target's multiple the adjacent enemies take. */
    adjacent: ADJACENT_SHARE + (eidolon >= 1 ? E1_ADJACENT_SHARE : 0),
  }
}

/**
 * For a Lightning-Lord action of `hits` hits on `enemies` enemies, how many of those hits (expected value) land
 * on an enemy that already carries 0, 1, 2 or 3 Vulnerable stacks from earlier hits of the same action. Each hit
 * picks its enemy uniformly, so the stacks before hit k are Binomial(k, 1/enemies), capped at 3. The four numbers
 * add up to `hits`.
 */
export function lightningLordVulnerableWeights(hits: number, enemies: number): number[] {
  const weights = [0, 0, 0, 0]
  const p = 1 / enemies
  for (let k = 0; k < hits; k++) {
    let below = 0
    for (let s = 0; s < E6_MAX_STACKS && s <= k; s++) {
      const prob = binomial(k, s) * p ** s * (1 - p) ** (k - s)
      weights[s]! += prob
      below += prob
    }
    weights[E6_MAX_STACKS]! += Math.max(0, 1 - below)
  }
  return weights
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let c = 1
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i
  return c
}

export const JingYuan: Kit = {
  characterId: '1204',
  path: 'Erudition',
  element: 'Lightning',
  maxEnergy: MAX_ENERGY,
  // Fribbels has no buffed version of him: only the original kit (K13).
  abilityVersions: [0],

  create(battle: Battle, self: Member): KitInstance {
    const { timeline } = battle
    const me = self.key
    const e = self.eidolon
    const affinitive = self.affinitiveEidolon
    const s = jingYuanScalings(e)
    const maxHits = affinitive ? LIGHTNING_LORD_MAX_HITS_AFFINITIVE : LIGHTNING_LORD_MAX_HITS
    const lord: UnitId = `${me}.lightning_lord`

    let hits = LIGHTNING_LORD_BASE_HITS
    /** The hit count and E6 stacks the kernel is being asked about during Lightning-Lord's action. */
    let pricing: { hits: number, e6Stacks: number } | undefined

    const critUp = () => timeline.modifiers.has(me, WAR_MARSHAL)
    const e2Up = () => timeline.modifiers.has(me, E2_BUFF)
    const enhanced = () => timeline.modifiers.has(me, ENHANCED)

    /** Sets Hits Per Action (and with it SPD). At the cap, with the Affinitive Eidolon, it acts at once. */
    const setHits = (n: number) => {
      const before = hits
      hits = Math.max(LIGHTNING_LORD_BASE_HITS, Math.min(maxHits, n))
      // The Lord can be gone already (Jing Yuan downed inside its own action): nothing to put a modifier on.
      if (!timeline.has(lord)) return
      if (hits > LIGHTNING_LORD_BASE_HITS) {
        timeline.modifiers.apply({
          id: LORD_HITS,
          target: lord,
          source: me,
          spdFlat: LIGHTNING_LORD_SPD_PER_HIT * (hits - LIGHTNING_LORD_BASE_HITS),
          stacks: hits,
        })
      } else timeline.modifiers.remove(lord, LORD_HITS)
      // IN-GAME CHECK: "immediately takes action" read as an action advance of 100%: it acts as soon as the
      // current action has resolved (the Ultimate window still opens between), before anyone else.
      // Not when the Lord's own turn is already being taken (the cap reached in the Ultimate window before its
      // action): its gauge was just refilled for that turn, and advancing it would give it a second action.
      if (affinitive && hits >= maxHits && before < maxHits && timeline.activeTurn?.unit !== lord) timeline.advance(lord, 1)
    }

    const refreshEnhanced = () => {
      if (!affinitive) return
      // IN-GAME CHECK: the text says the +240% starts with the enhanced state, at the start of combat and
      // after every Lightning-Lord action, and ends the sentence about Skill and Ultimate hits with "lasting for
      // 4 turn(s)". Read as: the enhanced state lasts 4 of Jing Yuan's turns and is renewed after each action of
      // Lightning-Lord, so it is up almost always (Fribbels has it always on). The other reading, that the extra
      // 6 / 12 hits last 4 turns, is not modelled: they last until Lightning-Lord's next action.
      timeline.modifiers.apply({ id: ENHANCED, target: me, source: me, duration: { turns: AFFINITIVE_TURNS, tick: 'turnEnd' } })
    }

    /** One attack part per possible target, each taking 1 / enemies of `weight` hits. */
    const lordParts = (weight: number): HitPart[] => {
      const ids = battle.enemies.ids
      return ids.map((target) => ({
        shape: 'blast',
        scaling: (s.lordHit * weight) / ids.length,
        adjacent: (s.lordHit * s.adjacent * weight) / ids.length,
        target,
        hit: 0,
        toughness: (TOUGHNESS_LORD_HIT * weight) / ids.length,
        // K17: these parts are `weight` random hits, each landing on this target with probability 1 / enemies.
        random: { hits: weight, chance: 1 / ids.length },
      }))
    }

    const lordAttack = (n: number) => {
      const levels: number[] = !(e >= 6)
        ? [n, 0, 0, 0]
        : E6_VULNERABILITY_RAMP
          ? lightningLordVulnerableWeights(n, battle.enemies.ids.length)
          : [0, 0, 0, n]
      levels.forEach((weight, stacks) => {
        if (!(weight > 1e-12)) return
        pricing = { hits: n, e6Stacks: stacks }
        try {
          battle.attack({ attacker: me, ability: 'FUA', parts: lordParts(weight) })
        } finally {
          pricing = undefined
        }
      })
    }

    const lordTurn = (_turn: TurnInfo) => {
      const n = hits
      battle.performAction(me, 'lightning_lord', 'followUp', () => {
        lordAttack(n)
        if (e >= 4) battle.party.gainEnergy(me, E4_ENERGY_PER_HIT * n)
      })
      // After its action ends it returns to its base hits and SPD.
      setHits(LIGHTNING_LORD_BASE_HITS)
      refreshEnhanced()
      if (e >= 2) timeline.modifiers.apply({ id: E2_BUFF, target: me, source: me, duration: { turns: E2_TURNS, tick: 'turnEnd' } })
    }

    battle.addSummon({ id: lord, owner: me, baseSpd: LIGHTNING_LORD_BASE_SPD, takeTurn: lordTurn })

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
                parts: [{ shape: 'single', scaling: s.basic, hit: 0, toughness: TOUGHNESS_BASIC }],
              })
            }),
        },
        skill: {
          kind: 'skill',
          canUse: () => battle.skillPoints >= 1,
          use: () =>
            battle.performAction(me, 'skill', 'skill', () => {
              battle.spendSkillPoints(1)
              battle.party.gainEnergy(me, SKILL_ENERGY)
              battle.attack({
                attacker: me,
                ability: 'SKILL',
                parts: [{ shape: 'aoe', scaling: s.skill, hit: 0, toughness: TOUGHNESS_SKILL }],
              })
              setHits(hits + SKILL_HITS + (affinitive ? AFFINITIVE_SKILL_HITS : 0))
              // "After the Skill is used": the Skill itself is not buffed.
              timeline.modifiers.apply({ id: WAR_MARSHAL, target: me, source: me, duration: { turns: WAR_MARSHAL_TURNS, tick: 'turnEnd' } })
            }),
        },
        ultimate: {
          kind: 'ultimate',
          canUse: () => battle.party.get(me).energy >= MAX_ENERGY,
          use: () =>
            battle.performAction(me, 'ultimate', 'ultimate', () => {
              battle.party.setEnergy(me, 0)
              battle.attack({
                attacker: me,
                ability: 'ULT',
                parts: [{ shape: 'aoe', scaling: s.ult, hit: 0, toughness: TOUGHNESS_ULT }],
              })
              battle.party.gainEnergy(me, ULT_ENERGY)
              setHits(hits + ULT_HITS + (affinitive ? AFFINITIVE_ULT_HITS : 0))
            }),
        },
      },

      quantities: {
        lightning_lord_hits: () => hits,
        enhanced: () => enhanced(),
        war_marshal: () => critUp(),
      },

      attackerState: () => {
        const n = pricing?.hits ?? hits
        return {
          characterConditionals: {
            skillCritBuff: critUp(),
            talentHitsPerAction: n,
            talentAttacks: n,
            e2DmgBuff: e2Up(),
            e6FuaVulnerabilityStacks: pricing?.e6Stacks ?? 0,
            ex1EnhancedState: enhanced(),
          },
        }
      },

      // He gives his teammates nothing.
      teammateState: () => ({}),

      onBattleStart: ({ techniques }) => {
        // Savant Providence: 15 energy at the start of battle, scaled by Energy Regeneration Rate like the
        // other kits' battle-start energy (the text does not call it flat).
        battle.party.gainEnergy(me, START_ENERGY)
        // Spiritus Invocation: Lightning-Lord's first turn has 3 more hits.
        if (techniques) setHits(hits + TECHNIQUE_HITS)
        // The enhanced state starts with the combat.
        refreshEnhanced()
      },
    }
  },
}
