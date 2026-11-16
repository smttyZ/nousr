import type { Battle, Member } from '../battle/battle'
import type { UnitId } from '../engine/events'
import type { Kit, KitInstance, TeammateState } from './kit'

/**
 * Hyacine (1409), from the 4.7.0 in-game text (`node tools/gamedata/kit-text.mjs 1409`). All traces are taken as unlocked, as Fribbels
 * does, and every ability is at the level the eidolon gives (E3: Basic ATK, Ultimate, Memosprite Skill up; E5: Skill, Talent, Memosprite
 * Talent up). Memory path, Wind, 140 energy. Her damage and heals scale on her Max HP.
 *
 * Abilities
 * - Basic ATK (When Breeze Kisses Cirrus): +20 energy, +1 Skill Point, 50% of her Max HP Wind to one enemy (55% at E3), toughness 30.
 * - Skill (Love Over the Rainbow): +30 energy, -1 Skill Point. Summons Little Ica (when it is not on the field), heals every ally but
 *   Ica for 8% of her Max HP + 160 (8.8% + 178 at E5) and Ica for 10% + 200 (11% + 222.5), which is 1.25 times the first.
 * - Ultimate (We Who Fly Into Twilight): costs 140, +5 energy. Summons Ica, heals every ally but Ica for 10% + 200 (11% + 222.5 at E3)
 *   and Ica for 12% + 240 (13.2% + 267), which is 1.2 times the first, and starts "After Rain" for 3 turns (counted down at the start of
 *   her turns): every ally's Max HP +30% + 600 (33% + 667.5 at E3), and from E1 +50% more.
 * - Talent (First Light Heals the World): Ica starts with 50% of her Max HP. Each time she or Ica provides healing, Ica's DMG +80% (88% at
 *   E5) for 2 turns, up to 3 stacks.
 * - Little Ica (memosprite 11409): 0 SPD, not on the timeline, aggro 100 (4 points). Enemies can target it
 *   and hit it (settled by Smitty in game, 2026-11-15), so it soaks a share of enemy attacks and can leave at 0 HP.
 *   - Rainclouds, Time to Go! (Memosprite Skill, AoE): Wind DMG of 20% (22% at E3) of the tally of healing Hyacine and Ica have done in the
 *     battle, then 50% of the tally is cleared (12% from E6). +5 energy for Hyacine, toughness 30 on every enemy. Cast only in After Rain,
 *     in an extra turn granted right after each of Hyacine's abilities (`Battle.grantExtraTurn`).
 *   - Take Sky in Hand: when an ally (not Ica) loses HP, at the start of any turn or after any action Ica spends 4% of its Max HP and heals
 *     that ally for 2% of her Max HP + 20 (2.2% + 22 at E5); in After Rain the same trigger also heals every ally for the same amount.
 *     Ica's effects count down by its own turns (its extra turns).
 *   - Soar, Unto the Sunlight: when summoned, +15 energy for her (+30 more on the first summon).
 *   - Fall, Then Take Wing: when Ica disappears, her action advances 30%.
 * - Technique (Day So Right, Life So Fine!): with her `technique` on (K31: the member's own, else `battle.start.techniques`), when the battle starts
 *   every ally is healed for 30% of her Max HP + 600 (a heal from her: Outgoing Healing, the tally, Little Ica's stacks, Newbud and the light
 *   cone see it, overheal included, and allies start at full HP, so it is all overheal) and every ally's Max HP is +20% for 2 turns.
 *   "All allies" is read as the party's characters: memosprites are not on the field when the battle starts (Little Ica is summoned by
 *   her kit; Netherwing and Demiurge come from their owners' own techniques, whose order against hers is not fixed), so none is healed or
 *   buffed, and the Max HP of a memosprite that arrives later is whatever its kit gives it.
 * - Traces: Gloomy Grin (CRIT Rate +100%; Outgoing Healing +25% when the healed ally is at or under 50% HP), Stormy Caress (Effect RES +50%),
 *   Tempestuous Halt (SPD above 200: Max HP +20% for her and Ica, Outgoing Healing +1% per excess SPD up to 200, E4 CRIT DMG +2% per excess).
 * - E1 in After Rain: allies' Max HP +50% more, and after an ally uses an attack it is healed for 8% of her Max HP. E2 an ally that loses HP
 *   has SPD +30% for 2 turns. E3, E5 levels. E4 Halt's CRIT DMG. E6 the tally is cleared by 12% and, while Ica is on the field, all
 *   allies' All-Type RES PEN +20%.
 *
 * Pricing. Fribbels prices her Basic ATK (`BASIC` hit 0), her heals (`SKILL_HEAL`, `ULT_HEAL`, one hit each, read through `Battle.healAmount`:
 * Outgoing Healing, Giant Tree, the light cone and the 25% trace are in them) and the Rainclouds damage (`MEMO_SKILL` hit 1, a "heal tally"
 * hit: the tally is a multiple of the heal hit before it, `memoSkillScaling x healTallyMultiplier x heal hit`). The tally is the sim's own:
 * every `healed` event with her or Ica as source adds its amount (restored + overheal; IN-GAME CHECK), and the hit is asked with the live
 * tally. The kernel's hit has no ATK/HP/DEF multiple, so it is priced like this: `healTallyMultiplier` is 1, so the hit is the heal hit
 * `h` times the share `a` times everything that multiplies damage; the part's `scaling` is `a x tally / h`, which `Battle.attack` turns
 * into `tally x a x (all multipliers)`, because the kernel reports `scaling: a` for the hit (`hitScaling` in
 * `src/kernel/fribbels/fribbelsKernel.ts` returns the hit's `healTallyScaling` for a `DamageFunctionType.HealTally` hit).
 *
 * Little Ica's talent heal and E1's heal have no Fribbels hit. They are priced as `(share x her Max HP + flat) x m`, where `m` is the
 * kernel's own multiplier for her heals in the same state (`SKILL_HEAL` hit / (its base heal)): Outgoing Healing, Giant Tree and the
 * trace, whatever the kernel applies to a Skill heal. Heals reading the 25% trace are priced per target, with the target's HP at the time.
 *
 * Teammate buffs, each with its live value in `teammateState` (and `attackerState` for her own prices): `clearSkies` (After Rain: HP% and flat
 * HP for the whole team), `e1HpBuff`, `e2SpdBuff` (the ally holds the E2 modifier, which is also on the timeline), `e6ResPen` (E6 and Ica on
 * the field). The party's Max HP follows After Rain as a tracked delta per ally (the kernel's HP with the buff minus without it, read with
 * the switch off for the second number), Fu Xuan's way; Ica's is derived from hers by the same percentage and flat value on 50% of her base
 * HP. Tempestuous Halt's Max HP is read the same way for her. Halt itself (the 200 threshold, Outgoing Healing, E4 CRIT DMG) is Fribbels' own
 * (`spd200HpBuff`, `e4CdBuff` left on), on the kernel's in-combat SPD. The kit stops with an error (`checkSpd`) when the timeline's SPD and
 * the kernel's fall on different sides of 200, and from E4 (CRIT DMG +2% per SPD over 200, which shifts Ica's damage) also when the
 * excess over 200 differs by more than 0.01 (both capped at 400, Fribbels' own cap). It runs before her heals, Take Sky in Hand's heals,
 * E1's heal, her Basic ATK and Rainclouds. Fribbels floors the SPD it converts; the two SPDs are built from the same base and flat
 * values, so they agree to float precision and the small tolerance is not hiding a real rounding difference.
 *
 * IN-GAME CHECK notes mark the readings Smitty will check in game:
 * - Ultimate ordering: Settled by Smitty in game, 2026-11-15. The Ultimate heals first and then applies After Rain, so its heal is priced on
 *   her Max HP from before the buff (4,946 Max HP, 34.5% Outgoing Healing, Lv10: +1,073 on allies, +1,288 on Little Ica).
 * - Ica's Max HP can double count Rain when she is summoned during Rain (her 50% of the in-combat Max HP already has it, then `syncRain`
 *   adds its own delta). Low severity: it only affects Take Sky in Hand's cost and the overheal split.
 * - The tally counts the whole healing value of each target (restored and overheal), per target, all the heals of both.
 * - One Talent stack per source per action (a stack per ability use or per Take Sky in Hand trigger batch), not per target.
 * - Take Sky in Hand: one consume-and-heal per ally that lost HP since the last check; checks are the start and end of every turn and after
 *   every ally action. The "all allies" heal in After Rain includes Ica itself. Ica never drops below 1 HP from its own cost.
 * - "Summons memosprite Little Ica" with Ica already on the field summons nothing (no energy, no re-summon).
 * - Energy from the summon is scaled by Energy Regeneration Rate, like Robin Summeretto's.
 * - After Rain's 3 turns are counted down at the start of her turns, the application turn not counted (Fu Xuan's Matrix convention).
 * - Ica's Max HP is 50% of her in-combat Max HP when summoned, then After Rain's buff on its own base; Halt is not re-read afterwards.
 * - E1's restore is a heal from her (tally, Outgoing Healing, Giant Tree, Warrior Goddess see it), on every ally and Ica after it attacks.
 * - E2: any loss of HP of a character counts, Ica's own cost excluded (Ica has no SPD).
 * - Halt: "exceeds 200" against Fribbels' "200 or more" for the Max HP part (they differ only at exactly 200 SPD).
 * - The light cone's 1-turn Outgoing Healing is in `theStorysNextPage.ts`.
 * - Technique, all IN-GAME CHECK: (1) the order: the heal is read first (priced on her Max HP from before the buff, and landing on full HP), then
 *   the Max HP buff, as the Ultimate does (settled for it, 2026-11-15); the other order would let the heal fill the new 20% gap. (2) Whose turns count
 *   down the 2 turns: each ally's own, at the end of its turns, so every ally gets its first two turns of the battle (the reading built; the text
 *   only says "2 turn(s)"). (3) Characters only, no memosprites (see Technique above). (4) The heal takes Outgoing Healing, as every heal of hers.
 *   (5) A Max HP buff does not raise current HP here (as After Rain's does not): allies start at 100% of the old maximum.
 *   Fribbels has no switch for the +20% Max HP, so it is injected into the kernel (`HP_PERCENT`, K15a) for each ally that holds the modifier,
 *   and the party's Max HP follows the kernel's difference with and without it, as After Rain's does.
 *
 * NOT MODELLED:
 * - Cyrene's Ode to Sky (Hyacine-specific: stacks that add 72% of each heal to the tally): Fribbels has no handling and the stacks
 *   (2 per Demiurge memosprite skill, spent per Skill or Ultimate) are Cyrene's kit; `battle.cyreneEffect` is only on or off.
 * - Stormy Caress dispelling (allies never carry debuffs). Memosprites of other kits do not get After Rain's Max HP in the party (their HP
 *   belongs to their owner's kit); their damage is priced as the owner's, which does.
 * - Warrior Goddess of Sun and Thunder does not see Ica's heals (it only recognises summons as the wearer's healers): a change in
 *   `warriorGoddessOfSunAndThunder.ts`, `battle.memospritesOf(wearer)`.
 */

