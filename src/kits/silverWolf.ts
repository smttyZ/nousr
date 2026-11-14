import { certain, expectedCapped } from '../battle/battle'
import type { Battle, Member } from '../battle/battle'
import type { UnitId } from '../engine/events'
import type { Kit, KitInstance } from './kit'

/**
 * Silver Wolf, buffed version 1 (game id 1006, ability_version 1, Fribbels id 1006b1), from the 4.7.0 in-game text
 * (`node tools/gamedata/kit-text.mjs 1006 --version 1`). All traces are taken as unlocked, as Fribbels does.
 *
 * - Energy 110. Basic ATK: +20 energy, +1 Skill Point. Skill: +30 energy, -1 Skill Point. Ultimate: costs 110, then +5.
 *   Trace Inject: +20 energy at the start of battle, +5 energy at the start of each of her turns.
 * - Skill (single target, on the primary enemy): All-Type RES -13% for 2 turns (13.5% at E3), then damage. It also
 *   implants a Weakness (see NOT MODELLED).
 * - Ultimate (AoE): DEF -45% for 3 turns on every enemy (46.8% at E5), then damage.
 * - Talent (Bugs): after each attack of hers, 1 random Bug on each enemy it attacked: ATK -10%, DEF -12% or SPD -6%
 *   (11%, 13.2%, 6.6% at E3). Trace Generate: a Bug lasts 4 turns (3 + 1), and every Weakness Break (anyone's) puts a
 *   Bug on the broken enemy. E2: every attack by another ally also puts a Bug on the enemies it attacked.
 * - E1: after her Ultimate, +7 energy per debuff on the target, at most 5 times per Ultimate.
 * - E2: every enemy takes 20% more DMG from the start of the battle. It is a debuff, as Acheron's E4 is.
 *   IN-GAME CHECK: whether it counts as a debuff for every effect that counts debuffs. Read as yes, so it adds 1 to every
 *   enemy's debuff count from the start of the battle (Pioneer Diver, Good Night and Sleep Well, her E1, E4 and E6, "against
 *   debuffed enemies").
 * - E4: after her Ultimate, Additional DMG of 20% ATK per debuff on each enemy (at most 5 per enemy).
 * - E6: her DMG to an enemy +20% per debuff on it, at most +100% (Fribbels: `targetDebuffs`, kernel-side).
 *
 * Debuffs are modifiers on the enemy (K1), applied with `battle.applyDebuff`, counted in enemy turns (ticking at the
 * enemy's turn end). They carry her id, so every debuff count (Acheron's talent, Pioneer Diver, Good Night and Sleep
 * Well, her own E1, E4 and E6) sees them. Break effects are debuffs too while they last (K24: Entanglement, the shared
 * Imprisoned state, Freeze), so they count in every one of those, and a Weakness Break's Imprisonment is the same status Welt's
 * Imprison is.
 *
 * Random Bug (DESIGN.md, K22): "1 random Bug" is each of the ATK, DEF and SPD Bug with chance 1/3 (the application's chance
 * to land, over 3), through `Battle.applyRandomDebuff`. The Bugs' expected count is exact; they are independent modifiers, so
 * the chance that an enemy has at least one Bug after one application is read as 1 - (2/3)^3 = 0.70, where the game has
 * exactly one (an approximation, DESIGN.md K22 notes). The SPD Bug slows the enemy's timeline at 1/3 of its value
 * (expected SPD). Consumers: the DEF Bug and the other Fribbels switches are boolean and priced in each debuff state
 * (K21); `targetDebuffs` (E6) and her E4 Additional DMG count debuffs up to a cap of 5, which is not linear in the expected
 * count, so E6's count is priced per state and E4's hit is a part whose weight is min(5, debuffs) in each state (`HitPart.worldWeight`:
 * priced in the state that sets its size); E1's energy is the expected number of triggers (up to 5 over all the enemies,
 * `Battle.debuffCountDistribution`). Fribbels' switches for her teammates' damage (`skillResShredDebuff`,
 * `talentDefShredDebuff`, `ultDefShredDebuff`, `e2Vulnerability`) are read per enemy from those modifiers, for her own
 * damage (`attackerState`) and for a teammate's (`teammateState`). `targetDebuffs` is the enemy's debuff count from any
 * source, capped at 5, as Fribbels' slider is.
 *
 * Order inside an action: her debuffs of the Skill and the Ultimate land first, so that the damage is priced with them;
 * the Bug lands after the attack (the talent says "after every attack"), so it never touches the hit that put it there.
 *
 * Toughness (K7), internal units from `node tools/gamedata/kit-text.mjs 1006 --version 1` ("toughness a/b/c": the
 * designated target / every enemy / adjacent): Basic 30/0/0, Skill 60/0/0, Ultimate 0/60/0 (Fribbels: `toughnessDmg`
 * 10, 20 and 20, times 3). The E4 Additional DMG removes none. She follows weaknesses.
 *
 * IN-GAME CHECK: whether E2's "attacked by ally targets" includes Silver Wolf's own attacks (read as no: her own
 * attacks already trigger the talent, so a Bug per attack, not two).
 * IN-GAME CHECK: whether E2's Bug is at most one per enemy per action. Read as one: an ally action that attacks an enemy in
 * several attack calls (Acheron's Ultimate) gives it one Bug in total (at the chance that any of them hit it).
 * IN-GAME CHECK: when E1 and E4 count the target's debuffs. Read as after the Ultimate's own DEF debuff and any Bug a
 * Weakness Break put on, but before the Bug the talent implants after this attack.
 * E1's "up to 5 times in each use of Ultimate" is 5 in total across all enemies: E4's text says "per target" and E1's does
 * not, so the text settles it.
 * IN-GAME CHECK: whether her trace and Eidolon energy (+20 at the start, +5 per turn, E1's 7 per debuff) is scaled by
 * Energy Regeneration Rate. The text does not call it flat, so it is scaled, as for Tribbie's trace energy.
 * IN-GAME CHECK: a Bug that an Ultimate or Skill implants lands on the enemy it attacked even if the Bug of the same
 * type is already there; it then refreshes its duration, which counts as inflicting a debuff for Acheron's talent.
 *
 * Approximations:
 * - E2's Bug on another ally's attack lands when the attack call that hit the enemy ends (`attackResolved`), not at the end
 *   of the whole action. An ability made of several attack calls (Acheron's Ultimate) lets the Bug affect its later
 *   parts. Each enemy gets it at the chance the attack hit it (`damageDealt.chance`), once per action.
 *
 * NOT MODELLED:
 * - The Weakness implant of the Skill, and its 20% RES reduction to that element. The battle has no per-enemy
 *   weaknesses (they are the scenario's list, read by the toughness and kernel code), so an implant cannot be added to one enemy.
 *   With `weaknesses: 'all'`, or a list that already holds every element on the team, the implant changes nothing, and
 *   the Skill runs. With a list that lacks a team member's element it would change toughness and RES, so her first use of the
 *   Skill stops with an error rather than quietly leaving it out (a scenario whose policy never uses the Skill runs). Engine change needed: weaknesses per enemy, with a `Battle` method to add
 *   one (and the kernel's `elementalWeak` and the toughness rules reading it).
 * - The Weakness implant moving to another enemy when its carrier is defeated (enemies never die, S6).
 * - The ATK Bug's -10% on the enemy's ATK: the enemy deals damage from the profile's fixed ATK, so damage taken is not reduced.
 * - The technique (80% ATK to all enemies, 60 toughness to every enemy whatever its weaknesses): technique damage stays
 *   out (decision of 2026-11-12), and so does its toughness, as for the other kits. Whether it triggers a Bug is unknown.
 * - Effect Hit Rate to ATK needs no code: Fribbels converts it (`ehrToAtkConversion`), and debuffs always land.
 */

