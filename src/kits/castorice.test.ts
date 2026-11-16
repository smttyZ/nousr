import { describe, expect, it } from 'vitest'
import { Battle, CYRENE_KERNEL_ID } from '../battle/battle'
import type { BattleSetup, MemberSetup } from '../battle/battle'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { DEATH_FLOWER_MODIFIER, MakeFarewellsMoreBeautiful } from '../equipment/makeFarewellsMoreBeautiful'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Rule } from '../scenario/types'
import {
  Castorice,
  castoriceScalings,
  cyreneBounceRate,
  makeCastorice,
  NEWBUD_MAX,
  netherwingId,
  SPD_MODIFIER,
  TALENT_MODIFIER,
  TEAM_DMG_MODIFIER,
  TERRITORY_MODIFIER,
} from './castorice'
import type { Kit } from './kit'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const NW = netherwingId('cas')
const CAS_HP = 10_000
const ALLY_HP = 5000

/** Per 100% of the multiple: Basic 1,000; Skill hit 0 1,000 and hit 1 1,500; Breath 2,000; Wings Sweep 3,000. */
function makeKernel(requests: DamageRequest[] = [], ohb = 0): DamageKernel {
  return {
    actionDamage(request) {
      requests.push(request)
      if (request.attacker.characterId !== '1407') return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] })
      const on = request.attacker.characterConditionals?.memospriteActive === true
      return fakeResult(
        {
          BASIC: [{ damage: 1000, scaling: 1 }],
          SKILL: on
            ? [{ damage: 1000, scaling: 1 }, { damage: 1500, scaling: 1 }]
            : [{ damage: 1000, scaling: 1 }],
          MEMO_SKILL: [{ damage: 2000, scaling: 1 }],
          MEMO_TALENT: [{ damage: 3000, scaling: 1 }],
        },
        { ATK: 0, DEF: 0, HP: CAS_HP, SPD: 90, CR: 0, CD: 0, EHR: 0, RES: 0, BE: 0, ERR: 0, OHB: ohb },
      )
    },
  }
}

const Ally: Kit = {
  characterId: 'ally',
  path: 'Hunt',
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
      heal: {
        kind: 'skill',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'heal', 'skill', () => {
            for (const m of battle.members) battle.party.heal(m.key, 100_000, self.key)
          }),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
}

const stubCyrene = (target: string): Kit => ({
  characterId: 'cyrene-stub',
  path: 'Remembrance',
  element: 'Ice',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: { basic: { kind: 'basic', canUse: () => true, use: () => battle.performAction(self.key, 'basic', 'basic', () => {}) } },
    attackerState: () => ({}),
    teammateState: () => ({}),
    onBattleStart: () => battle.setCyreneEffect(target, true, self.key),
  }),
})

const casSetup = (kit: Kit, eidolon: number, baseSpd = 90, lc = false): MemberSetup => ({
  key: 'cas',
  kit,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: CAS_HP, def: 1000, baseSpd },
  kernel: { unit: { characterId: '1407', lightConeId: lc ? '23040' : 'x', eidolon, superimposition: 1 }, build: noBuild },
  ...(lc && { equipment: { lightCone: MakeFarewellsMoreBeautiful, sets: [] } }),
})
const allySetup = (key: string, baseSpd: number): MemberSetup => ({
  key,
  kit: Ally,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: ALLY_HP, def: 1000, baseSpd },
  kernel: { unit: { characterId: 'ally', lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
})
const cyreneSetup = (eidolon: number): MemberSetup => ({
  key: 'cyrene',
  kit: stubCyrene('cas'),
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: ALLY_HP, def: 1000, baseSpd: 60 },
  kernel: { unit: { characterId: CYRENE_KERNEL_ID, lightConeId: 'x', eidolon, superimposition: 1 }, build: noBuild },
})

interface Options {
  kit?: Kit
  techniques?: boolean
  enemies?: number
  cycles?: number
  lc?: boolean
  cyrene?: number
  ohb?: number
  policy?: Rule[]
}

