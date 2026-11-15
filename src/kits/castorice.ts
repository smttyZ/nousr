import type { Battle, HitPart, Member } from '../battle/battle'
import type { UnitId } from '../engine/events'
import type { Kit, KitInstance, TeammateState } from './kit'

/**
 * Castorice (1407), from the 4.7.0 in-game text (`node tools/gamedata/kit-text.mjs 1407`). All traces are taken as unlocked, as Fribbels
 * does, and every ability is at the level the eidolon gives (Fribbels' ability helper uses the same eidolons): Basic ATK Lv7, Ultimate
 * Lv12 and the Memosprite Talent Lv7 from E3; Skill Lv12, Talent Lv12 and the Memosprite Skill Lv7 from E5. Memory path, Quantum, no
 * energy. Everything she and Netherwing deal scales on her Max HP.
 *
 * Abilities
 * - Basic ATK (Lament, Nethersea's Ripple): +1 Skill Point, 50% (E3: 55%) of her Max HP Quantum to one enemy, toughness 30.
 * - Skill (Silence, Wraithfly's Caress): no Skill Point (the text gives none and Fribbels' `skillPointsUsed` is 0). Consumes 30% of every
 *   ally's current HP, 50% (E5: 55%) of her Max HP to one enemy and 30% (33%) to adjacent ones, toughness 60 / 30. With Netherwing on
 *   the field it is Boneclaw, Doomdrake's Embrace instead: consumes 40% of every ally's current HP except Netherwing's, then a Joint
 *   ATK on all enemies, 30% (33%) from her and 50% (55%) from Netherwing, toughness 60 on every enemy (Fribbels' SKILL hits 0 and 1).
 * - Ultimate (Doomshriek, Dawn's Chime): needs max Newbud, costs it, summons Netherwing (advanced 100%) and deploys the Territory
 *   Lost Netherland (all enemies' All-Type RES -20%, E3: -22%), until Netherwing disappears. Netherwing: SPD 165, Max HP 100% of max
 *   Newbud, aggro 100, untargetable (`UNTARGETABLE_MEMOSPRITES`).
 * - Talent (Desolation Across Palms): Newbud. Every point of HP lost by an ally (a character or a memosprite) is a point of Newbud
 *   (`Party`'s `hpLost`), up to the maximum. When allies lose HP, her and Netherwing's DMG +20% (E5: 22%), 3 stacks, 3 turns. While
 *   Netherwing is on the field no Newbud is gained, and the HP any ally except Netherwing loses is given to Netherwing as HP.
 * - Contained Dark Tide (trace): after an ally (not Netherwing) is healed, 100% of the healed amount becomes Newbud (Netherwing's HP
 *   while it is on the field), each ally at most 12% of max Newbud, the tally of every ally resetting after any unit takes action.
 * - Inverted Torch (trace): SPD +40% while her HP is at 50% of her Max HP or more (a timeline modifier, Fribbels' `spdBuff`).
 * - Where the West Wind Dwells (trace): each Breath Netherwing launches gives its DMG +30%, 6 stacks, until the end of the turn.
 * - Netherwing's talents: Mooncocoon Shrouds the Form (backup, `Party.addBackup`, multiplier 5, covering every ally but itself), Roar
 *   Rumbles the Realm (all allies +10% DMG for 3 turns when it is summoned) and Wings Sweep the Ruins (when it disappears: 6 bounces,
 *   E6: 9, of 40% (E3: 44%) of her Max HP on random enemies, toughness 15 each, and all allies healed 6% (E3: 6.6%) of her Max HP + 800
 *   (880)).
 * - Technique (Wail, Death's Herald): the scenario's `techniques` setting: Netherwing is summoned at the start with 50% of max Newbud
 *   as HP and 40% of every other ally's current HP is consumed (the HP goes to Netherwing like any HP lost). The branch "if Netherwing
 *   is not summoned, 30% of max Newbud" is never taken (the technique always reaches an enemy).
 * - E1: against an enemy at 80% HP or lower her Boneclaw, Netherwing's Breath and its Wings Sweep deal 120% (140% at 50%); E2: after
 *   summoning, 2 Ardent Will (each pays for one Breath's HP and advances her 100%) and the next Boneclaw gives 30% of max Newbud;
 *   E4: healing received +20%; E6: Quantum RES PEN +20%, Netherwing breaks toughness whatever the weakness and Wings Sweep bounces +3.
 *
 * Netherwing's turn and the Breath loop. A Breath consumes 25% of its Max HP for 24% of her Max HP on all enemies (E5: 26.4%); "in one
 * attack, Breath can be launched repeatedly" with the multiple going to 28% and then 34% and staying there until Netherwing is gone
 * (E5: 30.8%, 37.4%). The text says nothing of when the repetition stops, so it is read as: Netherwing launches Breath again and again
 * for as long as its current HP is above 25% of its Max HP; at 25% or less the launch is the last one: it deals its damage, takes
 * Netherwing down to 1 HP and triggers Wings Sweep's effect (the bounces and the heal), and Netherwing disappears after it (one Wings
 * Sweep in all). That gives 4 Breaths from full HP, 6 with the two Ardent Will, which is the 4 Memosprite Skills before the Memosprite
 * Talent of Fribbels' own combo and the 6 stacks of the trace. Each Ardent Will, while there is one, pays for a launch instead of HP
 * (and advances her by 100%). After 3 turns of its own Netherwing disappears and Wings Sweep triggers; at 0 HP (the backup bearing too
 * much) it does too.
 *
 * Burn or hold (Smitty, 2026-11-15: model both, selectable per scenario; the option is `finishOnTurn`). The game's auto-battle burns:
 * everything on the first turn, as above (finishOnTurn 1, the default). Hold (finishOnTurn 2 or 3): on the turns before the finishing
 * one, Netherwing launches Breath only while its HP is above 25% and stops there, since any launch at 25% or less is the finisher (the
 * text keys it on HP, so Ardent Will does not change that). A turn that starts at 25% or less uses Claw Splits the Veil (40%, E5: 44%,
 * of her Max HP to all enemies, toughness 30, no HP cost, E1 applies by the text). The HP refilled between its turns (allies' HP loss
 * and healing, Contained Dark Tide) pays for more Breaths, and the Territory and backup stay up longer; the Breath multiple's step is
 * kept across turns by the text, West Wind is not. On the finishing turn it burns. With finishOnTurn at most 3 the 3-turn exit without
 * a finishing Breath is never reached; the code path stays for safety. Claw is priced on Fribbels' MEMO_SKILL hit (the Breath's) at its
 * own multiple: the price is per 100% (K11), and the only other Breath-specific switch, `memoDmgStacks`, is 0 on a Claw turn.
 *
 * Newbud. Her maximum is not in the text ("related to the levels of all characters on the battlefield"): it is NEWBUD_MAX, 34,000, the
 * Netherwing Max HP of Fribbels' Castorice (`Castorice.ts`, `memoBaseHpFlat`). IN-GAME CHECK below. The Ultimate needs it, and it is
 * emptied by the summon. Cyrene's Ode to Life and Death on her (`Battle.cyreneEffect`) lets Newbud overflow to 200%; the Ultimate then
 * consumes the overflow and each 1% of it adds 0.24% (Cyrene E3: 0.26%) to the multiple of every Wings Sweep bounce of that Netherwing,
 * plus 0.48% (0.53%) with 2 enemies or fewer on the field at the summoning (the same numbers Fribbels' `cyreneSpecialEffect` prices,
 * but with the live overflow in place of its fixed 30% assumption: the kit asks for the multiple, the kernel prices per 100%).
 *
 * Pricing. Fribbels' abilities: BASIC hit 0, SKILL (hit 0 normal; hits 0 and 1 while Netherwing is on the field), MEMO_SKILL hit 0 (Breath)
 * and MEMO_TALENT hit 0 (the bounces, one combined hit). Every switch is live: `memospriteActive` (Netherwing on the field: it picks the
 * Skill's form and gives every ally the Territory's RES PEN), `talentDmgStacks`, `spdBuff`, `memoSkillEnhances` (the Breath's multiple
 * step), `memoDmgStacks` (the West Wind stacks of the turn), `memoTalentHits`, `teamDmgBoost` (the holder's own 3-turn modifier), `cyreneSpecialEffect`,
 * `e1EnemyHp50` and `e6Buffs`. Fribbels' E1 is a Final DMG boost on Netherwing's hits only (+20%, +40% with the switch), with no
 * threshold, while the text gives 120% / 140% below 80% / 50% for Boneclaw (both parts), Breath and Wings Sweep: the kit asks for the
 * multiple times the text's factor over Fribbels' own, per enemy, so a hit against an enemy above 80% is not boosted.
 *
 * IN-GAME CHECK notes mark the readings Smitty will check in game:
 * - Maximum Newbud (above): 34,000 whatever the levels. Newbud is emptied by the Ultimate.
 * - The Breath loop's stopping rule (above), and that the last launch deals its damage and ends in one Wings Sweep with Netherwing gone.
 * - Each Ardent Will is spent at once on a launch when Netherwing is above 25% HP, and the advance is per Ardent Will used.
 * - The Talent's stacks: one per ally that loses HP, per HP loss (Netherwing's own Breath cost too: "allies lose HP"), refreshing the
 *   3 turns, counted on her own turns; the stack is already there for the hit that follows the HP she consumes; the stacks are one
 *   set for her and Netherwing. The expected-value engine gives every enemy attack a loss to each ally it hits, each one a stack.
 * - Skill / Boneclaw HP costs take 30% / 40% of the current HP of memosprites too (Robin's Songbirds): "all allies". The cost never
 *   asks for more than the ally has (30% / 40% of current HP), so the "down to 1" clause and Netherwing bearing a shortfall at 500% do
 *   not arise; the kit asks for at most (current HP - 1).
 * - West Wind: the stack a Breath gives is already there for that Breath (Breath k has min(k, 6) stacks).
 * - Boneclaw's toughness 60 is Castorice's part's; at E6 it ignores weakness (the Joint ATK is Netherwing's attack too).
 * - Roar Rumbles the Realm: the +10% DMG is given to every ally and every memosprite on the field, Netherwing included, each counting
 *   its own turns (3); a memosprite that arrives later does not have it.
 * - E2: Ardent Will and the +30% Newbud are given at each summoning (the technique's too); a Boneclaw that never comes loses the Newbud.
 * - E4's +20% healing received is added to her Outgoing Healing Boost for HER Wings Sweep heal only; the Wings Sweep heal has no Fribbels
 *   hit, so it is (6% of her Max HP + 800) x (1 + Outgoing Healing Boost + 20% at E4), her Max HP being the kernel's in-combat HP.
 * - Territory: a marker modifier on every enemy while Netherwing is on the field (not a debuff for the debuff counts); the RES PEN
 *   itself reaches allies' prices through `memospriteActive`.
 * - The Netherwing HP given from allies' HP loss and from healing is not a heal (`Party.gainHp`, no `healed` event), so effects that
 *   react to healing (Robin Summeretto's Vibes, Gentle Rain, Contained Dark Tide itself) do not see it.
 * - Contained Dark Tide converts the HP actually restored, not overheal (Hyacine's tally counts overheal).
 * - Hold mode: Claw Splits the Veil is what Netherwing does on a held turn with no HP above 25%.
 *
 * NOT MODELLED:
 * - E4 +20% healing received for heals other kits give (`Party.heal` has no incoming-healing hook).
 * - Inverted Torch's second part (Netherwing SPD +100% after a Breath that leaves all enemies at 0 HP: enemies never die here, S6).
 * - Wings Sweep's "restores HP" counts as a heal from her for Newbud (the tally is the same as any heal).
 * - The Technique's Newbud branch when Netherwing is not summoned, and the Netherveil state.
 * - The Quantum Weakness Break effect at E6 beyond what `Battle.attack` does for any Quantum break.
 */

