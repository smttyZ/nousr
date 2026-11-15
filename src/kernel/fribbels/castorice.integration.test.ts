import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { Battle, CYRENE_KERNEL_ID } from '../../battle/battle'
import type { MemberSetup } from '../../battle/battle'
import type { EngineEvents } from '../../engine'
import { loadEnemyProfile } from '../../enemy/profile'
import { MakeFarewellsMoreBeautiful } from '../../equipment/makeFarewellsMoreBeautiful'
import { Castorice, castoriceScalings, cyreneBounceRate, NEWBUD_MAX } from '../../kits/castorice'
import type { Kit } from '../../kits/kit'
import type { ConditionalValues, DamageRequest, KernelBuild, KernelTeammate } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Castorice through the real kernel. What these pin, per hit as Fribbels prices it (the kernel returns each hit's damage and the
 * multiple it used, the battle asks the multiple the text gives and the kernel prices it per 100%):
 * - Basic ATK (BASIC hit 0), the Skill (SKILL hit 0) and Boneclaw (SKILL hits 0 and 1), Netherwing's Breath (MEMO_SKILL hit 0, at each
 *   launch's own live state) and Wings Sweep (MEMO_TALENT hit 0, one combined hit for the bounces), at E0, E3, E5 and E6.
 * - The kernel's own multiples equal the text's (so the kit asks what Fribbels uses).
 * - Every teammate effect with its live value: the Territory's RES PEN (`memospriteActive`) and Roar Rumbles the Realm's DMG
 *   (`teamDmgBoost`), against an explicit request, and the E1 factors the kit divides out.
 * - Cyrene's effect on her: the switch is live, and the per-100% price is the same with or without it.
 */

const build: KernelBuild = {
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.InertSalsotto,
  body: Stats.CD,
  feet: Stats.HP_P,
  planarSphere: Stats.Quantum_DMG,
  linkRope: Stats.HP_P,
  substatRolls: { [Stats.HP_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
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
const profile = loadEnemyProfile('generic-moc')
const ENEMY = { count: 1, level: profile.level, maxToughness: profile.toughness, resistance: profile.res, elementalWeak: true, weaknessBroken: false }
const LC = '23040'
const BIG = 1e6

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

const acheronUnit = { characterId: '1308', lightConeId: '23024', eidolon: 0, superimposition: 1 }
const casUnit = (eidolon: number) => ({ characterId: '1407', lightConeId: LC, eidolon, superimposition: 1 })

const basicKit: Kit = {
  characterId: '1308',
  path: 'Abundance',
  element: 'Lightning',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'basic', 'basic', () =>
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] }),
          ),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
}
const stubCyrene: Kit = {
  characterId: '1415',
  path: 'Remembrance',
  element: 'Ice',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: { basic: { kind: 'basic', canUse: () => true, use: () => battle.performAction(self.key, 'basic', 'basic', () => {}) } },
    attackerState: () => ({}),
    teammateState: () => ({}),
    onBattleStart: () => battle.setCyreneEffect('cas', true, self.key),
  }),
}

const cas = (eidolon: number): MemberSetup => ({
  key: 'cas',
  kit: Castorice,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: BIG, def: 1000, baseSpd: 90 },
  kernel: { unit: casUnit(eidolon), build },
  equipment: { lightCone: MakeFarewellsMoreBeautiful, sets: [] },
})
const acheron = (): MemberSetup => ({
  key: 'a',
  kit: basicKit,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: BIG, def: 1000, baseSpd: 80 },
  kernel: { unit: acheronUnit, build: acheronBuild },
})
const cyrene = (): MemberSetup => ({
  key: 'cyrene',
  kit: stubCyrene,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: BIG, def: 1000, baseSpd: 60 },
  kernel: { unit: { characterId: CYRENE_KERNEL_ID, lightConeId: '23024', eidolon: 0, superimposition: 1 }, build: acheronBuild },
})