function setup(eidolon = 0, options: Options = {}) {
  const requests: DamageRequest[] = []
  const members = [casSetup(options.kit ?? Castorice, eidolon, 90, options.lc), allySetup('a', 80), allySetup('b', 70)]
  if (options.cyrene !== undefined) members.push(cyreneSetup(options.cyrene))
  const arg: BattleSetup = {
    members,
    policy: options.policy ?? members.map((m) => ({ unit: m.key, use: 'basic', when: [] })),
    profile,
    enemyCount: options.enemies ?? 3,
    weaknesses: 'all',
    cycles: options.cycles ?? 1,
    start: { energy: 0, skillPoints: 3, techniques: options.techniques ?? false },
    kernel: makeKernel(requests, options.ohb ?? 0),
  }
  const battle = new Battle(arg)
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (d) => dealt.push(d))
  const actions: EngineEvents['actionUsed'][] = []
  battle.timeline.bus.on('actionUsed', (a) => actions.push(a))
  const cas = battle.member('cas').instance
  for (const m of battle.members) m.instance.onBattleStart?.({ techniques: options.techniques ?? false })
  const q = (name: string) => cas.quantities![name]!()
  return { battle, requests, dealt, actions, q }
}
type Setup = ReturnType<typeof setup>
const use = (t: Setup, who: string, action: string) => t.battle.member(who).instance.actions[action]!.use()
const total = (t: Setup, ability: string) => t.dealt.filter((d) => d.ability === ability).reduce((a, d) => a + d.damage, 0)
const hp = (t: Setup, id: string) => t.battle.party.get(id).hp

/** Newbud to the maximum by letting allies lose HP (no Netherwing on the field). */
function fillNewbud(t: Setup, amount = NEWBUD_MAX) {
  // The heal that refills 'a' charges Newbud too (12% of the maximum at most), so the exact amount is read back with `q('newbud')`.
  t.battle.party.setStats('a', { maxHp: amount + ALLY_HP })
  t.battle.party.heal('a', amount, 'b')
  t.battle.party.consumeHp('a', amount, 'a')
  t.battle.party.setStats('a', { maxHp: ALLY_HP })
  use(t, 'b', 'basic')
}

describe('Basic ATK and Skill', () => {
  it('Basic ATK gives a Skill Point and deals 50% (55% at E3) to one enemy at 1,000 per 100%', () => {
    for (const [e, mult] of [[0, 0.5], [3, 0.55]] as const) {
      const t = setup(e)
      const sp = t.battle.skillPoints
      use(t, 'cas', 'basic')
      expect(t.battle.skillPoints).toBe(sp + 1)
      expect(total(t, 'BASIC')).toBeCloseTo(1000 * mult, 9)
      expect(castoriceScalings(e).basic).toBe(mult)
    }
  })

  it('Skill costs no Skill Point, consumes 30% of every ally\'s current HP (her own too) and gives that HP as Newbud', () => {
    const t = setup()
    const sp = t.battle.skillPoints
    use(t, 'cas', 'skill')
    expect(t.battle.skillPoints).toBe(sp)
    expect(hp(t, 'cas')).toBeCloseTo(0.7 * CAS_HP, 9)
    expect(hp(t, 'a')).toBeCloseTo(0.7 * ALLY_HP, 9)
    expect(t.q('newbud')).toBeCloseTo(0.3 * (CAS_HP + 2 * ALLY_HP), 9)
    // 50% on the target (the middle of 3 enemies), 30% on each of its 2 neighbours, 1,000 per 100%.
    expect(total(t, 'SKILL')).toBeCloseTo(1000 * (0.5 + 2 * 0.3), 9)
  })

  it('the Skill\'s numbers at E5: 55% / 33%', () => {
    const t = setup(5)
    use(t, 'cas', 'skill')
    expect(total(t, 'SKILL')).toBeCloseTo(1000 * (0.55 + 2 * 0.33), 9)
  })

  it('the cost stops at 1 HP and never asks for more than an ally has', () => {
    const t = setup()
    t.battle.party.consumeHp('a', ALLY_HP - 1.2, 'a')
    use(t, 'cas', 'skill')
    expect(hp(t, 'a')).toBeCloseTo(1, 9)
  })

  it('every ally that loses HP gives a Talent stack (3 at most, 3 turns), which the kernel is told', () => {
    const t = setup()
    use(t, 'cas', 'skill')
    expect(t.q('talent_stacks')).toBe(3)
    const mod = t.battle.timeline.modifiers.get('cas', TALENT_MODIFIER)!
    expect(mod.turnsLeft).toBe(3)
    expect(t.requests.at(-1)!.attacker.characterConditionals!.talentDmgStacks).toBe(3)
    expect(t.requests.at(-1)!.attacker.characterConditionals!.memospriteActive).toBe(false)
  })
})

