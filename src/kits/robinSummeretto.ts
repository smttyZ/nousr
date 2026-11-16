import type { Battle, Member } from '../battle/battle'
import type { UnitId } from '../engine/events'
import { ACTION_GAUGE } from '../engine/timeline'
import { levelBuff, levelsOf } from '../levels/levels'
import type { Kit, KitInstance, TeammateState } from './kit'

/**
 * Robin • Summeretto (1512), from the 4.7.0 in-game text (`node tools/gamedata/kit-text.mjs 1512`). All traces are taken as
 * unlocked, as Fribbels does, and every ability is at the level the eidolon gives (Basic ATK, Ultimate and Memosprite Skill one or
 * two levels up from E5, Skill and Talent from E3). Memory path, Wind, 140 energy. Her damage and the Songbirds' scale on HP.
 *
 * Abilities
 * - Basic ATK (The Sea Sings in My Key): +20 energy, +1 Skill Point, 50% of her Max HP Wind to one enemy (55% at E5), toughness 30.
 * - Skill (Summer Strums the Soul): +30 energy, -1 Skill Point, no damage. With no Songbirds on the field it summons the memosprite
 *   "Summer Songbirds" as Bessie (1 member). With any on the field it restores their HP by 100% of their Max HP (110% from E3)
 *   and gives her 6 Vibes.
 * - Ultimate (Ascend That Rhapsody in Blue): costs 140, +5 energy. One designated ally (never her, the policy rule's `target`) is
 *   advanced 100% and regenerates a fixed 20% of its Max Energy (21.6% at E5), then holds "Special Guest" for 2 turns, counted down
 *   at the start of its turns: each time it, or its summon, attacks, she gains 2 more Vibes.
 * - Talent (Wings Heed No Borders): Vibes. An ally target that attacks, or that heals, gives her 1 Vibe (cap 50, 70 at E2). While
 *   Bessie is on the field, Vibes 6 or more summon Drummie and 12 or more Paddie. With all three out the Fever state starts, and with
 *   it a Zone: allies' damage ignores 15% + 0.5% per Vibe of enemy DEF (16% at E3). In Fever she cannot take a turn.
 * - Memosprite "Summer Songbirds" (a party member through `Battle.addMemosprite`, K6 second kind; one unit for the three members):
 *   SPD 180% of hers, Max HP 70% of her Max HP (`Battle.combatStats`, read once when summoned; it sizes their damage; enemies can target
 *   them and take it: settled by Smitty in game, 2026-11-15), aggro 100 (4 points). Memosprite Skill (Chirrup Quartet): 150% of
 *   the Songbirds' Max HP Wind to all enemies (165% at E5, doubled at E6), +20 energy for her, toughness 30 on every enemy, used at
 *   every turn of theirs. Their talent (A Warble of Wings): in Fever the Songbirds and a countdown (SPD 140) are in the action order;
 *   Robin's and their damage is raised by 60% + 2% per Vibe (66% + 2.2% at E3); at each countdown turn 50% of the current Vibes
 *   (at least 12) go, and at 0 the Songbirds disappear and Fever ends. While they are on the field the enemies take 8 / 12 / 16% more
 *   DMG for 1 / 2 / 3 members (8.8 / 13.2 / 17.6% at E3). When they are summoned she regenerates 20 energy; when they disappear her
 *   action advances 50%.
 * - Traces: Deviated Chords (an ally that gives her Vibes holds, for 2 turns, ATK of (16% + 0.4% per Vibe) of her Max HP if its ATK
 *   is higher than hers, else CRIT DMG of 40% + 1.5% per Vibe), Improvised Blues (Groove), Rebuilt Harmony (+50% CRIT Rate for her
 *   and the Songbirds), and stats.
 * - Technique (We Are the Melody): 20% advance and 6 Vibes at the start of the battle and all allies' DMG +30% for 2 turns (the
 *   scenario's `techniques` setting).
 * - E1 Stray Bird of Summer (True DMG from a tally), E2 (all allies +18% All-Type RES PEN, Vibes cap 70, the first Vibes gain in each
 *   turn gives 2 more), E3 and E5 (levels), E4 (on entering Fever +12 Vibes and the Songbirds' SPD +20% + 0.5% per Vibe), E6 (the
 *   memosprite skill's multiple doubled, 140 energy when Fever first starts and at every countdown turn).
 *
 * Pricing. Fribbels prices her Basic ATK (`BASIC` hit 0) and the Songbirds' Memosprite Skill (`MEMO_SKILL` hit 0, on the Songbirds'
 * Max HP: Fribbels declares them a memosprite with HP 70% of hers, and the kernel returns the price per hit with the multiple it
 * used, so the kit asks for the multiple the text gives and the kernel prices it). The skill is `attack({ attacker: me, ability:
 * 'MEMO_SKILL' })` inside `performAction(songbirds, ...)`: damage is credited to her, the log shows the Songbirds as actor. Every
 * Fribbels switch is a live value, never its default:
 * - `feverState` is Fever (the Fever DMG boost on her and the Songbirds, and the Zone's DEF PEN for everyone), `vibes` the live
 *   Vibes, `songbirdCount` the members on the field (the Vulnerability on the enemies, which reaches every ally's price too),
 *   `e2ResPen`, `e4MemoSpdBuff` (Fever from E4), `e6MemoSkillBuff` (from E6), `techniqueDmgBuff` (the 2-turn modifier on the one
 *   attacking), `deviatedChordCdBuff` (her own Chord, on while the modifier is on the one attacking).
 * - For a teammate: `teammateHPValue` is her Max HP when the ally is in the ATK branch and holds the Chord, 0 otherwise;
 *   `deviatedChordBranch` is the ATK branch with that value of 0 when the ally holds no Chord (Fribbels always applies one of the
 *   two, and an ATK Chord of 0 HP is the only way to give nothing) and the CRIT DMG branch for a lower-ATK ally that holds it.
 *   Fribbels reads the Vibes in the Chord's value at the time of pricing, so the Chord follows the live Vibes (IN-GAME CHECK below).
 * Her HP and every ally's ATK are `Battle.combatStats` (the kernel's in-combat stat), read in listeners, never from `attackerState`.
 *
 * Reading of the Chord's moment: Fribbels counts the Chord on for an ally's attack; the text gives it when the ally gives her
 * Vibes, i.e. when it attacks. The kit gives the ally the Chord from the action that gives the Vibes (the kernel prices that action's
 * own damage with it: an action in progress counts as a Chord holder), and refreshes it for 2 turns on every further one.
 *
 * Fever in the timeline. The Songbirds are on the timeline from the moment they are summoned but suspended (`Timeline.suspend`, via
 * `addMemosprite({ suspended: true })`): "the Songbirds ... will appear on the Action Order" in Fever, so they are resumed with a full
 * gauge when Fever starts (`resume(songbirds, { gauge })`) and take no turn before it, whatever advance they received. The countdown is
 * `Battle.addSummon` (K6 first kind, SPD 140, no HP, run by this kit). Robin "will not enter her turn": she is suspended for the
 * whole Fever, her gauge frozen as it was, advances and delays she receives meanwhile applying to the frozen gauge (Smitty,
 * 2026-11-14, DESIGN.md in-game check table); she is resumed when Fever ends (then the 50% advance).
 *
 * E6's energy. "Can store her Ultimate up to 2 times" is read as an energy cap of 2 x 140 for the length of Fever (`Party.setMaxEnergy`),
 * the Ultimate costing 140 from what she holds (not emptying it), and the cap going back to 140 when Fever ends, cutting what is
 * over it. IN-GAME CHECK: what happens to the second stored charge when Fever ends.
 *
 * E1's tally. The Songbirds keep it while they are on the field (from Bessie's summoning to their disappearance, lost then): 100% of
 * every `damageDealt` of an ally that is not True DMG (`damageDealt.kind`), the Songbirds' own Memosprite Skill included, Break DMG
 * too. At each Memosprite Skill, after its damage has been added, `Battle.dealFlatDamage` deals (11% + 0.1% per current Vibe) of the
 * tally as True DMG to the enemy with the highest HP (`Battle.highestHpAmong`), and half of the tally is cleared.
 *
 * Shields and healing. A unit "provides healing or Shield for the first time in any target's turn": one Vibe per source per turn,
 * from a `healed` or a `shieldGranted` event, healing and Shield sharing the one count. `Party.setShield` takes the provider as an
 * optional last argument; a caller that leaves it out is read as the shielded unit providing it.
 * Improvised Blues: healing or a Shield that Robin or the Songbirds receive from a teammate sets Groove to 12; the first Vibes she
 * gains in each turn (any gain, `gainVibes`) spends one Groove for a fixed 3 energy.
 *
 * Which units give Vibes. IN-GAME CHECK: "ally target uses an attack" is read as every character (herself included) and every
 * memosprite (the Songbirds included) whose action hit an enemy, once per action. A summon's action counts as its owner's
 * (Lightning-Lord's attack is Jing Yuan's). Healing counts through `healed` events and a Shield through `shieldGranted` (the first
 * of either kind from each source in each turn). The first Vibes gain in each turn adds E2's 2 more, whichever kind it is.
 *
 * IN-GAME CHECK notes mark the readings Smitty will check in game:
 * - "When the Songbirds is summoned: 20 energy" is read as once per Skill that summons Bessie, not for each of Drummie and Paddie.
 * - "Initial SPD 180% of Robin's SPD" is read from her SPD (the timeline's, with its buffs) when Bessie is summoned.
 * - E4's SPD bonus (20% + 0.5% per Vibe) follows the live Vibes through the Fever, re-applied on every change; the base SPD (180% of hers)
 *   stays the snapshot taken when Bessie is summoned ("initial SPD").
 * - The Songbirds enter the order with a full gauge, and the countdown too; an advance they received before Fever is lost to it.
 * - E1: the Songbirds' own Memosprite Skill damage is in the tally before the True DMG is computed; the tally starts at Bessie's
 *   summoning and is lost when they disappear; "enemy with the highest HP" is `Battle.highestHpAmong`.
 * - Healing and Shield share the one "first time in a turn" Vibe per provider. A Shield set without a provider counts as the shielded unit's.
 * - Improvised Blues: Groove is set to 12 by every heal or Shield the pair receives from a teammate (before that same heal's Vibe, so
 *   the Vibe it gives can spend it); the first Vibes gain in a turn
 *   (the Skill's, the guest's too) spends one for 3 fixed energy, also when she has none (the gain still counts as that turn's first).
 * - E6: the energy cap is 280 for the length of Fever and is cut to 140 when it ends.
 * - Special Guest's 2 turns count down at the start of the guest's turns (the text), and the engine counts a buff given in another
 *   unit's turn as lasting through that unit's next turn only (one effective turn), so Vibes from the guest come from its next
 *   action.
 * - Deviated Chords' 2 turns count from the end of the holder's turns, as every 2-turn buff here; the Songbirds' own Chord lasts 2
 *   of their turns.
 * - The Vibes in the Chord's value follow the live Vibes, not the Vibes when it was given.
 * - The Technique's 30% lasts for 2 of each ally's own turns from the start of the battle.
 * - Special Guest's Vibes are 2 more per attack of the guest, on top of the 1 every ally gives.
 *
 * NOT MODELLED:
 * - Special Guest "cannot make other friendly targets gain the action advance effect": other kits' advances on allies cannot be
 *   intercepted.
 * - Shields set by kits and equipment that do not pass a provider to `Party.setShield` (Dan Heng • Permansor Terrae's, Texture of
 *   Memories) are counted as provided by the shielded unit, so Vibes and Groove from them are attributed to the wrong unit.
 * - Dispelling Crowd Control, and Crowd Control immunity in Fever: allies are never crowd-controlled here.
 * - The technique's Attack hit.
 */