const MAX_ENERGY = 140
const BASIC_ENERGY = 20
const SKILL_ENERGY = 30
const ULT_ENERGY = 5
const MEMO_SKILL_ENERGY = 5
const SUMMON_ENERGY = 15
const FIRST_SUMMON_ENERGY = 30

const RAIN_TURNS = 3
const TECHNIQUE_HEAL = { pct: 0.3, flat: 600 }
const TECHNIQUE_HP_PCT = 0.2
const TECHNIQUE_TURNS = 2
const E2_TURNS = 2
const E2_SPD = 0.3
const STACK_TURNS = 2
const STACK_MAX = 3
const E1_HEAL_SHARE = 0.08
const E1_RAIN_HP_PCT = 0.5
const TALENT_COST_SHARE = 0.04
const ICA_HP_SHARE = 0.5
const ICA_AGGRO = 4
const DISAPPEAR_ADVANCE = 0.3
const LOW_HP_SHARE = 0.5
const SPD_THRESHOLD = 200
const SPD_CAP = 400
const SPD_TOLERANCE = 0.01
const ICA_SKILL_HEAL_RATIO = 1.25
const ICA_ULT_HEAL_RATIO = 1.2

const TOUGHNESS_BASIC = 30
const TOUGHNESS_MEMO_SKILL = 30