describe('Newbud', () => {
  it('is HP lost by any ally, up to the maximum, and the Ultimate needs all of it', () => {
    const t = setup()
    expect(t.battle.member('cas').instance.actions.ultimate!.canUse()).toBe(false)
    t.battle.party.consumeHp('a', 1000, 'a')
    expect(t.q('newbud')).toBe(1000)
    fillNewbud(t, NEWBUD_MAX * 2)
    expect(t.q('newbud')).toBe(NEWBUD_MAX)
    expect(t.q('newbud_full')).toBe(true)
    expect(t.battle.member('cas').instance.actions.ultimate!.canUse()).toBe(true)
  })

  it('healing becomes Newbud, at most 12% of the maximum per ally until a unit takes action', () => {
    const t = setup()
    t.battle.party.setStats('a', { maxHp: 100_000 })
    t.battle.party.consumeHp('a', ALLY_HP - 1, 'a')
    use(t, 'b', 'basic')
    const before = t.q('newbud') as number
    t.battle.party.heal('a', 3000, 'b')
    expect((t.q('newbud') as number) - before).toBe(3000)
    t.battle.party.heal('a', 10_000, 'b')
    // 12% of 34,000 = 4,080 in all for this ally.
    expect((t.q('newbud') as number) - before).toBeCloseTo(0.12 * NEWBUD_MAX, 9)
    // Any unit's action resets the tally.
    use(t, 'b', 'basic')
    t.battle.party.heal('a', 500, 'b')
    expect((t.q('newbud') as number) - before).toBeCloseTo(0.12 * NEWBUD_MAX + 500, 9)
  })

  it('healing counts the overheal too (settled in game, 2026-11-15): a full-HP ally healed 500 gives 500 Newbud', () => {
    const t = setup()
    expect(hp(t, 'a')).toBe(t.battle.party.get('a').maxHp)
    t.battle.party.heal('a', 500, 'b')
    expect(t.q('newbud')).toBe(500)
  })

  it('a heal that is part restored and part overheal gives the whole of it, and the 12% cap per ally holds for overheal', () => {
    const t = setup()
    t.battle.party.consumeHp('a', 100, 'a')
    const before = t.q('newbud') as number
    // 100 restored + 600 over.
    t.battle.party.heal('a', 700, 'b')
    expect((t.q('newbud') as number) - before).toBe(700)
    // Full-HP allies healed enormously: each gives exactly 12% of the maximum.
    const u = setup()
    for (const id of ['a', 'b']) u.battle.party.heal(id, 1_000_000, 'cas')
    expect(u.q('newbud')).toBeCloseTo(2 * 0.12 * NEWBUD_MAX, 9)
  })
})

