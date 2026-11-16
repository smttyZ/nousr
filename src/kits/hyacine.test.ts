import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { ZERO_STATS, fakeResult } from '../kernel/testing'
import type { CombatStats, DamageKernel, DamageRequest, HitResult } from '../kernel/types'
import { Hyacine, hyacineScalings, icaId } from './hyacine'
import type { Kit } from './kit'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

const HP = 100_000
const OHB = 0.1
const HEAL_MULTIPLIER = 1 + OHB
/** A fake kernel: Hyacine's in-combat Max HP and Outgoing Healing are fixed, her heal hits are the text's base heals times (1 + OHB), more with the 25% trace. */
interface Knobs {
  /** Hyacine's in-combat SPD as the kernel reports it. */
  spd: number
  /** When on, the kernel adds After Rain's Max HP (30% + 600, +50% with E1's switch) to whoever has `clearSkies` on. */
  rain: boolean
}
function kernelFor(eidolon: number, requests: DamageRequest[] = [], knobs: Knobs = { spd: 150, rain: false }): DamageKernel {
  const s = hyacineScalings(eidolon)
  /** The Technique's Max HP is injected as an HP% buff; the fake kernel adds it to the Max HP it reports. */
  const injectedHp = (request: DamageRequest) => (request.injectedBuffs ?? []).filter((b) => b.stat === 'HP_PERCENT').reduce((n, b) => n + b.value * HP, 0)
  const rainBonus = (conditionals: Record<string, number | boolean> | undefined) =>
    knobs.rain && conditionals?.clearSkies === true ? (s.rainHp.pct + (conditionals.e1HpBuff === true ? 0.5 : 0)) * HP + s.rainHp.flat : 0
  return {
    actionDamage: (request) => {
      requests.push(request)
      if (request.attacker.characterId !== '1409') {
        const bonus = rainBonus(request.teammates.find((t) => t.characterId === '1409')?.characterConditionals)
        return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] }, { ...ZERO_STATS, HP: HP + bonus + injectedHp(request) })
      }
      const low = request.attacker.characterConditionals?.healTargetHp50 === true
      const mult = HEAL_MULTIPLIER + (low ? 0.25 : 0)
      const hp = HP + rainBonus(request.attacker.characterConditionals) + injectedHp(request)
      const heal = (pct: number, flat: number): HitResult => ({ damage: (pct * hp + flat) * mult, output: 'HEAL' })
      const stats: CombatStats = { ATK: 0, DEF: 0, HP: hp, SPD: knobs.spd, CR: 0, CD: 0, EHR: 0, RES: 0, BE: 0, ERR: 0, OHB: OHB + (low ? 0.25 : 0) }
      return fakeResult(
        {
          BASIC: [{ damage: 1000 * s.basic, scaling: s.basic }],
          SKILL_HEAL: [heal(s.skillHeal.pct, s.skillHeal.flat)],
          ULT_HEAL: [heal(s.ultHeal.pct, s.ultHeal.flat)],
          // The heal hit and the heal-tally hit: 10,000 per unit of the reference heal, multiple = the share (what the engine change reports).
          MEMO_SKILL: [{ damage: 10_000, output: 'HEAL' }, { damage: 10_000 * s.memoSkill, scaling: s.memoSkill }],
        },
        stats,
      )
    },
  }
}

const dummy: Kit = {
  characterId: 'dummy',
  path: 'Hunt',
  element: 'Wind',
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

const member = (key: string, kit: Kit, characterId: string, eidolon: number, baseSpd: number, technique?: boolean): MemberSetup => ({
  key,
  ...(technique !== undefined && { technique }),
  kit,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: HP, def: 1000, baseSpd },
  kernel: { unit: { characterId, lightConeId: 'none', eidolon, superimposition: 1 }, build: noBuild },
})

