import type { Battle, HitPart, Member } from '../battle/battle'
import type { UnitId } from '../engine/events'
import type { Kit, KitInstance, TeammateState } from './kit'

/**
 * Cyrene (1415), from the 4.7.0 in-game text (`node tools/gamedata/kit-text.mjs 1415`). All traces are taken as unlocked, as Fribbels
 * does, and every ability is at the level the eidolon gives (Fribbels' `ULT_TALENT_MEMO_SKILL_3_SKILL_BASIC_MEMO_TALENT_5`: Ultimate,
 * Talent and Memosprite Skill up from E3; Basic ATK, Skill and Memosprite Talent from E5). Memory path, Ice. Everything she and her
 * memosprite Demiurge deal scales on Max HP.
 *
 * Abilities
 * - Basic ATK (Lo, Hope Takes Flight!): +1 Skill Point, +1 Recollection, 50% (E5: 55%) of her Max HP Ice to one enemy, toughness 30.
 * - Skill (Bloom, Elysium of Beyond): -1 Skill Point, +3 Recollection, no damage. Deploys the Zone for 2 turns, counted down at the
 *   start of her turns (the application turn does not count: it is up for her next two turn starts). While the Zone is up every
 *   instance of DMG an ally target deals is followed by True DMG of 24% (E5: 26.4%) of it; Fribbels prices that as a TRUE_DMG_MODIFIER
 *   on every ally's hits (`zoneActive`), memosprite hits included (they are priced as their owner's).
 * - Ultimate (Verse Vow Infinity): once per battle, needs 24 Recollection and spends 12 of it (the rest stays). Summons Demiurge, which takes 1 extra turn at once, fills
 *   every teammate's energy (decided by Smitty 2026-11-15: "activates all teammates' Ultimate"; the team policy casts them), starts
 *   "Ripples of Past Reverie" (below), CRIT Rate +50% (E3: 55%) for her and Demiurge, and deploys the Zone with no duration limit.
 *   Reunion at First Sight (the Ultimate inside Ripples): needs 12 Recollection and spends 12, Demiurge takes 1 extra turn. Both are
 *   Ultimates, used by the policy's ultimate rule. The teammates' Ultimates the energy fill activates come BEFORE Demiurge's extra
 *   turn (settled by Smitty in game, 2026-11-15): they are cast in the same Ultimate window, which the battle runs to the end before
 *   the timeline gives the extra turn, and again before Demiurge's turn starts (`Battle.takeTurn`'s memosprite branch).
 * - Ode to Ego is always on (settled by Smitty in game, 2026-11-15): every Minuet gets the bounces, 1 per different teammate she has gained
 *   Recollection from, and Story and what E1, E4 and E6 hang on work from the start.
 * - Ripples of Past Reverie: lasts for the rest of the battle (Demiurge never leaves except when she is downed). Her Basic ATK
 *   becomes To Love and Tomorrow (the only Basic ATK, and the Skill cannot be used): +3 Recollection, no Skill Point, 30% (E5: 33%)
 *   of her Max HP to one enemy and then 30% (33%) to all enemies, toughness 30 on the target and 15 on every enemy. Fribbels' BASIC hit
 *   carries both (hpScaling 2 x 0.30), so each part is asked at its own multiple of the one hit's price per 100% (K11).
 * - Talent (Hearts Gather as One): Recollection (her Ultimate energy, up to 24 and then up to 27 more) and "Future" (below); all
 *   allies' DMG +20% (E3: 22%) while she is on the field, which Fribbels prices as `talentDmgBuff` on every ally.
 * - Demiurge (memosprite 11415): SPD 0, never on the Action Order, acts only in extra turns (`Battle.grantExtraTurn`, K6). Max HP 100%
 *   of hers, its HP percentage follows hers; while it is on the field both have Max HP +24% (E5: 26.4%). Aggro 100 (4 points),
 *   untargetable by default (`UNTARGETABLE_MEMOSPRITES`). Its own continuous effects count down on its extra turns (the timeline
 *   ticks an extra turn like a turn). Its two Memosprite Skills:
 *   - Minuet of Blooms and Plumes: 60% (E3: 66%) of Demiurge's Max HP Ice to all enemies, toughness 30 each, plus Ode to Ego's
 *     bounces (below). Fribbels prices both in one MEMO_SKILL hit (hpScaling = main + bounces x per-bounce multiple); the kit splits
 *     it into an AoE part and a bounce part at their own multiples.
 *   - This Ode, to All Lives: on one ally character, never on Cyrene herself (settled by Smitty in game, 2026-11-15). A Chrysos Heir gets their own special effect (`Battle.setCyreneEffect`, which
 *     each heir's kit reads); anyone else gets DMG +40% (E3: 44%) for 2 turns, also on their memosprites.
 * - Traces: Child of Remembrance (a teammate's memosprite holds Future and never spends it), Ripples Across Time (2 / 3 / 6
 *   Recollection at the start of combat with 1 / 2 / 3 other Chrysos Heirs or Remembrance characters), Causality in Trichotomy (SPD of
 *   180 or more: all allies' DMG +20%, her and Demiurge's Ice RES PEN +2% per SPD over 180, at most 60 counted; Fribbels'
 *   `cyreneSpdDmg` for the allies and `traceSpdBasedBuff` for her, read live).
 * - Technique (Peace at West Wind's End): with the scenario's `techniques` on, the Skill's Zone is deployed at the start (2 turns).
 * - E1: when Demiurge triggers Ode to Ego during Minuet: +6 Recollection and +12 bounces. E2: +12 Recollection at the start of combat,
 *   and the Zone's True DMG multiple +6% per different ally character that has gained a Memosprite Skill buff from Demiurge, up to
 *   24%. E3 and E5: levels. E4: after every use of Minuet the bounce multiple of Ode to Ego +6%, up to 24 times. E6: her first
 *   Ultimate advances all allies 100%; each Ode to Ego trigger: the first gives all enemies DEF -20% while Demiurge is on the field
 *   (Fribbels' `e6DefPen`, a DEF PEN), the second and later advance all allies 24%.
 *
 * Recollection, kept by the kit (not in `Party`'s energy: it ignores the scenario's starting energy and Energy Regeneration Rate, and
 * it overflows past its maximum, which `Party` cannot hold). It starts at the trace's value plus 12 at E2, nothing else (0 + trace, with
 * the 50% start energy adding nothing: settled by Smitty in game, 2026-11-15). Cap 24 + 27 = 51. The first Ultimate needs 24 and spends
 * 12, Reunion at First Sight needs 12 and spends 12; the rest stays (settled by Smitty in game, 2026-11-15). The policy reads it as
 * `cyrene.recollection`; `recollection_cost` is what the next Ultimate needs.
 *
 * Choice turns (Smitty, K26 / K27). Demiurge's extra turns from her Ultimates (the summoning one and each Reunion) are choices;
 * the "Story" extra turns are automatic Minuets. `makeCyrene({ demiurgeOrder, afterOrder })` reads the choices from the list: a member
 * key is This Ode on that member (never her own key: the Ode cannot target her, so the kit refuses it and the loader rejects it with
 * `x-nousr-domain.exclude_self`), `'attack'` is Minuet. Without a list the placeholder order is every other member in party order,
 * then `'attack'`, and `kit-option-default-used` is raised the first time it decides. Past the end of the list `afterOrder` applies (`'attack'`, `'repeat'` the last entry, `'cycle'` from the top) and
 * `kit-option-list-exhausted` is raised, with the count of such turns in the message.
 *
 * IN-GAME CHECK notes mark the readings Smitty will check in game:
 * - "Take action" for Future: a unit's own turn action (Basic ATK or Skill), not an Ultimate or a follow-up. A memosprite's Future is
 *   never consumed, so each Basic/Skill-kind action of a teammate's memosprite is 1 Recollection (Little Ica's and Netherwing's turns,
 *   not Wings Sweep); summons such as Lightning-Lord are not memosprites and hold none. Characters hold one Future at a time: given at
 *   the start of combat and again after each Basic ATK or Skill of hers (her Ultimates are not "taking action").
 * - Settled by Smitty in game, 2026-11-15 (no longer checks): Recollection is not the party's energy bar (the 50% start energy adds
 *   nothing; the Memory of Chaos start is 0 + trace); the first Ultimate needs 24 and spends 12; Reunion needs and spends 12; Ode to Ego is
 *   always on, with the bounces on every Minuet (1 per different teammate, characters and memosprites, never Demiurge, never herself);
 *   "This Ode, to All Lives" cannot target her; the first Ultimate gives 2 Story (1 for using the Ultimate, 1 for summoning Demiurge), and
 *   a Reunion gives 1; at 3 Story all of it is spent for an automatic Minuet extra turn; teammates' Ultimates come before Demiurge's turn.
 * - E1's 6 Recollection and E6's effects come after the Minuet that triggers them (not in the hit that triggers them); Ode to Ego
 *   triggers on every Minuet, including a Minuet with no bounces (0 teammates counted).
 * - E2's count of "different ally characters" given a Memosprite Skill buff counts every Ode target, Chrysos Heir or not; Cyrene herself
 *   can never be one (the Ode cannot target her).
 * - E4: +6 percentage points on the bounce's multiple per earlier Minuet of the battle (Fribbels' form), the stack built after each use.
 * - E6: "all allies" includes Cyrene herself and every memosprite on the timeline. The DEF reduction is Fribbels' DEF PEN and is not
 *   recorded as a debuff on the enemies (nothing that counts debuffs sees it).
 * - This Ode on a non-Chrysos Heir: the 2 turns count the target's own turns from its next turn on, and each of its memosprites that is
 *   on the field at that moment holds its own 2 turns; priced as the owner's, so the buff is on while the acting unit holds it.
 * - Ode to Sky on Hyacine: the 24 energy (E3: 26.4) is a flat gain (no Energy Regeneration Rate), as Sunday's Ultimate on an ally.
 * - Anaxa's Ode (One-time): +1 Skill Point and he is advanced 100%; his effect (`cyreneEffect`) is switched off after his next turn.
 * - Demiurge's HP follows hers without it being HP lost or restored (no `hpLost` / `healed` events: Castorice's Newbud, Hyacine's
 *   Ica and Robin's Vibes do not see the mirroring). Its Max HP is hers, kept equal.
 * - The Zone deployed by the Skill, the Technique or the Ultimate is one effect: the Ultimate removes its duration, no second one.
 * - Child of Remembrance, Ripples Across Time count Chrysos Heirs by the kernel's character id (the same list as Fribbels' CHRYSOS_HEIR_IDS)
 *   and Remembrance by the kit's path.
 * - The log names Demiurge's actions `minuet` and `ode:<member key>`. A memosprite that removes itself in its own action (Netherwing's last
 *   Breath) has no `owner` on its `actionUsed` (`Battle.performAction` reads it after the removal), so the kit finds the owner from the
 *   id convention `${owner}.${name}` to still count its Recollection. Engine fix wanted: read `owner` before the body runs.
 *
 * NOT MODELLED:
 * - Trailblazer (Remembrance)'s Ode to Genesis and its Story-like extra turn (no kit for them).
 * - Ode to Sky's stacks on Hyacine's side (hyacine.ts has no handling); the energy is given here.
 * - Ode to Earth beyond the Bondmate's DMG boost (the Souldragon's advance, its three Additional DMG hits and its Ultimate enhancement:
 *   those are Dan Heng PT's kit).
 * - Anaxa's three more Skill instances and True Knowledge (his kit, not written yet); the effect flag is set and his SP and advance are
 *   done here.
 * - Heirs with no kit yet (Aglaea, Mydei, Cipher, Phainon, Hysilens, Cerydra, Evernight): the effect flag is set, nothing reads it.
 * - "Hello, World": Crowd Control dispel when Demiurge is summoned, and the debuff dispel by her first Ultimate (nothing here puts a
 *   debuff or Crowd Control on allies).
 * - The Ode's DMG on a memosprite of the target summoned after the Ode (only memosprites on the field then hold it).
 * - Debuff-ness of E6's DEF reduction (above).
 */