describe('Ultimate and Netherwing', () => {
  const summoned = (e = 0, options: Options = {}) => {
    const t = setup(e, options)
    fillNewbud(t)
    use(t, 'cas', 'ultimate')
    return t
  }

  it('summons Netherwing: SPD 165, Max HP = max Newbud, untargetable, advanced 100%, and Newbud is spent', () => {
    const t = summoned()
    expect(t.q('netherwing')).toBe(true)
    expect(t.battle.isMemosprite(NW)).toBe(true)
    const body = t.battle.party.get(NW)
    expect(body.maxHp).toBe(NEWBUD_MAX)
    expect(body.hp).toBe(NEWBUD_MAX)
    expect(body.targetable).toBe(false)
    expect(t.battle.timeline.spd(NW)).toBe(165)
    expect(t.battle.timeline.gauge(NW)).toBe(0)
    expect(t.q('newbud')).toBe(0)
    expect(t.battle.member('cas').instance.actions.ultimate!.canUse()).toBe(false)
  })

  it('deploys the Territory on every enemy and 10% DMG for 3 turns on every ally and memosprite', () => {
    const t = summoned()
    for (const enemy of t.battle.enemies.ids) expect(t.battle.timeline.modifiers.has(enemy, TERRITORY_MODIFIER)).toBe(true)
    for (const unit of ['cas', 'a', 'b', NW]) expect(t.battle.timeline.modifiers.get(unit, TEAM_DMG_MODIFIER)!.turnsLeft).toBe(3)
  })

  it('tells Fribbels the Territory (memospriteActive) and the team DMG buff, for her and for a teammate', () => {
    const t = summoned()
    use(t, 'a', 'basic')
    const r = t.requests.at(-1)!
    const cas = r.teammates.find((m) => m.characterId === '1407')!.characterConditionals!
    expect(cas.memospriteActive).toBe(true)
    expect(cas.teamDmgBoost).toBe(true)
    use(t, 'cas', 'basic')
    expect(t.requests.at(-1)!.attacker.characterConditionals!.memospriteActive).toBe(true)
    expect(t.requests.at(-1)!.attacker.characterConditionals!.teamDmgBoost).toBe(true)
  })

  it('while it is out, no Newbud is gained and the HP allies lose goes to Netherwing as HP', () => {
    const t = summoned()
    t.battle.party.consumeHp(NW, 20_000, 'cas')
    const low = hp(t, NW)
    t.battle.party.consumeHp('a', 1000, 'a')
    expect(t.q('newbud')).toBe(0)
    expect(hp(t, NW)).toBeCloseTo(low + 1000, 9)
    // Healing converts to Netherwing's HP too, with the 12% cap.
    t.battle.party.heal('a', 800, 'b')
    expect(hp(t, NW)).toBeCloseTo(low + 1800, 9)
    expect(t.q('newbud')).toBe(0)
  })

  it('is backup: an ally is held at 1 HP and Netherwing bears 500% of the rest', () => {
    const t = summoned()
    t.battle.party.takeDamage('a', ALLY_HP + 100, 'enemy')
    expect(hp(t, 'a')).toBe(1)
    // The ally lost 4,999 (given to Netherwing as HP, which was already full), the excess 101 times 5 comes off Netherwing.
    expect(hp(t, NW)).toBeCloseTo(NEWBUD_MAX - 5 * 101, 6)
    expect(t.battle.party.get('a').downed).toBe(false)
  })

  it('Boneclaw: while it is out the Skill takes 40% of the HP, and the Joint ATK is hits 0 (30%) and 1 (50%) on all enemies', () => {
    const t = summoned()
    t.dealt.length = 0
    use(t, 'cas', 'skill')
    // Netherwing is not charged: no Newbud, and 40% of her own and the allies' HP is gone (before Netherwing's HP is added back).
    expect(hp(t, 'a')).toBeCloseTo(0.6 * ALLY_HP, 9)
    expect(hp(t, 'cas')).toBeCloseTo(0.6 * CAS_HP, 9)
    expect(total(t, 'SKILL')).toBeCloseTo(3 * (1000 * 0.3 + 1500 * 0.5), 9)
    expect(t.q('newbud')).toBe(0)
  })

  it('Breath loops: 24%, 28%, 34%, 34% while HP is above 25%, the last launch takes it to 1 HP and Wings Sweep triggers once', () => {
    const t = summoned()
    t.dealt.length = 0
    t.battle.run()
    const breaths = t.dealt.filter((d) => d.ability === 'MEMO_SKILL' && d.enemy === t.battle.enemies.ids[0])
    expect(breaths.map((d) => d.damage / 2000)).toEqual([0.24, 0.28, 0.34, 0.34].map((x) => expect.closeTo(x, 9)))
    const sweeps = t.dealt.filter((d) => d.ability === 'MEMO_TALENT' && d.enemy === t.battle.enemies.ids[0])
    expect(sweeps).toHaveLength(1)
    // 6 bounces of 40%, 3,000 per 100%, split over 3 enemies.
    expect(sweeps[0]!.damage).toBeCloseTo(3000 * 0.4 * 2, 9)
    expect(t.q('netherwing')).toBe(false)
    expect(t.battle.isMemosprite(NW)).toBe(false)
    const turns = t.actions.filter((a) => a.actor === NW)
    expect(turns.map((a) => a.action)).toEqual(['breath'])
  })

  it('Wings Sweep heals every ally 6% of her Max HP + 800 (times 1 + OHB), converted to Newbud at most 12% each; the Territory is gone', () => {
    const t = summoned(0, { ohb: 0.1 })
    // Room to be healed: raise the Max HP (the HP stays at 5,000).
    t.battle.party.setStats('a', { maxHp: 100_000 })
    const heals: number[] = []
    t.battle.timeline.bus.on('healed', (h) => { if (h.source === 'cas') heals.push(h.amount) })
    t.battle.run()
    const heal = (0.06 * CAS_HP + 800) * 1.1
    // The two other allies have no room (full HP) unless hurt by an enemy; the one with room is healed the whole amount.
    expect(heals).toContainEqual(expect.closeTo(heal, 6))
    for (const enemy of t.battle.enemies.ids) expect(t.battle.timeline.modifiers.has(enemy, TERRITORY_MODIFIER)).toBe(false)
    // Newbud rose by the converted heals (three allies, each below its cap).
    expect(t.q('newbud')).toBeGreaterThan(0)
  })

  it('E3: Wings Sweep 44%, 6.6% + 880 heal; E5: Breath 26.4 / 30.8 / 37.4%; E6: 9 bounces', () => {
    expect(castoriceScalings(3).wings).toBe(0.44)
    expect(castoriceScalings(3).healShare).toBe(0.066)
    expect(castoriceScalings(3).healFlat).toBe(880)
    expect(castoriceScalings(5).breath).toEqual([0.264, 0.308, 0.374])
    expect(castoriceScalings(6).bounces).toBe(9)
    expect(castoriceScalings(0).bounces).toBe(6)
  })

  it('West Wind: Breath k has min(k, 6) stacks of the turn, which the kernel is told; they are gone at the turn\'s end', () => {
    const t = summoned()
    t.battle.run()
    const stacks = t.requests.filter((r) => r.attacker.characterId === '1407').map((r) => r.attacker.characterConditionals!.memoDmgStacks)
    expect(Math.max(...(stacks as number[]))).toBe(4)
    expect(t.battle.member('cas').instance.attackerState(t.battle.enemies.ids[0]!).characterConditionals!.memoDmgStacks).toBe(0)
  })

  /** Per Netherwing action: its name, Netherwing's HP share when it ended, and the Breath / Claw launches it made (hits on one enemy). */
  function netherwingTurns(t: Setup) {
    const turns: { action: string, hpShare: number, present: boolean, memoSkills: number }[] = []
    let seen = 0
    t.battle.timeline.bus.on('actionUsed', (a) => {
      if (a.actor !== NW) return
      const memoSkills = t.dealt.filter((d) => d.ability === 'MEMO_SKILL' && d.enemy === t.battle.enemies.ids[0]).length
      const present = t.q('netherwing') as boolean
      const body = present ? t.battle.party.get(NW) : undefined
      turns.push({ action: a.action, hpShare: body ? body.hp / body.maxHp : 0, present, memoSkills: memoSkills - seen })
      seen = memoSkills
    })
    return turns
  }

  it('burn (finishOnTurn 1, the default): the first turn launches Breath into the finisher and Netherwing is gone', () => {
    const t = summoned()
    const turns = netherwingTurns(t)
    t.battle.run()
    expect(turns[0]!.action).toBe('breath')
    expect(turns[0]!.present).toBe(false)
    expect(t.dealt.filter((d) => d.ability === 'MEMO_TALENT' && d.enemy === t.battle.enemies.ids[0])).toHaveLength(1)
  })

  it('hold (finishOnTurn 3): stops above the finisher on turns 1 and 2, finishes on turn 3, one Wings Sweep in all', () => {
    const t = summoned(0, { kit: makeCastorice({ finishOnTurn: 3 }), cycles: 3 })
    const turns = netherwingTurns(t)
    t.battle.run()
    // Turn 1 from full HP: 100 -> 75 -> 50 -> 25%, then it holds (a 4th launch would be the finisher).
    expect(turns[0]).toMatchObject({ action: 'breath', present: true })
    expect(turns[0]!.hpShare).toBeCloseTo(0.25, 9)
    expect(turns[1]!.present).toBe(true)
    expect(turns[1]!.hpShare).toBeGreaterThan(1 / NEWBUD_MAX - 1e-12)
    expect(turns[1]!.hpShare).toBeLessThanOrEqual(0.25 + 1e-9)
    expect(turns[2]!.present).toBe(false)
    expect(turns).toHaveLength(3)
    expect(t.dealt.filter((d) => d.ability === 'MEMO_TALENT' && d.enemy === t.battle.enemies.ids[0])).toHaveLength(1)
  })

  it('hold: a turn that starts at 25% HP or less uses Claw Splits the Veil (40% of her Max HP, no HP cost) and stays', () => {
    const t = summoned(0, { kit: makeCastorice({ finishOnTurn: 2 }) })
    t.battle.party.consumeHp(NW, 0.8 * NEWBUD_MAX, 'cas')
    const turns = netherwingTurns(t)
    const before = hp(t, NW)
    t.battle.timeline.bus.on('actionUsed', (a) => {
      if (a.actor === NW && a.action === 'claw') expect(hp(t, NW)).toBeGreaterThanOrEqual(before)
    })
    t.battle.run()
    expect(turns[0]).toMatchObject({ action: 'claw', present: true, memoSkills: 1 })
    const claw = t.dealt.find((d) => d.ability === 'MEMO_SKILL' && d.enemy === t.battle.enemies.ids[0])!
    // The fake kernel prices MEMO_SKILL at 2000 per 100%.
    expect(claw.damage).toBeCloseTo(2000 * 0.4, 9)
    // Turn 2 is the finishing turn: Breath into the finisher.
    expect(turns[1]).toMatchObject({ action: 'breath', present: false })
  })

  it('hold: Claw is 40% (E5: 44%), and E2 Ardent Will is spent only above the finisher', () => {
    expect(castoriceScalings(0).claw).toBe(0.4)
    expect(castoriceScalings(5).claw).toBe(0.44)
    const t = summoned(2, { kit: makeCastorice({ finishOnTurn: 2 }) })
    const turns = netherwingTurns(t)
    t.battle.run()
    // Two Ardent Will pay for the first two launches at full HP, then HP pays 100 -> 75 -> 50 -> 25%: 5 Breaths, holding.
    expect(turns[0]).toMatchObject({ action: 'breath', present: true, memoSkills: 5 })
    expect(t.q('ardent_will')).toBe(0)
  })

  it('rejects a finishing turn outside 1 to 3', () => {
    expect(() => makeCastorice({ finishOnTurn: 4 as 3 })).toThrow(/finishOnTurn/)
  })

  it("Netherwing's HP gained from allies' HP loss and healing is not a heal: no healed event", () => {
    const t = summoned()
    t.battle.party.consumeHp(NW, 0.5 * NEWBUD_MAX, 'cas')
    const healed: string[] = []
    t.battle.timeline.bus.on('healed', ({ unit }) => healed.push(unit))
    const before = hp(t, NW)
    t.battle.party.takeDamage('a', 500, 'enemy')
    t.battle.party.heal('b', 300, 'b')
    expect(hp(t, NW)).toBeGreaterThan(before)
    expect(healed).toEqual(['b'])
  })

  it('its HP running out (the backup bearing too much) makes it disappear and triggers Wings Sweep', () => {
    const t = summoned()
    t.dealt.length = 0
    t.battle.party.consumeHp(NW, NEWBUD_MAX - 10, 'cas')
    t.battle.party.takeDamage('a', 100_000, 'enemy')
    expect(t.q('netherwing')).toBe(false)
    expect(t.battle.isMemosprite(NW)).toBe(false)
    expect(t.dealt.filter((d) => d.ability === 'MEMO_TALENT')).toHaveLength(3)
    expect(t.battle.party.get('a').downed).toBe(false)
  })

  it('the owner being downed removes it without Wings Sweep', () => {
    const t = summoned()
    t.dealt.length = 0
    t.battle.removeMemosprite(NW, 'ownerDowned')
    expect(t.q('netherwing')).toBe(false)
    expect(t.dealt).toHaveLength(0)
  })
})