const MAX_ENERGY = 110
const BASIC_ENERGY = 20
const SKILL_ENERGY = 30
const ULT_ENERGY = 5
const BATTLE_START_ENERGY = 20
const TURN_START_ENERGY = 5
const E1_ENERGY_PER_DEBUFF = 7
const E1_MAX_TRIGGERS = 5
const E4_ADDITIONAL_PER_DEBUFF = 0.2
const E4_MAX_DEBUFFS = 5
/** Fribbels' `targetDebuffs` slider goes to 5. */
const MAX_TARGET_DEBUFFS = 5

/** Toughness per part, internal units (see the header). */
const TOUGHNESS_BASIC = 30
const TOUGHNESS_SKILL = 60
const TOUGHNESS_ULT = 60

const SKILL_RES_TURNS = 2
const ULT_DEF_TURNS = 3
/** 3 turns, plus 1 from the Generate trace. */
const BUG_TURNS = 4

type BugType = 'def' | 'atk' | 'spd'

/** The Bugs a random Bug is one of, each with the same chance (K22). */
const BUG_TYPES: readonly BugType[] = ['atk', 'def', 'spd']

/** The distribution of the sum of two independent counts. */
function convolve(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0)
  a.forEach((p, i) => b.forEach((q, j) => (out[i + j]! += p * q)))
  return out
}