export const CYRENE_ID = '1415'

/** Fribbels' CHRYSOS_HEIR_IDS (`vendor/hsr-optimizer/src/lib/conditionals/character/1400/Cyrene.ts`); a test compares the two lists. */
export const CHRYSOS_HEIR_IDS: readonly string[] = [
  '1402', '1403', '1404', '1405', '1406', '1407', '1408', '1409', '1410', '1412', '1413', '1414', '1415', '8007', '8008',
]
export const isChrysosHeir = (characterId: string): boolean => CHRYSOS_HEIR_IDS.includes(characterId)

const RECOLLECTION_MAX = 24
const RECOLLECTION_OVERFLOW = 27
const RECOLLECTION_CAP = RECOLLECTION_MAX + RECOLLECTION_OVERFLOW
/** What every Ultimate spends (the rest stays). */
const ULTIMATE_SPEND = 12
/** What Reunion at First Sight needs. */
const REUNION_NEED = 12
const ZONE_TURNS = 2
const ODE_TURNS = 2
const STORY_NEEDED = 3
const E1_BOUNCES = 12
const E1_RECOLLECTION = 6
const E2_START_RECOLLECTION = 12
const E2_MAX_ALLIES = 4
const E4_MAX_STACKS = 24
const E4_BOUNCE_PER_STACK = 0.06
const E6_ADVANCE_FIRST = 1
const E6_ADVANCE_LATER = 0.24
const SPD_THRESHOLD = 180
const SPD_EXCESS_CAP = 60
const SPD_TOLERANCE = 0.01
const EPSILON = 1e-9
/** 100 aggro in the game data, over 25 per point. */
const DEMIURGE_AGGRO = 4
const ANAXA_ID = '1405'
const HYACINE_ID = '1409'
/** Fribbels' slider maximum for Ode to Ego's extra bounces. */
const EGO_BOUNCES_MAX = 6