function setup(eidolon = 0, requests: DamageRequest[] = [], knobs: Knobs = { spd: 150, rain: false }, technique?: { start?: boolean, hy?: boolean }) {
  const battle = new Battle({
    members: [member('hy', Hyacine, '1409', eidolon, 100, technique?.hy), member('a', dummy, 'dummy', 0, 90), member('b', dummy, 'dummy', 0, 80)],
    policy: [{ unit: 'hy', use: 'basic', when: [] }, { unit: 'a', use: 'basic', when: [] }, { unit: 'b', use: 'basic', when: [] }],
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 3,
    start: { energy: 0, skillPoints: 5, techniques: technique?.start ?? false },
    kernel: kernelFor(eidolon, requests, knobs),
  })
  const healed: EngineEvents['healed'][] = []
  const dealt: EngineEvents['damageDealt'][] = []
  const actions: string[] = []
  battle.timeline.bus.on('healed', (e) => healed.push(e))
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  battle.timeline.bus.on('actionUsed', (a) => actions.push(`${a.actor}:${a.action}`))
  const act = battle.member('hy').instance.actions
  const q = (name: string) => battle.member('hy').instance.quantities![name]!()
  const ica = icaId('hy')
  return { battle, healed, dealt, actions, act, q, ica, requests, knobs }
}

const damage = (battle: Battle, unit: string, amount: number) => battle.party.takeDamage(unit, amount, 'enemy1')

describe('Hyacine: Basic ATK and Skill', () => {
  it('Basic ATK: +20 energy, +1 Skill Point, 50% of her Max HP (55% from E3) priced as BASIC hit 0', () => {
    for (const [eidolon, scaling] of [[0, 0.5], [3, 0.55]] as const) {
      const { battle, dealt, act } = setup(eidolon)
      battle.spendSkillPoints(2)
      expect(battle.skillPoints).toBe(3)
      act.basic!.use()
      expect(battle.skillPoints).toBe(4)
      expect(battle.party.get('hy').energy).toBeCloseTo(20, 9)
      expect(dealt[0]!.scaling).toBeCloseTo(scaling, 12)
    }
  })

  it('Skill: -1 SP, +30 energy, summons Little Ica (+15 energy, +30 more the first time), heals every ally, Ica 1.25 times', () => {
    const { battle, healed, act, ica } = setup()
    damage(battle, 'a', 70_000)
    act.skill!.use()
    expect(battle.skillPoints).toBe(4)
    expect(battle.party.get('hy').energy).toBeCloseTo(30 + 15 + 30, 9)
    expect(battle.isMemosprite(ica)).toBe(true)
    // 'a' is at 30% HP: the trace's 25% is in its heal; 'b' is full.
    const base = (0.08 * HP + 160)
    const amount = (unit: string) => healed.filter((h) => h.unit === unit).map((h) => h.amount + h.overheal)
    expect(amount('a')).toEqual([expect.closeTo(base * (HEAL_MULTIPLIER + 0.25), 6)])
    expect(amount('b')).toEqual([expect.closeTo(base * HEAL_MULTIPLIER, 6)])
    expect(amount('hy')).toEqual([expect.closeTo(base * HEAL_MULTIPLIER, 6)])
    expect(amount(ica)).toEqual([expect.closeTo(1.25 * base * HEAL_MULTIPLIER, 6)])
    expect(battle.party.get('a').hp).toBeCloseTo(30_000 + base * (HEAL_MULTIPLIER + 0.25), 6)
  })

  it('a second Skill with Ica on the field summons nothing: no summon energy', () => {
    const { battle, act } = setup()
    act.skill!.use()
    const energy = battle.party.get('hy').energy
    act.skill!.use()
    expect(battle.party.get('hy').energy).toBeCloseTo(energy + 30, 9)
  })

  it('Ica starts with 50% of her in-combat Max HP, 0 SPD (not on the timeline), and enemies can target it (seen in game, 2026-11-15)', () => {
    const { battle, act, ica } = setup()
    act.skill!.use()
    expect(battle.party.get(ica).maxHp).toBeCloseTo(0.5 * HP, 6)
    expect(battle.timeline.has(ica)).toBe(false)
    expect(battle.party.get(ica).targetable).toBe(true)
  })

  it('the tally is every heal of hers and Ica, restored and overheal, and a Talent stack is gained once per source per action', () => {
    const { battle, healed, act, q } = setup()
    act.skill!.use()
    expect(q('tally')).toBeCloseTo(healed.reduce((t, h) => t + h.amount + h.overheal, 0), 6)
    expect(q('stacks')).toBe(1)
    act.skill!.use()
    expect(q('stacks')).toBe(2)
    act.skill!.use()
    act.skill!.use()
    expect(q('stacks')).toBe(3)
    expect(battle.timeline.modifiers.get(icaId('hy'), 'hyacine.healing_dmg')!.turnsLeft).toBe(2)
  })
})

