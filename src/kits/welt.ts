import { certain } from '../battle/battle'
import type { Battle, HitPart, Member } from '../battle/battle'
import type { TurnInfo, UnitId } from '../engine/events'
import { levelsOf } from '../levels/levels'
import type { Kit, KitInstance } from './kit'

/**
 * Welt, buffed version 1 (game id 1004, `ability_version` 1, Fribbels id 1004b1), from the 4.7.0 in-game text
 * (`node tools/gamedata/kit-text.mjs 1004 --version 1`). All traces are taken as unlocked, as Fribbels does.
 * Everything scales on ATK. Abilities are at the kit text's levels: no eidolon gives Basic 100%, Skill 72%,
 * Ultimate 150%, Talent 100%; E3 raises the Basic ATK to 110% and the Skill to 79.2% (the Lv7 / Lv12 lines), E5 the
 * Ultimate to 162% (and its Imprison delay from 12% to 13.2%) and the Talent to 110%.
 *
 * - Energy 120. Basic ATK: +20 energy, +1 Skill Point. Skill: +30 energy in total, -1 Skill Point. Ultimate: costs 120,
 *   +5 energy, +5 more from the Punishment trace. Retribution trace: +30 energy at the start of battle. All are
 *   scaled by Energy Regeneration Rate, as the other kits' battle-start and trace energy is (the text does not
 *   call it flat).
 * - Basic ATK: one hit on the designated enemy (the primary target, K2 and K3).
 * - Skill (Edge of the Void): one hit on the designated enemy, then 4 hits on random enemies, all at the same
 *   multiple, each hit slowing its target 10% for 2 turns. The Judgment trace adds one Additional DMG instance
 *   (120% of the Skill multiple) on the designated enemy.
 *   IN-GAME CHECK: the Skill's energy. The game data prints it per hit for a multi-hit ability (the original Skill +10 over
 *   3 hits, this one +6 over 5 hits, both 30 in total), so the Skill gives 30, not the 6 the printed line shows. Read as
 *   the total; if the +6 is per use, set `SKILL_ENERGY` to 6.
 * - Ultimate (Synthetic Black Hole): AoE, then Imprison every enemy for 1 turn (delay 12% once, SPD -10%), then
 *   the Weightless state on every enemy for 2 turns.
 * - Weightless (Ultimate and Talent): DEF -40% and SPD -5% on the enemy; allies that attack it gain a Retribution
 *   stack (+10% DMG, up to 10, 2 turns); every attack on it delays it 4%, at most 8 times per target per turn.
 *   E4: its All-Type RES -30%.
 * - Talent (Time Distortion): attacking an enemy that is already Slowed deals Additional DMG (100% ATK, 110% at
 *   E5), once per hit. E2: +3 energy each time it triggers. E1: after a Skill or Ultimate hits a Weightless
 *   target, 40% of the Ultimate multiple as Additional DMG, once per target per attack. E6: Skill and Ultimate
 *   hits on a Slowed enemy get +30% CRIT Rate and +60% CRIT DMG (not the Additional DMG).
 * - Technique: Imprison every enemy at the start of battle (delay 20%, SPD -10%, 1 turn).
 *
 * How the hits are priced (K11): Fribbels builds BASIC as [Basic hit, Judgment, Talent], SKILL as [Skill hit,
 * Judgment, Talent, E1] and ULT as [Ultimate hit, Talent, E1]. The kit keeps those positions fixed (it always
 * tells the kernel `enemySlowed` and the Judgment trace are on) and deals only the parts that apply, so a hit's
 * index never depends on the enemy's state. Each part's multiple is the text's, times the expected number of
 * hits (random hits are split over the enemies, K2 and K17).
 *
 * Slowed means an enemy has any SPD reduction: his Skill's slow, Imprison, Weightless, another unit's slow, or a
 * weakness break's Imprisonment (K24: the same Imprisoned state as his own Imprison). Settled: any debuff counts as "debuffed"
 * for his light cone, SPD reductions included. A debuff lands after the damage that applies it, like every other debuff in
 * this repo, and Slowed is read before it.
 *
 * Expected-value debuffs (DESIGN.md, K22). The Skill's 4 random hits are each a hit on one random enemy, so its slow is on
 * each enemy at the chance a hit landed there (the designated enemy's, 1). Slowed is therefore a probability
 * (`Battle.anyPresent`): E6's CRIT bonus is a kernel switch priced in each debuff state and weighted (K21), and the Talent's
 * Additional DMG is a part with a `worldWeight` of 1 in the states where the enemy is Slowed and 0 in the others, so it is priced
 * in the states that trigger it (a hit that only exists on a Slowed enemy has that enemy's debuffed price, not the average
 * price over states). The energy and the counts that E2 reads use the chance itself (linear).
 *
 * Later hits see earlier hits' slow. The Skill is dealt one hit at a time, each its own `battle.attack` call, with the slow
 * of that hit applied before the next: the engine already shows a debuff to every attack call after it, so no engine rule
 * is needed (parts of one call are priced together, in the same state, and stay so). A hit on an enemy that an earlier hit
 * slowed (the designated hit slows its enemy for certain; each random hit slows the enemy it lands on at its chance) is
 * priced as against a Slowed enemy: the Talent's Additional DMG and E6 follow the chance it is slowed by then. Its own
 * slow lands after its damage. The Ultimate's second hit is NOT given the Imprison: the text deals one instance of damage
 * and then Imprisons "hit enemy targets" (the 10% / 90% split is Fribbels' convention for the Talent's two triggers), so both
 * hits are priced before the Imprison.
 *
 * Toughness (K7), internal units from `node tools/gamedata/kit-text.mjs 1004 --version 1` ("toughness a/b/c": the
 * designated target / every enemy / adjacent): Basic 30, Skill 30 on the designated target, Ultimate 60 to every
 * enemy (Fribbels: `toughnessDmg` 10, 10 + 10 per extra hit and 20, times 3). He follows weaknesses.
 *
 * His Imprison and a break's Imprisonment are one shared Imprisoned state (K24, `Battle.imprison`): applying it again refreshes
 * it and never stacks the -10% SPD, while each source's delay is applied separately, as the text says.
 *
 * NOT MODELLED:
 * - The Special Dimension's 50% movement-speed cut (it does nothing to the timeline).
 * - Additional DMG is told apart from an attack by the part's `additional` flag (`HitPart.additional`): a part that
 *   carries it is not counted for the Weightless delay and Retribution, and an attack call made only of such parts is
 *   not an ally attacking. A kit that deals Additional DMG without the flag would be counted as an attack.
 *
 * Approximations:
 * - A Retribution stack is gained by the attacker when an action hits a Weightless enemy; the chance of that is
 *   the largest chance, over the Weightless enemies the action reaches, that it hit the enemy at least once (the chances of
 *   the action's attack calls combined as independent).
 *
 * IN-GAME CHECK notes mark the readings Smitty will check in game.
 */

