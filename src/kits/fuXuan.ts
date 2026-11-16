import type { Battle, Member } from '../battle/battle'
import type { UnitId } from '../engine/events'
import type { Kit, KitInstance, TeammateState } from './kit'

/**
 * Fu Xuan (1208), from the 4.7.0 in-game text (`node tools/gamedata/kit-text.mjs 1208`). All traces are taken as unlocked, as
 * Fribbels does, and every ability is at the level the eidolon gives: Skill and Talent Lv12 from E3, Ultimate Lv12 and Basic ATK
 * Lv7 from E5. Her damage scales on her Max HP.
 *
 * - Energy 135. Basic ATK (Novaburst): +20 energy, +1 Skill Point, 50% of her Max HP (55% at E5) Quantum to one enemy, toughness 30.
 *   Skill (Known by Stars, Shown by Hearts): +30 energy, -1 Skill Point, no damage: activates Matrix of Prescience for 3 turns.
 *   Ultimate (Woes of Many Morphed to One): costs 135, +5 energy, 100% of her Max HP (108% at E5) Quantum to all enemies, toughness
 *   60 on every enemy, and one trigger count of the Talent's HP Restore.
 * - Matrix of Prescience: a modifier on her. While it lasts, a share of the DMG her teammates receive (65%, before their Shields) goes
 *   to her instead (`Party.addRedirect` with an `active` check on this modifier, so the redirection lasts exactly as long as the
 *   Matrix; the reading of "after the ally's reductions, hers do not apply" is DESIGN.md's Fu Xuan row). Every ally also has the
 *   Knowledge effect: Max HP +6% of her Max HP (6.6% at E3), CRIT Rate +12% (13.2% at E3), and from E1 CRIT DMG +30%. It is dispelled
 *   when she is knocked down. The Technique starts the battle with it for 2 turns (the scenario's `techniques` setting).
 * - Talent (Bleak Breeds Bliss): while she is in combat (not downed), every ally takes 18% less DMG (19.6% at E3), a damage reduction
 *   on every ally in the party (`Party.setDamageReduction`; memosprites that appear later get it too). When her HP falls to 50% of
 *   her Max HP or less, HP Restore heals her by 90% (92% at E3) of the HP she is missing, not on a killing blow. 1 trigger count at
 *   the start, at most 2, each Ultimate adds one.
 * - Traces: Taiyi (+20 extra energy when she uses her Skill while the Matrix is active), Dunjia (her Ultimate heals all other allies
 *   by 5% of her Max HP + 133), Liuren (below).
 * - E1 the Knowledge effect adds CRIT DMG 30% (Fribbels' same `skillActive` switch: the CRIT Rate, the CRIT DMG, the HP and her
 *   65% reduction are all one effect that lasts as long as the Matrix, so one switch is exact). E4 when another ally under the
 *   Matrix is attacked, she regenerates 5 energy. E6 the Matrix keeps a tally of all HP the team loses once it has been activated;
 *   her Ultimate deals 200% of the tally extra (as a share of her Max HP), capped at 120% of her Max HP, and the tally resets after
 *   the Ultimate. E3 and E5 are level raises (above).
 *
 * Pricing. Fribbels prices her Basic ATK (`BASIC` hit 0) and Ultimate (`ULT` hit 0); the Break hit is not priced here, and the heal
 * hit (`TALENT_HEAL`, Dunjia) is read through `Battle.healAmount`. The
 * Knowledge effect reaches every ally's price through `teammateState`: the kernel's `skillActive` switch is the live state of the
 * Matrix and `teammateHPValue` her Max HP when the Matrix was last activated or at her last turn start (Fribbels takes it as an
 * input: the HP buff is flat, 6% of it, written to both HP and its unconvertible companion). For her own attacks the same switch
 * gives her own Knowledge (a conversion of 6% of her HP into HP, CRIT Rate, CRIT DMG at E1). E6 passes the live tally share as
 * `e6TeamHpLostPercent`. Her 65% and 18% damage reductions are in Fribbels as multiplicative complements of DMG_RED, which only
 * change a unit's EHP and no damage dealt; here they are in the party, where they matter. No injected buff (K15a) is needed:
 * every ability is at the level Fribbels uses for the eidolon, and the effect text matches its switches.
 *
 * Her Max HP for the Knowledge effect is `Battle.combatStats(me).HP` read with her own Knowledge switched off: the Max HP before the
 * effect, because the effect gives 6% of that and not of the total it creates. IN-GAME CHECK: the text says "6% of Fu Xuan's Max
 * HP" and does not say whether the effect counts her own bonus (Fribbels' conversion for herself does not).
 *
 * Toughness (K7), internal units from the kit text ("toughness a/b/c"): Basic 30 on the target, Ultimate 60 on every enemy.
 *
 * IN-GAME CHECK notes mark the readings Smitty will check in game:
 * - The Matrix's 3 turns (2 from the Technique) count down at the start of her turns, so it is up for her two next turns after the
 *   Skill, and she recasts on the third (Recalled; the text gives no tick point).
 * - Taiyi's "when the Matrix is active" is read as: already active when the Skill is used (the Skill's own activation does not count).
 * - Knowledge's Max HP raises Max HP only: current HP stays where it was (the party's rule, DESIGN.md), and the bonus is snapshot at
 *   activation and refreshed at her turn start, not tracked continuously.
 * - E4's 5 energy is gained per attack on an ally, as the expected number of hits (an AoE on 3 other allies is 3), scaled by her Energy
 *   Regeneration Rate like the Skill's energy. Memosprites count as allies.
 * - E6's tally counts every point of HP any ally or memosprite loses (damage after shields, HP spent, the share she takes herself) from
 *   the first activation on, also while the Matrix is down; the cap is applied as HP is added.
 * - HP Restore is checked whenever she loses HP. Gaining a trigger count from the Ultimate while she is already at or under 50% does not
 *   heal until she loses HP again. HP Restore is not changed by Outgoing Healing Boost: Fribbels has no hit for it, so the kernel gives no
 *   amount to read (Dunjia's heal does carry it).
 * - The Ultimate's heal reaches memosprites as well as characters ("all other allies").
 * - E2 ("any ally target struck by a killing blow while the Matrix is active: all ally targets struck by a killing blow during this
 *   action are not knocked down and 70% of their Max HP is restored, once per battle") is a `Party.addKnockdownGuard`. "Ally target"
 *   is every party unit: she herself, the other characters and memosprites. "During this action" is the turn in progress (the first
 *   save uses the battle's one charge, and every further unit that reaches 0 HP in that same turn is saved too); outside any turn
 *   (a test calling the party directly) every call is its own action. "Struck by a killing blow" is the loss that reached the unit
 *   after the redirect, its shields and a backup rule (Netherwing), as `KnockdownGuard` documents: Netherwing's rule comes first, so a
 *   covered ally is held at 1 HP and is never struck by one. The restore is the HP set by the guard (`knockdownPrevented`), not a
 *   `healed` event (it triggers no heal-based effect, nor HP Restore). The Matrix must be up at the moment of the blow.
 *
 * NOT MODELLED:
 * - Liuren (the allies resist the crowd control an enemy applies): allies are never crowd-controlled (DESIGN.md, Known approximations).
 * - A memosprite's Knowledge Max HP (a memosprite's Max HP belongs to its owner's kit) and the Matrix's effect on its CRIT Rate (its damage
 *   is priced as its owner's, which does get the Knowledge).
 * - Her Technique's Barrier and its Attack hit (Fribbels has no number for technique damage).
 * - Outgoing Healing Boost on HP Restore (no Fribbels hit to read it from).
 */