const TOUGHNESS_BASIC = 30
const TOUGHNESS_ENHANCED_TARGET = 30
const TOUGHNESS_ENHANCED_ALL = 15
const TOUGHNESS_MINUET = 30
const TOUGHNESS_BOUNCE = 5

export const ZONE_MODIFIER = 'cyrene.zone'
export const ODE_DMG_MODIFIER = 'cyrene.ode_dmg'
export const demiurgeId = (me: string): UnitId => `${me}.demiurge`

/** Ability numbers by eidolon, from the in-game Lv lines. */
export function cyreneScalings(eidolon: number) {
  const e3 = eidolon >= 3
  const e5 = eidolon >= 5
  return {
    basic: e5 ? 0.55 : 0.5,
    /** One of the two parts of To Love and Tomorrow. */
    enhanced: e5 ? 0.33 : 0.3,
    /** Minuet's main hit and one bounce of Ode to Ego. */
    minuet: e3 ? 0.66 : 0.6,
    odeDmg: e3 ? 0.44 : 0.4,
    /** Ode to Sky's energy for Hyacine. */
    odeToSkyEnergy: e3 ? 26.4 : 24,
  }
}

/** A choice of Demiurge's: This Ode on a member (by key), or Minuet. */
export type DemiurgeChoice = string | 'attack'
export type AfterOrder = 'attack' | 'repeat' | 'cycle'