describe('E1', () => {
  it('120% below 80% enemy HP and 140% below 50% on Boneclaw (both parts), Breath and Wings Sweep; Fribbels\' own +20% / +40% on Netherwing is divided out', () => {
    const run = (fraction: number) => {
      const t = setup(1, { enemies: 1 })
      fillNewbud(t)
      use(t, 'cas', 'ultimate')
      const enemy = t.battle.enemies.ids[0]!
      t.battle.enemies.takeDamage(enemy, (1 - fraction) * t.battle.enemyHp(enemy).max)
      t.dealt.length = 0
      use(t, 'cas', 'skill')
      const boneclaw = t.dealt.filter((d) => d.ability === 'SKILL')[0]!
      const req = t.requests.at(-1)!
      return { damage: boneclaw.damage, e1: req.attacker.characterConditionals!.e1EnemyHp50 }
    }
    const full = run(1)
    const mid = run(0.7)
    const low = run(0.4)
    expect(full.e1).toBe(false)
    expect(low.e1).toBe(true)
    // Castorice's part 1000 x 0.3 x factor, Netherwing's part 1500 x 0.5 x (factor / Fribbels' own factor, divided out).
    expect(full.damage).toBeCloseTo(300 + 750 / 1.2, 6)
    expect(mid.damage).toBeCloseTo(300 * 1.2 + 750, 6)
    expect(low.damage).toBeCloseTo(300 * 1.4 + 750, 6)
  })
})