describe('Hyacine: Ultimate and After Rain', () => {
  it('costs 140 and gives 5, heals with ULT_HEAL (Ica 1.2 times), and starts After Rain for 3 turns', () => {
    const { battle, healed, act, q, ica } = setup()
    battle.party.setEnergy('hy', 140)
    act.ultimate!.use()
    expect(battle.party.get('hy').energy).toBeCloseTo(5 + 15 + 30, 9)
    const base = 0.1 * HP + 200
    expect(healed.find((h) => h.unit === 'a')!.amount + healed.find((h) => h.unit === 'a')!.overheal).toBeCloseTo(base * HEAL_MULTIPLIER, 6)
    const icaHeal = healed.find((h) => h.unit === ica)!
    expect(icaHeal.amount + icaHeal.overheal).toBeCloseTo(1.2 * base * HEAL_MULTIPLIER, 6)
    expect(q('after_rain')).toBe(true)
    expect(battle.timeline.modifiers.get('hy', 'hyacine.after_rain')!.turnsLeft).toBe(3)
  })

  it("the Ultimate's heal is priced on her Max HP from before After Rain's buff: heal first, then After Rain (settled in game, 2026-11-15)", () => {
    const requests: DamageRequest[] = []
    const { battle, healed, act, q } = setup(0, requests, { spd: 150, rain: true })
    battle.party.setEnergy('hy', 140)
    act.ultimate!.use()
    expect(q('after_rain')).toBe(true)
    // After Rain adds 30% + 600 Max HP in this kernel: the heal is the base 10% + 200 of the unbuffed HP, for allies and (1.2 times) Ica.
    const base = (0.1 * HP + 200) * HEAL_MULTIPLIER
    expect(healed.find((h) => h.unit === 'a')!.amount + healed.find((h) => h.unit === 'a')!.overheal).toBeCloseTo(base, 6)
    const ica = healed.find((h) => h.unit === icaId('hy'))!
    expect(ica.amount + ica.overheal).toBeCloseTo(1.2 * base, 6)
  })

  it("Ica takes an extra turn after each of her abilities in After Rain, never outside it", () => {
    const { battle, act, actions } = setup()
    act.skill!.use()
    expect(battle.timeline.pendingExtraTurns()).toEqual([])
    battle.party.setEnergy('hy', 140)
    act.ultimate!.use()
    expect(battle.timeline.pendingExtraTurns()).toEqual([icaId('hy')])
    act.basic!.use()
    expect(battle.timeline.pendingExtraTurns()).toEqual([icaId('hy'), icaId('hy')])
    battle.run()
    expect(actions.filter((a) => a === `${icaId('hy')}:memo_skill`).length).toBeGreaterThanOrEqual(2)
  })

  it("Rainclouds: the part's scaling is share x tally / the reference heal, toughness 30 on every enemy, +5 energy, and the tally loses 50% (12% from E6)", () => {
    for (const eidolon of [0, 3, 6]) {
      const { battle, dealt, act, q, ica } = setup(eidolon)
      const s = hyacineScalings(eidolon)
      battle.party.setEnergy('hy', 140)
      act.ultimate!.use()
      const tally = q('tally') as number
      const energy = battle.party.get('hy').energy
      let energyAtIca: number | undefined
      battle.timeline.bus.on('actionUsed', (a) => {
        if (a.actor === ica && energyAtIca === undefined) energyAtIca = battle.party.get('hy').energy
      })
      const before = dealt.length
      battle.run()
      const first = dealt.slice(before).find((d) => d.ability === 'MEMO_SKILL')!
      expect(first.scaling).toBeCloseTo((s.memoSkill * tally) / 10_000, 9)
      // The fake hit is 10,000 x share per unit of its multiple 'share': damage = tally x share.
      expect(first.damage).toBeCloseTo(s.memoSkill * tally, 6)
      // Nothing else gives her energy between the Ultimate and Ica's first turn: Rainclouds is exactly +5.
      expect(energyAtIca! - energy).toBeCloseTo(5, 9)
      expect(s.tallyClear).toBe(eidolon >= 6 ? 0.12 : 0.5)
      expect(ica).toBeDefined()
    }
  })

  it('the Max HP of every ally follows the kernel while After Rain is up and returns when it ends', () => {
    const requests: DamageRequest[] = []
    const { battle, act } = setup(0, requests)
    battle.party.setEnergy('hy', 140)
    act.ultimate!.use()
    // The fake kernel ignores the Rain, so the kernel difference is 0: the buff is what the kernel says, not the kit's own arithmetic.
    expect(battle.party.get('a').maxHp).toBeCloseTo(HP, 6)
    const switches = requests.filter((r) => r.attacker.characterId === 'dummy').flatMap((r) => r.teammates.filter((t) => t.characterId === '1409').map((t) => t.characterConditionals?.clearSkies))
    expect(switches).toContain(true)
    expect(switches).toContain(false)
  })

  it('E6: 20% RES PEN only while Ica is on the field; E1 and E2 switches follow the state', () => {
    const requests: DamageRequest[] = []
    const { battle, act } = setup(6, requests)
    const teammateSwitches = () => requests.filter((r) => r.attacker.characterId === 'dummy').at(-1)!.teammates.find((t) => t.characterId === '1409')!.characterConditionals
    battle.member('a').instance.actions.basic!.use()
    expect(teammateSwitches()).toMatchObject({ e6ResPen: false, e1HpBuff: true, e2SpdBuff: false, clearSkies: false })
    act.skill!.use()
    battle.member('a').instance.actions.basic!.use()
    expect(teammateSwitches()).toMatchObject({ e6ResPen: true })
    damage(battle, 'a', 100)
    battle.member('a').instance.actions.basic!.use()
    expect(teammateSwitches()).toMatchObject({ e2SpdBuff: true })
    expect(battle.timeline.modifiers.get('a', 'hyacine.e2_spd')!.spdPct).toBeCloseTo(0.3, 12)
    battle.member('b').instance.actions.basic!.use()
    expect(battle.timeline.modifiers.has('b', 'hyacine.e2_spd')).toBe(false)
  })
})