/** The kernel hit that is the Ultimate's E4 Additional DMG (hit 0 is the Ultimate itself). */
const E4_ADDITIONAL_HIT = 1

/** Ability multiples and debuff values by eidolon. E3 raises the Skill and Talent; E5 the Ultimate and Basic ATK. */
export function silverWolfScalings(eidolon: number) {
  return {
    basic: eidolon >= 5 ? 1.1 : 1.0,
    skill: eidolon >= 3 ? 2.156 : 1.96,
    skillResShred: eidolon >= 3 ? 0.135 : 0.13,
    ult: eidolon >= 5 ? 4.104 : 3.8,
    ultDefShred: eidolon >= 5 ? 0.468 : 0.45,
    bugAtk: eidolon >= 3 ? 0.11 : 0.1,
    bugDef: eidolon >= 3 ? 0.132 : 0.12,
    bugSpd: eidolon >= 3 ? 0.066 : 0.06,
  }
}

export const SilverWolf: Kit = {
  characterId: '1006',
  path: 'Nihility',
  element: 'Quantum',
  maxEnergy: MAX_ENERGY,
  // The buffed version (Nova Flare, Fribbels' 1006b1). The original kit is a different kit (K13).
  abilityVersions: [1],

  create(battle: Battle, self: Member): KitInstance {
    const { timeline } = battle
    const me = self.key
    const e = self.eidolon
    const s = silverWolfScalings(e)

    // The Skill's Weakness implant cannot be modelled (see NOT MODELLED). It changes nothing when every element on the
    // team is already a weakness; otherwise refuse on the first use of the Skill, so that a result is never quietly missing it.
    const refuseWeaknessImplant = () => {
      const weaknesses = battle.weaknesses
      if (weaknesses === 'all') return
      const missing = [...new Set(battle.members.map((m) => m.kit.element))].filter((element) => !weaknesses.includes(element))
      if (missing.length > 0) {
        throw new Error(
          `NOT MODELLED: Silver Wolf's Skill implants a Weakness of an ally's element on one enemy, which changes toughness and ` +
            `RES when the scenario's weaknesses (${weaknesses.join(', ') || 'none'}) lack a team element (${missing.join(', ')}). ` +
            `The battle has no per-enemy weaknesses. Use weaknesses "all", or a list holding every element on the team.`,
        )
      }
    }

    const id = {
      skillRes: `silver_wolf.skill_res:${me}`,
      ultDef: `silver_wolf.ult_def:${me}`,
      bug: (type: BugType) => `silver_wolf.bug_${type}:${me}`,
      e2Vulnerability: `silver_wolf.e2_vulnerability:${me}`,
    }

    /** A kernel switch: whether the modifier is on the enemy in the debuff state being priced (K21, `Battle.kernelResult`). */
    const has = (enemy: UnitId, modifier: string) => certain(battle.presence(enemy, modifier))
    const alive = () => !battle.party.get(me).downed
    const targetDebuffs = (enemy: UnitId) => Math.min(MAX_TARGET_DEBUFFS, battle.debuffCount(enemy))

    /** 1 random Bug (ATK, DEF or SPD, 1/3 each) on `enemy`. `landing` is the chance the Bug was implanted at all (K22). */
    const implantBug = (enemy: UnitId, landing = 1, typeChance = landing / BUG_TYPES.length) => {
      battle.applyRandomDebuff(
        BUG_TYPES.map((type) => ({
          id: id.bug(type),
          target: enemy,
          source: me,
          ...(type === 'spd' && { spdPct: -s.bugSpd }),
          duration: { turns: BUG_TURNS, tick: 'turnEnd' as const },
        })),
        landing,
        typeChance,
      )
    }

    // Inject: +5 energy when her turn starts.
    timeline.bus.on('turnStart', (turn) => {
      if (turn.unit === me) battle.party.gainEnergy(me, TURN_START_ENERGY)
    })

    // Generate: a Bug on every enemy whose Weakness gets broken, by anyone.
    timeline.bus.on('weaknessBroken', ({ enemy }) => {
      if (alive()) implantBug(enemy)
    })

    // E2: a Bug on the enemies another ally's attack hit, each at the chance the attack hit it (K22). Collected per attack
    // call, applied when it ends, at most one per enemy per action (the later calls add only what the earlier ones did not).
    // A bare attack (not inside an action) is not an attack by an ally target and is skipped.
    if (e >= 2) {
      let actionSerial: number | undefined
      /** Per enemy, the chance a Bug has been implanted by E2 so far in this action. */
      let bugged = new Map<UnitId, number>()
      /** Per enemy, the chance the attack call in progress hit it. */
      let attacked = new Map<UnitId, number>()
      timeline.bus.on('damageDealt', (hit) => {
        if (hit.attacker === me || !battle.isAlly(hit.attacker) || battle.actionSerialInProgress === undefined) return
        attacked.set(hit.enemy, 1 - (1 - (attacked.get(hit.enemy) ?? 0)) * (1 - hit.chance))
      })
      timeline.bus.on('attackResolved', (attack) => {
        const pending = attacked
        attacked = new Map()
        if (attack.attacker === me || !battle.isAlly(attack.attacker) || !alive()) return
        const serial = battle.actionSerialInProgress
        if (serial === undefined) return
        if (serial !== actionSerial) {
          actionSerial = serial
          bugged = new Map()
        }
        for (const [enemy, chance] of pending) {
          const already = bugged.get(enemy) ?? 0
          const landing = chance * (1 - already)
          if (landing <= 0) continue
          bugged.set(enemy, already + landing)
          // The attack calls are independent, so the action's chance of a Bug is their union (`landing` is the new part, `chance`
          // is what the debuff record multiplies in). Each type's presence must rise by landing / 3 in total, not by an
          // independent draw on top of the earlier call's: the extra draw's chance is landing / 3 over what is still free.
          implantBug(enemy, chance, landing / BUG_TYPES.length / (1 - already / BUG_TYPES.length))
        }
      })
    }

    /** The debuff switches Fribbels reads about an enemy, for her damage and her teammates' alike. */
    const debuffState = (enemy: UnitId) => ({
      skillResShredDebuff: has(enemy, id.skillRes),
      // NOT MODELLED: the Weakness implant is never on (see the header), so neither is its RES reduction.
      skillWeaknessResShredDebuff: false,
      talentDefShredDebuff: has(enemy, id.bug('def')),
      ultDefShredDebuff: has(enemy, id.ultDef),
      targetDebuffs: targetDebuffs(enemy),
      e2Vulnerability: has(enemy, id.e2Vulnerability),
    })

    return {
      actions: {
        basic: {
          kind: 'basic',
          canUse: () => true,
          use: () =>
            battle.performAction(me, 'basic', 'basic', () => {
              battle.gainSkillPoints(1)
              battle.party.gainEnergy(me, BASIC_ENERGY)
              const target = battle.primary
              battle.attack({ attacker: me, ability: 'BASIC', parts: [{ shape: 'single', scaling: s.basic, target, hit: 0, toughness: TOUGHNESS_BASIC }] })
              implantBug(target)
            }),
        },
        skill: {
          kind: 'skill',
          canUse: () => battle.skillPoints >= 1,
          use: () =>
            battle.performAction(me, 'skill', 'skill', () => {
              refuseWeaknessImplant()
              battle.spendSkillPoints(1)
              battle.party.gainEnergy(me, SKILL_ENERGY)
              const target = battle.primary
              battle.applyDebuff({ id: id.skillRes, target, source: me, duration: { turns: SKILL_RES_TURNS, tick: 'turnEnd' } })
              battle.attack({ attacker: me, ability: 'SKILL', parts: [{ shape: 'single', scaling: s.skill, target, hit: 0, toughness: TOUGHNESS_SKILL }] })
              implantBug(target)
            }),
        },
        ultimate: {
          kind: 'ultimate',
          canUse: () => battle.party.get(me).energy >= MAX_ENERGY,
          use: () =>
            battle.performAction(me, 'ultimate', 'ultimate', () => {
              battle.party.setEnergy(me, 0)
              battle.party.gainEnergy(me, ULT_ENERGY)
              const enemies = battle.enemies.ids
              for (const enemy of enemies) {
                battle.applyDebuff({ id: id.ultDef, target: enemy, source: me, duration: { turns: ULT_DEF_TURNS, tick: 'turnEnd' } })
              }
              battle.attack({ attacker: me, ability: 'ULT', parts: [{ shape: 'aoe', scaling: s.ult, hit: 0, toughness: TOUGHNESS_ULT }] })

              // E4 and E1 read each enemy's debuffs once, after the attack (see the IN-GAME CHECK in the header). The counts
              // are random (K22), so each is a distribution and the caps are applied to it.
              const counts = enemies.map((enemy) => ({ enemy, distribution: battle.debuffCountDistribution(enemy) }))
              if (e >= 4) {
                // One part per enemy: 20% per debuff up to 5. The count is random, so the part's weight is read in each debuff state
                // (min(5, debuffs) there) and the hit is priced in that state: its expected scaling is 20% of the expected capped
                // count and the price follows the count, as Fribbels' own hit 1 does (it exists only with at least 1 debuff).
                const parts = counts
                  .filter(({ distribution }) => expectedCapped(distribution, E4_MAX_DEBUFFS) > 0)
                  .map(({ enemy }) => ({
                    shape: 'single' as const,
                    target: enemy,
                    scaling: E4_ADDITIONAL_PER_DEBUFF,
                    hit: E4_ADDITIONAL_HIT,
                    additional: true,
                    worldWeight: () => Math.min(E4_MAX_DEBUFFS, battle.debuffCount(enemy)),
                  }))
                if (parts.length > 0) battle.attack({ attacker: me, ability: 'ULT', parts })
              }
              if (e >= 1) {
                // 7 energy per debuff, at most 5 debuffs over all the enemies: the expected value of min(5, total count).
                let total = [1]
                for (const { distribution } of counts) total = convolve(total, distribution)
                battle.party.gainEnergy(me, E1_ENERGY_PER_DEBUFF * expectedCapped(total, E1_MAX_TRIGGERS))
              }
              for (const enemy of enemies) implantBug(enemy)
            }),
        },
      },

      quantities: {
        /** Debuffs on the primary target, from any source. */
        target_debuffs: () => battle.debuffCount(battle.primary),
      },

      attackerState: (enemy) => ({
        characterConditionals: { ehrToAtkConversion: true, ...debuffState(enemy) },
      }),

      // The debuffs are on the enemy, so a teammate's damage to this enemy is priced with exactly the ones it has (K1).
      teammateState: (_attacker, enemy) => ({ characterConditionals: debuffState(enemy) }),

      onBattleStart: () => {
        battle.party.gainEnergy(me, BATTLE_START_ENERGY)
        // E2: enemies entering combat take 20% more DMG. A debuff on every enemy, from the start; not an action, so no
        // talent of anyone's fires for it. Fribbels adds the 20% itself, from the eidolon and its `e2Vulnerability` switch.
        if (e >= 2) {
          for (const enemy of battle.enemies.ids) {
            timeline.modifiers.apply({ id: id.e2Vulnerability, target: enemy, source: me, debuff: true })
          }
        }
      },
    }
  },
}