describe('E2, Ardent Will and the +30% Newbud', () => {
  it('after summoning she has 2 Ardent Will, each paying a Breath instead of HP and advancing her 100%; 6 Breaths in all', () => {
    const t = setup(2)
    fillNewbud(t)
    use(t, 'cas', 'ultimate')
    expect(t.q('ardent_will')).toBe(2)
    t.battle.timeline.delay('cas', 0.5)
    t.battle.run()
    const breaths = t.dealt.filter((d) => d.ability === 'MEMO_SKILL' && d.enemy === t.battle.enemies.ids[0])
    expect(breaths).toHaveLength(6)
    expect(t.q('ardent_will')).toBe(0)
  })

  it('the next Boneclaw gives 30% of max Newbud, once', () => {
    const t = setup(2)
    fillNewbud(t)
    use(t, 'cas', 'ultimate')
    use(t, 'cas', 'skill')
    expect(t.q('newbud')).toBeCloseTo(0.3 * NEWBUD_MAX, 9)
    use(t, 'cas', 'skill')
    expect(t.q('newbud')).toBeCloseTo(0.3 * NEWBUD_MAX, 9)
  })

  it('there is none below E2', () => {
    const t = setup(1)
    fillNewbud(t)
    use(t, 'cas', 'ultimate')
    expect(t.q('ardent_will')).toBe(0)
  })
})