const MAX_ENERGY = 140
const BASIC_ENERGY = 20
const SKILL_ENERGY = 30
const ULT_ENERGY = 5
const MEMO_SKILL_ENERGY = 20
const SUMMON_ENERGY = 20
const E6_ENERGY = 140

const BASE_VIBES_CAP = 50
const E2_VIBES_CAP = 70
const E2_FIRST_GAIN_BONUS = 2
const SKILL_VIBES = 6
const GUEST_VIBES = 2
const TECHNIQUE_VIBES = 6
const E4_VIBES = 12
/** Vibes needed for the second and third member. */
const DRUMMIE_VIBES = 6
const PADDIE_VIBES = 12
const COUNTDOWN_SHARE = 0.5
const COUNTDOWN_MIN = 12
const COUNTDOWN_SPD = 140

const SONGBIRDS_SPD_SHARE = 1.8
const SONGBIRDS_HP_SHARE = 0.7
/** 100 aggro in the game data, over 25 per point. */
const SONGBIRDS_AGGRO = 4

const START_ADVANCE = 0.2
const DISAPPEAR_ADVANCE = 0.5
const GUEST_TURNS = 2
const CHORD_TURNS = 2
const TECHNIQUE_TURNS = 2

const CHORD_ATK_BASE = 0.16
const CHORD_ATK_PER_VIBE = 0.004