const EPSILON = 1e-9

export const RAIN_MODIFIER = 'hyacine.after_rain'
export const STACK_MODIFIER = 'hyacine.healing_dmg'
export const E2_MODIFIER = 'hyacine.e2_spd'
/** The Technique's Max HP buff, held by each character it reached. */
export const TECHNIQUE_MODIFIER = 'hyacine.technique_max_hp'

export const icaId = (me: string): UnitId => `${me}.little_ica`

/** Ability numbers by eidolon, from the in-game Lv lines. */
export function hyacineScalings(eidolon: number) {
  const e3 = eidolon >= 3
  const e5 = eidolon >= 5
  return {
    basic: e3 ? 0.55 : 0.5,
    skillHeal: e5 ? { pct: 0.088, flat: 178 } : { pct: 0.08, flat: 160 },
    ultHeal: e3 ? { pct: 0.11, flat: 222.5 } : { pct: 0.1, flat: 200 },
    rainHp: e3 ? { pct: 0.33, flat: 667.5 } : { pct: 0.3, flat: 600 },
    /** The Memosprite Skill's share of the tally. */
    memoSkill: e3 ? 0.22 : 0.2,
    /** Take Sky in Hand's heal. */
    talentHeal: e5 ? { pct: 0.022, flat: 22 } : { pct: 0.02, flat: 20 },
    tallyClear: eidolon >= 6 ? 0.12 : 0.5,
  }
}