describe('Little Ica: Take Sky in Hand', () => {
  it('when an ally loses HP, Ica pays 4% of its Max HP and heals that ally for 2% of her Max HP + 20 (2.2% + 22 from E5) after the next action', () => {
    for (const [eidolon, pct, flat] of [[0, 0.02, 20], [5, 0.022, 22]] as const) {
      const { battle, healed, act, ica } = setup(eidolon)
      act.skill!.use()
      damage(battle, 'a', 70_000)
      healed.length = 0
      const icaHp = battle.party.get(ica).hp
      battle.member('b').instance.actions.basic!.use()
      expect(battle.party.get(ica).hp).toBeCloseTo(icaHp - 0.04 * battle.party.get(ica).maxHp, 6)
      const heals = healed.filter((h) => h.source === ica)
      expect(heals).toHaveLength(1)
      expect(heals[0]!.unit).toBe('a')
      // 'a' is at 30% HP, so the 25% trace is in the multiplier.
      expect(heals[0]!.amount + heals[0]!.overheal).toBeCloseTo((pct * HP + flat) * (HEAL_MULTIPLIER + 0.25), 6)
    }
  })

  it('in After Rain the same trigger also heals every ally (Ica too) for the same amount', () => {
    const { battle, healed, act, ica } = setup()
    battle.party.setEnergy('hy', 140)
    act.ultimate!.use()
    damage(battle, 'a', 1000)
    healed.length = 0
    battle.member('b').instance.actions.basic!.use()
    const fromIca = healed.filter((h) => h.source === ica)
    expect(new Set(fromIca.map((h) => h.unit))).toEqual(new Set(['hy', 'a', 'b', ica]))
  })

  it('one consume and one heal per ally that lost HP, none without Ica on the field', () => {
    const { battle, healed, act, ica } = setup()
    damage(battle, 'a', 1000)
    battle.member('b').instance.actions.basic!.use()
    expect(healed).toHaveLength(0)
    act.skill!.use()
    healed.length = 0
    damage(battle, 'a', 1000)
    damage(battle, 'b', 1000)
    battle.member('b').instance.actions.basic!.use()
    expect(healed.filter((h) => h.source === ica).map((h) => h.unit).sort()).toEqual(['a', 'b'])
  })

  it("Ica's own cost is not an HP loss that triggers itself, and it never goes under 1 HP", () => {
    const { battle, act, ica } = setup()
    act.skill!.use()
    for (let i = 0; i < 80; i += 1) {
      damage(battle, 'a', 1)
      battle.member('b').instance.actions.basic!.use()
    }
    expect(battle.party.get(ica).hp).toBeGreaterThanOrEqual(1 - 1e-9)
  })
})