const TOUGHNESS_BASIC = 30
const TOUGHNESS_MEMO_SKILL = 30

const EPSILON = 1e-9

const E1_TALLY_SHARE = 0.11
const E1_TALLY_PER_VIBE = 0.001
const E1_CLEAR = 0.5
const E4_SPD_BASE = 0.2
const E4_SPD_PER_VIBE = 0.005
const GROOVE_MAX = 12
const GROOVE_ENERGY = 3

/** Fribbels' `DeviatedChordBranch` values (RobinSummeretto.ts): 1 gives the ATK buff, 2 the CRIT DMG buff. */
export const CHORD_BRANCH_ATK = 1
export const CHORD_BRANCH_CD = 2

export const CHORD_MODIFIER = 'robinSummeretto.deviated_chords'
export const GUEST_MODIFIER = 'robinSummeretto.special_guest'
export const TECHNIQUE_MODIFIER = 'robinSummeretto.technique_dmg'
export const E4_SPD_MODIFIER = 'robinSummeretto.e4_spd'

/** The Songbirds' and the countdown's unit ids for a member key. */
export const songbirdsId = (me: string): UnitId => `${me}.songbirds`
export const countdownId = (me: string): UnitId => `${me}.fever_countdown`

/** Ability numbers by eidolon, from the in-game Lv6 / Lv7 (Basic ATK, Memosprite Skill) and Lv10 / Lv12 (Ultimate) lines. */
export function robinSummerettoScalings(eidolon: number) {
  return {
    /** Basic ATK, a share of her Max HP. E5: Lv7. */
    basic: eidolon >= 5 ? 0.55 : 0.5,
    /** The Memosprite Skill, a share of the Songbirds' Max HP. E5: Lv7; E6 doubles it. */
    memoSkill: (eidolon >= 5 ? 1.65 : 1.5) * (eidolon >= 6 ? 2 : 1),
    /** The Ultimate's energy for the ally, a share of its Max Energy. E5: Lv12. */
    ultEnergyShare: eidolon >= 5 ? 0.216 : 0.2,
    vibesCap: eidolon >= 2 ? E2_VIBES_CAP : BASE_VIBES_CAP,
  }
}