const MAX_ENERGY = 120
const BASIC_ENERGY = 20
const SKILL_ENERGY = 30
const ULT_ENERGY = 5
/** Punishment trace: "when using Ultimate, additionally restores 5 Energy". */
const ULT_TRACE_ENERGY = 5
/** Retribution trace: "at the start of the battle, Welt regenerates 30 Energy". */
const START_ENERGY = 30
/** E2: "when his Talent is triggered, Welt regenerates 3 Energy". */
const E2_ENERGY = 3

const SKILL_EXTRA_HITS = 4

/** Toughness per part, internal units (see the header). */
const TOUGHNESS_BASIC = 30
const TOUGHNESS_SKILL_HIT = 30
const TOUGHNESS_ULT = 60

const SLOW = 0.1
const SLOW_TURNS = 2
const TECHNIQUE_DELAY = 0.2
const WEIGHTLESS_TURNS = 2
const WEIGHTLESS_SLOW = 0.05
const WEIGHTLESS_ATTACK_DELAY = 0.04
const WEIGHTLESS_DELAY_CAP = 8
const RETRIBUTION_TURNS = 2
const MAX_RETRIBUTION = 10
const E1_SHARE_OF_ULT = 0.4
/** Judgment trace: Additional DMG as a share of the Basic ATK / Skill multiple. */
const JUDGMENT_BASIC = 0.8
const JUDGMENT_SKILL = 1.2
/**
 * Fribbels treats the Ultimate as two hits (10% / 90%) so that the Talent triggers twice (WeltB1.ts, "Ult has 2
 * hits"). The split is not in the kit text.
 * IN-GAME CHECK: the Ultimate's two hits, which sets how often the Talent triggers on it (and Weightless's delay).
 */
const ULT_HIT_SPLIT = [0.1, 0.9] as const

const SKILL_SLOW = 'welt.skill_slow'
const WEIGHTLESS = 'welt.weightless'
const RETRIBUTION = 'welt.retribution'
/** The Skill's random hits are one random-target group per hit (K17). */
const SKILL_GROUP = 'welt.skill'