const MAX_ENERGY = 135
const BASIC_ENERGY = 20
const SKILL_ENERGY = 30
const ULT_ENERGY = 5
/** Taiyi: the extra energy of a Skill used while the Matrix is active. */
const TAIYI_ENERGY = 20
/** E4: energy per attack on an ally under the Matrix. */
const E4_ENERGY = 5

const MATRIX_TURNS = 3
const TECHNIQUE_MATRIX_TURNS = 2
/** Matrix of Prescience: the share of the DMG her teammates receive that she takes instead. */
export const MATRIX_SHARE = 0.65

const RESTORE_HP_SHARE = 0.5
const RESTORE_START = 1
const RESTORE_MAX = 2

/**
 * Dunjia: the Ultimate heals every other ally by 5% of her Max HP + 133. The amount is Fribbels' own heal hit for it
 * (`FuXuan.ts` `TALENT_HEAL`: `hpScaling(0.05).flatHeal(133)`), read with `Battle.healAmount`, so her Outgoing Healing Boost is in it.
 */
const DUNJIA_HEAL_ABILITY = 'TALENT_HEAL'

/** E2: the share of Max HP an ally is restored to when its knockdown is prevented. */
const E2_RESTORE_SHARE = 0.7

/** E6: the Ultimate deals this share of her Max HP per unit of the tally (as a share of her Max HP), and the tally is capped at this share. */
const E6_PER_TALLY = 2
const E6_TALLY_CAP = 1.2