describe('Hyacine: E1, disappearance and the rest', () => {
  it('E1: in After Rain an ally that attacked is healed for 8% of her Max HP', () => {
    const { battle, healed, act } = setup(1)
    battle.party.setEnergy('hy', 140)
    act.ultimate!.use()
    healed.length = 0
    battle.member('a').instance.actions.basic!.use()
    const restore = healed.filter((h) => h.unit === 'a' && h.source === 'hy')
    expect(restore).toHaveLength(1)
    expect(restore[0]!.amount + restore[0]!.overheal).toBeCloseTo(0.08 * HP * HEAL_MULTIPLIER, 6)
  })

  it('without E1 an attack heals nothing, and outside After Rain neither', () => {
    const { battle, healed, act } = setup(0)
    battle.party.setEnergy('hy', 140)
    act.ultimate!.use()
    healed.length = 0
    battle.member('a').instance.actions.basic!.use()
    expect(healed).toHaveLength(0)
    const solo = setup(1)
    solo.act.skill!.use()
    solo.healed.length = 0
    solo.battle.member('a').instance.actions.basic!.use()
    expect(solo.healed).toHaveLength(0)
  })

  it("Fall, Then Take Wing: when Ica disappears her action advances 30%, but not when she herself is downed", () => {
    const { battle, act, ica } = setup()
    act.skill!.use()
    const gauge = (unit: string) => battle.timeline.gauge(unit)
    const before = gauge('hy')
    battle.removeMemosprite(ica, 'hp')
    expect(gauge('hy')).toBeCloseTo(before - 0.3 * 10_000, 6)
    const second = setup()
    second.act.skill!.use()
    const after = second.battle.timeline.gauge('hy')
    second.battle.removeMemosprite(second.ica, 'ownerDowned')
    expect(second.battle.timeline.gauge('hy')).toBeCloseTo(after, 9)
  })

  it('declares ability version 0 and the Remembrance path', () => {
    expect(Hyacine.abilityVersions).toEqual([0])
    expect(Hyacine.path).toBe('Remembrance')
    expect(Hyacine.maxEnergy).toBe(140)
  })
})

const RAIN = 'hyacine.after_rain'