/** Positions in Fribbels' hit lists (see the header). */
export const WELT_HITS = {
  BASIC: { main: 0, judgment: 1, talent: 2 },
  SKILL: { main: 0, judgment: 1, talent: 2, e1: 3 },
  ULT: { main: 0, talent: 1, e1: 2 },
} as const

/** Ability multiples by eidolon. E3 raises the Basic ATK and Skill, E5 the Ultimate and Talent. */
export function weltScalings(eidolon: number) {
  return {
    basic: eidolon >= 3 ? 1.1 : 1.0,
    skill: eidolon >= 3 ? 0.792 : 0.72,
    ult: eidolon >= 5 ? 1.62 : 1.5,
    /** Per Talent Additional DMG instance. */
    talent: eidolon >= 5 ? 1.1 : 1.0,
    /** The share of a full gauge the Ultimate's Imprison delays an enemy. */
    imprisonDelay: eidolon >= 5 ? 0.132 : 0.12,
  }
}

/**
 * How many of an attack's hits (expected number) reach `enemy`, counting parts of kernel hit 0 only, and the
 * chance that at least one does. Random parts count as the expected share they stand for.
 */
export function reachOfParts(battle: Battle, parts: readonly HitPart[], enemy: UnitId): { hits: number, chance: number } {
  const ids = battle.enemies.ids
  let hits = 0
  let certain = false
  /** Per random group: the hits it stands for and the per-hit chance that one lands on `enemy`. */
  const groups = new Map<string, { hits: number, perHit: number }>()
  const addRandom = (key: string, n: number, chance: number) => {
    const group = groups.get(key) ?? { hits: n, perHit: 0 }
    group.perHit += chance
    groups.set(key, group)
    hits += n * chance
  }
  parts.forEach((part, index) => {
    if (part.additional === true || !(part.scaling > 0)) return
    const reaches = (target: UnitId, adjacent: number | undefined): boolean =>
      target === enemy || (adjacent !== undefined && adjacent > 0 && battle.adjacentEnemies(target).includes(enemy))
    switch (part.shape) {
      case 'single':
      case 'blast': {
        const adjacent = part.shape === 'blast' ? part.adjacent : undefined
        if (!reaches(part.target ?? battle.primary, adjacent)) return
        if (part.random === undefined) {
          hits += 1
          certain = true
        } else addRandom(`${index}:${part.random.group ?? 'random'}`, part.random.hits, part.random.chance)
        break
      }
      case 'aoe':
        hits += 1
        certain = true
        break
      case 'bounce':
        addRandom(`${index}:bounce`, part.hits, 1 / ids.length)
        break
    }
  })
  if (certain) return { hits, chance: 1 }
  let miss = 1
  for (const group of groups.values()) miss *= (1 - Math.min(1, group.perHit)) ** group.hits
  return { hits, chance: 1 - miss }
}