function setup(eidolon: number, options: { enemies?: number, cyrene?: boolean } = {}) {
  const members = [cas(eidolon), acheron(), ...(options.cyrene ? [cyrene()] : [])]
  const battle = new Battle({
    members,
    policy: members.map((m) => ({ unit: m.key, use: 'basic', when: [] })),
    profile,
    enemyCount: options.enemies ?? 1,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0, skillPoints: 3, techniques: false },
    kernel,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (d) => dealt.push(d))
  for (const m of battle.members) m.instance.onBattleStart?.({ techniques: false })
  const q = (name: string) => battle.member('cas').instance.quantities![name]!()
  return { battle, dealt, q }
}
type Setup = ReturnType<typeof setup>
const use = (t: Setup, who: string, action: string) => t.battle.member(who).instance.actions[action]!.use()
const sum = (dealt: EngineEvents['damageDealt'][], ability: string) => dealt.filter((d) => d.ability === ability).reduce((n, d) => n + d.damage, 0)
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 5)

/** All the Newbud, by letting 'a' lose HP (also gives 3 Talent stacks); then the Ultimate. */
function summon(t: Setup) {
  t.battle.party.consumeHp('a', NEWBUD_MAX, 'a')
  use(t, 'cas', 'ultimate')
}

interface State {
  nw?: boolean
  talent?: number
  tier?: number
  westWind?: number
  team?: boolean
  cyrene?: boolean
  e1Low?: boolean
  flower?: boolean
}
/** Her request, written from the text's switches. */
const casRequest = (eidolon: number, s: State, mates: KernelTeammate[]): DamageRequest => ({
  attacker: {
    ...casUnit(eidolon),
    characterConditionals: {
      memospriteActive: s.nw ?? false,
      spdBuff: true,
      talentDmgStacks: s.talent ?? 0,
      memoSkillEnhances: s.tier ?? 1,
      memoTalentHits: eidolon >= 6 ? 9 : 6,
      teamDmgBoost: s.team ?? false,
      memoDmgStacks: s.westWind ?? 0,
      cyreneSpecialEffect: s.cyrene ?? false,
      e1EnemyHp50: s.e1Low ?? false,
      e6Buffs: eidolon >= 6,
    },
    lightConeConditionals: { deathFlower: s.flower ?? false },
  },
  teammates: mates,
  build,
  enemy: ENEMY,
})
const mates: KernelTeammate[] = [{ ...acheronUnit }]
/** What one 100% of the hit prices at, and the multiple Fribbels used for it. */
const hit = (r: DamageRequest, ability: string, index = 0) => {
  const h = kernel.actionDamage(r).hits[ability]![index]!
  return { perUnit: h.damage / h.scaling!, scaling: h.scaling! }
}
/**
 * The state of each of Netherwing's launches and of the Wings Sweep after them, as the text gives it (not read from the kit): each launch
 * that is paid for in HP is an HP loss of its own in its own turn (a Talent stack, up to 3, and Death Flower), the Ardent Will (E2 and
 * up, 2) pay for the first launches instead, the last launch takes it to 1 HP (one more loss), and Breath k is step min(k, 3) with
 * min(k, 6) West Wind stacks. From full HP: 3 paid launches, then the last one.
 */
function launchPlan(eidolon: number, talent0: number): { launches: State[], sweep: State } {
  let stacks = talent0
  let flower = false
  let ardent = eidolon >= 2 ? 2 : 0
  const total = 3 + ardent + 1
  const launches: State[] = []
  for (let k = 1; k <= total; k++) {
    if (k < total) {
      if (ardent > 0) ardent -= 1
      else {
        stacks = Math.min(3, stacks + 1)
        flower = true
      }
    }
    launches.push({ nw: true, talent: stacks, tier: Math.min(k, 3), westWind: Math.min(k, 6), team: true, flower })
  }
  stacks = Math.min(3, stacks + 1)
  return { launches, sweep: { nw: true, talent: stacks, tier: 3, westWind: Math.min(total, 6), team: true, flower: true } }
}
/** From E1 on Fribbels prices Netherwing's hits with +20% that the text gives only below 80% enemy HP: the kit divides it out against a full-HP enemy. */
const e1Divide = (eidolon: number) => (eidolon >= 1 ? 1 / 1.2 : 1)
const three = (r: DamageRequest): DamageRequest => ({ ...r, enemy: { ...ENEMY, count: 3 } })