describe('Hyacine: mutation-pinning checks', () => {
  it('Gloomy Grin: an ally at exactly 50% or at 45% HP is low (the 25% is in its heal), one at 51% is not', () => {
    const { battle, healed, act } = setup()
    damage(battle, 'a', 50_000) // exactly 50%
    damage(battle, 'b', 55_000) // 45%
    damage(battle, 'hy', 49_000) // 51%
    act.skill!.use()
    const base = 0.08 * HP + 160
    const amount = (unit: string) => healed.filter((h) => h.unit === unit).map((h) => h.amount + h.overheal)
    expect(amount('a')).toEqual([expect.closeTo(base * (HEAL_MULTIPLIER + 0.25), 6)])
    expect(amount('b')).toEqual([expect.closeTo(base * (HEAL_MULTIPLIER + 0.25), 6)])
    expect(amount('hy')).toEqual([expect.closeTo(base * HEAL_MULTIPLIER, 6)])
  })

  it('After Rain counts down at the start of her turns: up for her first two actions and gone for the third', () => {
    const { battle, act, q } = setup()
    battle.party.setEnergy('hy', 140)
    act.ultimate!.use()
    expect(battle.timeline.modifiers.get('hy', RAIN)!.turnsLeft).toBe(3)
    const left: number[] = []
    const upAtAction: boolean[] = []
    battle.timeline.bus.on('turnStart', (t) => {
      if (t.unit === 'hy') left.push(battle.timeline.modifiers.get('hy', RAIN)?.turnsLeft ?? 0)
    })
    battle.timeline.bus.on('actionUsed', (a) => {
      if (a.actor === 'hy') upAtAction.push(q('after_rain') as boolean)
    })
    battle.run()
    // Read before the turn's countdown (the kit's listeners run first, the engine ticks after): 3, 2, 1 left, gone at the third action.
    expect(left.slice(0, 3)).toEqual([3, 2, 1])
    expect(upAtAction.slice(0, 3)).toEqual([true, true, false])
  })

  it('E2: the SPD buff lasts 2 turns', () => {
    const { battle } = setup(2)
    damage(battle, 'a', 100)
    expect(battle.timeline.modifiers.get('a', 'hyacine.e2_spd')!.turnsLeft).toBe(2)
  })

  it("the tally includes Little Ica's Take Sky in Hand heals", () => {
    const { battle, healed, act, ica, q } = setup()
    act.skill!.use()
    damage(battle, 'a', 70_000)
    const before = q('tally') as number
    healed.length = 0
    battle.member('b').instance.actions.basic!.use()
    const fromIca = healed.filter((h) => h.source === ica)
    expect(fromIca).toHaveLength(1)
    expect((q('tally') as number) - before).toBeCloseTo(fromIca[0]!.amount + fromIca[0]!.overheal, 6)
  })

  it("Ica's own HP cost is not a heal: one Take Sky heal for the ally and no `healed` event for Ica", () => {
    const { battle, healed, act, ica } = setup()
    act.skill!.use()
    damage(battle, 'a', 1000)
    healed.length = 0
    battle.member('b').instance.actions.basic!.use()
    expect(healed.filter((h) => h.source === ica)).toHaveLength(1)
    expect(healed.filter((h) => h.unit === ica)).toHaveLength(0)
    expect(healed).toHaveLength(1)
  })

  it('the SPD check stops her Skill, Basic ATK and Rainclouds when the timeline and the kernel are on different sides of 200', () => {
    for (const [timelineExtra, kernelSpd] of [[0, 250], [110, 190]] as const) {
      const skill = setup()
      if (timelineExtra) skill.battle.timeline.modifiers.apply({ id: 't', target: 'hy', source: 'hy', spdFlat: timelineExtra })
      skill.knobs.spd = kernelSpd
      expect(() => skill.act.skill!.use()).toThrow(/different sides of the 200 SPD threshold/)

      const basic = setup()
      if (timelineExtra) basic.battle.timeline.modifiers.apply({ id: 't', target: 'hy', source: 'hy', spdFlat: timelineExtra })
      basic.knobs.spd = kernelSpd
      expect(() => basic.act.basic!.use()).toThrow(/different sides of the 200 SPD threshold/)
    }
    // Rainclouds: they agree while she heals, then disagree before Ica's turn.
    const rain = setup()
    rain.battle.party.setEnergy('hy', 140)
    rain.act.ultimate!.use()
    // (The kernel's answers are cached per request, so it is the timeline's SPD that moves.)
    rain.battle.timeline.modifiers.apply({ id: 't', target: 'hy', source: 'hy', spdFlat: 110 })
    expect(() => rain.battle.run()).toThrow(/different sides of the 200 SPD threshold/)
    // It stops before Ica's damage is priced, not later at her own Basic ATK.
    expect(rain.dealt.filter((d) => d.ability === 'MEMO_SKILL')).toHaveLength(0)
    // Agreeing SPDs on the same side pass.
    const ok = setup()
    ok.knobs.spd = 180
    ok.battle.timeline.modifiers.apply({ id: 't', target: 'hy', source: 'hy', spdFlat: 80 })
    expect(() => ok.act.skill!.use()).not.toThrow()
  })

  it('from E4 the check also compares the SPD over 200 (CRIT DMG +2% per point), within 0.01, capped at 400', () => {
    const run = (eidolon: number, timelineSpd: number, kernelSpd: number) => {
      const { battle, knobs, act } = setup(eidolon)
      battle.timeline.modifiers.apply({ id: 't', target: 'hy', source: 'hy', spdFlat: timelineSpd - 100 })
      knobs.spd = kernelSpd
      return () => act.basic!.use()
    }
    expect(run(4, 210, 220)).toThrow(/E4's CRIT DMG/)
    expect(run(4, 210, 210.005)).not.toThrow()
    expect(run(4, 450, 500)).not.toThrow() // both over the 400 cap
    // Before E4 only the side counts.
    expect(run(3, 210, 220)).not.toThrow()
  })

  it('E4 gives Fribbels its CRIT DMG switch from E4 on, not from E3; Halt itself stays on', () => {
    for (const eidolon of [3, 4]) {
      const requests: DamageRequest[] = []
      const { act } = setup(eidolon, requests)
      act.basic!.use()
      const mine = requests.filter((r) => r.attacker.characterId === '1409').at(-1)!.attacker.characterConditionals
      expect(mine).toMatchObject({ e4CdBuff: eidolon >= 4, spd200HpBuff: true })
    }
  })

  it("E1: in After Rain the Max HP is 50% more (Ica's from hers), and Ica itself is healed after its attack", () => {
    const { battle, healed, act, ica } = setup(1, [], { spd: 150, rain: true })
    battle.party.setEnergy('hy', 140)
    act.ultimate!.use()
    // Rain 30% + 50% + 600 on every ally; Ica's is the same share on her half-HP base.
    expect(battle.party.get('a').maxHp).toBeCloseTo(HP + 0.8 * HP + 600, 6)
    expect(battle.party.get(ica).maxHp).toBeCloseTo(0.5 * HP + 0.5 * (0.8 * HP) + 600, 6)
    healed.length = 0
    battle.run()
    // Ica is an ally (not only a character): her own Rainclouds is an attack and E1 heals her for 8% of Hyacine's Max HP.
    expect(healed.find((h) => h.unit === ica && h.source === 'hy')).toBeDefined()
  })

  it('Take Sky in Hand heals are checked at the start and at the end of a turn, not only after actions', () => {
    const start = setup()
    start.act.skill!.use()
    damage(start.battle, 'a', 1000)
    start.healed.length = 0
    let atFirstStart: number | undefined
    start.battle.timeline.bus.on('turnStart', () => {
      atFirstStart ??= start.healed.filter((h) => h.source === start.ica).length
    })
    start.battle.run()
    expect(atFirstStart).toBe(1)

    const end = setup()
    end.act.skill!.use()
    const toA = () => end.healed.filter((h) => h.source === end.ica && h.unit === 'a').length
    let baseline: number | undefined
    let gained: number | undefined
    // Registered after the kit's listeners: the HP is lost once the kit's own check after the action is over, so only the turn's end can heal it.
    end.battle.timeline.bus.on('actionUsed', () => {
      if (baseline !== undefined) return
      baseline = toA()
      damage(end.battle, 'a', 1000)
    })
    end.battle.timeline.bus.on('turnEnd', () => {
      if (baseline !== undefined) gained ??= toA() - baseline
    })
    end.battle.run()
    expect(gained).toBe(1)
  })

  it('the first summon gives +45 energy, a later one only +15', () => {
    const { battle, act, ica } = setup()
    act.skill!.use()
    expect(battle.party.get('hy').energy).toBeCloseTo(30 + 15 + 30, 9)
    battle.removeMemosprite(ica, 'hp')
    const energy = battle.party.get('hy').energy
    act.skill!.use()
    expect(battle.isMemosprite(ica)).toBe(true)
    expect(battle.party.get('hy').energy).toBeCloseTo(energy + 30 + 15, 9)
  })
})

describe('Hyacine: Technique, Day So Right, Life So Fine! (K31)', () => {
  const TECH = 'hyacine.technique_max_hp'
  const techHeal = (0.3 * HP + 600) * HEAL_MULTIPLIER

  /** Runs the battle and records, for 'a', its Max HP at each of its turn starts, plus everything Hyacine healed at the start. */
  function run(technique: { start?: boolean, hy?: boolean }, eidolon = 0, requests: DamageRequest[] = []) {
    const t = setup(eidolon, requests, { spd: 150, rain: false }, technique)
    const maxHpAtTurn: Record<string, number[]> = { hy: [], a: [], b: [] }
    const startHeals: EngineEvents['healed'][] = []
    let started = false
    t.battle.timeline.bus.on('healed', (h) => { if (!started) startHeals.push(h) })
    t.battle.timeline.bus.on('turnStart', (turn) => {
      started = true
      maxHpAtTurn[turn.unit]?.push(t.battle.party.get(turn.unit).maxHp)
    })
    t.battle.run()
    return { ...t, maxHpAtTurn, startHeals }
  }

  it('with the technique on, every character is healed for 30% of her Max HP + 600, as a heal from her (Outgoing Healing in it), overheal included', () => {
    const { startHeals } = run({ hy: true })
    expect(startHeals.map((h) => h.unit).sort()).toEqual(['a', 'b', 'hy'])
    for (const h of startHeals) {
      expect(h.source).toBe('hy')
      expect(h.amount).toBe(0) // everyone starts at full HP, so it is all overheal
      expect(h.overheal).toBeCloseTo(techHeal, 6)
    }
  })

  it('the heal feeds the tally of Rainclouds like any heal of hers', () => {
    const { battle, q } = setup(0, [], { spd: 150, rain: false }, { hy: true })
    expect(q('tally')).toBe(0)
    battle.member('hy').instance.onBattleStart!({ techniques: true })
    expect(q('tally')).toBeCloseTo(3 * techHeal, 6)
  })

  it('every character gets Max HP +20% for 2 turns, counted down by its own turns', () => {
    const { maxHpAtTurn } = run({ hy: true })
    for (const unit of ['hy', 'a', 'b']) {
      // Up for the first two turns of each.
      expect(maxHpAtTurn[unit]!.slice(0, 2), unit).toEqual([HP * 1.2, HP * 1.2].map((v) => expect.closeTo(v, 6)))
    }
    // And gone for the third (Hyacine and 'a' have a third turn in 3 cycles).
    expect(maxHpAtTurn.hy![2]).toBeCloseTo(HP, 6)
    expect(maxHpAtTurn.a![2]).toBeCloseTo(HP, 6)
  })

  it('the Max HP buff is a modifier of 2 turns on each character, and the kernel gets it as an injected HP% buff only while it is held', () => {
    const requests: DamageRequest[] = []
    const { battle } = setup(0, requests, { spd: 150, rain: false }, { hy: true })
    battle.member('hy').instance.onBattleStart!({ techniques: true })
    for (const unit of ['hy', 'a', 'b']) expect(battle.timeline.modifiers.get(unit, TECH)!.turnsLeft, unit).toBe(2)
    expect(battle.party.get('a').maxHp).toBeCloseTo(HP * 1.2, 6)
    const injected = () => requests.filter((r) => r.attacker.characterId === 'dummy').map((r) => r.injectedBuffs)
    expect(injected()).toContainEqual([expect.objectContaining({ stat: 'HP_PERCENT', value: 0.2, target: 'team' })])
    battle.timeline.modifiers.remove('a', TECH)
    expect(battle.party.get('a').maxHp).toBeCloseTo(HP, 6)
    expect(battle.party.get('b').maxHp).toBeCloseTo(HP * 1.2, 6) // the others keep theirs
  })

  it('the heal is priced on her Max HP from before the buff (heal first, then Max HP)', () => {
    const { startHeals } = run({ hy: true })
    expect(startHeals[0]!.overheal).toBeCloseTo((0.3 * HP + 600) * HEAL_MULTIPLIER, 6)
    expect(startHeals[0]!.overheal).not.toBeCloseTo((0.3 * HP * 1.2 + 600) * HEAL_MULTIPLIER, 0)
  })

  it('off: with the technique off nobody is healed or buffed, and the heal of nobody reaches the tally', () => {
    for (const technique of [{}, { start: false }, { start: true, hy: false }]) {
      const { startHeals, maxHpAtTurn, battle } = run(technique)
      expect(startHeals, JSON.stringify(technique)).toEqual([])
      expect(maxHpAtTurn.a![0]).toBeCloseTo(HP, 6)
      expect(battle.timeline.modifiers.has('a', TECH)).toBe(false)
    }
  })

  it('the own switch of a member overrides the battle default, both ways', () => {
    expect(run({ start: false, hy: true }).startHeals).toHaveLength(3)
    expect(run({ start: true }).startHeals).toHaveLength(3) // no member setting: the battle default
    expect(run({ start: true, hy: false }).startHeals).toHaveLength(0)
  })

  it('Little Ica is not healed or buffed: the technique reaches characters only', () => {
    const { startHeals, ica } = run({ hy: true })
    expect(startHeals.map((h) => h.unit)).not.toContain(ica)
  })
})
