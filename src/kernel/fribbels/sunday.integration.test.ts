import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { Battle } from '../../battle/battle'
import type { MemberSetup } from '../../battle/battle'
import type { EngineEvents } from '../../engine'
import { loadEnemyProfile } from '../../enemy/profile'
import { PastAndFuture } from '../../equipment/pastAndFuture'
import { Acheron } from '../../kits/acheron'
import { JingYuan } from '../../kits/jingYuan'
import { Sunday, sundayScalings } from '../../kits/sunday'
import type { DamageKernel, DamageRequest, DamageResult, InjectedBuff, KernelBuild } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Sunday through the real kernel. What these pin:
 * - His own Basic ATK is Fribbels' BASIC hit 0 for the same state (E0 and E3, 1, 3 and 5 enemies).
 * - Every buff he gives a teammate reaches that teammate's price with its live value, never Fribbels' teammate defaults
 *   (which have every buff on): the request the battle really sends is captured, and its price is compared with the same
 *   request carrying the text's numbers as injected buffs (K15a) on top of Sunday's switches all off. For a teammate without a
 *   summon (Acheron) and with one (Jing Yuan: his Basic ATK and Lightning-Lord's Follow-Up).
 * - Past and Future: only the next ally's turn.
 */

const acheronBuild: KernelBuild = {
  relicSet1: Sets.PioneerDiverOfDeadWaters,
  relicSet2: Sets.PioneerDiverOfDeadWaters,
  ornamentSet: Sets.IzumoGenseiAndTakamaDivineRealm,
  body: Stats.CR,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 12, [Stats.CD]: 8 },
}
const jyBuild: KernelBuild = {
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.InertSalsotto,
  body: Stats.CR,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 12, [Stats.CD]: 8 },
}
const sundayBuild: KernelBuild = {
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.InertSalsotto,
  body: Stats.CD,
  feet: Stats.SPD,
  planarSphere: Stats.HP_P,
  linkRope: Stats.ERR,
  substatRolls: { [Stats.CD]: 12, [Stats.SPD]: 8, [Stats.RES]: 4 },
}
const profile = loadEnemyProfile('generic-moc')
const PAST_AND_FUTURE = '21025'

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

/** Records every request the battle sends (the battle caches by request, so only distinct ones arrive). */
class Spy implements DamageKernel {
  calls: DamageRequest[] = []
  constructor(private readonly inner: DamageKernel) {}
  actionDamage(request: DamageRequest): DamageResult {
    this.calls.push(request)
    return this.inner.actionDamage(request)
  }
  /** The newest request for an attacker character. */
  last(characterId: string): DamageRequest {
    const found = [...this.calls].reverse().find((r) => r.attacker.characterId === characterId)
    if (!found) throw new Error(`no request for ${characterId}`)
    return found
  }
}

const SUNDAY_ID = '1313'
const sunday = (eidolon: number, superimposition = 5): MemberSetup => ({
  key: 'sunday',
  kit: Sunday,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 134 },
  kernel: { unit: { characterId: SUNDAY_ID, lightConeId: PAST_AND_FUTURE, eidolon, superimposition }, build: sundayBuild },
  equipment: { lightCone: PastAndFuture, sets: [] },
})
const acheron = (): MemberSetup => ({
  key: 'acheron',
  kit: Acheron,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 101 },
  kernel: { unit: { characterId: '1308', lightConeId: '23024', eidolon: 0, superimposition: 1 }, build: acheronBuild },
})
const jy = (): MemberSetup => ({
  key: 'jy',
  kit: JingYuan,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: '1204', lightConeId: '21034', eidolon: 0, superimposition: 4 }, build: jyBuild },
})