describe('Basic ATK, Skill and Boneclaw, per hit', () => {
  it("Basic ATK is BASIC hit 0 with the text's multiple, at E0 and E3", () => {
    for (const e of [0, 3]) {
      const t = setup(e)
      use(t, 'cas', 'basic')
      const h = hit(casRequest(e, {}, mates), 'BASIC')
      near(h.scaling, castoriceScalings(e).basic)
      near(sum(t.dealt, 'BASIC'), h.perUnit * castoriceScalings(e).basic)
    }
  })

  it("the Skill is SKILL hit 0 at her live Talent stacks (2: the HP she and 'a' lost), at E0 and E5", () => {
    for (const e of [0, 5]) {
      const t = setup(e)
      use(t, 'cas', 'skill')
      // Her own and 'a' losing HP: 2 stacks.
      expect(t.q('talent_stacks')).toBe(2)
      const h = hit(casRequest(e, { talent: 2 }, mates), 'SKILL')
      near(h.scaling, castoriceScalings(e).skill)
      near(sum(t.dealt, 'SKILL'), h.perUnit * castoriceScalings(e).skill)
    }
  })

  it('Boneclaw is SKILL hits 0 (30%) and 1 (50%) while Netherwing is out: 33% and 55% at E5', () => {
    for (const e of [0, 5]) {
      const t = setup(e)
      summon(t)
      t.dealt.length = 0
      use(t, 'cas', 'skill')
      const state: State = { nw: true, talent: t.q('talent_stacks') as number, team: true }
      const s = castoriceScalings(e)
      const h0 = hit(casRequest(e, state, mates), 'SKILL', 0)
      const h1 = hit(casRequest(e, state, mates), 'SKILL', 1)
      near(h0.scaling, s.boneclawCastorice)
      near(h1.scaling, s.boneclawNetherwing)
      near(sum(t.dealt, 'SKILL'), h0.perUnit * s.boneclawCastorice + h1.perUnit * s.boneclawNetherwing * e1Divide(e))
    }
  })

  it("on 3 enemies the Skill's blast is the kernel number on each enemy: the target at 50%, the neighbours at 30%", () => {
    const t = setup(0, { enemies: 3 })
    use(t, 'cas', 'skill')
    const h = hit(three(casRequest(0, { talent: 2 }, mates)), 'SKILL')
    near(sum(t.dealt, 'SKILL'), h.perUnit * (0.5 + 2 * 0.3))
  })
})