describe('E6', () => {
  it('Wings Sweep has 9 bounces and Quantum RES PEN is on', () => {
    const t = setup(6, { enemies: 1 })
    fillNewbud(t)
    use(t, 'cas', 'ultimate')
    t.battle.run()
    const sweep = t.dealt.filter((d) => d.ability === 'MEMO_TALENT')
    expect(sweep).toHaveLength(1)
    // E1 is on too: against an enemy above 80% HP Fribbels' own +20% on Netherwing is divided out.
    expect(sweep[0]!.damage).toBeCloseTo((3000 * 0.44 * 9) / 1.2, 9)
    expect(t.requests.filter((r) => r.attacker.characterId === '1407').at(-1)!.attacker.characterConditionals!.e6Buffs).toBe(true)
  })
})

describe('Cyrene\'s Ode to Life and Death', () => {
  it('lets Newbud overflow to 200%; the Ultimate consumes it and each 1% adds 0.24% to every bounce (+0.48% with 2 enemies or fewer)', () => {
    const t = setup(0, { cyrene: 0, enemies: 3 })
    fillNewbud(t, NEWBUD_MAX * 1.5)
    const filled = t.q('newbud') as number
    expect(filled).toBeGreaterThan(NEWBUD_MAX)
    expect(filled).toBeLessThanOrEqual(2 * NEWBUD_MAX)
    const overflow = ((filled - NEWBUD_MAX) / NEWBUD_MAX) * 100
    use(t, 'cas', 'ultimate')
    expect(t.q('newbud')).toBe(0)
    t.battle.run()
    const sweep = t.dealt.filter((d) => d.ability === 'MEMO_TALENT' && d.enemy === t.battle.enemies.ids[0])[0]!
    expect(sweep.damage).toBeCloseTo(3000 * (0.4 + overflow * 0.0024) * 2, 9)
    expect(t.requests.some((r) => r.attacker.characterConditionals?.cyreneSpecialEffect === true)).toBe(true)
  })

  it('2 enemies: 0.72% per 1%; Cyrene E3 uses the game data\'s 0.264% + 0.528% (Fribbels: 3 x 0.264%), not the text\'s rounded 0.26% + 0.53%', () => {
    expect(cyreneBounceRate(false, true)).toBeCloseTo(0.0072, 12)
    expect(cyreneBounceRate(true, true)).toBeCloseTo(0.00792, 12)
    expect(cyreneBounceRate(true, false)).toBeCloseTo(0.00264, 12)
    const t = setup(0, { cyrene: 3, enemies: 2 })
    fillNewbud(t, NEWBUD_MAX * 2)
    const overflow = (((t.q('newbud') as number) - NEWBUD_MAX) / NEWBUD_MAX) * 100
    use(t, 'cas', 'ultimate')
    t.battle.run()
    const sweep = t.dealt.filter((d) => d.ability === 'MEMO_TALENT' && d.enemy === t.battle.enemies.ids[0])[0]!
    expect(sweep.damage).toBeCloseTo(3000 * (0.4 + overflow * 0.00792) * 3, 9)
  })

  it('without Cyrene the cap is 100% and the switch is off', () => {
    const t = setup(0)
    fillNewbud(t, NEWBUD_MAX * 1.5)
    expect(t.q('newbud')).toBe(NEWBUD_MAX)
    use(t, 'cas', 'basic')
    expect(t.requests.at(-1)!.attacker.characterConditionals!.cyreneSpecialEffect).toBe(false)
  })
})