function setup(eidolon: number, options: { enemies?: number, techniques?: boolean, cycles?: number } = {}) {
  const spy = new Spy(kernel)
  const members = [sunday(eidolon), acheron(), jy()]
  const battle = new Battle({
    members,
    policy: members.map((m) => ({ unit: m.key, use: 'basic' as const, when: [] })),
    profile,
    enemyCount: options.enemies ?? 1,
    weaknesses: 'all',
    cycles: options.cycles ?? 2,
    start: { energy: 0, skillPoints: 5, techniques: options.techniques ?? false },
    kernel: spy,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  const act = battle.member('sunday').instance.actions
  if (options.techniques) battle.member('sunday').instance.onBattleStart!({ techniques: true })
  return { battle, spy, dealt, members, act, enemies: options.enemies ?? 1 }
}

const sum = (dealt: EngineEvents['damageDealt'][], ability: string, attacker?: string) =>
  dealt.filter((d) => d.ability === ability && (attacker === undefined || d.attacker === attacker)).reduce((total, d) => total + d.damage, 0)

const OFF = {
  skillDmgBuff: false,
  talentCrBuffStacks: 0,
  beatified: false,
  teammateCDValue: 0,
  techniqueDmgBuff: false,
  e1DefPen: false,
  e2DmgBuff: false,
  e6CrToCdConversion: false,
}

/** The request with Sunday's teammate state switched fully off (and Past and Future's), to put the text's numbers on instead. */
function withSundayOff(request: DamageRequest): DamageRequest {
  return {
    ...request,
    teammates: request.teammates.map((t) =>
      t.characterId === SUNDAY_ID ? { ...t, characterConditionals: { ...OFF }, lightConeConditionals: { postSkillDmgBuff: false } } : t),
  }
}
const sundayIn = (request: DamageRequest) => request.teammates.find((t) => t.characterId === SUNDAY_ID)!
const withBuffs = (request: DamageRequest, injectedBuffs: InjectedBuff[]): DamageRequest => ({
  ...request,
  injectedBuffs: [...(request.injectedBuffs ?? []), ...injectedBuffs],
})

interface TextState {
  eidolon: number
  skill: boolean
  summon: boolean
  stacks: number
  beatified: boolean
  sundayCd: number
  technique: boolean
  past: boolean
  /** The attacker's final CRIT Rate, for E6's conversion. */
  attackerCr: number
}

/** What Sunday gives, from the in-game text, as injected buffs. `ability` limits DEF PEN to the ability kind it is priced as. */
function textBuffs(s: TextState, ability: string): InjectedBuff[] {
  const n = sundayScalings(s.eidolon)
  const team = (stat: InjectedBuff['stat'], value: number, extra: Partial<InjectedBuff> = {}): InjectedBuff => ({ stat, value, target: 'team', label: 'text', ...extra })
  const buffs: InjectedBuff[] = []
  if (s.skill) buffs.push(team('DMG_PERCENT', n.skillDmg + (s.summon ? n.skillDmgSummon : 0)))
  // E1: the target 16% DEF ignored, its summon 40%; the Lightning-Lord's Follow-Up is the summon's.
  if (s.skill && s.eidolon >= 1) buffs.push(team('DEF_PEN', ability === 'FUA' && s.summon ? 0.4 : 0.16))
  if (s.stacks > 0) buffs.push(team('CRIT_RATE', n.talentCritRate * s.stacks))
  if (s.beatified) {
    buffs.push(team('CRIT_DMG', n.ultCritDmgShare * s.sundayCd + n.ultCritDmgFlat))
    if (s.eidolon >= 2) buffs.push(team('DMG_PERCENT', 0.3))
  }
  if (s.technique) buffs.push(team('DMG_PERCENT', 0.5))
  if (s.past) buffs.push(team('DMG_PERCENT', 0.32))
  // E6: while the Talent's boost is on, 2% CRIT DMG for every 1% of CRIT Rate above 100%. Only on the target itself.
  if (s.eidolon >= 6 && s.stacks > 0 && ability === 'BASIC') {
    buffs.push(team('CRIT_DMG', Math.max(0, Math.floor((s.attackerCr - 1) / 0.01 + 1e-9)) * 0.02))
  }
  return buffs
}

describe("Sunday's own hit, priced as Fribbels prices it", () => {
  it('Basic ATK equals the kernel number for the same state at E0 and E3, on 1, 3 and 5 enemies', () => {
    for (const eidolon of [0, 3]) {
      for (const enemies of [1, 3, 5]) {
        const { dealt, act, members } = setup(eidolon, { enemies })
        act.basic!.use()
        const expected = kernel.actionDamage({
          attacker: { ...members[0]!.kernel.unit },
          teammates: members.slice(1).map((m) => ({ ...m.kernel.unit })),
          build: sundayBuild,
          enemy: { count: enemies, level: profile.level, maxToughness: profile.toughness, resistance: profile.res, elementalWeak: true, weaknessBroken: false },
        })
        // A single-target hit: one enemy takes it, whatever the enemy count.
        expect(sum(dealt, 'BASIC'), `E${eidolon} x${enemies}`).toBeCloseTo(expected.damage.BASIC!, 6)
        expect(expected.hits.BASIC).toHaveLength(1)
        expect(expected.hits.BASIC![0]!.scaling).toBeCloseTo(eidolon >= 3 ? 1.1 : 1.0, 12)
      }
    }
  })
})

describe('what he gives a teammate reaches the price, live', () => {
  /** Acts the way the scenario says on `target` and prices the target's Basic ATK; returns the request and the dealt damage. */
  function scenario(
    eidolon: number,
    target: 'acheron' | 'jy',
    steps: { skills?: number, ultimate?: boolean, technique?: boolean } = {},
  ) {
    const s = setup(eidolon, { techniques: steps.technique })
    for (let i = 0; i < (steps.skills ?? 1); i++) s.act.skill!.use(target)
    if (steps.ultimate) {
      s.battle.party.setEnergy('sunday', 130)
      s.act.ultimate!.use(target)
    }
    s.spy.calls.length = 0
    s.battle.member(target).instance.actions.basic!.use()
    const characterId = target === 'jy' ? '1204' : '1308'
    const request = s.spy.last(characterId)
    return { ...s, request, characterId }
  }

  const stateOf = (eidolon: number, target: 'acheron' | 'jy', s: ReturnType<typeof scenario>, extra: Partial<TextState> = {}): TextState => {
    const result = kernel.actionDamage(s.request)
    const sundayCd = kernel.actionDamage({
      attacker: { ...s.members[0]!.kernel.unit },
      teammates: [],
      build: sundayBuild,
      enemy: s.request.enemy!,
    }).stats.CD
    expect(s.battle.combatStats('sunday').CD, 'the CRIT DMG the kit reads is the kernel\'s for him').toBeCloseTo(sundayCd, 9)
    return {
      eidolon,
      skill: true,
      summon: target === 'jy',
      stacks: 1,
      beatified: false,
      sundayCd,
      technique: false,
      past: false,
      attackerCr: result.stats.CR,
      ...extra,
    }
  }

  const closeTo = (actual: number, expected: number) => expect(actual / expected).toBeCloseTo(1, 9)

  for (const target of ['acheron', 'jy'] as const) {
    describe(`target ${target}${target === 'jy' ? ' (has a summon)' : ''}`, () => {
      it('the Skill: the request carries the live switches, and the price is the text\'s 30% DMG, 20% CRIT Rate (and 50% with a summon)', () => {
        for (const eidolon of [0, 1, 5]) {
          const s = scenario(eidolon, target)
          expect(sundayIn(s.request).characterConditionals, `E${eidolon}`).toEqual({
            ...OFF,
            skillDmgBuff: true,
            talentCrBuffStacks: 1,
            e1DefPen: eidolon >= 1,
          })
          const live = kernel.actionDamage(s.request)
          expect(sum(s.dealt, 'BASIC', target)).toBeCloseTo(live.damage.BASIC!, 6)
          const state = stateOf(eidolon, target, s)
          const text = kernel.actionDamage(withBuffs(withSundayOff(s.request), textBuffs(state, 'BASIC')))
          closeTo(live.damage.BASIC!, text.damage.BASIC!)
          // ... and it is not the kernel's default, which would count every teammate buff as on.
          const defaults = kernel.actionDamage({ ...s.request, teammates: s.request.teammates.map((t) => (t.characterId === SUNDAY_ID ? { ...t, characterConditionals: undefined, lightConeConditionals: undefined } : t)) })
          expect(defaults.damage.BASIC).toBeGreaterThan(live.damage.BASIC! * 1.05)
        }
      })

      it("Lightning-Lord's Follow-Up price matches the text for a summon: the Skill's 80% and E1's 40% DEF ignored", () => {
        if (target !== 'jy') return
        for (const eidolon of [0, 1, 5]) {
          const s = scenario(eidolon, target)
          const live = kernel.actionDamage(s.request)
          const state = stateOf(eidolon, target, s)
          const text = kernel.actionDamage(withBuffs(withSundayOff(s.request), textBuffs(state, 'FUA')))
          closeTo(live.damage.FUA!, text.damage.FUA!)
        }
      })

      it('the Ultimate: Beatified with his live CRIT DMG, E2 on The Beatified only', () => {
        for (const eidolon of [0, 2, 3]) {
          const s = scenario(eidolon, target, { ultimate: true })
          const state = stateOf(eidolon, target, s, { stacks: 1, beatified: true })
          const c = sundayIn(s.request).characterConditionals!
          expect(c, `E${eidolon}`).toMatchObject({ beatified: true, e2DmgBuff: eidolon >= 2, skillDmgBuff: true })
          expect(c.teammateCDValue).toBeCloseTo(state.sundayCd, 9)
          const live = kernel.actionDamage(s.request)
          const text = kernel.actionDamage(withBuffs(withSundayOff(s.request), textBuffs(state, 'BASIC')))
          closeTo(live.damage.BASIC!, text.damage.BASIC!)
        }
      })

      it('E6: three stacks and the CRIT Rate over 100% turned into CRIT DMG', () => {
        const s = scenario(6, target, { skills: 2, ultimate: true })
        const c = sundayIn(s.request).characterConditionals!
        expect(c).toMatchObject({ talentCrBuffStacks: 3, e6CrToCdConversion: true, beatified: true })
        const live = kernel.actionDamage(s.request)
        expect(live.stats.CR, 'the build is over 100% CRIT Rate for the conversion to show').toBeGreaterThan(1)
        const state = stateOf(6, target, s, { stacks: 3, beatified: true })
        const text = kernel.actionDamage(withBuffs(withSundayOff(s.request), textBuffs(state, 'BASIC')))
        closeTo(live.damage.BASIC!, text.damage.BASIC!)
        // The conversion is real: without it the price is lower.
        const noConversion = kernel.actionDamage({
          ...s.request,
          teammates: s.request.teammates.map((t) => (t.characterId === SUNDAY_ID ? { ...t, characterConditionals: { ...t.characterConditionals, e6CrToCdConversion: false } } : t)),
        })
        expect(noConversion.damage.BASIC).toBeLessThan(live.damage.BASIC!)
      })

      it('the Technique: 50% DMG on the first ability only', () => {
        const s = scenario(0, target, { technique: true })
        expect(sundayIn(s.request).characterConditionals).toMatchObject({ techniqueDmgBuff: true, skillDmgBuff: true })
        const live = kernel.actionDamage(s.request)
        const state = stateOf(0, target, s, { technique: true })
        const text = kernel.actionDamage(withBuffs(withSundayOff(s.request), textBuffs(state, 'BASIC')))
        closeTo(live.damage.BASIC!, text.damage.BASIC!)
      })
    })
  }

  it('an ally that was not the target gets none of it (Fribbels would give it all of it)', () => {
    const s = scenario(6, 'acheron', { skills: 2, ultimate: true })
    s.spy.calls.length = 0
    s.battle.member('jy').instance.actions.basic!.use()
    const request = s.spy.last('1204')
    expect(sundayIn(request).characterConditionals).toEqual({ ...OFF })
    expect(sundayIn(request).lightConeConditionals).toEqual({ postSkillDmgBuff: false })
    const defaults = kernel.actionDamage({ ...request, teammates: request.teammates.map((t) => (t.characterId === SUNDAY_ID ? { ...t, characterConditionals: undefined, lightConeConditionals: undefined } : t)) })
    const live = kernel.actionDamage(request)
    expect(defaults.damage.BASIC).toBeGreaterThan(live.damage.BASIC! * 1.2)
  })
})

describe('timing through a battle: the buffs are on exactly as long as the text says', () => {
  it('the Skill lasts 2 of the target turns, the Past and Future buff 1 (the first), the Talent 3', () => {
    const { battle, spy, dealt, act } = setup(0, { cycles: 4 })
    act.skill!.use('acheron')
    const seen: Array<{ turn: number, state: Record<string, number | boolean>, lc: Record<string, number | boolean> | undefined, damage: number, expected: number }> = []
    let before = 0
    battle.timeline.bus.on('actionUsed', (a) => {
      if (a.actor !== 'acheron' || a.kind !== 'basic') return
      const request = spy.last('1308')
      const s = sundayIn(request)
      const mine = dealt.filter((d) => d.attacker === 'acheron' && d.ability === 'BASIC').slice(before)
      before += mine.length
      seen.push({ turn: seen.length + 1, state: s.characterConditionals!, lc: s.lightConeConditionals, damage: mine.reduce((t, d) => t + d.damage, 0), expected: kernel.actionDamage(request).damage.BASIC! })
    })
    battle.run()
    expect(seen.length).toBeGreaterThanOrEqual(4)
    expect(seen.slice(0, 4).map((t) => [t.state.skillDmgBuff, t.state.talentCrBuffStacks, t.lc?.postSkillDmgBuff])).toEqual([
      [true, 1, true],
      [true, 1, false],
      [false, 1, false],
      [false, 0, false],
    ])
    // Each turn's damage is Fribbels' number for the state it was priced in, and the state falls turn by turn.
    for (const t of seen.slice(0, 4)) expect(t.damage, `turn ${t.turn}`).toBeCloseTo(t.expected, 6)
    expect(seen[0]!.damage).toBeGreaterThan(seen[1]!.damage)
    expect(seen[1]!.damage).toBeGreaterThan(seen[2]!.damage)
    expect(seen[2]!.damage).toBeGreaterThan(seen[3]!.damage)
  })
})

describe('memosprite damage is priced in the owner\'s request with the same switches', () => {
  const castorice = (sundayState: Record<string, number | boolean>, lc: boolean): DamageRequest => ({
    attacker: { characterId: '1407', lightConeId: '21034', eidolon: 0, superimposition: 1 },
    teammates: [{ ...sunday(6).kernel.unit, characterConditionals: sundayState, lightConeConditionals: { postSkillDmgBuff: lc } }],
    build: jyBuild,
    enemy: { count: 1, level: profile.level, maxToughness: profile.toughness, resistance: profile.res, elementalWeak: true, weaknessBroken: false },
  })

  it('the Skill, Talent, Beatified and E2 buffs reach MEMO_SKILL and MEMO_TALENT hits exactly as the text gives them', () => {
    const live = kernel.actionDamage(castorice({ ...OFF, skillDmgBuff: true, e1DefPen: true, talentCrBuffStacks: 3, beatified: true, teammateCDValue: 2.5, e2DmgBuff: true }, true))
    const plain = kernel.actionDamage(castorice({ ...OFF }, false))
    const n = sundayScalings(6)
    const text = kernel.actionDamage(withBuffs(castorice({ ...OFF }, false), [
      { stat: 'DMG_PERCENT', value: n.skillDmg + n.skillDmgSummon + 0.3 + 0.32, target: 'team' },
      { stat: 'DEF_PEN', value: 0.4, target: 'team' },
      { stat: 'CRIT_RATE', value: n.talentCritRate * 3, target: 'team' },
      { stat: 'CRIT_DMG', value: n.ultCritDmgShare * 2.5 + n.ultCritDmgFlat, target: 'team' },
    ]))
    const kinds = ['MEMO_SKILL', 'MEMO_TALENT'].filter((k) => plain.damage[k] !== undefined && plain.damage[k]! > 0)
    expect(kinds.length, 'the kernel prices memosprite hits for this owner').toBeGreaterThan(0)
    for (const k of kinds) {
      expect(live.damage[k]!, k).toBeGreaterThan(plain.damage[k]! * 1.5)
      expect(live.damage[k]! / text.damage[k]!, k).toBeCloseTo(1, 9)
    }
  })
})