describe("Netherwing's Breath and Wings Sweep, per hit at each launch's own state", () => {
  for (const e of [0, 3, 5]) {
    it(`E${e}: every Breath (MEMO_SKILL hit 0, steps 1, 2, 3, 3... and West Wind stacks, Death Flower from its HP cost) and one Wings Sweep (MEMO_TALENT)`, () => {
      const t = setup(e)
      summon(t)
      t.dealt.length = 0
      const plan = launchPlan(e, t.q('talent_stacks') as number)
      t.battle.run()
      const s = castoriceScalings(e)
      const breaths = t.dealt.filter((d) => d.ability === 'MEMO_SKILL')
      expect(breaths).toHaveLength(plan.launches.length)
      breaths.forEach((d, i) => {
        const k = i + 1
        const h = hit(casRequest(e, plan.launches[i]!, mates), 'MEMO_SKILL')
        near(h.scaling, s.breath[Math.min(k, 3) - 1]!)
        near(d.damage, h.perUnit * s.breath[Math.min(k, 3) - 1]! * e1Divide(e))
      })
      const sweep = t.dealt.filter((d) => d.ability === 'MEMO_TALENT')
      expect(sweep).toHaveLength(1)
      const w = hit(casRequest(e, plan.sweep, mates), 'MEMO_TALENT')
      near(w.scaling, s.wings * s.bounces)
      near(sweep[0]!.damage, w.perUnit * s.wings * s.bounces * e1Divide(e))
    })
  }

  it('E6: 9 bounces, Quantum RES PEN, and the per-hit price still matches', () => {
    const t = setup(6)
    summon(t)
    t.dealt.length = 0
    const plan = launchPlan(6, t.q('talent_stacks') as number)
    t.battle.run()
    const s = castoriceScalings(6)
    const sweep = t.dealt.find((d) => d.ability === 'MEMO_TALENT')!
    // E1 is on too: against an enemy above 80% HP Fribbels' own +20% on Netherwing is divided out (the text gives 100% there).
    const w = hit(casRequest(6, plan.sweep, mates), 'MEMO_TALENT')
    near(w.scaling, s.wings * 9)
    near(sweep.damage, (w.perUnit * s.wings * 9) / 1.2)
  })

  it('3 enemies: the Breath hits each at its multiple, the bounces are split between them', () => {
    const t = setup(0, { enemies: 3 })
    summon(t)
    t.dealt.length = 0
    const plan = launchPlan(0, t.q('talent_stacks') as number)
    t.battle.run()
    const w = hit(three(casRequest(0, plan.sweep, mates)), 'MEMO_TALENT')
    near(sum(t.dealt, 'MEMO_TALENT'), w.perUnit * 0.4 * 6)
    const b1 = hit(three(casRequest(0, plan.launches[0]!, mates)), 'MEMO_SKILL')
    const first = t.dealt.filter((d) => d.ability === 'MEMO_SKILL').slice(0, 3)
    expect(first).toHaveLength(3)
    near(first.reduce((n, d) => n + d.damage, 0), 3 * b1.perUnit * 0.24)
  })
})

describe("E1 and Fribbels' own factor", () => {
  it("Fribbels' E1 is a +20% on Netherwing's hits that becomes +40% with its switch, and nothing on hers", () => {
    const base = { nw: true, talent: 3, team: true }
    const e0 = hit(casRequest(0, base, mates), 'SKILL', 1).perUnit
    const lowOff = hit(casRequest(1, base, mates), 'SKILL', 1).perUnit
    const lowOn = hit(casRequest(1, { ...base, e1Low: true }, mates), 'SKILL', 1).perUnit
    near(lowOff / e0, 1.2)
    near(lowOn / e0, 1.4)
    const her0 = hit(casRequest(0, base, mates), 'SKILL', 0).perUnit
    near(hit(casRequest(1, { ...base, e1Low: true }, mates), 'SKILL', 0).perUnit, her0)
  })

  it("the kit prices Boneclaw's two parts by the text: 100% above 80% enemy HP, 120% to 80%, 140% to 50%", () => {
    const run = (fraction: number) => {
      const t = setup(1)
      summon(t)
      const enemy = t.battle.enemies.ids[0]!
      t.battle.enemies.takeDamage(enemy, (1 - fraction) * t.battle.enemyHp(enemy).max)
      t.dealt.length = 0
      use(t, 'cas', 'skill')
      const state: State = { nw: true, talent: t.q('talent_stacks') as number, team: true, e1Low: fraction <= 0.5 }
      const h0 = hit(casRequest(1, state, mates), 'SKILL', 0).perUnit * 0.3
      const h1 = hit(casRequest(1, state, mates), 'SKILL', 1).perUnit * 0.5
      return { dealt: sum(t.dealt, 'SKILL'), h0, h1 }
    }
    // Netherwing's part is priced with Fribbels' +20% (above 50% HP) or +40% (at 50% or less) already in it.
    const full = run(1)
    near(full.dealt, full.h0 + full.h1 / 1.2)
    const mid = run(0.7)
    near(mid.dealt, 1.2 * mid.h0 + mid.h1)
    const low = run(0.4)
    near(low.dealt, 1.4 * low.h0 + low.h1)
  })
})