const TOUGHNESS_BASIC = 30
const TOUGHNESS_ULT = 60

export const MATRIX_MODIFIER = 'fuxuan.matrix'
const REDIRECT_ID = 'fuxuan.matrix'
const AVOIDANCE_KEY = 'fuxuan.misfortune_avoidance'

/** Ability multiples and Skill and Talent values by eidolon, from the in-game Lv10 / Lv12 lines (E3 raises Skill and Talent, E5 Ultimate and Basic ATK). */
export function fuXuanScalings(eidolon: number) {
  const skillTalentUp = eidolon >= 3
  const ultBasicUp = eidolon >= 5
  return {
    basic: ultBasicUp ? 0.55 : 0.5,
    ult: ultBasicUp ? 1.08 : 1.0,
    /** Knowledge: Max HP, as a share of her Max HP. */
    knowledgeHp: skillTalentUp ? 0.066 : 0.06,
    knowledgeCritRate: skillTalentUp ? 0.132 : 0.12,
    /** Misfortune Avoidance: the DMG every ally takes less. */
    damageReduction: skillTalentUp ? 0.196 : 0.18,
    /** HP Restore: the share of her missing HP she heals. */
    restoreShare: skillTalentUp ? 0.92 : 0.9,
  }
}

export const FuXuan: Kit = {
  characterId: '1208',
  path: 'Preservation',
  element: 'Quantum',
  maxEnergy: MAX_ENERGY,
  // Fribbels has no buffed version of her: only the original kit (K13).
  abilityVersions: [0],

  create(battle: Battle, self: Member): KitInstance {
    const { timeline, party } = battle
    const me = self.key
    const e = self.eidolon
    const s = fuXuanScalings(e)

    /** Her Max HP (before her own Knowledge) when the Matrix was last activated or at her last turn start with it up. */
    let sourceHp = 0
    /** True while the kernel is asked for her Max HP without her own Knowledge (see `maxHpWithoutKnowledge`). */
    let withoutKnowledge = false
    let restoreCount = RESTORE_START
    /** E6's tally of HP the team lost, in HP. It runs from the first activation of the Matrix. */
    let tally = 0
    let tallyRunning = false
    /** The Max HP each character holds from Knowledge right now, so it can be taken off again. */
    const knowledgeHp = new Map<UnitId, number>()

    const matrixUp = () => timeline.modifiers.has(me, MATRIX_MODIFIER)
    const alive = () => !party.get(me).downed

    /** Every ally the effects reach: the party's characters and the memosprites on the field. */
    const allies = (): UnitId[] => battle.members.flatMap((m) => [m.key, ...battle.memospritesOf(m.key)])

    // ---------------------------------------------------------------- her Max HP and the Knowledge effect

    /** Her Max HP as the kernel reports it with the Matrix's effect on herself switched off. Call from an action or a listener. */
    const maxHpWithoutKnowledge = (): number => {
      withoutKnowledge = true
      try {
        return battle.combatStats(me).HP
      } finally {
        withoutKnowledge = false
      }
    }

    /** Knowledge's Max HP bonus on the party's characters: 6% of `sourceHp` while the Matrix is up, none otherwise. */
    const syncKnowledgeHp = () => {
      const target = matrixUp() ? s.knowledgeHp * sourceHp : 0
      for (const { key } of battle.members) {
        const applied = knowledgeHp.get(key) ?? 0
        if (Math.abs(applied - target) < 1e-9) continue
        party.setStats(key, { maxHp: party.get(key).maxHp - applied + target })
        knowledgeHp.set(key, target)
      }
    }

    timeline.bus.on('modifierApplied', ({ modifier }) => {
      if (modifier.id !== MATRIX_MODIFIER || modifier.target !== me) return
      tallyRunning = true
      syncKnowledgeHp()
    })
    timeline.bus.on('modifierRemoved', ({ modifier }) => {
      if (modifier.id === MATRIX_MODIFIER && modifier.target === me) syncKnowledgeHp()
    })

    /** Activates (or refreshes) the Matrix for `turns` of her turns, counted down at the start of each. */
    const activateMatrix = (turns: number) => {
      sourceHp = maxHpWithoutKnowledge()
      timeline.modifiers.apply({ id: MATRIX_MODIFIER, target: me, source: me, duration: { turns, tick: 'turnStart' } })
    }

    // The share of the DMG every teammate receives. Lasts exactly as long as the modifier (and the receiver standing).
    party.addRedirect({ id: REDIRECT_ID, to: me, share: MATRIX_SHARE, active: matrixUp })

    // Her HP at her turn start, while the Matrix is up: the Knowledge bonus follows her Max HP.
    timeline.bus.on('turnStart', (turn) => {
      if (turn.unit !== me || !matrixUp()) return
      sourceHp = maxHpWithoutKnowledge()
      syncKnowledgeHp()
    })

    // ---------------------------------------------------------------- Misfortune Avoidance

    const applyAvoidance = (id: UnitId) => party.setDamageReduction(id, AVOIDANCE_KEY, alive() ? s.damageReduction : undefined)
    for (const id of allies()) applyAvoidance(id)
    timeline.bus.on('memospriteAdded', ({ unit }) => {
      if (party.has(unit)) applyAvoidance(unit)
    })

    // ---------------------------------------------------------------- knocked down

    timeline.bus.on('unitDowned', ({ unit }) => {
      if (unit !== me) return
      // The Matrix is dispelled and the Talent's reduction ends with her ("while Fu Xuan is still active in combat").
      timeline.modifiers.remove(me, MATRIX_MODIFIER)
      for (const id of allies()) if (party.has(id)) party.setDamageReduction(id, AVOIDANCE_KEY, undefined)
    })

    // E2: a killing blow while the Matrix is up is turned into 70% of Max HP, once per battle (every unit struck in that one action).
    if (e >= 2) {
      let used = false
      let usedInTurn: number | undefined
      party.addKnockdownGuard('fuxuan.e2', ({ unit }) => {
        if (!matrixUp()) return undefined
        const turn = timeline.activeTurn?.serial
        if (used && (turn === undefined || turn !== usedInTurn)) return undefined
        used = true
        usedInTurn = turn
        return E2_RESTORE_SHARE * party.get(unit).maxHp
      })
    }

    // ---------------------------------------------------------------- HP lost: E6's tally and HP Restore

    timeline.bus.on('hpLost', ({ unit, amount }) => {
      if (tallyRunning && e >= 6 && battle.isAlly(unit)) tally = Math.min(E6_TALLY_CAP * party.get(me).maxHp, tally + amount)
      if (unit !== me) return
      // HP Restore: at 50% or less, not on a killing blow (she is at 0 HP then, and downed right after this event).
      const her = party.get(me)
      if (restoreCount < 1 || her.downed || !(her.hp > 1e-9) || her.hp > RESTORE_HP_SHARE * her.maxHp + 1e-9) return
      restoreCount -= 1
      party.heal(me, s.restoreShare * (her.maxHp - her.hp), me)
    })

    // E4: another ally under the Matrix is attacked.
    if (e >= 4) {
      timeline.bus.on('allyHit', ({ unit, hits }) => {
        if (unit === me || !battle.isAlly(unit) || !matrixUp() || !alive()) return
        party.gainEnergy(me, E4_ENERGY * hits)
      })
    }

    /** E6's tally as a share of her Max HP, at most the cap. Reads the party only, so `attackerState` may call it. */
    const tallyShare = () => Math.min(E6_TALLY_CAP, tally / party.get(me).maxHp)

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
          use: () =>
            battle.performAction(me, 'skill', 'skill', () => {
              battle.spendSkillPoints(1)
              // Taiyi: the extra energy needs the Matrix to be up already (IN-GAME CHECK, see the header).
              party.gainEnergy(me, SKILL_ENERGY + (matrixUp() ? TAIYI_ENERGY : 0))
              activateMatrix(MATRIX_TURNS)
            }),
        },
        ultimate: {
          kind: 'ultimate',
          canUse: () => party.get(me).energy >= MAX_ENERGY,
          use: () =>
            battle.performAction(me, 'ultimate', 'ultimate', () => {
              party.setEnergy(me, 0)
              const e6Bonus = e >= 6 ? E6_PER_TALLY * tallyShare() : 0
              battle.attack({
                attacker: me,
                ability: 'ULT',
                parts: [{ shape: 'aoe', scaling: s.ult + e6Bonus, hit: 0, toughness: TOUGHNESS_ULT }],
              })
              party.gainEnergy(me, ULT_ENERGY)
              restoreCount = Math.min(RESTORE_MAX, restoreCount + 1)
              // Dunjia: heals every other ally by 5% of her Max HP + 133, as the kernel prices it: Fribbels' TALENT_HEAL hit, with her
              // in-combat Max HP (her Knowledge) and her Outgoing Healing Boost (relics, light cone, Giant Tree of Rapt Brooding).
              const heal = battle.healAmount(me, DUNJIA_HEAL_ABILITY)
              for (const id of allies()) if (id !== me && party.has(id)) party.heal(id, heal, me)
              // The tally restarts after the Ultimate (E6).
              if (e >= 6) tally = 0
            }),
        },
      },

      quantities: {
        matrix: () => matrixUp(),
        matrix_turns_left: () => timeline.modifiers.get(me, MATRIX_MODIFIER)?.turnsLeft ?? 0,
        restore_counts: () => restoreCount,
        e6_tally_share: () => tallyShare(),
      },

      attackerState: () => ({
        characterConditionals: {
          skillActive: matrixUp() && !withoutKnowledge,
          talentActive: alive(),
          ...(e >= 6 && { e6TeamHpLostPercent: tallyShare() }),
        },
      }),

      teammateState: (): TeammateState => ({
        characterConditionals: {
          skillActive: matrixUp(),
          talentActive: alive(),
          teammateHPValue: matrixUp() ? sourceHp : 0,
        },
      }),

      onBattleStart: ({ techniques }) => {
        // Technique: entering battle with the Barrier up activates the Matrix for 2 turns.
        if (techniques) activateMatrix(TECHNIQUE_MATRIX_TURNS)
      },
    }
  },
}