export const Welt: Kit = {
  characterId: '1004',
  path: 'Nihility',
  element: 'Imaginary',
  maxEnergy: MAX_ENERGY,
  // Written for the buffed kit (K13): the original Welt has a different kit and no Weightless.
  abilityVersions: [1],
  // Ability levels and major traces (K15, K15a): every ability and all three major traces.
  levelsModelled: { abilities: ['basic', 'skill', 'ult', 'talent'], majorTraces: [1, 2, 3] },

  create(battle: Battle, self: Member): KitInstance {
    const { timeline } = battle
    const me = self.key
    const e = self.eidolon
    // Ability levels and major traces (K15, K15a): multiples scale by the table's ratio. Retribution (B1: the DMG stacks and 30 start
    // energy), Judgment (B2: the Additional DMG on Basic ATK and Skill) and Punishment (B3: EHR to ATK, 5 energy on the Ultimate)
    // are switched off in the kit when locked. The Judgment hit stays in the kernel's list (the positions are fixed) and is not dealt.
    const lv = levelsOf(self)
    const base = weltScalings(e)
    const s = {
      ...base,
      basic: base.basic * lv.ratio('basic', '1100401', 0),
      skill: base.skill * lv.ratio('skill', '1100402', 0),
      ult: base.ult * lv.ratio('ult', '1100403', 0),
      talent: base.talent * lv.ratio('talent', '1100404', 0),
      imprisonDelay: base.imprisonDelay * lv.ratio('ult', '1100403', 1),
    }

    /** How many times each enemy has been delayed by Weightless since its last turn started. */
    const delaysThisTurn = new Map<UnitId, number>()
    /** Per action in progress, per Weightless enemy, the chance that no attack of the action has hit it yet (for the Retribution stack). */
    const retributionMiss = new Map<number, Map<UnitId, number>>()

    /** The chance the enemy is Weightless (1 or 0: Weightless is applied to every enemy). A kernel switch is `certain(...)`. */
    const weightless = (enemy: UnitId) => battle.presence(enemy, WEIGHTLESS)
    /** The chance the enemy is Slowed: any SPD reduction on it, whoever put it there. In a priced world exactly 0 or 1. */
    const slowed = (enemy: UnitId) => battle.anyPresent(enemy, (m) => m.spdPct < 0)
    const retribution = (ally: UnitId) => (lv.major(1) ? timeline.modifiers.get(ally, RETRIBUTION)?.stacks ?? 0 : 0)

    /** The Talent's Additional DMG on `enemy`: `scaling` where the enemy is Slowed, nothing where it is not (see the header). */
    const talentPart = (enemy: UnitId, scaling: number, hit: number, random?: HitPart['random']): HitPart => ({
      shape: 'single',
      target: enemy,
      scaling,
      hit,
      additional: true,
      worldWeight: () => (certain(slowed(enemy)) ? 1 : 0),
      ...(random !== undefined && { random }),
    })

    // IN-GAME CHECK: "While Imprisoned, actions delayed by 12%" read as one delay when the Imprisonment lands.
    const imprison = (enemy: UnitId, delay: number) => battle.imprison(enemy, me, delay, true)

    // Weightless: "when targets in Weightless state get attacked, their actions are delayed by 4%, up to 8 times
    // per target per turn". Read as per hit, so the cap means something against multi-hit attacks, by any ally,
    // with the count reset when the target's own turn starts. Allies only: nothing else attacks an enemy.
    // IN-GAME CHECK: whether "attacked" is per hit or per attack, and whose turn "per turn" counts.
    timeline.bus.on('turnStart', (turn: TurnInfo) => {
      delaysThisTurn.delete(turn.unit)
    })
    timeline.bus.on('attackResolved', ({ attacker, parts }) => {
      // Additional DMG is not an attack: an attack call whose parts are all flagged `additional` (Tribbie's Zone, Welt's own
      // Talent) does not count as an ally attacking.
      if (!battle.isAlly(attacker) || parts.every((part) => part.additional === true)) return
      const serial = battle.actionSerialInProgress
      for (const enemy of battle.enemies.ids) {
        if (!(weightless(enemy) > 0)) continue
        const { hits, chance } = reachOfParts(battle, parts, enemy)
        if (!(hits > 0)) continue
        if (serial !== undefined) {
          const misses = retributionMiss.get(serial) ?? new Map<UnitId, number>()
          misses.set(enemy, (misses.get(enemy) ?? 1) * (1 - chance))
          retributionMiss.set(serial, misses)
        }
        const used = delaysThisTurn.get(enemy) ?? 0
        const counted = Math.min(hits, WEIGHTLESS_DELAY_CAP - used)
        if (counted <= 0) continue
        delaysThisTurn.set(enemy, used + counted)
        timeline.delay(enemy, WEIGHTLESS_ATTACK_DELAY * counted)
      }
      // The Retribution stack counts the enemy as it is when hit (Weightless is applied after his own Ultimate).
    })

    // Retribution: "when ally targets attack targets under the Weightless state, their DMG dealt increases by 10%,
    // stacking up to 10 times, for 2 turns". One stack per attack (per action) that hit a Weightless enemy, given
    // after the action, so an attack does not benefit from the stack it earns. The stack is the attacker's own; a
    // summon's action counts for its owner. Fribbels' conditional is the stack count, applied to hits on Weightless
    // enemies only.
    // IN-GAME CHECK: per attack or per hit; whether the attack that earns it already benefits; the 2 turns counted
    // on the ally's own turns (not the one it was gained in).
    timeline.bus.on('actionUsed', (action) => {
      const misses = retributionMiss.get(action.serial)
      retributionMiss.delete(action.serial)
      if (misses === undefined || !battle.isAlly(action.actor) || !lv.major(1)) return
      const chance = 1 - Math.min(...misses.values())
      if (!(chance > 0)) return
      // A memosprite's attack is priced as its owner's, so the stack goes to the owner, whose state the kernel reads
      // (isAlly now covers memosprites, so this is where a memosprite actor would otherwise land on an id nothing reads).
      const holder = action.owner ?? action.actor
      timeline.modifiers.apply({
        id: RETRIBUTION,
        target: holder,
        source: me,
        stacks: Math.min(MAX_RETRIBUTION, retribution(holder) + chance),
        duration: { turns: RETRIBUTION_TURNS, tick: 'turnEnd' },
      })
    })

    /** E2: 3 energy per Talent trigger (per Additional DMG instance), as an expected number. */
    const talentTriggered = (instances: number) => {
      if (e >= 2 && instances > 0) battle.party.gainEnergy(me, E2_ENERGY * instances)
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
              const target = battle.primary
              const triggers = slowed(target)
              battle.attack({
                attacker: me,
                ability: 'BASIC',
                parts: [
                  { shape: 'single', target, scaling: s.basic, hit: WELT_HITS.BASIC.main, toughness: TOUGHNESS_BASIC },
                  ...(lv.major(2) ? [{ shape: 'single' as const, target, scaling: JUDGMENT_BASIC * s.basic, hit: WELT_HITS.BASIC.judgment, additional: true }] : []),
                  ...(triggers > 0 ? [talentPart(target, s.talent, WELT_HITS.BASIC.talent)] : []),
                ],
              })
              talentTriggered(triggers)
            }),
        },

        skill: {
          kind: 'skill',
          canUse: () => battle.skillPoints >= 1,
          use: () =>
            battle.performAction(me, 'skill', 'skill', () => {
              battle.spendSkillPoints(1)
              battle.party.gainEnergy(me, SKILL_ENERGY)
              const ids = battle.enemies.ids
              const count = ids.length
              const primary = battle.primary
              /** The chance that hit number `hit` (0 is the designated one, then the 4 random ones) lands on an enemy. */
              const lands = (hit: number, id: UnitId) => (hit === 0 ? (id === primary ? 1 : 0) : 1 / count)

              // One attack call per hit, so that a hit sees the slow the earlier hits left (see the header).
              let triggers = 0
              for (let hit = 0; hit <= SKILL_EXTRA_HITS; hit++) {
                const designated = hit === 0
                const parts: HitPart[] = designated
                  ? [
                      { shape: 'single', target: primary, scaling: s.skill, hit: WELT_HITS.SKILL.main, toughness: TOUGHNESS_SKILL_HIT },
                      ...(lv.major(2) ? [{ shape: 'single' as const, target: primary, scaling: JUDGMENT_SKILL * s.skill, hit: WELT_HITS.SKILL.judgment, additional: true }] : []),
                    ]
                  : ids.map((target): HitPart => ({
                      shape: 'single',
                      target,
                      scaling: s.skill / count,
                      hit: WELT_HITS.SKILL.main,
                      toughness: TOUGHNESS_SKILL_HIT / count,
                      random: { hits: 1, chance: 1 / count, group: SKILL_GROUP },
                    }))
                // The Talent: Additional DMG on each enemy this hit lands on while it is Slowed (read before this hit's own slow).
                for (const id of ids) {
                  const n = lands(hit, id) * slowed(id)
                  if (!(n > 0)) continue
                  triggers += n
                  // Rides on this hit's random landing: adds no chance of its own to hit an enemy.
                  parts.push(
                    talentPart(id, lands(hit, id) * s.talent, WELT_HITS.SKILL.talent, designated ? undefined : { hits: 1, chance: 0, group: SKILL_GROUP }),
                  )
                }
                battle.attack({ attacker: me, ability: 'SKILL', parts })

                // "On hit ... reduce the enemy's SPD by 10% for 2 turns": on each enemy at the chance this hit landed there.
                for (const id of ids) {
                  const chance = lands(hit, id)
                  if (!(chance > 0)) continue
                  battle.applyDebuff({
                    id: SKILL_SLOW,
                    target: id,
                    source: me,
                    spdPct: -SLOW,
                    chance,
                    duration: { turns: SLOW_TURNS, tick: 'turnEnd' },
                  })
                }
              }

              // E1: once per Weightless enemy the Skill reached, at the chance the Skill hit it at least once.
              if (e >= 1) {
                const reachedByRandom = 1 - (1 - 1 / count) ** SKILL_EXTRA_HITS
                const e1: HitPart[] = []
                for (const id of ids) {
                  const w = weightless(id)
                  if (!(w > 0)) continue
                  const reached = id === primary ? 1 : reachedByRandom
                  e1.push({
                    shape: 'single',
                    target: id,
                    scaling: E1_SHARE_OF_ULT * s.ult * w * reached,
                    hit: WELT_HITS.SKILL.e1,
                    additional: true,
                    ...(id !== primary && { random: { hits: 1, chance: 0 } }),
                  })
                }
                if (e1.length > 0) battle.attack({ attacker: me, ability: 'SKILL', parts: e1 })
              }
              talentTriggered(triggers)
            }),
        },

        ultimate: {
          kind: 'ultimate',
          canUse: () => battle.party.get(me).energy >= MAX_ENERGY,
          use: () =>
            battle.performAction(me, 'ultimate', 'ultimate', () => {
              battle.party.setEnergy(me, 0)
              const ids = battle.enemies.ids
              // Both hits are priced before the Imprison, which lands after the damage (see the header).
              const wasSlowed = new Map(ids.map((id) => [id, slowed(id)]))
              const wasWeightless = new Map(ids.map((id) => [id, weightless(id)]))

              battle.attack({
                attacker: me,
                ability: 'ULT',
                parts: ULT_HIT_SPLIT.map((share, i): HitPart => ({
                  shape: 'aoe',
                  scaling: s.ult * share,
                  hit: WELT_HITS.ULT.main,
                  ...(i === 0 && { toughness: TOUGHNESS_ULT }),
                })),
              })

              // The Talent triggers on each of the Ultimate's hits at a Slowed enemy, E1 once per Weightless enemy.
              const extras: HitPart[] = []
              let triggers = 0
              for (const id of ids) {
                const slow = wasSlowed.get(id)!
                if (slow > 0) {
                  extras.push(talentPart(id, s.talent * ULT_HIT_SPLIT.length, WELT_HITS.ULT.talent))
                  triggers += slow * ULT_HIT_SPLIT.length
                }
                const w = wasWeightless.get(id)!
                if (e >= 1 && w > 0) {
                  extras.push({ shape: 'single', target: id, scaling: E1_SHARE_OF_ULT * s.ult * w, hit: WELT_HITS.ULT.e1, additional: true })
                }
              }
              if (extras.length > 0) battle.attack({ attacker: me, ability: 'ULT', parts: extras })
              talentTriggered(triggers)

              battle.party.gainEnergy(me, ULT_ENERGY + (lv.major(3) ? ULT_TRACE_ENERGY : 0))

              // After the damage: Imprison every enemy hit, then Weightless on all of them.
              for (const id of ids) {
                imprison(id, s.imprisonDelay)
                battle.applyDebuff({
                  id: WEIGHTLESS,
                  target: id,
                  source: me,
                  spdPct: -WEIGHTLESS_SLOW,
                  duration: { turns: WEIGHTLESS_TURNS, tick: 'turnEnd' },
                })
              }
            }),
        },
      },

      quantities: {
        weightless: () => certain(weightless(battle.primary)),
        slowed: () => certain(slowed(battle.primary)),
        retribution_stacks: () => retribution(me),
      },

      attackerState: (enemy: UnitId) => ({
        characterConditionals: {
          // The Talent's hit stays in the kernel's list whatever the enemy; the kit decides whether it is dealt.
          enemySlowed: true,
          enemyWeightless: certain(weightless(enemy)),
          retributionDmgStacks: retribution(me),
          ehrToAtkBoost: lv.major(3),
          traceAdditionalDmg: true,
          skillExtraHits: SKILL_EXTRA_HITS,
          e1WeightlessAdditionalDmg: true,
          e4WeightlessResPen: true,
          // A boolean kernel switch: priced in each debuff state and weighted (K21, `Battle.kernelResult`).
          e6SlowedCrCdBoost: certain(slowed(enemy)),
        },
      }),

      // His team gets Weightless's DEF and RES shred and each ally's own Retribution stacks (Fribbels' teammate
      // content: enemyWeightless, retributionDmgStacks, e4WeightlessResPen; it checks the eidolon itself).
      teammateState: (attacker: Member, enemy: UnitId) => ({
        characterConditionals: {
          enemyWeightless: certain(weightless(enemy)),
          retributionDmgStacks: retribution(attacker.key),
          e4WeightlessResPen: true,
        },
      }),

      onBattleStart: ({ techniques }) => {
        if (lv.major(1)) battle.party.gainEnergy(me, START_ENERGY)
        // Technique: every enemy in the Special Dimension is Imprisoned on entering combat (delay 20%).
        if (techniques) for (const id of battle.enemies.ids) imprison(id, TECHNIQUE_DELAY)
      },
    }
  },
}