describe('what she gives a teammate, priced with its live value', () => {
  const mateOf = (e: number, c: ConditionalValues): KernelTeammate => ({ ...casUnit(e), characterConditionals: c })
  const allyRequest = (m: KernelTeammate): DamageRequest => ({ attacker: { ...acheronUnit }, teammates: [m], build: acheronBuild, enemy: ENEMY })

  it('with no Netherwing: the Territory and the DMG buff are off', () => {
    const t = setup(0)
    use(t, 'a', 'basic')
    near(sum(t.dealt, 'BASIC'), kernel.actionDamage(allyRequest(mateOf(0, { memospriteActive: false, teamDmgBoost: false }))).damage.BASIC!)
  })

  it("with Netherwing out: RES PEN 20% (E3: 22%) and +10% DMG, each real, on the ally's own hit", () => {
    for (const e of [0, 3]) {
      const t = setup(e)
      summon(t)
      t.dealt.length = 0
      use(t, 'a', 'basic')
      const on = kernel.actionDamage(allyRequest(mateOf(e, { memospriteActive: true, teamDmgBoost: true }))).damage.BASIC!
      near(sum(t.dealt, 'BASIC'), on)
      const noRes = kernel.actionDamage(allyRequest(mateOf(e, { memospriteActive: false, teamDmgBoost: true }))).damage.BASIC!
      const noDmg = kernel.actionDamage(allyRequest(mateOf(e, { memospriteActive: true, teamDmgBoost: false }))).damage.BASIC!
      expect(noRes).toBeLessThan(on)
      expect(noDmg).toBeLessThan(on)
    }
  })

  it("the DMG buff counts down on the ally's own turns and the Territory ends with Netherwing", () => {
    const t = setup(0)
    summon(t)
    expect(t.battle.timeline.modifiers.get('a', 'castorice.team_dmg')!.turnsLeft).toBe(3)
    t.battle.run()
    // Netherwing used all its HP in its first turn: the Territory is gone (RES PEN off).
    expect(t.q('netherwing')).toBe(false)
    t.dealt.length = 0
    const stillBuffed = t.battle.timeline.modifiers.has('a', 'castorice.team_dmg')
    use(t, 'a', 'basic')
    near(sum(t.dealt, 'BASIC'), kernel.actionDamage(allyRequest(mateOf(0, { memospriteActive: false, teamDmgBoost: stillBuffed }))).damage.BASIC!)
  })
})

describe("Cyrene's effect on her", () => {
  it('the switch is live, the per-100% price does not change with it, and the multiple of every bounce takes the live overflow', () => {
    const t = setup(0, { cyrene: true })
    const withCyrene: KernelTeammate[] = [...mates, { characterId: CYRENE_KERNEL_ID, lightConeId: '23024', eidolon: 0, superimposition: 1 }]
    t.battle.party.consumeHp('a', NEWBUD_MAX * 1.5, 'a')
    const filled = t.q('newbud') as number
    expect(filled).toBeGreaterThan(NEWBUD_MAX)
    const overflow = ((filled - NEWBUD_MAX) / NEWBUD_MAX) * 100
    use(t, 'cas', 'ultimate')
    t.dealt.length = 0
    const plan = launchPlan(0, t.q('talent_stacks') as number)
    t.battle.run()
    const state = plan.sweep
    const on = hit(casRequest(0, { ...state, cyrene: true }, withCyrene), 'MEMO_TALENT')
    const off = hit(casRequest(0, { ...state, cyrene: false }, withCyrene), 'MEMO_TALENT')
    near(on.perUnit, off.perUnit)
    // Fribbels' own multiple has the fixed 30% overflow in it (3x with fewer than 3 enemies); the kit's has the live one.
    expect(on.scaling).toBeGreaterThan(off.scaling)
    const sweep = t.dealt.find((d) => d.ability === 'MEMO_TALENT')!
    near(sweep.damage, on.perUnit * (0.4 + overflow * cyreneBounceRate(false, true)) * 6)
    expect(t.battle.cyreneEffect('cas').active).toBe(true)
  })
})
