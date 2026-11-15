import { afterEach, describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { BattleSetup, MemberSetup } from '../battle/battle'
import type { Path } from '../battle/party'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Rule } from '../scenario/types'
import { BEATIFIED_MODIFIER, Sunday, sundayScalings, SKILL_MODIFIER, TALENT_MODIFIER } from './sunday'
import type { Kit } from './kit'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/** Sunday's CRIT DMG in the fake kernel's stats: a test changes it to see the Ultimate's buff follow it. */
const cd = { value: 2.0 }
/** Extra CRIT DMG teammates give Sunday in the fake kernel: a request changes, so the kernel cache does not hide the change. */
const gift = { value: 0 }

/** A teammate with a Basic ATK of 100% and nothing else; `maxEnergy` and `summon` vary per test. */
const makeAlly = (path: Path, options: { maxEnergy?: number, summon?: boolean } = {}): Kit => ({
  characterId: 'ally',
  path,
  element: 'Lightning',
  maxEnergy: options.maxEnergy ?? 0,
  create: (battle, self) => {
    if (options.summon) battle.addSummon({ id: `${self.key}.pet`, owner: self.key, baseSpd: 50, takeTurn: () => {} })
    return {
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
      teammateState: () => ({ characterConditionals: { cdGift: gift.value } }),
    }
  },
})

function makeKernel(requests: DamageRequest[] = []): DamageKernel {
  return {
    actionDamage(request) {
      requests.push(request)
      const stats = { ATK: 0, DEF: 0, HP: 0, SPD: 0, CR: 0, CD: cd.value + request.teammates.reduce((t, m) => t + Number(m.characterConditionals?.cdGift ?? 0), 0), EHR: 0, RES: 0, BE: 0, ERR: 0, OHB: 0 }
      if (request.attacker.characterId !== '1313') return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }], MEMO_SKILL: [{ damage: 500, scaling: 1 }] })
      const s = sundayScalings(request.attacker.eidolon)
      return fakeResult({ BASIC: [{ damage: 1000 * s.basic, scaling: s.basic }] }, stats)
    },
  }
}

const sunday = (eidolon = 0, baseSpd = 100): MemberSetup => ({
  key: 'sunday',
  kit: Sunday,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
  kernel: { unit: { characterId: '1313', lightConeId: '21025', eidolon, superimposition: 5 }, build: noBuild },
})