/** IN-GAME CHECK: see the header. Fribbels' value for Netherwing's Max HP (`Castorice.ts`). */
export const NEWBUD_MAX = 34000

const NETHERWING_SPD = 165
/** 100 aggro in the game data, over 25 per point. */
const NETHERWING_AGGRO = 4
const NETHERWING_TURNS = 3
const BREATH_COST_SHARE = 0.25
const CONVERSION_CAP = 0.12
const TALENT_MAX_STACKS = 3
const TALENT_TURNS = 3
const WEST_WIND_MAX = 6
const WEST_WIND_DMG = 0.3
const TEAM_DMG_TURNS = 3
const SPD_BONUS = 0.4
const SKILL_HP_SHARE = 0.3
const BONECLAW_HP_SHARE = 0.4
const TECHNIQUE_HP_SHARE = 0.4
const TECHNIQUE_NETHERWING_HP = 0.5
const E2_NEWBUD = 0.3
const ARDENT_WILL = 2
const MAX_BREATHS = 50
const EPSILON = 1e-9

const TOUGHNESS_BASIC = 30
const TOUGHNESS_SKILL = 60
const TOUGHNESS_SKILL_ADJACENT = 30
const TOUGHNESS_BREATH = 30
const TOUGHNESS_BOUNCE = 15