export const Hyacine: Kit = {
  characterId: '1409',
  path: 'Remembrance',
  element: 'Wind',
  maxEnergy: MAX_ENERGY,
  // Fribbels has no buffed version of her: only the original kit (K13).
  abilityVersions: [0],

  create(battle: Battle, self: Member): KitInstance {
    const { timeline, party } = battle
    const me = self.key
    const e = self.eidolon
    const s = hyacineScalings(e)
    const ica = icaId(me)
    const modifiers = timeline.modifiers

    let tally = 0
    let firstSummonDone = false
    /** Switches the kernel is asked with while a kit read needs them off or per target. */
    let lowTarget = false
    let suppressRain = false
    let suppressHalt = false
    let suppressTechnique = false
    /** Max HP applied to each character so far by the Technique. */
    const techniqueApplied = new Map<UnitId, number>()
    /** Max HP applied to the party so far by After Rain (per member and for Ica) and by Halt (her). */
    const rainApplied = new Map<UnitId, number>()
    let haltApplied = 0
    /** Allies that lost HP since the last check. */
    const reduced = new Set<UnitId>()
    let flushing = false
    const stackSeen = new Set<string>()

    const rainUp = () => modifiers.has(me, RAIN_MODIFIER)
    const icaOn = () => battle.isMemosprite(ica)
    const stacks = () => (icaOn() ? Math.min(STACK_MAX, modifiers.get(ica, STACK_MODIFIER)?.stacks ?? 0) : 0)
    const turnSerial = () => timeline.activeTurn?.serial ?? -1

    /** Every ally target: the party's characters and the memosprites on the field. */
    const allies = (): UnitId[] => battle.members.flatMap((m) => [m.key, ...battle.memospritesOf(m.key)])

    // ---------------------------------------------------------------- reads (actions and listeners only)

    /** The kernel's Outgoing Healing multiplier on her Skill heal in the state asked for: Outgoing Healing, set and light cone effects. */
    const healMultiplier = (low: boolean): number => {
      lowTarget = low
      try {
        const base = s.skillHeal.pct * battle.combatStats(me).HP + s.skillHeal.flat
        return battle.healAmount(me, 'SKILL_HEAL') / base
      } finally {
        lowTarget = false
      }
    }
    const isLow = (unit: UnitId): boolean => {
      const c = party.get(unit)
      return c.hp <= LOW_HP_SHARE * c.maxHp + EPSILON
    }
    const kernelHeal = (ability: 'SKILL_HEAL' | 'ULT_HEAL', low: boolean): number => {
      lowTarget = low
      try {
        return battle.healAmount(me, ability)
      } finally {
        lowTarget = false
      }
    }
    /** A heal by a share of her Max HP plus a flat amount, with the kernel's multiplier for her heals on that target. */
    const sharedHeal = (pct: number, flat: number, unit: UnitId): number => {
      return (pct * battle.combatStats(me).HP + flat) * healMultiplier(isLow(unit))
    }

    const side = (spd: number) => spd + EPSILON >= SPD_THRESHOLD
    /** Halt reads the kernel's in-combat SPD; the timeline's SPD must agree on which side of 200 she is. */
    const checkSpd = () => {
      const live = timeline.spd(me)
      const priced = battle.combatStats(me).SPD
      const excess = (spd: number) => Math.max(0, Math.min(SPD_CAP, spd) - SPD_THRESHOLD)
      if (side(live) === side(priced)) {
        // E4's CRIT DMG (2% per SPD over 200) moves Ica's damage with the excess itself, not only with the side.
        if (e < 4 || Math.abs(excess(live) - excess(priced)) <= SPD_TOLERANCE) return
        throw new Error(
          `Hyacine ${me}: the timeline has her at SPD ${live.toFixed(2)} and the kernel at ${priced.toFixed(2)}, which differ over 200 SPD by more ` +
            `than ${SPD_TOLERANCE}, so E4's CRIT DMG (2% per SPD over 200) would be priced differently from the timeline's SPD. Make the two agree.`,
        )
      }
      throw new Error(
        `Hyacine ${me}: the timeline has her at SPD ${live.toFixed(2)} and the kernel at ${priced.toFixed(2)}, on different sides of the ` +
          `200 SPD threshold of Tempestuous Halt, so her Outgoing Healing would be priced with a bonus the timeline's SPD would not give ` +
          `(or the other way round). Make the two agree (an SPD buff one side does not carry).`,
      )
    }

    // ---------------------------------------------------------------- Max HP (After Rain, Halt)

    const kernelHp = (key: string): number => battle.combatStats(key).HP

    const syncRain = () => {
      const on = rainUp()
      const total = s.rainHp.pct + (e >= 1 ? E1_RAIN_HP_PCT : 0)
      const delta = new Map<UnitId, number>()
      for (const { key } of battle.members) {
        if (!on || party.get(key).downed) {
          delta.set(key, 0)
          continue
        }
        const withRain = kernelHp(key)
        suppressRain = true
        let without: number
        try {
          without = kernelHp(key)
        } finally {
          suppressRain = false
        }
        delta.set(key, withRain - without)
      }
      if (icaOn()) {
        // Her base HP from her own delta (pct x base + flat), and Ica's base is half of it.
        const mine = delta.get(me) ?? 0
        const baseMe = on && mine > s.rainHp.flat ? (mine - s.rainHp.flat) / total : 0
        delta.set(ica, on ? total * ICA_HP_SHARE * baseMe + s.rainHp.flat : 0)
      }
      for (const [unit, target] of delta) {
        if (!party.has(unit)) continue
        const applied = rainApplied.get(unit) ?? 0
        if (Math.abs(applied - target) < EPSILON) continue
        party.setStats(unit, { maxHp: party.get(unit).maxHp - applied + target })
        rainApplied.set(unit, target)
      }
    }

    const syncHalt = () => {
      if (party.get(me).downed) return
      const on = kernelHp(me)
      suppressHalt = true
      let off: number
      try {
        off = kernelHp(me)
      } finally {
        suppressHalt = false
      }
      const target = on - off
      if (Math.abs(haltApplied - target) < EPSILON) return
      party.setStats(me, { maxHp: party.get(me).maxHp - haltApplied + target })
      haltApplied = target
    }

    const techniqueUp = (unit: UnitId) => modifiers.has(unit, TECHNIQUE_MODIFIER)

    /** The Technique's +20% Max HP on one character: the kernel's Max HP with the injected buff minus without it (After Rain's way). */
    const syncTechnique = (unit: UnitId) => {
      if (!party.has(unit)) return
      let target = 0
      if (techniqueUp(unit) && !party.get(unit).downed) {
        const withBuff = kernelHp(unit)
        suppressTechnique = true
        try {
          target = withBuff - kernelHp(unit)
        } finally {
          suppressTechnique = false
        }
      }
      const applied = techniqueApplied.get(unit) ?? 0
      if (Math.abs(applied - target) < EPSILON) return
      party.setStats(unit, { maxHp: party.get(unit).maxHp - applied + target })
      techniqueApplied.set(unit, target)
    }

    timeline.bus.on('modifierApplied', ({ modifier }) => {
      if (modifier.id === RAIN_MODIFIER && modifier.target === me) syncRain()
      if (modifier.id === TECHNIQUE_MODIFIER) syncTechnique(modifier.target)
    })
    timeline.bus.on('modifierRemoved', ({ modifier }) => {
      if (modifier.id === RAIN_MODIFIER && modifier.target === me) syncRain()
      if (modifier.id === TECHNIQUE_MODIFIER) syncTechnique(modifier.target)
    })
    timeline.bus.on('turnStart', (turn) => {
      if (turn.unit !== me) return
      syncHalt()
      if (rainUp()) syncRain()
    })

    // ---------------------------------------------------------------- healing: the tally and the Talent's stacks

    timeline.bus.on('healed', ({ amount, overheal, source }) => {
      if (source !== me && source !== ica) return
      tally += amount + overheal
      if (!icaOn()) return
      // One stack per source per action (or per turn outside one).
      const key = `${source}:${turnSerial()}:${battle.actionSerialInProgress ?? 'none'}`
      if (stackSeen.has(key)) return
      stackSeen.clear()
      stackSeen.add(key)
      modifiers.apply({
        id: STACK_MODIFIER,
        target: ica,
        source: me,
        stacks: Math.min(STACK_MAX, stacks() + 1),
        duration: { turns: STACK_TURNS, tick: 'turnEnd' },
      })
    })

    // ---------------------------------------------------------------- Little Ica

    const summonIca = () => {
      if (icaOn()) return
      battle.addMemosprite({
        id: ica,
        owner: me,
        name: 'little_ica',
        maxHp: ICA_HP_SHARE * battle.combatStats(me).HP,
        baseAggro: ICA_AGGRO,
        takeTurn: icaTurn,
      })
      party.gainEnergy(me, SUMMON_ENERGY + (firstSummonDone ? 0 : FIRST_SUMMON_ENERGY))
      firstSummonDone = true
      if (rainUp()) syncRain()
    }

    function icaTurn(): void {
      battle.performAction(ica, 'memo_skill', 'skill', () => {
        checkSpd()
        const heal = battle.healAmount(me, 'MEMO_SKILL', 0)
        const amount = tally
        battle.attack({
          attacker: me,
          ability: 'MEMO_SKILL',
          parts: [{ shape: 'aoe', scaling: heal > 0 ? (s.memoSkill * amount) / heal : 0, hit: 1, toughness: TOUGHNESS_MEMO_SKILL }],
        })
        tally -= amount * s.tallyClear
        party.gainEnergy(me, MEMO_SKILL_ENERGY)
      })
    }

    // Fall, Then Take Wing.
    timeline.bus.on('memospriteRemoved', ({ unit, reason }) => {
      if (unit !== ica) return
      reduced.clear()
      rainApplied.delete(ica)
      if (reason === 'ownerDowned' || party.get(me).downed || !timeline.has(me)) return
      timeline.advance(me, DISAPPEAR_ADVANCE)
    })

    /** Take Sky in Hand: for each ally that lost HP since the last check, Ica pays 4% of its Max HP and heals it (and, in After Rain, everyone). */
    const flush = () => {
      if (flushing || !icaOn() || reduced.size === 0) return
      flushing = true
      try {
        const targets = [...reduced]
        reduced.clear()
        for (const unit of targets) {
          if (!icaOn()) break
          if (!party.has(unit) || party.get(unit).downed) continue
          checkSpd()
          party.consumeHp(ica, TALENT_COST_SHARE * party.get(ica).maxHp, ica)
          party.heal(unit, sharedHeal(s.talentHeal.pct, s.talentHeal.flat, unit), ica)
          if (rainUp()) {
            for (const other of allies()) {
              if (!party.has(other) || party.get(other).downed) continue
              party.heal(other, sharedHeal(s.talentHeal.pct, s.talentHeal.flat, other), ica)
            }
          }
        }
      } finally {
        flushing = false
      }
    }

    timeline.bus.on('hpLost', ({ unit }) => {
      if (!battle.isAlly(unit) || unit === ica) return
      if (icaOn()) reduced.add(unit)
      // E2: an ally that loses HP has SPD +30% for 2 turns (it needs a place on the timeline).
      if (e >= 2 && timeline.has(unit)) {
        modifiers.apply({ id: E2_MODIFIER, target: unit, source: me, spdPct: E2_SPD, duration: { turns: E2_TURNS, tick: 'turnEnd' } })
      }
    })
    timeline.bus.on('turnStart', () => flush())
    timeline.bus.on('turnEnd', () => flush())

    timeline.bus.on('actionUsed', (action) => {
      // E1: in After Rain an ally that used an attack is healed for 8% of her Max HP.
      if (e >= 1 && rainUp() && battle.isAlly(action.actor) && action.expectedEnemiesHit > 0 && party.has(action.actor) && !party.get(action.actor).downed) {
        checkSpd()
        party.heal(action.actor, E1_HEAL_SHARE * battle.combatStats(me).HP * healMultiplier(isLow(action.actor)), me)
      }
      // After Rain: Ica takes an extra turn right after each of her abilities.
      if (action.actor === me && rainUp() && icaOn()) battle.grantExtraTurn(ica)
      flush()
    })

    // ---------------------------------------------------------------- the kit

    /** Heals every ally but Ica from the kernel's hit, and Ica for `ratio` times it. */
    const healAll = (ability: 'SKILL_HEAL' | 'ULT_HEAL', ratio: number) => {
      checkSpd()
      for (const unit of allies()) {
        if (!party.has(unit) || party.get(unit).downed) continue
        const amount = kernelHeal(ability, isLow(unit))
        party.heal(unit, unit === ica ? ratio * amount : amount, me)
      }
    }

    const kernelState = (unit: UnitId) => ({
      clearSkies: rainUp() && !suppressRain,
      e1HpBuff: e >= 1,
      e2SpdBuff: modifiers.has(unit, E2_MODIFIER),
      e6ResPen: e >= 6 && icaOn(),
    })

    /** The Technique's Max HP for the kernel, for the character that holds it: an injected HP% buff, off while the difference is being read. */
    const techniqueBuffs = (unit: UnitId, target: 'self' | 'team') =>
      techniqueUp(unit) && !suppressTechnique
        ? { injectedBuffs: [{ stat: 'HP_PERCENT' as const, value: TECHNIQUE_HP_PCT, target, label: 'Hyacine Technique' }] }
        : {}

    return {
      actions: {
        basic: {
          kind: 'basic',
          canUse: () => true,
          use: () =>
            battle.performAction(me, 'basic', 'basic', () => {
              checkSpd()
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
              party.gainEnergy(me, SKILL_ENERGY)
              summonIca()
              healAll('SKILL_HEAL', ICA_SKILL_HEAL_RATIO)
            }),
        },
        ultimate: {
          kind: 'ultimate',
          canUse: () => party.get(me).energy >= MAX_ENERGY,
          use: () =>
            battle.performAction(me, 'ultimate', 'ultimate', () => {
              party.setEnergy(me, Math.max(0, party.get(me).energy - MAX_ENERGY))
              summonIca()
              // The heal is priced on the Max HP from before After Rain's buff: heal first, then start After Rain (settled in game).
              healAll('ULT_HEAL', ICA_ULT_HEAL_RATIO)
              modifiers.apply({ id: RAIN_MODIFIER, target: me, source: me, duration: { turns: RAIN_TURNS, tick: 'turnStart' } })
              party.gainEnergy(me, ULT_ENERGY)
            }),
        },
      },

      quantities: {
        tally: () => tally,
        stacks: () => stacks(),
        after_rain: () => rainUp(),
        ica: () => icaOn(),
      },

      attackerState: () => ({
        characterConditionals: {
          ...kernelState(me),
          healTargetHp50: lowTarget,
          spd200HpBuff: !suppressHalt,
          e4CdBuff: e >= 4,
          healingDmgStacks: stacks(),
          // The tally is the sim's own (the part's scaling carries it), so the kernel's multiple is 1.
          healTallyMultiplier: 1,
        },
        ...techniqueBuffs(me, 'self'),
      }),

      teammateState: (attacker: Member): TeammateState => ({
        characterConditionals: kernelState(attacker.key),
        ...techniqueBuffs(attacker.key, 'team'),
      }),

      onBattleStart: ({ techniques }) => {
        syncHalt()
        if (!techniques) return
        checkSpd()
        // Heal first, on her Max HP from before the buff (see IN-GAME CHECK notes), then the Max HP.
        for (const { key } of battle.members) {
          if (party.get(key).downed) continue
          party.heal(key, sharedHeal(TECHNIQUE_HEAL.pct, TECHNIQUE_HEAL.flat, key), me)
        }
        for (const { key } of battle.members) {
          modifiers.apply({ id: TECHNIQUE_MODIFIER, target: key, source: me, duration: { turns: TECHNIQUE_TURNS, tick: 'turnEnd' } })
        }
      },
    }
  },
}