export interface CyreneOptions {
  /** Demiurge's choice turns, in order: a member key (This Ode on that member; her own key is Ode to Ego) or `'attack'` (Minuet). */
  demiurgeOrder?: string[]
  /** What it does on a choice turn after the list is used up. Default `'attack'`. */
  afterOrder?: AfterOrder
}

export function makeCyrene(options: CyreneOptions = {}): Kit {
  const afterOrder: AfterOrder = options.afterOrder ?? 'attack'
  if (!['attack', 'repeat', 'cycle'].includes(afterOrder)) {
    throw new Error(`Cyrene: afterOrder must be "attack", "repeat" or "cycle" (got ${String(afterOrder)})`)
  }
  return {
    characterId: CYRENE_ID,
    path: 'Remembrance',
    element: 'Ice',
    // Recollection is kept by the kit (see the header), so she has no `Party` energy bar.
    maxEnergy: 0,
    // Fribbels has no buffed version of her: only the original kit (K13).
    abilityVersions: [0],

    create(battle: Battle, self: Member): KitInstance {
      const { timeline, party } = battle
      const me = self.key
      const e = self.eidolon
      const s = cyreneScalings(e)
      const demi = demiurgeId(me)
      const modifiers = timeline.modifiers

      const teamKeys = battle.members.map((m) => m.key)
      for (const entry of options.demiurgeOrder ?? []) {
        if (entry === me) {
          throw new Error(`Cyrene ${me}: demiurge_order names "${entry}", her own key, but "This Ode, to All Lives" cannot target Cyrene herself`)
        }
        if (entry !== 'attack' && !teamKeys.includes(entry)) {
          throw new Error(`Cyrene ${me}: demiurge_order names "${entry}", which is neither a member of the team (${teamKeys.join(', ')}) nor "attack"`)
        }
      }

      let recollection = 0
      /** Characters (other than her) that hold Future now. */
      const future = new Set<UnitId>()
      /** Different teammates (characters and memosprites) she has gained Recollection from. */
      const sources = new Set<UnitId>()
      /** Different ally characters Demiurge has given a Memosprite Skill buff (E2). */
      const odeTargets = new Set<string>()
      let ultsUsed = 0
      let egoTriggers = 0
      let story = 0
      let minuets = 0
      /** The kinds of the extra turns Demiurge has queued, in the order the timeline will give them. */
      const pending: Array<'choice' | 'story'> = []
      let choices = 0
      let exhausted = 0
      let defaultWarned = false
      let suppressMemo = false
      /** Max HP the kit has added to her (Waiting, In Every Past), so it can be taken off before the new figure is added. */
      let hpApplied = 0
      /** Odes that last one turn of the target: the serial of the turn the Ode was used in, per target. */
      const oneTime = new Map<string, number>()

      const demiurgeOn = (): boolean => battle.isMemosprite(demi)
      const alive = (): boolean => !party.get(me).downed
      const zoneUp = (): boolean => alive() && modifiers.has(me, ZONE_MODIFIER)
      const gain = (amount: number, source?: UnitId): void => {
        if (!(amount > 0) || !alive()) return
        recollection = Math.min(RECOLLECTION_CAP, recollection + amount)
        if (source !== undefined) sources.add(source)
      }
      const others = (): Member[] => battle.members.filter((m) => m.key !== me)
      const heirsAndRemembrance = (): number =>
        others().filter((m) => isChrysosHeir(m.kernel.unit.characterId) || m.kit.path === 'Remembrance').length
      /** Ally characters and memosprites that stand on the timeline, her and Demiurge's memosprite-less units included. */
      const timelineAllies = (): UnitId[] =>
        battle.members
          .filter((m) => !party.get(m.key).downed)
          .flatMap((m) => [m.key, ...battle.memospritesOf(m.key)])
          .filter((id) => timeline.has(id))

      const ripples = (): boolean => demiurgeOn()
      /** Ode to Ego is always on: one bounce per different teammate she has gained Recollection from. */
      const egoBounces = (): number => sources.size

      // ---------------------------------------------------------------- SPD (Causality in Trichotomy)

      const excess = (spd: number): number => Math.max(0, Math.min(SPD_EXCESS_CAP, spd - SPD_THRESHOLD))
      /**
       * The trace reads the kernel's in-combat SPD for her own price and the timeline's for her allies' (`cyreneSpdDmg`). They must
       * agree on which side of 180 she is and on the whole points above it (the RES PEN steps by 2% a point), or the run stops.
       */
      const checkSpd = (): void => {
        if (!timeline.has(me)) return
        const live = timeline.spd(me)
        const priced = battle.combatStats(me).SPD
        const side = (spd: number) => spd + EPSILON >= SPD_THRESHOLD
        if (side(live) !== side(priced)) {
          throw new Error(
            `Cyrene ${me}: the timeline has her at SPD ${live.toFixed(2)} and the kernel at ${priced.toFixed(2)}, on different sides of ` +
              `the 180 SPD threshold of Causality in Trichotomy, so her allies' +20% DMG and her Ice RES PEN would be priced differently ` +
              `from the timeline's SPD. Make the two agree (an SPD buff one side does not carry).`,
          )
        }
        if (Math.abs(excess(live) - excess(priced)) > SPD_TOLERANCE) {
          throw new Error(
            `Cyrene ${me}: the timeline has her at SPD ${live.toFixed(2)} and the kernel at ${priced.toFixed(2)}, which differ over 180 ` +
              `by more than ${SPD_TOLERANCE}, so her Ice RES PEN (2% per SPD over 180, up to 60) would be priced differently from the ` +
              `timeline's SPD. Make the two agree.`,
          )
        }
      }

      // ---------------------------------------------------------------- Max HP and Demiurge's HP

      const kernelHp = (): number => battle.combatStats(me).HP

      /** Waiting, In Every Past: Max HP +24% for her while Demiurge is on the field, as the kernel's HP with the switch on minus off. */
      const syncMaxHp = (): void => {
        if (!alive()) return
        let target = 0
        if (demiurgeOn()) {
          const on = kernelHp()
          suppressMemo = true
          let off: number
          try {
            off = kernelHp()
          } finally {
            suppressMemo = false
          }
          target = on - off
        }
        if (Math.abs(hpApplied - target) > EPSILON) {
          party.setStats(me, { maxHp: party.get(me).maxHp - hpApplied + target })
          hpApplied = target
        }
        if (demiurgeOn()) party.setStats(demi, { maxHp: party.get(me).maxHp })
        mirror()
      }

      /** Demiurge's HP percentage follows hers (a quiet change: no hpLost or healed event, see the header). */
      function mirror(): void {
        if (!demiurgeOn() || !alive()) return
        const her = party.get(me)
        const it = party.get(demi)
        const target = (her.hp / her.maxHp) * it.maxHp
        if (!(target > 0)) return
        if (target > it.hp + EPSILON) party.gainHp(demi, target - it.hp)
        else if (target < it.hp - EPSILON) {
          // Lowering Max HP below the current HP pulls HP down quietly; the Max HP is put back at once.
          const max = it.maxHp
          party.setStats(demi, { maxHp: target })
          party.setStats(demi, { maxHp: max })
        }
      }

      timeline.bus.on('hpLost', ({ unit }) => {
        if (unit === me) mirror()
      })
      timeline.bus.on('healed', ({ unit }) => {
        if (unit === me) mirror()
      })

      // ---------------------------------------------------------------- Future and Recollection

      const refreshFuture = (): void => {
        future.clear()
        for (const m of others()) if (!party.get(m.key).downed) future.add(m.key)
      }

      /**
       * A memosprite that removed itself during its own action (Netherwing's last Breath) has no `owner` on the `actionUsed` of that
       * action (`Battle.performAction` reads it after the removal). Its id is `${owner}.${name}` by the engine's convention.
       */
      const removedMemospriteOwner = (actor: UnitId): string | undefined => {
        if (battle.isCharacter(actor) || battle.isSummon(actor) || battle.isMemosprite(actor)) return undefined
        return battle.members.find((m) => actor.startsWith(`${m.key}.`))?.key
      }

      timeline.bus.on('actionUsed', (action) => {
        if (!alive() || action.actor === demi) return
        const turnAction = action.kind === 'basic' || action.kind === 'skill'
        if (action.actor === me) {
          // After she takes action the other characters gain Future (her Ultimates are not "taking action").
          if (turnAction) refreshFuture()
          return
        }
        if (!turnAction) return
        const owner = action.owner ?? removedMemospriteOwner(action.actor)
        if (owner !== undefined) {
          // A teammate's memosprite: its Future is never consumed.
          if (owner !== me) gain(1, action.actor)
          return
        }
        if (future.has(action.actor)) {
          future.delete(action.actor)
          gain(1, action.actor)
        }
      })

      // ---------------------------------------------------------------- the Zone

      const deployZone = (limited: boolean): void => {
        modifiers.apply({
          id: ZONE_MODIFIER,
          target: me,
          source: me,
          ...(limited && { duration: { turns: ZONE_TURNS, tick: 'turnStart' as const } }),
        })
      }

      // ---------------------------------------------------------------- Demiurge

      const grantTurn = (kind: 'choice' | 'story'): void => {
        pending.push(kind)
        battle.grantExtraTurn(demi)
      }

      timeline.bus.on('memospriteRemoved', ({ unit }) => {
        if (unit !== demi) return
        pending.length = 0
        hpApplied = 0
      })

      /** One Story (after her Ultimate, or Demiurge's summoning). Three of them are an extra turn. */
      const addStory = (): void => {
        story += 1
        if (story >= STORY_NEEDED) {
          story = 0
          grantTurn('story')
        }
      }

      const defaultOrder = (): string[] => [...others().map((m) => m.key), 'attack']

      /** What Demiurge does on its next choice turn. */
      const nextChoice = (): DemiurgeChoice => {
        const given = options.demiurgeOrder
        const list = given ?? defaultOrder()
        if (given === undefined && !defaultWarned) {
          defaultWarned = true
          battle.warn({
            severity: 'warning',
            code: 'kit-option-default-used',
            member: me,
            message:
              `Cyrene's demiurge_order was not given, so Demiurge's choice turns use the placeholder order (${list.join(', ')}): every other ` +
              'member in party order, then attack. Set kit_options.demiurge_order for a real rotation.',
          })
        }
        const index = choices
        choices += 1
        if (index < list.length) return list[index]!
        exhausted += 1
        battle.warn({
          severity: 'warning',
          code: 'kit-option-list-exhausted',
          member: me,
          message:
            `Demiurge's demiurge_order (${list.length} ${list.length === 1 ? 'entry' : 'entries'}) ran out: ${exhausted} choice ` +
            `turn${exhausted === 1 ? '' : 's'} of ${choices} came after it and used after_order "${afterOrder}".`,
        })
        if (afterOrder === 'repeat') return list[list.length - 1] ?? 'attack'
        if (afterOrder === 'cycle') return list.length > 0 ? list[index % list.length]! : 'attack'
        return 'attack'
      }

      function demiurgeTurn(): void {
        const kind = pending.shift()
        if (kind === undefined) throw new Error(`Cyrene ${me}: Demiurge took an extra turn nobody asked for`)
        if (kind === 'story') return minuet()
        const choice = nextChoice()
        if (choice === 'attack') return minuet()
        ode(choice)
      }

      /** Minuet of Blooms and Plumes, with Ode to Ego's bounces (always on). */
      function minuet(): void {
        battle.performAction(demi, 'minuet', 'skill', () => {
          checkSpd()
          const bounces = egoBounces() + (e >= 1 ? E1_BOUNCES : 0)
          const bounce = s.minuet + (e >= 4 ? minuets * E4_BOUNCE_PER_STACK : 0)
          const parts: HitPart[] = [{ shape: 'aoe', scaling: s.minuet, hit: 0, toughness: TOUGHNESS_MINUET }]
          if (bounces > 0) parts.push({ shape: 'bounce', scaling: bounce, hits: bounces, hit: 0, toughness: TOUGHNESS_BOUNCE })
          battle.attack({ attacker: me, ability: 'MEMO_SKILL', parts })
          minuets = Math.min(E4_MAX_STACKS, minuets + 1)
          egoTriggers += 1
          if (e >= 1) gain(E1_RECOLLECTION)
          if (e >= 6) {
            // The first trigger gives the DEF reduction (`e6DefPen`), the second and later also advance everyone 24%.
            if (egoTriggers >= 2) for (const id of timelineAllies()) timeline.advance(id, E6_ADVANCE_LATER)
          }
        })
      }

      /** This Ode, to All Lives on `key`. */
      function ode(key: string): void {
        battle.performAction(demi, `ode:${key}`, 'skill', () => {
          const target = battle.member(key)
          if (party.get(key).downed) return
          odeTargets.add(key)
          const id = target.kernel.unit.characterId
          if (isChrysosHeir(id)) {
            battle.setCyreneEffect(key, true, me)
            if (id === HYACINE_ID) party.gainEnergy(key, s.odeToSkyEnergy, { fixed: true })
            if (id === ANAXA_ID) {
              // Ode to Reason is a one-time effect: +1 Skill Point, he acts at once, and his effect ends with that turn.
              battle.gainSkillPoints(1)
              if (timeline.has(key)) timeline.advance(key, 1)
              oneTime.set(key, timeline.activeTurn?.serial ?? 0)
            }
            return
          }
          for (const unit of [key, ...battle.memospritesOf(key)]) {
            modifiers.apply({ id: ODE_DMG_MODIFIER, target: unit, source: demi, duration: { turns: ODE_TURNS, tick: 'turnEnd' } })
          }
        })
      }

      timeline.bus.on('turnEnd', (turn) => {
        const armed = oneTime.get(turn.unit)
        if (armed === undefined || turn.serial <= armed) return
        oneTime.delete(turn.unit)
        battle.setCyreneEffect(turn.unit, false, me)
      })

      /** Whether the unit whose turn it is for `owner` (a memosprite counts its own turns) holds the Ode's DMG buff. */
      const holdsOde = (owner: string): boolean => {
        const acting = timeline.activeTurn?.unit
        const unit = acting !== undefined && battle.isMemosprite(acting) && battle.ownerOf(acting) === owner ? acting : owner
        return modifiers.has(unit, ODE_DMG_MODIFIER)
      }

      // ---------------------------------------------------------------- the Ultimate

      /** What the next Ultimate needs: 24 for the first, 12 for Reunion at First Sight. It spends 12 either way. */
      const ultimateNeed = (): number => (ripples() ? REUNION_NEED : RECOLLECTION_MAX)
      const canUltimate = (): boolean => alive() && recollection + EPSILON >= ultimateNeed() && (ripples() || ultsUsed === 0)

      const summonDemiurge = (): void => {
        const her = party.get(me)
        battle.addMemosprite({
          id: demi,
          owner: me,
          name: 'demiurge',
          maxHp: her.maxHp,
          hp: her.hp,
          baseAggro: DEMIURGE_AGGRO,
          takeTurn: demiurgeTurn,
        })
        // Both gain Max HP now; the kernel's HP (read with Demiurge on the field) sizes it, and Demiurge's follows hers.
        syncMaxHp()
      }

      const useUltimate = (): void =>
        battle.performAction(me, 'ultimate', 'ultimate', () => {
          const first = !ripples()
          recollection -= ULTIMATE_SPEND
          ultsUsed += 1
          if (first) {
            summonDemiurge()
            checkSpd()
            // "Activates all teammates' Ultimate": every teammate's energy is filled (the team policy casts them).
            for (const m of others()) if (!party.get(m.key).downed) party.setEnergy(m.key, party.get(m.key).maxEnergy)
            deployZone(false)
            // 2 Story: 1 for using the Ultimate and 1 for summoning Demiurge.
            addStory()
            addStory()
            grantTurn('choice')
            if (e >= 6) for (const id of timelineAllies()) timeline.advance(id, E6_ADVANCE_FIRST)
          } else {
            grantTurn('choice')
            addStory()
          }
        })

      // ---------------------------------------------------------------- the kit

      const attackerFlags = () => ({
        memospriteActive: demiurgeOn() && !suppressMemo,
        zoneActive: zoneUp(),
        talentDmgBuff: alive(),
        traceSpdBasedBuff: true,
        odeToEgoExtraBounces: Math.min(EGO_BOUNCES_MAX, egoBounces()),
        e1ExtraBounces: e >= 1 ? E1_BOUNCES : 0,
        e2TrueDmgStacks: e >= 2 ? Math.min(E2_MAX_ALLIES, odeTargets.size) : 0,
        e4BounceStacks: e >= 4 ? minuets : 0,
        e6DefPen: e >= 6 && egoTriggers >= 1 && demiurgeOn(),
      })

      return {
        actions: {
          basic: {
            kind: 'basic',
            canUse: () => true,
            use: () =>
              battle.performAction(me, 'basic', 'basic', () => {
                checkSpd()
                if (!ripples()) {
                  battle.gainSkillPoints(1)
                  gain(1)
                  battle.attack({
                    attacker: me,
                    ability: 'BASIC',
                    parts: [{ shape: 'single', scaling: s.basic, hit: 0, toughness: TOUGHNESS_BASIC }],
                  })
                  return
                }
                // To Love and Tomorrow: no Skill Point, one hit on the target and then the same on every enemy.
                gain(3)
                battle.attack({
                  attacker: me,
                  ability: 'BASIC',
                  parts: [
                    { shape: 'single', scaling: s.enhanced, hit: 0, toughness: TOUGHNESS_ENHANCED_TARGET },
                    { shape: 'aoe', scaling: s.enhanced, hit: 0, toughness: TOUGHNESS_ENHANCED_ALL },
                  ],
                })
              }),
          },
          skill: {
            kind: 'skill',
            canUse: () => !ripples() && battle.skillPoints >= 1,
            use: () =>
              battle.performAction(me, 'skill', 'skill', () => {
                battle.spendSkillPoints(1)
                gain(3)
                deployZone(true)
              }),
          },
          ultimate: {
            kind: 'ultimate',
            canUse: canUltimate,
            use: useUltimate,
          },
        },

        quantities: {
          recollection: () => recollection,
          recollection_cost: () => ultimateNeed(),
          ripples: () => ripples(),
          demiurge: () => demiurgeOn(),
          zone: () => zoneUp(),
          story: () => story,
          ode_to_ego: () => true,
          ego_sources: () => sources.size,
          choice_turns: () => choices,
        },

        attackerState: () => ({
          characterConditionals: attackerFlags(),
        }),

        teammateState: (attacker: Member): TeammateState => ({
          characterConditionals: {
            zoneActive: zoneUp(),
            cyreneSpdDmg: alive() && timeline.has(me) && timeline.spd(me) + EPSILON >= SPD_THRESHOLD,
            specialEffect: !isChrysosHeir(attacker.kernel.unit.characterId) && holdsOde(attacker.key),
            talentDmgBuff: alive(),
            e2TrueDmgStacks: e >= 2 ? Math.min(E2_MAX_ALLIES, odeTargets.size) : 0,
            e6DefPen: e >= 6 && egoTriggers >= 1 && demiurgeOn(),
          },
        }),

        onBattleStart: ({ techniques }) => {
          // Ripples Across Time and E2, then Future for everyone.
          const n = heirsAndRemembrance()
          gain(n >= 3 ? 6 : n === 2 ? 3 : n === 1 ? 2 : 0)
          if (e >= 2) gain(E2_START_RECOLLECTION)
          refreshFuture()
          if (techniques) deployZone(true)
        },
      }
    },
  }
}

export const Cyrene: Kit = makeCyrene()