export const TALENT_MODIFIER = 'castorice.talent_dmg'
export const TEAM_DMG_MODIFIER = 'castorice.team_dmg'
export const TERRITORY_MODIFIER = 'castorice.territory'
export const SPD_MODIFIER = 'castorice.inverted_torch'
export const netherwingId = (me: string): UnitId => `${me}.netherwing`

/** Ability numbers by eidolon (the in-game Lv6 / Lv7 and Lv10 / Lv12 lines). */
export function castoriceScalings(eidolon: number) {
  const e3 = eidolon >= 3
  const e5 = eidolon >= 5
  return {
    basic: e3 ? 0.55 : 0.5,
    /** Skill: the target, and the adjacent enemies. */
    skill: e5 ? 0.55 : 0.5,
    skillAdjacent: e5 ? 0.33 : 0.3,
    /** Boneclaw: Castorice's part and Netherwing's part. */
    boneclawCastorice: e5 ? 0.33 : 0.3,
    boneclawNetherwing: e5 ? 0.55 : 0.5,
    talentDmg: e5 ? 0.22 : 0.2,
    /** Claw Splits the Veil: Netherwing's other Memosprite Skill, all enemies. */
    claw: e5 ? 0.44 : 0.4,
    /** Breath: the first launch, the second, the third and after. */
    breath: e5 ? ([0.264, 0.308, 0.374] as const) : ([0.24, 0.28, 0.34] as const),
    /** One bounce of Wings Sweep. */
    wings: e3 ? 0.44 : 0.4,
    bounces: eidolon >= 6 ? 9 : 6,
    healShare: e3 ? 0.066 : 0.06,
    healFlat: e3 ? 880 : 800,
  }
}