export const RobinSummeretto: Kit = {
  characterId: '1512',
  path: 'Remembrance',
  element: 'Wind',
  maxEnergy: MAX_ENERGY,
  // Fribbels has no buffed version of her: only the original kit (K13).
  abilityVersions: [0],
  // Ability levels (K15, K15a): Basic ATK, Skill (the Songbirds' heal), Ultimate (energy), Talent (Zone DEF PEN) and the Memosprite
  // Skill (multiple). The Memosprite Talent's buffs are priced by Fribbels at the maximum level, so a lower level warns.
  // No major trace is modelled: a locked one warns.
  levelsModelled: { abilities: ['basic', 'skill', 'ult', 'talent', 'memo_skill'], majorTraces: [] },

  create(battle: Battle, self: Member): KitInstance {
    const { timeline, party } = battle
    const me = self.key
    const e = self.eidolon
    // Ability levels (K15, K15a): multiples scale by the table's ratio; the Zone's DEF PEN (Fribbels applies the maximum level's base
    // value while Fever lasts) is corrected by injecting the difference.
    const lv = levelsOf(self)
    const base = robinSummerettoScalings(e)
    const s = {
      ...base,
      basic: base.basic * lv.ratio('basic', '151201', 0),
      memoSkill: base.memoSkill * lv.ratio('memo_skill', '1151201', 1),
      ultEnergyShare: base.ultEnergyShare * lv.ratio('ult', '151203', 2),
    }
    const skillHeal = (e >= 3 ? 1.1 : 1) * lv.ratio('skill', '151202', 0)
    const zoneDefPenDelta = lv.delta('talent', '151204', 7)
    const songbirds = songbirdsId(me)
    const countdown = countdownId(me)
    const modifiers = timeline.modifiers

    let vibes = 0
    /** Members of the Songbirds on the field: 0 (none), 1 Bessie, 2 Drummie, 3 Paddie. */
    let members = 0
    let fever = false
    let feverEntered = false
    /** E1: the Songbirds' tally of the non-True DMG allies deal while they are on the field. */
    let tally = 0
    /** Improvised Blues: Groove stacks, and the turn of the first Vibes gain already seen. */
    let groove = 0
    let grooveTurn = -2
    /** True while the Songbirds' Memosprite Skill is being used, so the kernel's request is for their attack. */
    let songbirdsActing = false
    /** Her Max HP as `Battle.combatStats` last gave it (the Chord's ATK value is a share of it). `teammateState` cannot ask the kernel. */
    let maxHp = self.stats.maxHp
    /** Whether an ally is in the Chord's ATK branch (its ATK above hers) or the CRIT DMG branch, as last read. */
    const branch = new Map<string, 'atk' | 'cd'>()
    /** The turn in which the first Vibes gain already happened (E2), and the healing sources seen in the current turn. */
    let lastGainTurn = -2
    let provideTurn = -2
    const provideSeen = new Set<string>()

    const cap = s.vibesCap
    const turnSerial = () => timeline.activeTurn?.serial ?? -1

    // ---------------------------------------------------------------- reads (listeners and actions only)

    const readMaxHp = () => {
      maxHp = battle.combatStats(me).HP
    }

    /** The Chord's ATK value a holder has right now: part of its in-combat ATK that is not its own. */
    const chordAtkValue = (holder: string): number =>
      branch.get(holder) === 'atk' && modifiers.has(holder, CHORD_MODIFIER) ? (CHORD_ATK_BASE + CHORD_ATK_PER_VIBE * vibes) * maxHp : 0

    /** Whether the ally's ATK (without a Chord's own ATK) is above hers: the Chord's ATK branch. Her own, and the Songbirds', never are. */
    const refreshBranch = (holder: string) => {
      if (holder === me || holder === songbirds || !battle.isCharacter(holder) || party.get(holder).downed) {
        branch.set(holder, 'cd')
        return
      }
      const own = battle.combatStats(holder).ATK - chordAtkValue(holder)
      branch.set(holder, own > battle.combatStats(me).ATK ? 'atk' : 'cd')
    }

    // ---------------------------------------------------------------- Vibes

    /** The unit that holds the Chord for an attack by `actor`: the Songbirds themselves, else the member that owns the actor. */
    const holderOf = (actor: UnitId): string => (actor === songbirds ? songbirds : (battle.ownerOf(actor) ?? actor))

    /**
     * Whether a request for `holder` carries the Chord. IN-GAME CHECK (header): an action in progress counts, since the Chord is
     * given by the action that gives the Vibes and the kernel prices that action with it.
     */
    const chordUp = (holder: string) => modifiers.has(holder, CHORD_MODIFIER) || battle.actionSerialInProgress !== undefined

    const giveChord = (holder: string) => {
      if (holder !== songbirds && !party.has(holder)) return
      refreshBranch(holder)
      modifiers.apply({ id: CHORD_MODIFIER, target: holder, source: me, duration: { turns: CHORD_TURNS, tick: 'turnEnd' } })
    }

    /** E4: the Songbirds' SPD bonus follows the live Vibes while Fever lasts. */
    const syncE4Spd = () => {
      if (e < 4 || !fever || !timeline.has(songbirds) || !(vibes > EPSILON)) return
      modifiers.apply({ id: E4_SPD_MODIFIER, target: songbirds, source: me, spdPct: E4_SPD_BASE + E4_SPD_PER_VIBE * vibes })
    }

    /** Sets the Vibes (the one place they change in a battle) and keeps what follows them current. */
    const setVibes = (value: number) => {
      vibes = Math.min(cap, Math.max(0, value))
      syncE4Spd()
    }

    /** Adds Vibes and summons the members they call for. Improvised Blues: the first gain in a turn spends a Groove for energy. */
    const gainVibes = (amount: number) => {
      if (!(amount > 0)) return
      const serial = turnSerial()
      if (grooveTurn !== serial) {
        grooveTurn = serial
        if (groove > 0) {
          groove -= 1
          party.gainEnergy(me, GROOVE_ENERGY, { fixed: true })
        }
      }
      setVibes(vibes + amount)
      callSongbirds()
    }

    /** Drummie at 6 Vibes and Paddie at 12, while Bessie is on the field; the third member starts Fever. */
    const callSongbirds = () => {
      while (members >= 1 && members < 3 && vibes >= (members === 1 ? DRUMMIE_VIBES : PADDIE_VIBES)) members += 1
      if (members === 3 && !fever) enterFever()
    }

    /** One ally attack or healing: 1 Vibe, E2's 2 more for the first gain in a turn, and the guest's 2 for its own attack. */
    const allyGivesVibes = (actor: UnitId, source: UnitId) => {
      let gain = 1
      const serial = turnSerial()
      if (e >= 2 && lastGainTurn !== serial) {
        lastGainTurn = serial
        gain += E2_FIRST_GAIN_BONUS
      }
      const owner = battle.ownerOf(source) ?? source
      if (modifiers.has(owner, GUEST_MODIFIER)) gain += GUEST_VIBES
      giveChord(holderOf(actor))
      gainVibes(gain)
    }

    timeline.bus.on('actionUsed', (action) => {
      if (!battle.isAlly(action.actor) || !(action.expectedEnemiesHit > 0)) return
      readMaxHp()
      allyGivesVibes(action.actor, action.actor)
    })

    // Improvised Blues: healing or a Shield that she or the Songbirds receive from a teammate. Listed before the Vibes it may give,
    // so the same heal that gives her a Vibe has already given her Groove for it to spend.
    const receivesFromTeammate = (unit: UnitId, source: UnitId) => {
      if ((unit === me || unit === songbirds) && source !== me && source !== songbirds) groove = GROOVE_MAX
    }
    timeline.bus.on('healed', (heal) => receivesFromTeammate(heal.unit, heal.source))
    timeline.bus.on('shieldGranted', (shield) => receivesFromTeammate(shield.unit, shield.source))

    // Healing or a Shield an ally provides: the first of each source in each turn (the two share the count).
    const provides = (source: UnitId) => {
      if (!battle.isAlly(source)) return
      const serial = turnSerial()
      if (serial !== provideTurn) {
        provideTurn = serial
        provideSeen.clear()
      }
      if (provideSeen.has(source)) return
      provideSeen.add(source)
      readMaxHp()
      allyGivesVibes(source, source)
    }
    timeline.bus.on('healed', (heal) => provides(heal.source))
    timeline.bus.on('shieldGranted', (shield) => provides(shield.source))

    // E1: the tally of the non-True DMG allies deal, kept by the Songbirds while they are on the field.
    if (e >= 1) {
      timeline.bus.on('damageDealt', (hit) => {
        if (members >= 1 && hit.kind !== 'TRUE' && battle.isAlly(hit.attacker)) tally += hit.damage
      })
    }

    // Any turn may have changed an ATK or her HP: read them again where the kernel may be asked.
    timeline.bus.on('turnStart', () => {
      readMaxHp()
    })

    // ---------------------------------------------------------------- the Songbirds and Fever

    const summonBessie = () => {
      const hp = battle.combatStats(me).HP * SONGBIRDS_HP_SHARE
      battle.addMemosprite({
        id: songbirds,
        owner: me,
        name: 'summer_songbirds',
        maxHp: hp,
        baseAggro: SONGBIRDS_AGGRO,
        baseSpd: timeline.spd(me) * SONGBIRDS_SPD_SHARE,
        // On the timeline but not in the order until Fever starts.
        suspended: true,
        takeTurn: songbirdsTurn,
      })
      members = 1
      tally = 0
      party.gainEnergy(me, SUMMON_ENERGY)
    }

    function enterFever(): void {
      fever = true
      // E6: she can store the Ultimate twice for as long as Fever lasts.
      if (e >= 6) party.setMaxEnergy(me, 2 * MAX_ENERGY)
      // E4: Vibes first, then the SPD that follows them (and keeps following them).
      if (e >= 4) setVibes(vibes + E4_VIBES)
      // Robin leaves the order, her gauge frozen.
      if (timeline.has(me)) timeline.suspend(me)
      // The Songbirds enter it with a full gauge.
      if (timeline.has(songbirds)) timeline.resume(songbirds, { gauge: ACTION_GAUGE })
      syncE4Spd()
      battle.addSummon({ id: countdown, owner: me, baseSpd: COUNTDOWN_SPD, takeTurn: countdownTurn })
      if (e >= 6 && !feverEntered) party.gainEnergy(me, E6_ENERGY, { fixed: true })
      feverEntered = true
    }

    function songbirdsTurn(): void {
      if (!fever) return
      songbirdsActing = true
      try {
        battle.performAction(songbirds, 'memo_skill', 'skill', () => {
          battle.attack({
            attacker: me,
            ability: 'MEMO_SKILL',
            parts: [{ shape: 'aoe', scaling: s.memoSkill, hit: 0, toughness: TOUGHNESS_MEMO_SKILL }],
          })
          party.gainEnergy(me, MEMO_SKILL_ENERGY)
          // E1: True DMG from the tally to the enemy with the highest HP, then half of the tally goes.
          if (e >= 1) {
            const target = battle.highestHpAmong(battle.enemies.ids, { attacker: me, ability: 'MEMO_SKILL', hit: 0 })
            battle.dealFlatDamage({
              attacker: me,
              enemy: target,
              amount: (E1_TALLY_SHARE + E1_TALLY_PER_VIBE * vibes) * tally,
              kind: 'TRUE',
              label: 'E1_TRUE_DMG',
            })
            tally *= 1 - E1_CLEAR
          }
        })
      } finally {
        songbirdsActing = false
      }
    }

    function countdownTurn(): void {
      if (e >= 6) party.gainEnergy(me, E6_ENERGY, { fixed: true })
      setVibes(vibes - Math.max(COUNTDOWN_MIN, vibes * COUNTDOWN_SHARE))
      if (vibes <= EPSILON) {
        vibes = 0
        battle.removeMemosprite(songbirds)
      }
    }

    // The Songbirds are gone (their Vibes ran out, or Robin was knocked down): Fever ends, Robin comes back.
    timeline.bus.on('memospriteRemoved', ({ unit, reason }) => {
      if (unit !== songbirds) return
      members = 0
      tally = 0
      const wasFever = fever
      fever = false
      battle.removeSummon(countdown)
      if (wasFever && e >= 6) party.setMaxEnergy(me, MAX_ENERGY)
      if (!wasFever || reason === 'ownerDowned' || party.get(me).downed || !timeline.has(me)) return
      // Her gauge is what it was (plus whatever advanced or delayed it meanwhile), then Astride Summer's Nightwind.
      timeline.resume(me)
      timeline.advance(me, DISAPPEAR_ADVANCE)
    })

    // ---------------------------------------------------------------- the kit

    const checkAlly = (action: string, target: string | undefined): string => {
      if (target === undefined) throw new Error(`${me}'s ${action} needs a target: an ally character (the policy rule's "target")`)
      if (!battle.isCharacter(target)) throw new Error(`${me}'s ${action} target "${target}" is not an ally character`)
      if (target === me) throw new Error(`${me}'s ${action} cannot target herself`)
      if (party.get(target).downed) throw new Error(`${me}'s ${action} target "${target}" is downed`)
      return target
    }

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
              party.gainEnergy(me, SKILL_ENERGY)
              if (members === 0) {
                summonBessie()
                // Vibes she already has (the Technique's 6) call the others at once.
                callSongbirds()
              } else {
                // "Restores their HP by an amount equal to 100% (Lv12, E3: 110%) of Summer Songbirds' Max HP." IN-GAME CHECK: the heal is a heal from her, so it
                // gives a Vibe like any ally's heal (Wings Heed No Borders), even on full-HP Songbirds.
                const birds = party.get(songbirds)
                party.heal(songbirds, birds.maxHp * skillHeal, me)
                gainVibes(SKILL_VIBES)
              }
            }),
        },
        ultimate: {
          kind: 'ultimate',
          canUse: () => party.get(me).energy >= MAX_ENERGY,
          use: (target) => {
            const ally = checkAlly('Ultimate', target)
            battle.performAction(me, 'ultimate', 'ultimate', () => {
              // The Ultimate costs 140 of what she holds: at E6 in Fever she may hold two.
              party.setEnergy(me, Math.max(0, party.get(me).energy - MAX_ENERGY))
              if (timeline.has(ally)) timeline.advance(ally, 1)
              party.gainEnergy(ally, s.ultEnergyShare * party.get(ally).maxEnergy, { fixed: true })
              modifiers.apply({ id: GUEST_MODIFIER, target: ally, source: me, duration: { turns: GUEST_TURNS, tick: 'turnStart' } })
              party.gainEnergy(me, ULT_ENERGY)
            })
          },
        },
      },

      quantities: {
        vibes: () => vibes,
        songbirds: () => members,
        fever: () => fever,
        e1_tally: () => tally,
        groove: () => groove,
      },

      // Her own attacks, and the Songbirds' (priced as hers): the live Fribbels switches.
      attackerState: () => ({
        injectedBuffs: fever ? levelBuff('DEF_PEN', zoneDefPenDelta, 'team', 'Robin Zone DEF PEN') : [],
        characterConditionals: {
          feverState: fever,
          vibes: Math.min(vibes, cap),
          songbirdCount: members,
          deviatedChordCdBuff: chordUp(songbirdsActing ? songbirds : me),
          e2ResPen: e >= 2,
          e4MemoSpdBuff: e >= 4 && fever,
          e6MemoSkillBuff: e >= 6,
          techniqueDmgBuff: !songbirdsActing && modifiers.has(me, TECHNIQUE_MODIFIER),
        },
      }),

      teammateState: (attacker: Member): TeammateState => {
        const holder = attacker.key
        const up = chordUp(holder)
        const atkBranch = (branch.get(holder) ?? 'atk') === 'atk'
        return {
          injectedBuffs: fever ? levelBuff('DEF_PEN', zoneDefPenDelta, 'team', 'Robin Zone DEF PEN') : [],
          characterConditionals: {
            feverState: fever,
            vibes: Math.min(vibes, cap),
            songbirdCount: members,
            // An ATK Chord of 0 HP gives nothing; the other branch is only chosen for a lower-ATK holder.
            teammateHPValue: up && atkBranch ? maxHp : 0,
            deviatedChordBranch: up && !atkBranch ? CHORD_BRANCH_CD : CHORD_BRANCH_ATK,
            techniqueDmgBuff: modifiers.has(holder, TECHNIQUE_MODIFIER),
            e2ResPen: e >= 2,
          },
        }
      },

      onBattleStart: ({ techniques }) => {
        readMaxHp()
        for (const member of battle.members) refreshBranch(member.key)
        if (!techniques) return
        // Technique (We Are the Melody): 20% advance, 6 Vibes, all allies' DMG +30% for 2 turns.
        timeline.advance(me, START_ADVANCE)
        vibes = Math.min(cap, vibes + TECHNIQUE_VIBES)
        for (const member of battle.members) {
          modifiers.apply({ id: TECHNIQUE_MODIFIER, target: member.key, source: me, duration: { turns: TECHNIQUE_TURNS, tick: 'turnEnd' } })
        }
      },
    }
  },
}