const ally = (key: string, kit: Kit, baseSpd = 100, energyRegen?: number): MemberSetup => ({
  key,
  kit,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd, ...(energyRegen !== undefined && { energyRegen }) },
  kernel: { unit: { characterId: 'ally', lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
})

afterEach(() => {
  cd.value = 2.0
  gift.value = 0
})

const basicPolicy: Rule[] = [
  { unit: 'sunday', use: 'basic', when: [] },
  { unit: 'dps', use: 'basic', when: [] },
  { unit: 'sup', use: 'basic', when: [] },
  { unit: 'harmony', use: 'basic', when: [] },
]

function setup(overrides: Partial<BattleSetup> & { eidolon?: number, dps?: Kit, sup?: Kit, sundaySpd?: number } = {}) {
  const { eidolon, dps, sup, sundaySpd, ...rest } = overrides
  const requests: DamageRequest[] = []
  const battle = new Battle({
    members: [sunday(eidolon ?? 0, sundaySpd), ally('dps', dps ?? makeAlly('Hunt', { maxEnergy: 120 }), 80), ally('sup', sup ?? makeAlly('Abundance')), ally('harmony', makeAlly('Harmony'), 60)],
    policy: basicPolicy,
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 4,
    start: { energy: 0, skillPoints: 3, techniques: false },
    kernel: makeKernel(requests),
    ...rest,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  const act = battle.member('sunday').instance.actions
  /** What the kit tells the kernel about Sunday when `key` attacks. */
  const told = (key: string) => battle.member('sunday').instance.teammateState(battle.member(key), battle.primary).characterConditionals!
  const read = (name: string) => battle.member('sunday').instance.quantities![name]!()
  return { battle, dealt, requests, act, told, read }
}

describe('Sunday: ability numbers from the kit text', () => {
  it('multiples by eidolon', () => {
    const e0 = sundayScalings(0)
    expect(e0).toEqual({ basic: 1.0, skillDmg: 0.3, skillDmgSummon: 0.5, ultCritDmgShare: 0.3, ultCritDmgFlat: 0.12, talentCritRate: 0.2 })
    // E3: Ultimate +2, Basic ATK +1; the Skill and Talent are still Lv10.
    const e3 = sundayScalings(3)
    expect([e3.basic, e3.ultCritDmgShare, e3.ultCritDmgFlat, e3.skillDmg, e3.talentCritRate]).toEqual([1.1, 0.336, 0.128, 0.3, 0.2])
    // E5: Skill +2 and Talent +2.
    const e5 = sundayScalings(5)
    expect([e5.skillDmg, e5.skillDmgSummon, e5.talentCritRate]).toEqual([0.33, 0.55, 0.22])
  })

  it('Basic ATK: +20 energy, +1 SP, 30 toughness, hit 0 of BASIC; E3 makes it 110%', () => {
    const { battle, dealt, act } = setup({ start: { energy: 0, skillPoints: 2, techniques: false } })
    act.basic!.use()
    expect(battle.skillPoints).toBe(3)
    expect(battle.party.get('sunday').energy).toBe(20)
    expect(dealt[0]).toMatchObject({ ability: 'BASIC', scaling: 1, damage: 1000 })
    expect(battle.enemies.toughness(battle.primary)).toBe(profile.toughness - 30)
    const e3 = setup({ eidolon: 3 })
    e3.act.basic!.use()
    expect(e3.dealt[0]).toMatchObject({ scaling: 1.1 })
  })

  it('has 130 energy and the Ultimate needs all of it', () => {
    const { battle, act } = setup()
    expect(battle.party.get('sunday').maxEnergy).toBe(130)
    expect(act.ultimate!.canUse()).toBe(false)
    battle.party.setEnergy('sunday', 130)
    expect(act.ultimate!.canUse()).toBe(true)
  })
})

describe('Sunday: the Skill', () => {
  it('costs 1 SP, gives 30 energy, and needs an ally other than himself', () => {
    const { battle, act } = setup()
    expect(() => act.skill!.use()).toThrow(/needs a target/)
    expect(() => act.skill!.use('sunday')).toThrow(/cannot target himself/)
    expect(() => act.skill!.use('nobody')).toThrow(/not an ally/)
    act.skill!.use('dps')
    expect(battle.skillPoints).toBe(2)
    expect(battle.party.get('sunday').energy).toBe(30)
  })

  it('cannot be used without a Skill Point', () => {
    const { act } = setup({ start: { energy: 0, skillPoints: 0, techniques: false } })
    expect(act.skill!.canUse()).toBe(false)
  })

  it('advances the target to act at once, and not a Harmony ally', () => {
    const { battle, act } = setup()
    expect(battle.timeline.gauge('dps')).toBeGreaterThan(0)
    act.skill!.use('dps')
    expect(battle.timeline.gauge('dps')).toBe(0)
    expect(battle.timeline.gauge('harmony')).toBeGreaterThan(0)
    act.skill!.use('harmony')
    expect(battle.timeline.gauge('harmony')).toBeGreaterThan(0)
    // ... but the Harmony ally still gets the buffs.
    expect(battle.timeline.modifiers.has('harmony', SKILL_MODIFIER)).toBe(true)
  })

  it("advances the target's summon too", () => {
    const { battle, act } = setup({ dps: makeAlly('Hunt', { summon: true }) })
    expect(battle.timeline.gauge('dps.pet')).toBeGreaterThan(0)
    act.skill!.use('dps')
    expect(battle.timeline.gauge('dps.pet')).toBe(0)
    expect(battle.timeline.gauge('dps')).toBe(0)
  })

  it('the target is acting first: it takes its turn before Sunday, immediately', () => {
    const { battle } = setup()
    battle.member('sunday').instance.actions.skill!.use('dps')
    const order: string[] = []
    battle.timeline.bus.on('turnStart', (t) => order.push(t.unit))
    battle.run()
    expect(order[0]).toBe('dps')
  })

  it('the DMG switch (and E1 DEF PEN, and the Talent) are on for the target only, for 2 turns; the Talent for 3', () => {
    const { battle, act, told } = setup({ eidolon: 1 })
    expect(told('dps')).toMatchObject({ skillDmgBuff: false, talentCrBuffStacks: 0, e1DefPen: false })
    act.skill!.use('dps')
    expect(told('dps')).toMatchObject({ skillDmgBuff: true, talentCrBuffStacks: 1, e1DefPen: true, beatified: false, e2DmgBuff: false })
    expect(told('sup')).toMatchObject({ skillDmgBuff: false, talentCrBuffStacks: 0, e1DefPen: false })

    const seen: Array<{ turn: number, skill: unknown, stacks: unknown }> = []
    battle.timeline.bus.on('turnStart', (t) => {
      if (t.unit === 'dps') seen.push({ turn: t.index, skill: told('dps').skillDmgBuff, stacks: told('dps').talentCrBuffStacks })
    })
    battle.run()
    expect(seen.slice(0, 4)).toEqual([
      { turn: 1, skill: true, stacks: 1 },
      { turn: 2, skill: true, stacks: 1 },
      { turn: 3, skill: false, stacks: 1 },
      { turn: 4, skill: false, stacks: 0 },
    ])
  })

  it('without E1 the DEF PEN switch is off', () => {
    const { act, told } = setup()
    act.skill!.use('dps')
    expect(told('dps')).toMatchObject({ skillDmgBuff: true, e1DefPen: false })
  })

  it('E6: the Talent stacks to 3, lasts 4 turns, and turns excess CRIT Rate into CRIT DMG only while it is up', () => {
    const { battle, act, told } = setup({ eidolon: 6, start: { energy: 0, skillPoints: 5, techniques: false } })
    expect(told('dps').e6CrToCdConversion).toBe(false)
    for (let i = 1; i <= 4; i++) {
      act.skill!.use('dps')
      expect(told('dps').talentCrBuffStacks, `after ${i} Skills`).toBe(Math.min(i, 3))
    }
    expect(told('dps').e6CrToCdConversion).toBe(true)
    expect(battle.timeline.modifiers.get('dps', TALENT_MODIFIER)!.turnsLeft).toBe(4)
    expect(told('sup').e6CrToCdConversion).toBe(false)
  })

  it('the Talent is 1 stack at E5 too', () => {
    const { act, told } = setup({ eidolon: 5, start: { energy: 0, skillPoints: 5, techniques: false } })
    act.skill!.use('dps')
    act.skill!.use('dps')
    expect(told('dps').talentCrBuffStacks).toBe(1)
  })
})

describe('Sunday: the Ultimate and The Beatified', () => {
  const full = (battle: Battle) => battle.party.setEnergy('sunday', 130)

  it('costs everything, gives 5 energy, and the target regenerates 20% of its Max Energy, at least 40', () => {
    const big = setup({ dps: makeAlly('Hunt', { maxEnergy: 300 }) })
    full(big.battle)
    big.act.ultimate!.use('dps')
    expect(big.battle.party.get('sunday').energy).toBe(5)
    expect(big.battle.party.get('dps').energy).toBe(60)

    const small = setup({ dps: makeAlly('Hunt', { maxEnergy: 120 }) })
    full(small.battle)
    small.act.ultimate!.use('dps')
    expect(small.battle.party.get('dps').energy).toBe(40) // 20% of 120 is 24; the trace lifts it to 40
  })

  it("the target's Energy Regeneration Rate does not scale it (IN-GAME CHECK), Sunday's own does", () => {
    const battle = new Battle({
      members: [
        { ...sunday(), stats: { maxHp: 1e6, def: 1000, baseSpd: 100, energyRegen: 0.5 } },
        ally('dps', makeAlly('Hunt', { maxEnergy: 300 }), 80, 0.5),
      ],
      policy: [{ unit: 'sunday', use: 'basic', when: [] }, { unit: 'dps', use: 'basic', when: [] }],
      profile,
      enemyCount: 1,
      weaknesses: 'all',
      cycles: 1,
      start: { energy: 0, skillPoints: 3, techniques: false },
      kernel: makeKernel(),
    })
    battle.party.setEnergy('sunday', 130)
    battle.member('sunday').instance.actions.ultimate!.use('dps')
    expect(battle.party.get('dps').energy).toBe(60)
    expect(battle.party.get('sunday').energy).toBeCloseTo(7.5, 12)
  })

  it('The Beatified: the target holds it, with Sunday\'s CRIT DMG live in the value the kernel is told', () => {
    const { battle, act, told } = setup()
    cd.value = 2.0
    gift.value = 0
    full(battle)
    expect(told('dps')).toMatchObject({ beatified: false, teammateCDValue: 0 })
    act.ultimate!.use('dps')
    expect(told('dps')).toMatchObject({ beatified: true, teammateCDValue: 2.0 })
    expect(told('sup')).toMatchObject({ beatified: false, teammateCDValue: 0 })
    // His CRIT DMG changes; the next action of anyone brings the value up to date.
    gift.value = 0.5
    battle.member('sup').instance.actions.basic!.use()
    // Three teammates each give 0.5 in the fake kernel.
    expect(told('dps').teammateCDValue).toBe(3.5)
    gift.value = 0
  })

  it('only the most recent target holds it, and an Ultimate on himself changes nothing about it', () => {
    const { battle, act, told } = setup()
    full(battle)
    act.ultimate!.use('dps')
    full(battle)
    act.ultimate!.use('sup')
    expect(told('dps').beatified).toBe(false)
    expect(told('sup').beatified).toBe(true)
    full(battle)
    act.ultimate!.use('sunday')
    expect(told('sup').beatified).toBe(true)
    expect(battle.party.get('sunday').energy).toBeGreaterThan(5) // he regenerated 40 as the target
  })

  it('counts down at the start of his turns: 3 in all', () => {
    const { battle, act, read } = setup({ sundaySpd: 100 })
    full(battle)
    act.ultimate!.use('dps')
    expect(read('has_beatified')).toBe(true)
    expect(read('beatified_turns_left')).toBe(3)
    const left: number[] = []
    battle.timeline.bus.on('turnEnd', (t) => {
      if (t.unit === 'sunday') left.push(read('beatified_turns_left') as number)
    })
    battle.run()
    // The count drops when each of his turns starts (read at the end of each turn), so the buff is gone as his third turn begins.
    expect(left.slice(0, 3)).toEqual([2, 1, 0])
    expect(read('has_beatified')).toBe(false)
  })

  it('is dispelled when he is knocked down', () => {
    const { battle, act, told, read } = setup()
    full(battle)
    act.ultimate!.use('dps')
    battle.party.takeDamage('sunday', 1e12, 'enemy')
    expect(read('has_beatified')).toBe(false)
    expect(told('dps').beatified).toBe(false)
    expect(battle.timeline.modifiers.has('dps', BEATIFIED_MODIFIER)).toBe(false)
  })

  it('a Skill on The Beatified gives the Skill Point back', () => {
    const { battle, act } = setup()
    act.skill!.use('dps')
    expect(battle.skillPoints).toBe(2)
    full(battle)
    act.ultimate!.use('dps')
    act.skill!.use('dps')
    expect(battle.skillPoints).toBe(2)
    act.skill!.use('sup')
    expect(battle.skillPoints).toBe(1)
  })

  it('E2: +2 SP after the first Ultimate only, and +30% DMG for The Beatified only', () => {
    const { battle, act, told } = setup({ eidolon: 2, start: { energy: 0, skillPoints: 0, techniques: false } })
    expect(told('dps').e2DmgBuff).toBe(false)
    full(battle)
    act.ultimate!.use('dps')
    expect(battle.skillPoints).toBe(2)
    expect(told('dps').e2DmgBuff).toBe(true)
    expect(told('sup').e2DmgBuff).toBe(false)
    full(battle)
    act.ultimate!.use('sup')
    expect(battle.skillPoints).toBe(2)
    expect(told('dps').e2DmgBuff).toBe(false)
    expect(setup().told('dps').e2DmgBuff).toBe(false)
  })

  it('E6: the Ultimate also gives the target one Talent stack', () => {
    const { battle, act, told } = setup({ eidolon: 6 })
    full(battle)
    act.ultimate!.use('dps')
    expect(told('dps').talentCrBuffStacks).toBe(1)
    const e0 = setup()
    full(e0.battle)
    e0.act.ultimate!.use('dps')
    expect(e0.told('dps').talentCrBuffStacks).toBe(0)
  })
})

describe('Sunday: traces, E4 and the Technique', () => {
  it('Exalted Sweep: 25 energy when the battle starts', () => {
    const { battle } = setup({ cycles: 1 })
    battle.run()
    expect(battle.party.get('sunday').energy).toBeGreaterThanOrEqual(25)
  })

  it('E4: 8 energy at the start of his turn', () => {
    const run = (eidolon: number) => {
      const { battle, read } = setup({ eidolon, cycles: 1, policy: [{ unit: 'sunday', use: 'basic', when: [] }, { unit: 'dps', use: 'basic', when: [] }, { unit: 'sup', use: 'basic', when: [] }, { unit: 'harmony', use: 'basic', when: [] }] })
      void read
      let turns = 0
      battle.timeline.bus.on('turnStart', (t) => {
        if (t.unit === 'sunday') turns += 1
      })
      battle.run()
      return { energy: battle.party.get('sunday').energy, turns }
    }
    const e3 = run(3)
    const e4 = run(4)
    expect(e4.turns).toBe(e3.turns)
    expect(e4.energy - e3.energy).toBeCloseTo(8 * e3.turns, 9)
  })

  it('Technique: the first ability on an ally gives 50% DMG for 2 turns, only with techniques on', () => {
    const on = setup({ start: { energy: 0, skillPoints: 5, techniques: true } })
    on.battle.run()
    // run() starts the battle; use a fresh one to act before the run and read the state.
    const fresh = setup({ start: { energy: 0, skillPoints: 5, techniques: true }, cycles: 1 })
    fresh.battle.member('sunday').instance.onBattleStart!({ techniques: true })
    fresh.act.skill!.use('dps')
    expect(fresh.told('dps').techniqueDmgBuff).toBe(true)
    fresh.act.skill!.use('sup')
    expect(fresh.told('sup').techniqueDmgBuff).toBe(false)

    const off = setup({ start: { energy: 0, skillPoints: 5, techniques: false }, cycles: 1 })
    off.battle.member('sunday').instance.onBattleStart!({ techniques: false })
    off.act.skill!.use('dps')
    expect(off.told('dps').techniqueDmgBuff).toBe(false)
  })

  it('Technique: an Ultimate on an ally counts as the first ability, and one on himself does not', () => {
    const a = setup({ cycles: 1 })
    a.battle.member('sunday').instance.onBattleStart!({ techniques: true })
    a.battle.party.setEnergy('sunday', 130)
    a.act.ultimate!.use('dps')
    expect(a.told('dps').techniqueDmgBuff).toBe(true)

    const b = setup({ cycles: 1 })
    b.battle.member('sunday').instance.onBattleStart!({ techniques: true })
    b.battle.party.setEnergy('sunday', 130)
    b.act.ultimate!.use('sunday')
    b.act.skill!.use('dps')
    expect(b.told('dps').techniqueDmgBuff).toBe(true)
  })
})

describe('Sunday: what the kernel is told is complete and never Fribbels defaults', () => {
  it('every key of Fribbels\' teammate content is given in every state', () => {
    const { battle, act, told } = setup({ eidolon: 6 })
    const keys = ['skillDmgBuff', 'talentCrBuffStacks', 'beatified', 'teammateCDValue', 'techniqueDmgBuff', 'e1DefPen', 'e2DmgBuff', 'e6CrToCdConversion']
    expect(Object.keys(told('dps')).sort()).toEqual([...keys].sort())
    act.skill!.use('dps')
    battle.party.setEnergy('sunday', 130)
    act.ultimate!.use('dps')
    expect(Object.keys(told('dps')).sort()).toEqual([...keys].sort())
    expect(told('dps')).toEqual({
      skillDmgBuff: true,
      talentCrBuffStacks: 2,
      beatified: true,
      teammateCDValue: cd.value,
      techniqueDmgBuff: false,
      e1DefPen: true,
      e2DmgBuff: true,
      e6CrToCdConversion: true,
    })
  })

  it('a kit that asks the kernel through a full run gets no error (the live CRIT DMG read is outside the request build)', () => {
    const { battle, act } = setup({ eidolon: 6, cycles: 3 })
    act.skill!.use('dps')
    battle.party.setEnergy('sunday', 130)
    act.ultimate!.use('dps')
    expect(() => battle.run()).not.toThrow()
  })
})

describe('Sunday: a target that owns a memosprite', () => {
  /** A stub owner whose memosprite attacks as its owner's MEMO_SKILL, the way the engine's memosprites do. */
  const Owner: Kit = {
    ...makeAlly('Remembrance', { maxEnergy: 120 }),
    create: (battle, self) => {
      const base = makeAlly('Remembrance', { maxEnergy: 120 }).create(battle, self)
      const id = `${self.key}.memo`
      battle.addMemosprite({
        id,
        owner: self.key,
        name: 'stub',
        maxHp: 1000,
        baseAggro: 4,
        baseSpd: 40,
        takeTurn: () =>
          battle.performAction(id, 'memo_skill', 'skill', () =>
            battle.attack({ attacker: self.key, ability: 'MEMO_SKILL', parts: [{ shape: 'single', scaling: 1, hit: 0 }] }),
          ),
      })
      return base
    },
  }

  it('the Skill advances the memosprite with its owner', () => {
    const { battle, act } = setup({ dps: Owner })
    expect(battle.timeline.gauge('dps.memo')).toBeGreaterThan(0)
    act.skill!.use('dps')
    expect(battle.timeline.gauge('dps.memo')).toBe(0)
    expect(battle.timeline.gauge('dps')).toBe(0)
  })

  it('no advance for a Harmony owner, memosprite included', () => {
    const { battle, act } = setup({ dps: { ...Owner, path: 'Harmony' } })
    act.skill!.use('dps')
    expect(battle.timeline.gauge('dps.memo')).toBeGreaterThan(0)
  })

  it('a memosprite is not an ally character to aim at', () => {
    const { act } = setup({ dps: Owner })
    expect(() => act.skill!.use('dps.memo')).toThrow(/not an ally character/)
  })

  it("the memosprite's damage is priced in the owner's request, which carries the owner's live Sunday state", () => {
    const { battle, act, told } = setup({ dps: Owner, eidolon: 6 })
    act.skill!.use('dps')
    battle.party.setEnergy('sunday', 130)
    act.ultimate!.use('dps')
    const seen: Array<Record<string, number | boolean>> = []
    battle.timeline.bus.on('damageDealt', (d) => {
      if (d.ability === 'MEMO_SKILL') seen.push({ ...told('dps') })
    })
    battle.run()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]).toMatchObject({ skillDmgBuff: true, beatified: true, e2DmgBuff: true, talentCrBuffStacks: 2, e6CrToCdConversion: true })
  })
})