/** Cyrene's Ode to Life and Death: the multiple each 1% of overflow adds to a Wings Sweep bounce, by Cyrene's eidolon, and with 2 enemies or fewer. */
export const cyreneBounceRate = (upgraded: boolean, fewEnemies: boolean): number =>
  // The game data's values (skill 1141517, Lv6 / Lv7); the kit text prints them rounded to 0.26% and 0.53%.
  (upgraded ? 0.00264 : 0.0024) + (fewEnemies ? (upgraded ? 0.00528 : 0.0048) : 0)

export interface CastoriceOptions {
  /**
   * The Netherwing turn (1 to 3, its own turns counted from the summoning) on which it launches Breath down into the finisher. 1 (the
   * default) is "burn": everything on its first turn, as the game's auto-battle and Fribbels' combo do. 2 or 3 is "hold": on the turns
   * before it, Netherwing launches Breath only while its HP is above 25% and stops there, using Claw Splits the Veil on a turn that
   * starts at 25% or less, so that HP refilled between its turns (allies' HP loss, healing) pays for more Breaths and the Territory
   * stays up longer. Netherwing still leaves early if its HP runs out.
   */
  finishOnTurn?: 1 | 2 | 3
}

export function makeCastorice(options: CastoriceOptions = {}): Kit {
  const finishOnTurn = options.finishOnTurn ?? 1
  if (![1, 2, 3].includes(finishOnTurn)) throw new Error(`Castorice: finishOnTurn must be 1, 2 or 3 (got ${finishOnTurn})`)
  return {
    characterId: '1407',
    path: 'Remembrance',
    element: 'Quantum',
    maxEnergy: 0,
    // Fribbels has no buffed version of her: only the original kit (K13).
    abilityVersions: [0],

    create(battle: Battle, self: Member): KitInstance {
      const { timeline, party } = battle
      const me = self.key
      const e = self.eidolon
      const s = castoriceScalings(e)
      const nw = netherwingId(me)
      const modifiers = timeline.modifiers

      let newbud = 0
      let present = false
      let nwTurns = 0
      /** Breath launches since Netherwing came: the multiple's step (1 to 3) stays. */
      let launches = 0
      /** West Wind stacks of the Netherwing turn in progress. */
      let westWind = 0
      let ardent = 0
      let e2Pending = false
      /** Extra multiple on each Wings Sweep bounce from Cyrene's overflow, set at the summoning. */
      let cyreneBonus = 0
      let disappearing = false
      /** Per ally, the HP converted to Newbud so far (Contained Dark Tide's 12% cap). */
      const converted = new Map<UnitId, number>()

      const newbudCap = () => (battle.cyreneEffect(me).active ? 2 : 1) * NEWBUD_MAX
      const gainNewbud = (amount: number) => {
        if (amount > 0) newbud = Math.min(newbudCap(), newbud + amount)
      }
      const talentStacks = () => modifiers.get(me, TALENT_MODIFIER)?.stacks ?? 0
      const allies = (): UnitId[] => party.alive().filter((id) => id !== nw)
      const spdUp = () => {
        const her = party.get(me)
        return !her.downed && her.hp >= 0.5 * her.maxHp - EPSILON
      }
      const syncSpd = () => {
        if (!timeline.has(me)) return
        if (spdUp()) modifiers.apply({ id: SPD_MODIFIER, target: me, source: me, spdPct: SPD_BONUS })
        else modifiers.remove(me, SPD_MODIFIER)
      }
      const tier = () => Math.min(3, Math.max(1, launches))

      /** Whether the 3-turn DMG buff is on the unit whose turn is being taken for `owner` (a memosprite counts its own turns). */
      const holds = (owner: string): boolean => {
        const acting = timeline.activeTurn?.unit
        const unit = acting !== undefined && battle.isMemosprite(acting) && battle.ownerOf(acting) === owner ? acting : owner
        return modifiers.has(unit, TEAM_DMG_MODIFIER)
      }

      /** The text's E1 factor over what Fribbels applies, for a hit against `enemy` (see the header). */
      const e1Scale = (enemy: UnitId, netherwingHit: boolean): number => {
        if (e < 1) return 1
        const { current, max } = battle.enemyHp(enemy)
        const ratio = current / max
        const text = ratio <= 0.5 + EPSILON ? 1.4 : ratio <= 0.8 + EPSILON ? 1.2 : 1
        const fribbels = netherwingHit ? (ratio <= 0.5 + EPSILON ? 1.4 : 1.2) : 1
        return text / fribbels
      }

      // ---------------------------------------------------------------- HP loss, healing, Newbud

      timeline.bus.on('hpLost', ({ unit, amount }) => {
        if (unit === me) syncSpd()
        if (!battle.isAlly(unit) || !(amount > 0)) return
        // "When allies lose HP": one stack per loss, 3 turns from the latest.
        modifiers.apply({
          id: TALENT_MODIFIER,
          target: me,
          source: me,
          stacks: Math.min(TALENT_MAX_STACKS, talentStacks() + 1),
          duration: { turns: TALENT_TURNS, tick: 'turnEnd' },
        })
        if (unit === nw) return
        if (present) party.gainHp(nw, amount)
        else gainNewbud(amount)
      })

      timeline.bus.on('healed', ({ unit, amount }) => {
        if (unit === me) syncSpd()
        if (unit === nw || !battle.isAlly(unit) || !(amount > 0)) return
        const take = Math.min(amount, CONVERSION_CAP * NEWBUD_MAX - (converted.get(unit) ?? 0))
        if (!(take > 0)) return
        converted.set(unit, (converted.get(unit) ?? 0) + take)
        if (present) party.gainHp(nw, take)
        else gainNewbud(take)
      })
      timeline.bus.on('turnEnd', () => converted.clear())
      timeline.bus.on('actionUsed', () => converted.clear())

      // ---------------------------------------------------------------- attacks

      /** One part per enemy (an AoE whose multiple depends on the enemy), so the E1 threshold is read per enemy. */
      const perEnemy = (
        hit: number,
        base: number,
        netherwingHit: boolean,
        options: { toughness?: number } = {},
      ): HitPart[] =>
        battle.enemies.ids.map((id) => ({
          shape: 'single' as const,
          target: id,
          scaling: base * e1Scale(id, netherwingHit),
          hit,
          ...(options.toughness !== undefined && { toughness: options.toughness }),
          ...(e >= 6 && netherwingHit && options.toughness !== undefined && { ignoresWeakness: true }),
        }))

      const launchBreath = () => {
        launches += 1
        westWind = Math.min(WEST_WIND_MAX, westWind + 1)
        const base = s.breath[tier() - 1]!
        battle.attack({ attacker: me, ability: 'MEMO_SKILL', parts: perEnemy(0, base, true, { toughness: TOUGHNESS_BREATH }) })
      }

      /** Wings Sweep: the bounces, then Netherwing is gone and the heal goes to every ally. */
      const wingsSweep = () => {
        const ids = battle.enemies.ids
        const n = s.bounces
        const bounce = s.wings + cyreneBonus
        battle.attack({
          attacker: me,
          ability: 'MEMO_TALENT',
          parts: ids.map((id) => ({
            shape: 'single' as const,
            target: id,
            scaling: ((bounce * n) / ids.length) * e1Scale(id, true),
            hit: 0,
            toughness: (TOUGHNESS_BOUNCE * n) / ids.length,
            ...(e >= 6 && { ignoresWeakness: true }),
            random: { hits: n, chance: 1 / ids.length, group: 'wings' },
          })),
        })
        endField()
        if (party.get(me).downed) return
        const stats = battle.combatStats(me)
        const heal = (s.healShare * stats.HP + s.healFlat) * (1 + stats.OHB + (e >= 4 ? 0.2 : 0))
        for (const id of allies()) party.heal(id, heal, me)
      }

      /** Netherwing leaves the field: its rules, the Territory and what it gave. Safe to call twice. */
      function endField(): void {
        if (!present) return
        present = false
        party.removeBackup(`${me}.backup`)
        for (const enemy of battle.enemies.ids) modifiers.remove(enemy, TERRITORY_MODIFIER)
        ardent = 0
        e2Pending = false
        westWind = 0
        cyreneBonus = 0
      }

      /** Netherwing disappears: Wings Sweep's talent triggers (unless the owner was downed), then it is taken off the field. */
      const disappear = (inAction: boolean) => {
        if (!present || disappearing) return
        disappearing = true
        try {
          if (party.get(me).downed) endField()
          else if (inAction) wingsSweep()
          else battle.performAction(nw, 'wings_sweep', 'followUp', wingsSweep)
          endField()
          battle.removeMemosprite(nw, 'removed')
        } finally {
          disappearing = false
        }
      }

      timeline.bus.on('memospriteRemoved', ({ unit, reason }) => {
        if (unit !== nw || disappearing || !present) return
        // Removed by the battle: its HP ran out (Wings Sweep triggers) or its owner was downed.
        disappearing = true
        try {
          if (reason === 'hp' && !party.get(me).downed) battle.performAction(nw, 'wings_sweep', 'followUp', wingsSweep)
          endField()
        } finally {
          disappearing = false
        }
      })

      // ---------------------------------------------------------------- Netherwing

      const summon = (hpShare: number, overflowPct: number) => {
        const enemies = battle.enemies.ids
        const cyrene = battle.cyreneEffect(me)
        cyreneBonus = cyrene.active ? overflowPct * cyreneBounceRate(cyrene.upgraded, enemies.length <= 2) : 0
        battle.addMemosprite({
          id: nw,
          owner: me,
          name: 'netherwing',
          maxHp: NEWBUD_MAX,
          hp: NEWBUD_MAX * hpShare,
          baseAggro: NETHERWING_AGGRO,
          baseSpd: NETHERWING_SPD,
          takeTurn: netherwingTurn,
        })
        present = true
        nwTurns = 0
        launches = 0
        westWind = 0
        timeline.advance(nw, 1)
        party.addBackup({ id: `${me}.backup`, by: nw, multiplier: 5, covers: (id) => id !== nw, active: () => present })
        for (const enemy of enemies) modifiers.apply({ id: TERRITORY_MODIFIER, target: enemy, source: me })
        // Roar Rumbles the Realm: every ally and memosprite on the field, each counting its own turns.
        for (const member of battle.members) {
          if (party.get(member.key).downed) continue
          for (const unit of [member.key, ...battle.memospritesOf(member.key)]) {
            modifiers.apply({ id: TEAM_DMG_MODIFIER, target: unit, source: me, duration: { turns: TEAM_DMG_TURNS, tick: 'turnEnd' } })
          }
        }
        if (e >= 2) {
          ardent = ARDENT_WILL
          e2Pending = true
        }
      }

      function netherwingTurn(): void {
        if (!present) return
        nwTurns += 1
        westWind = 0
        const holding = nwTurns < finishOnTurn
        const atFloor = () => party.get(nw).hp <= BREATH_COST_SHARE * party.get(nw).maxHp + EPSILON
        if (holding && atFloor()) {
          // Holding with no HP above the finisher: any Breath now would be the finisher (the text keys it on HP, so Ardent Will does not
          // change that). Claw Splits the Veil instead (no HP cost; E1 applies by the text).
          battle.performAction(nw, 'claw', 'skill', () => {
            battle.attack({ attacker: me, ability: 'MEMO_SKILL', parts: perEnemy(0, s.claw, true, { toughness: TOUGHNESS_BREATH }) })
          })
          if (present && nwTurns >= NETHERWING_TURNS) disappear(false)
          return
        }
        battle.performAction(nw, 'breath', 'skill', () => {
          for (let i = 0; ; i++) {
            if (i >= MAX_BREATHS) throw new Error(`${me}'s Netherwing launched ${MAX_BREATHS} Breaths in one turn: the loop does not stop`)
            const her = party.get(nw)
            if (atFloor()) {
              // Holding: stop above the finisher and keep the HP for a later turn.
              if (holding) return
              // The last launch: its damage, then Netherwing down to 1 HP and Wings Sweep's effect, and it is gone.
              launchBreath()
              party.consumeHp(nw, party.get(nw).hp - 1, me)
              disappear(true)
              return
            }
            if (ardent > 0) {
              ardent -= 1
              if (!party.get(me).downed && timeline.has(me)) timeline.advance(me, 1)
            } else party.consumeHp(nw, BREATH_COST_SHARE * her.maxHp, me)
            launchBreath()
          }
        })
        if (present && nwTurns >= NETHERWING_TURNS) disappear(false)
        westWind = 0
      }

      /** HP an ability takes: a share of each ally's current HP, never below 1 HP (see the header). */
      const consumeShare = (share: number, ids: readonly UnitId[]) => {
        for (const id of ids) {
          const hp = party.get(id).hp
          party.consumeHp(id, Math.min(share * hp, Math.max(0, hp - 1)), me)
        }
      }

      return {
        actions: {
          basic: {
            kind: 'basic',
            canUse: () => true,
            use: () =>
              battle.performAction(me, 'basic', 'basic', () => {
                battle.gainSkillPoints(1)
                battle.attack({
                  attacker: me,
                  ability: 'BASIC',
                  parts: [{ shape: 'single', scaling: s.basic, hit: 0, toughness: TOUGHNESS_BASIC }],
                })
              }),
          },
          skill: {
            kind: 'skill',
            canUse: () => true,
            use: () => {
              const enhanced = present
              battle.performAction(me, 'skill', 'skill', () => {
                if (!enhanced) {
                  consumeShare(SKILL_HP_SHARE, allies())
                  battle.attack({
                    attacker: me,
                    ability: 'SKILL',
                    parts: [
                      {
                        shape: 'blast',
                        scaling: s.skill,
                        adjacent: s.skillAdjacent,
                        hit: 0,
                        toughness: TOUGHNESS_SKILL,
                        adjacentToughness: TOUGHNESS_SKILL_ADJACENT,
                      },
                    ],
                  })
                  return
                }
                consumeShare(BONECLAW_HP_SHARE, allies())
                if (e2Pending) {
                  e2Pending = false
                  gainNewbud(E2_NEWBUD * NEWBUD_MAX)
                }
                battle.attack({
                  attacker: me,
                  ability: 'SKILL',
                  parts: [
                    ...perEnemy(0, s.boneclawCastorice, false, { toughness: TOUGHNESS_SKILL }).map((p) => ({
                      ...p,
                      ...(e >= 6 && { ignoresWeakness: true }),
                      // E1 applies to both parts of Boneclaw by the text; Fribbels prices Netherwing's part only.
                    })),
                    ...perEnemy(1, s.boneclawNetherwing, true),
                  ],
                })
              })
            },
          },
          ultimate: {
            kind: 'ultimate',
            canUse: () => !present && !party.get(me).downed && newbud >= NEWBUD_MAX - EPSILON,
            use: () =>
              battle.performAction(me, 'ultimate', 'ultimate', () => {
                const overflowPct = (Math.max(0, newbud - NEWBUD_MAX) / NEWBUD_MAX) * 100
                newbud = 0
                summon(1, overflowPct)
              }),
          },
        },

        quantities: {
          newbud: () => newbud,
          newbud_max: () => NEWBUD_MAX,
          newbud_full: () => newbud >= NEWBUD_MAX - EPSILON,
          netherwing: () => present,
          netherwing_hp: () => (present ? party.get(nw).hp : 0),
          netherwing_turns: () => (present ? nwTurns : 0),
          ardent_will: () => ardent,
          talent_stacks: () => talentStacks(),
        },

        attackerState: (enemy: UnitId) => {
          const { current, max } = battle.enemyHp(enemy)
          return {
            characterConditionals: {
              memospriteActive: present,
              spdBuff: spdUp(),
              talentDmgStacks: talentStacks(),
              memoSkillEnhances: tier(),
              memoTalentHits: s.bounces,
              teamDmgBoost: holds(me),
              memoDmgStacks: Math.min(WEST_WIND_MAX, westWind),
              cyreneSpecialEffect: battle.cyreneEffect(me).active,
              e1EnemyHp50: e >= 1 && current / max <= 0.5 + EPSILON,
              e6Buffs: e >= 6,
            },
          }
        },

        // The Territory's RES PEN and Roar Rumbles the Realm's DMG reach every ally's price.
        teammateState: (attacker: Member): TeammateState => ({
          characterConditionals: { memospriteActive: present, teamDmgBoost: holds(attacker.key) },
        }),

        onBattleStart: ({ techniques }) => {
          syncSpd()
          if (!techniques) return
          // Wail, Death's Herald: Netherwing with half of max Newbud as HP, then 40% of every other ally's current HP is consumed.
          summon(TECHNIQUE_NETHERWING_HP, 0)
          consumeShare(TECHNIQUE_HP_SHARE, allies())
        },
      }
    },
  }
}

export const Castorice: Kit = makeCastorice()
