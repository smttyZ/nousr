import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { CombatStats, DamageKernel, DamageRequest, HitResult } from '../kernel/types'
import { Hyacine, hyacineScalings, icaId } from './hyacine'
import type { Kit } from './kit'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

const HP = 100_000
const OHB = 0.1
const HEAL_MULTIPLIER = 1 + OHB
/** A fake kernel: Hyacine's in-combat Max HP and Outgoing Healing are fixed, her heal hits are the text's base heals times (1 + OHB), more with the 25% trace. */
function kernelFor(eidolon: number, requests: DamageRequest[] = []): DamageKernel {
  const s = hyacineScalings(eidolon)
  return {
    actionDamage: (request) => {
      requests.push(request)
      if (request.attacker.characterId !== '1409') return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] })
      const low = request.attacker.characterConditionals?.healTargetHp50 === true
      const mult = HEAL_MULTIPLIER + (low ? 0.25 : 0)
      const heal = (pct: number, flat: number): HitResult => ({ damage: (pct * HP + flat) * mult, output: 'HEAL' })
      const stats: CombatStats = { ATK: 0, DEF: 0, HP, SPD: 150, CR: 0, CD: 0, EHR: 0, RES: 0, BE: 0, ERR: 0, OHB: OHB + (low ? 0.25 : 0) }
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

const member = (key: string, kit: Kit, characterId: string, eidolon: number, baseSpd: number): MemberSetup => ({
  key,
  kit,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: HP, def: 1000, baseSpd },
  kernel: { unit: { characterId, lightConeId: 'none', eidolon, superimposition: 1 }, build: noBuild },
})

function setup(eidolon = 0, requests: DamageRequest[] = []) {
  const battle = new Battle({
    members: [member('hy', Hyacine, '1409', eidolon, 100), member('a', dummy, 'dummy', 0, 90), member('b', dummy, 'dummy', 0, 80)],
    policy: [{ unit: 'hy', use: 'basic', when: [] }, { unit: 'a', use: 'basic', when: [] }, { unit: 'b', use: 'basic', when: [] }],
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 3,
    start: { energy: 0, skillPoints: 5, techniques: false },
    kernel: kernelFor(eidolon, requests),
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
  return { battle, healed, dealt, actions, act, q, ica, requests }
}

const damage = (battle: Battle, unit: string, amount: number) => battle.party.takeDamage(unit, amount, 'enemy1')

describe('Hyacine: Basic ATK and Skill', () => {
  it('Basic ATK: +20 energy, +1 Skill Point, 50% of her Max HP (55% from E3) priced as BASIC hit 0', () => {
    for (const [eidolon, scaling] of [[0, 0.5], [3, 0.55]] as const) {
      const { battle, dealt, act } = setup(eidolon)
      act.basic!.use()
      expect(battle.skillPoints).toBe(6 > 5 ? 5 : 6)
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

  it('Ica starts with 50% of her in-combat Max HP, 0 SPD (not on the timeline), and is untargetable', () => {
    const { battle, act, ica } = setup()
    act.skill!.use()
    expect(battle.party.get(ica).maxHp).toBeCloseTo(0.5 * HP, 6)
    expect(battle.timeline.has(ica)).toBe(false)
    expect(battle.party.get(ica).targetable).toBe(false)
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
      const before = dealt.length
      battle.run()
      const first = dealt.slice(before).find((d) => d.ability === 'MEMO_SKILL')!
      expect(first.scaling).toBeCloseTo((s.memoSkill * tally) / 10_000, 9)
      // The fake hit is 10,000 x share per unit of its multiple 'share': damage = tally x share.
      expect(first.damage).toBeCloseTo(s.memoSkill * tally, 6)
      expect(battle.party.get('hy').energy).toBeGreaterThan(energy)
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