describe('Technique and Inverted Torch', () => {
  it('summons Netherwing at the start with half of max Newbud as HP and takes 40% of the others\' HP, which Netherwing receives', () => {
    const t = setup(0, { techniques: true })
    expect(t.q('netherwing')).toBe(true)
    expect(hp(t, 'a')).toBeCloseTo(0.6 * ALLY_HP, 9)
    expect(hp(t, NW)).toBeCloseTo(0.5 * NEWBUD_MAX + 0.4 * (CAS_HP + 2 * ALLY_HP), 9)
    expect(t.battle.timeline.gauge(NW)).toBe(0)
    expect(t.q('newbud')).toBe(0)
  })

  it('SPD +40% while her HP is 50% or more of her Max HP, and not below', () => {
    const t = setup()
    expect(t.battle.timeline.modifiers.has('cas', SPD_MODIFIER)).toBe(true)
    expect(t.battle.timeline.spd('cas')).toBeCloseTo(90 * 1.4, 9)
    t.battle.party.consumeHp('cas', 0.6 * CAS_HP, 'cas')
    expect(t.battle.timeline.modifiers.has('cas', SPD_MODIFIER)).toBe(false)
    expect(t.battle.timeline.spd('cas')).toBeCloseTo(90, 9)
    t.battle.party.heal('cas', 0.3 * CAS_HP, 'a')
    expect(t.battle.timeline.spd('cas')).toBeCloseTo(90 * 1.4, 9)
  })
})

describe('Make Farewells More Beautiful', () => {
  it('Death Flower after she loses HP in her own turn: the kernel is told, and it lasts 2 of her turns', () => {
    const t = setup(0, { lc: true })
    use(t, 'cas', 'basic')
    expect(t.requests.at(-1)!.attacker.lightConeConditionals!.deathFlower).toBe(false)
    // HP lost outside any turn does not count.
    t.battle.party.consumeHp('cas', 100, 'cas')
    expect(t.battle.timeline.modifiers.has('cas', DEATH_FLOWER_MODIFIER)).toBe(false)
    t.battle.run()
  })

  it('her Skill in her turn takes HP first and so hits with the Death Flower', () => {
    const t = setup(0, { lc: true, policy: [
      { unit: 'cas', use: 'skill', when: [] },
      { unit: 'a', use: 'basic', when: [] },
      { unit: 'b', use: 'basic', when: [] },
    ] })
    t.battle.run()
    const flowers = t.requests.filter((r) => r.attacker.characterId === '1407').map((r) => r.attacker.lightConeConditionals!.deathFlower)
    expect(flowers).toContain(true)
    expect(flowers[0]).toBe(true)
  })

  it('advances her 12% when her memosprite disappears, once until her next Ultimate', () => {
    const t = setup(0, { lc: true })
    fillNewbud(t)
    use(t, 'cas', 'ultimate')
    const gauge = t.battle.timeline.gauge('cas')
    t.battle.removeMemosprite(NW)
    expect(t.battle.timeline.gauge('cas')).toBeCloseTo(Math.max(0, gauge - 1200), 6)
    const again = t.battle.timeline.gauge('cas')
    fillNewbud(t)
    t.battle.timeline.delay('cas', 0)
    use(t, 'cas', 'ultimate')
    // The Ultimate reset the count: the next disappearance advances again.
    t.battle.removeMemosprite(NW)
    expect(t.battle.timeline.gauge('cas')).toBeLessThanOrEqual(again)
  })
})

describe('kit', () => {
  it('declares ability version 0, no energy and the Memory path', () => {
    expect(Castorice.abilityVersions).toEqual([0])
    expect(Castorice.maxEnergy).toBe(0)
    expect(Castorice.characterId).toBe('1407')
    expect(Castorice.path).toBe('Remembrance')
  })
})
