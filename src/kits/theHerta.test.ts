import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { BattleSetup, HitPart, MemberSetup } from '../battle/battle'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Path } from '../battle/party'
import type { Rule } from '../scenario/types'
import type { Kit } from './kit'
import { E4_MODIFIER, TECHNIQUE_MODIFIER, TheHerta, theHertaScalings, theHertaUltMultiple, ULT_ATK_MODIFIER } from './theHerta'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/** Damage per 100% of a hit: Basic 1,000; Skill 2,000 (x1.5 when the +50% Skill DMG switch is on); Ultimate 3,000. */
function fakeKernel() {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = {
    actionDamage(request) {
      requests.push(request)
      if (request.attacker.characterId !== '1401') return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }], ULT: [{ damage: 1000, scaling: 1 }] })
      const c = request.attacker.characterConditionals ?? {}
      const boost = c.enhancedSkill === true && (c.interpretationStacks as number) >= 42
      return fakeResult({
        BASIC: [{ damage: 1000, scaling: 1 }],
        SKILL: [{ damage: boost ? 3000 : 2000, scaling: 1 }],
        ULT: [{ damage: 3000, scaling: 1 }],
      })
    },
  }
  return { kernel, requests }
}

type Mode = 'single' | 'aoe' | 'bounce3' | 'edge1' | 'extra'

/** A made-up ally of a given path. Its Basic ATK hits as `mode.m` says (a single hit on the primary by default). */
const ally = (path: Path, mode: { m: Mode }): Kit => ({
  characterId: 'helper',
  path,
  element: 'Ice',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'basic', 'basic', () => {
            battle.gainSkillPoints(1)
            const part: HitPart =
              mode.m === 'aoe'
                ? { shape: 'aoe', scaling: 1, hit: 0 }
                : mode.m === 'bounce3'
                  ? { shape: 'bounce', scaling: 1, hits: 3, hit: 0 }
                  : mode.m === 'edge1'
                    ? { shape: 'single', scaling: 1, hit: 0, target: 'enemy1' }
                    : { shape: 'single', scaling: 1, hit: 0 }
            // 'extra': a normal hit on the primary plus Additional DMG on enemy1 (not an attack).
            const parts: HitPart[] = mode.m === 'extra' ? [part, { shape: 'single', scaling: 1, hit: 0, target: 'enemy1', additional: true }] : [part]
            battle.attack({ attacker: self.key, ability: 'BASIC', parts })
          }),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
})

const hertaMember = (eidolon: number, energyRegen = 0): MemberSetup => ({
  key: 'herta',
  kit: TheHerta,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100, energyRegen },
  kernel: { unit: { characterId: '1401', lightConeId: 'none', eidolon, superimposition: 1 }, build: noBuild },
})
const helperMember = (key: string, path: Path, mode: { m: Mode }, baseSpd = 160): MemberSetup => ({
  key,
  kit: ally(path, mode),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
  kernel: { unit: { characterId: 'helper', lightConeId: 'none', eidolon: 0, superimposition: 1 }, build: noBuild },
})

const rule = (unit: string, use: string, when: Rule['when'] = []): Rule => ({ unit, use, when })

interface SetupOptions extends Partial<BattleSetup> {
  eidolon?: number
  energyRegen?: number
  helpers?: MemberSetup[]
  /** Run `onBattleStart` (the battle does it in `run()`). Default true. */
  start?: BattleSetup['start']
}

function setup(o: SetupOptions = {}) {
  const { kernel, requests } = fakeKernel()
  const { eidolon = 0, energyRegen = 0, helpers = [], ...rest } = o
  const battle = new Battle({
    members: [hertaMember(eidolon, energyRegen), ...helpers],
    policy: [rule('herta', 'basic')],
    profile,
    enemyCount: 3,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0, skillPoints: 3, techniques: false },
    kernel,
    ...rest,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (d) => dealt.push(d))
  const parts: HitPart[][] = []
  battle.timeline.bus.on('attackResolved', (a) => {
    if (a.attacker === 'herta') parts.push([...a.parts])
  })
  const gains: number[] = []
  battle.timeline.bus.on('energyGained', (g) => {
    if (g.unit === 'herta') gains.push(g.amount)
  })
  const herta = battle.member('herta').instance
  const q = (name: string) => herta.quantities![name]!() as number | boolean
  const act = (name: string, who = 'herta') => battle.member(who).instance.actions[name]!.use()
  /** What one enemy took from one ability of hers, summed over the attack calls. */
  const took = (enemy: string, ability: string) =>
    dealt.filter((d) => d.attacker === 'herta' && d.enemy === enemy && d.ability === ability).reduce((s, d) => s + d.damage, 0)
  const start = (techniques = false) => herta.onBattleStart!({ techniques })
  /** The toughness each enemy lost to the parts of the attacks so far (kit text units). */
  const toughnessOf = (enemy: string) =>
    parts.flat().reduce((sum, p) => {
      if (p.shape === 'single' && (p.target ?? battle.primary) === enemy) return sum + (p.toughness ?? 0)
      if (p.shape === 'aoe') return sum + (p.toughness ?? 0)
      return sum
    }, 0)
  return { battle, requests, dealt, parts, gains, q, act, took, start, toughnessOf, herta }
}

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)
const stacksOf = (s: ReturnType<typeof setup>, n: number) => Array.from({ length: n }, (_, i) => s.q(`interpretation_${i + 1}`) as number)

describe('numbers by eidolon', () => {
  it('uses the kit text: Lv10 values, Skill/Talent Lv12 at E3, Ultimate/Basic Lv12 at E5', () => {
    expect(theHertaScalings(0)).toEqual({ basic: 1.0, skill: 0.7, enhanced: 0.8, enhancedAoe: 0.4, stackPrimary: 0.08, stackOther: 0.04, ult: 2.0, ultAtk: 0.8 })
    const e3 = theHertaScalings(3)
    expect([e3.skill, e3.enhanced, e3.enhancedAoe, e3.stackPrimary, e3.stackOther]).toEqual([0.77, 0.88, 0.44, 0.088, 0.044])
    expect([e3.basic, e3.ult]).toEqual([1.0, 2.0])
    const e5 = theHertaScalings(5)
    expect([e5.basic, e5.ult, e5.ultAtk]).toEqual([1.1, 2.2, 0.88])
  })

  it('the Ultimate multiple: +1% per Answer, E6 +140% / 250% / 400% for 3+ / 2 / 1 enemies', () => {
    near(theHertaUltMultiple(0, 30, 3), 2.3)
    near(theHertaUltMultiple(5, 99, 1), 2.2 + 0.99)
    near(theHertaUltMultiple(6, 0, 5), 2.2 + 1.4)
    near(theHertaUltMultiple(6, 0, 2), 2.2 + 2.5)
    near(theHertaUltMultiple(6, 10, 1), 2.2 + 0.1 + 4.0)
  })
})

describe('battle start', () => {
  it('1 stack on each enemy and 25 more on the primary; Answer counts them (3 enemies: 3 + 25 = 28)', () => {
    const s = setup()
    s.start()
    expect(stacksOf(s, 3)).toEqual([1, 26, 1])
    expect(s.q('answer')).toBe(28)
    expect(s.q('inspiration')).toBe(0)
  })

  it('5 enemies: the middle one (the third) gets the 25; Answer 5 + 25 = 30', () => {
    const s = setup({ enemyCount: 5 })
    s.start()
    expect(stacksOf(s, 5)).toEqual([1, 1, 26, 1, 1])
    expect(s.q('answer')).toBe(30)
  })

  it('E2 starts with 1 Inspiration; the Technique and E4 only when on', () => {
    const e0 = setup()
    e0.start()
    expect(e0.battle.timeline.modifiers.has('herta', TECHNIQUE_MODIFIER)).toBe(false)
    const e2 = setup({ eidolon: 2 })
    e2.start(true)
    expect(e2.q('inspiration')).toBe(1)
    expect(e2.battle.timeline.modifiers.has('herta', TECHNIQUE_MODIFIER)).toBe(true)
    expect(e2.battle.timeline.modifiers.has('herta', E4_MODIFIER)).toBe(false)
  })

  it('the Technique sends +60% ATK to the kernel as an injected buff, from the first attack', () => {
    const s = setup()
    s.start(true)
    s.act('basic')
    const buff = s.requests.at(-1)!.injectedBuffs
    expect(buff).toEqual([expect.objectContaining({ stat: 'ATK_PERCENT', value: 0.6, target: 'self' })])
    const off = setup()
    off.start(false)
    off.act('basic')
    expect(off.requests.at(-1)!.injectedBuffs ?? []).toEqual([])
  })

  it('the Technique lasts her first 2 turns', () => {
    const s = setup({ start: { energy: 0, skillPoints: 3, techniques: true }, cycles: 3 })
    const seen: boolean[] = []
    s.battle.timeline.bus.on('actionUsed', (a) => {
      if (a.actor === 'herta') seen.push(s.battle.timeline.modifiers.has('herta', TECHNIQUE_MODIFIER))
    })
    s.battle.run()
    // The listener runs after the action, before the turn ends: up on turns 1 and 2, gone on turn 3.
    expect(seen.slice(0, 3)).toEqual([true, true, false])
  })
})

describe('E4', () => {
  it('+12% SPD to every Erudition character in the team (herself and the other one), not to others', () => {
    const mode = { m: 'single' as Mode }
    const s = setup({ eidolon: 4, helpers: [helperMember('anaxa', 'Erudition', mode), helperMember('other', 'Harmony', mode)] })
    s.start()
    const mods = s.battle.timeline.modifiers
    expect(mods.get('herta', E4_MODIFIER)!.spdPct).toBe(0.12)
    expect(mods.get('anaxa', E4_MODIFIER)!.spdPct).toBe(0.12)
    expect(mods.has('other', E4_MODIFIER)).toBe(false)
    expect(setup({ eidolon: 3 }).battle.timeline.modifiers.has('herta', E4_MODIFIER)).toBe(false)
  })

  it('moves the timeline: 100 base SPD at E4 acts at 112', () => {
    const s = setup({ eidolon: 4, cycles: 1 })
    expect(s.battle.timeline.spd('herta')).toBe(100)
    s.start()
    near(s.battle.timeline.spd('herta'), 112)
  })
})

describe('Basic ATK', () => {
  it('100% on the middle enemy; 110% at E5; +20 energy, +1 Skill Point', () => {
    const s = setup()
    s.start()
    s.act('basic')
    expect(s.took('enemy2', 'BASIC')).toBe(1000)
    expect(s.took('enemy1', 'BASIC')).toBe(0)
    expect(s.battle.skillPoints).toBe(4)
    expect(s.toughnessOf('enemy2')).toBe(30)
    const e5 = setup({ eidolon: 5 })
    e5.start()
    e5.act('basic')
    near(e5.took('enemy2', 'BASIC'), 1100)
  })

  it('her own attack triggers her reactions: 3 fixed energy for the 1 enemy hit; 1 + 3 stacks on it (Message, she is Erudition)', () => {
    const s = setup({ energyRegen: 0.5 })
    s.start()
    s.act('basic')
    // 20 x (1 + 0.5) scaled for the Basic ATK, then 3 x 1 target fixed (not scaled): 30 + 3.
    expect(s.gains).toEqual([30, 3])
    // Primary: 26, +1 (Aloofly) + 1 + 2 (Message, attacker Erudition) = 30. Others untouched.
    expect(stacksOf(s, 3)).toEqual([1, 30, 1])
    // Answer 28 + 4 inflicted.
    expect(s.q('answer')).toBe(32)
  })

  it('another ally attack gives her 3 energy per enemy hit and 1 + 1 stacks on the primary', () => {
    const mode = { m: 'single' as Mode }
    const s = setup({ helpers: [helperMember('h', 'Harmony', mode)] })
    s.start()
    s.act('basic', 'h')
    // A Harmony ally: +1 Aloofly +1 Message (no Erudition bonus) on the primary.
    expect(stacksOf(s, 3)).toEqual([1, 28, 1])
    expect(s.gains).toEqual([3])
  })
})

describe('Skill (Big Brain Energy)', () => {
  it('3 enemies: 3 hits of 70% on the middle one, 2 on each neighbour; -1 SP; +30 energy, +3 per enemy hit', () => {
    const s = setup()
    s.start()
    s.act('skill')
    // Middle: 3 x 0.7 x 2000 = 4200. Neighbours: 2 x 0.7 x 2000 = 2800.
    near(s.took('enemy2', 'SKILL'), 4200)
    near(s.took('enemy1', 'SKILL'), 2800)
    near(s.took('enemy3', 'SKILL'), 2800)
    expect(s.battle.skillPoints).toBe(2)
    expect(s.gains).toEqual([30, 9])
    // Toughness (text 45/0/30): 3 x 15 on the designated, 2 x 15 on a neighbour.
    expect(s.toughnessOf('enemy2')).toBe(45)
    expect(s.toughnessOf('enemy1')).toBe(30)
    // Stacks: primary 26 + 1 inflicted = 27; after: +1 each (hit); Message +1 + 2 on the highest (the primary).
    expect(stacksOf(s, 3)).toEqual([2, 31, 2])
    // Answer: 28 + 1 + (3 Aloofly + 3 Message) = 35.
    expect(s.q('answer')).toBe(35)
  })

  it('5 enemies: the pattern widens each repeat: middle 3 hits, its neighbours 2, the outer two 1; 15 energy (5 enemies)', () => {
    const s = setup({ enemyCount: 5, eidolon: 1 })
    s.start()
    s.act('skill')
    const x = 0.7 * 2000
    near(s.took('enemy3', 'SKILL'), 3 * x)
    near(s.took('enemy2', 'SKILL'), 2 * x)
    near(s.took('enemy4', 'SKILL'), 2 * x)
    near(s.took('enemy1', 'SKILL'), x)
    near(s.took('enemy5', 'SKILL'), x)
    expect(s.gains).toEqual([30, 15])
    expect(s.toughnessOf('enemy1')).toBe(15)
  })

  it('1 enemy: three hits on it; the Skill is not Enhanced without Inspiration (no stack bonus, no 40%)', () => {
    const s = setup({ enemyCount: 1 })
    s.start()
    s.act('skill')
    near(s.took('enemy1', 'SKILL'), 3 * 0.7 * 2000)
    expect(s.requests.at(-1)!.attacker.characterConditionals!.enhancedSkill).toBe(false)
  })

  it('needs a Skill Point', () => {
    const s = setup({ start: { energy: 0, skillPoints: 0, techniques: false } })
    expect(s.herta.actions.skill!.canUse()).toBe(false)
  })
})

describe('Ultimate (Told Ya! / Magic Happens)', () => {
  const full = { energy: 1, skillPoints: 3, techniques: false }

  it('220 energy; 200% + 1% per Answer to all; Answer is kept; +1 Inspiration; ATK buff on; acts at once; +5 energy', () => {
    const s = setup({ start: full })
    s.start()
    expect(s.herta.actions.ultimate!.canUse()).toBe(true)
    s.act('ultimate')
    // Answer before the hit: 28, so 2.00 + 0.28 = 2.28 x 3000 = 6840 on each of 3 enemies.
    for (const id of ['enemy1', 'enemy2', 'enemy3']) near(s.took(id, 'ULT'), 6840)
    expect(s.toughnessOf('enemy1')).toBe(60)
    expect(s.q('inspiration')).toBe(1)
    expect(s.q('ult_buff')).toBe(true)
    // Energy: set to 0, +5, then 3 x 3 targets (Aloofly).
    expect(s.battle.party.get('herta').energy).toBe(5 + 9)
    // Answer is not spent: 28 + 3 (Aloofly) + 3 (Message) = 34.
    expect(s.q('answer')).toBe(34)
    expect(s.requests.at(-1)!.attacker.characterConditionals!.ultAtkBuff).toBe(true)
    // The next Ultimate reads the new Answer.
    s.battle.party.setEnergy('herta', 220)
    s.act('ultimate')
    near(s.took('enemy1', 'ULT'), 6840 + (2.0 + 0.34) * 3000)
  })

  it('cannot be used below 220 energy', () => {
    const s = setup({ start: { energy: 0.9, skillPoints: 3, techniques: false } })
    expect(s.herta.actions.ultimate!.canUse()).toBe(false)
  })

  it('the ATK buff is sent with the Ultimate\'s own hit (switch on) and lasts 3 of her turns, the one right after it being the first', () => {
    const s = setup({ start: full, policy: [rule('herta', 'ultimate'), rule('herta', 'basic')], cycles: 4 })
    const ups: Array<[string, boolean]> = []
    s.battle.timeline.bus.on('actionUsed', (a) => {
      if (a.actor === 'herta') ups.push([a.action, s.battle.timeline.modifiers.has('herta', ULT_ATK_MODIFIER)])
    })
    s.battle.run()
    // Ultimate (buff on), then three turns with it (the immediate one and two more), then it is gone.
    expect(ups.slice(0, 5)).toEqual([['ultimate', true], ['basic', true], ['basic', true], ['basic', true], ['basic', false]])
  })

  it('immediately takes action: her gauge is full after the Ultimate', () => {
    const s = setup({ start: full, policy: [rule('herta', 'ultimate', [{ what: 'herta.ult_buff', is: false }]), rule('herta', 'basic')] })
    const order: string[] = []
    s.battle.timeline.bus.on('actionUsed', (a) => order.push(a.action))
    s.battle.run()
    // Before any other unit moves, her Ultimate and then her own turn.
    expect(order.slice(0, 2)).toEqual(['ultimate', 'basic'])
  })

  it('E2: +2 Inspiration; capped at 4', () => {
    const s = setup({ eidolon: 2, start: full })
    s.start()
    expect(s.q('inspiration')).toBe(1)
    s.act('ultimate')
    expect(s.q('inspiration')).toBe(3)
    s.battle.party.setEnergy('herta', 220)
    s.act('ultimate')
    expect(s.q('inspiration')).toBe(4)
  })

  it('E6: 3 enemies +140%, 2 enemies +250%, 1 enemy +400% of ATK on top', () => {
    for (const [count, extra, answer] of [[3, 1.4, 28], [2, 2.5, 27], [1, 4.0, 26]] as const) {
      const s = setup({ eidolon: 6, enemyCount: count, start: full })
      s.start()
      s.act('ultimate')
      // Answer at the hit = enemies + 25.
      near(s.took('enemy1', 'ULT'), (2.2 + answer * 0.01 + extra) * 3000)
    }
  })
})

describe('Enhanced Skill (Hear Me Out)', () => {
  const full = { energy: 1, skillPoints: 5, techniques: false }

  /** Ultimate first (E0 needs it for Inspiration); then the state is [2, 30, 2], Answer 34 (see the Ultimate test). */
  function afterUltimate(eidolon = 0, helpers: MemberSetup[] = [], enemyCount = 3) {
    const s = setup({ eidolon, helpers, enemyCount, start: full })
    s.start()
    s.act('ultimate')
    return s
  }

  it('aims at the most-stacked enemy (the middle one), N = 30: 3 x 80% + 8% x 30 on it, 80% x 2 + 4% x 30 on a neighbour, +40% on all', () => {
    const s = afterUltimate()
    expect(stacksOf(s, 3)).toEqual([2, 30, 2])
    expect(s.q('interpretation_target')).toBe(30)
    const before = s.dealt.length
    s.act('skill')
    const skill = s.dealt.slice(before).filter((d) => d.ability === 'SKILL')
    expect(skill.length).toBeGreaterThan(0)
    // Middle: 0.8 + 0.08 x 30 = 3.2 (first hit), 0.8, 0.8, then 0.4 = 5.2 -> x 2000.
    near(s.took('enemy2', 'SKILL'), 5.2 * 2000)
    // Neighbours: first hit 0.8 + 0.04 x 30 = 2.0, then 0.8, then 0.4 = 3.2.
    near(s.took('enemy1', 'SKILL'), 3.2 * 2000)
    near(s.took('enemy3', 'SKILL'), 3.2 * 2000)
    expect(s.q('inspiration')).toBe(0)
    expect(s.requests.at(-1)!.attacker.characterConditionals!.enhancedSkill).toBe(true)
    // Toughness (text 60/0/30): designated 30 + 15 + 15, neighbours 15 + 15, the 40% AoE none.
    expect(s.toughnessOf('enemy2')).toBe(60 + 60) // the Ultimate's 60 is included
    expect(s.toughnessOf('enemy1')).toBe(30 + 60)
  })

  it('resets the aimed enemy to 1 after the hits, then her own after-attack stacks land: tie among the others goes to the left one', () => {
    const s = afterUltimate()
    s.act('skill')
    // Skill inflicts 1 (30 -> 31), reset to 1. Then +1 each (Aloofly): [3, 2, 3]; Message 1 + 2 on the highest existing among
    // those hit ([2, 1, 2]: enemy1 and enemy3 tie, both next to the middle, so the first in standing order): enemy1 + 3.
    expect(stacksOf(s, 3)).toEqual([6, 2, 3])
    // Answer: 34 + 1 (inflicted) + 3 (Aloofly) + 3 (Message).
    expect(s.q('answer')).toBe(41)
    // Energy: 30 + 3 x 3.
    expect(s.gains.slice(-2)).toEqual([30, 9])
  })

  it('K30: aimed at the enemy with the most stacks, an edge enemy here; a blast has one neighbour there, 3 instances widen', () => {
    const edge = { m: 'edge1' as Mode }
    const s = afterUltimate(0, [helperMember('anaxa', 'Erudition', edge)])
    // After the Ultimate [2, 30, 2]. Each Erudition ally hit on enemy1 adds 1 + 1 + 2 = 4 there.
    for (let i = 0; i < 7; i++) s.act('basic', 'anaxa')
    // 2 + 28 = 30: a tie with the middle enemy (30), which keeps it.
    expect(stacksOf(s, 3)[0]).toBe(30)
    expect(s.q('interpretation_target')).toBe(30)
    s.act('basic', 'anaxa')
    expect(stacksOf(s, 3)).toEqual([34, 30, 2])
    expect(s.q('interpretation_target')).toBe(34)
    s.act('skill')
    const targets = (parts: HitPart[]) => parts.map((p) => (p.shape === 'single' ? p.target : '*'))
    expect(targets(s.parts.at(-4)!)).toEqual(['enemy1'])
    expect(targets(s.parts.at(-3)!)).toEqual(['enemy1', 'enemy2'])
    expect(targets(s.parts.at(-2)!)).toEqual(['enemy1', 'enemy2', 'enemy3'])
    expect(targets(s.parts.at(-1)!)).toEqual(['*'])
    // 2 Erudition now, N = 34 (E0): enemy1 0.8 + 0.16 x 34 = 6.24, then 0.8, 0.8, 0.4 = 8.24.
    near(s.took('enemy1', 'SKILL'), 8.24 * 2000)
    // enemy2: first hit in instance 2: 0.8 + 0.08 x 34 = 3.52, then 0.8, then 0.4 = 4.72. enemy3: first hit in instance 3: 3.52 + 0.4 = 3.92.
    near(s.took('enemy2', 'SKILL'), 4.72 * 2000)
    near(s.took('enemy3', 'SKILL'), 3.92 * 2000)
  })

  it('ties go to the middle enemy: at battle start (5 enemies) the first Enhanced Skill aims at the third', () => {
    const s = setup({ eidolon: 2, enemyCount: 5 })
    s.start()
    s.act('skill')
    expect(s.parts.at(0)![0]).toMatchObject({ target: 'enemy3' })
  })

  it('2 or more Erudition: the stack bonus doubles (16% / 8% at E0) and Aloofly counts at least 3 targets', () => {
    const mode = { m: 'single' as Mode }
    const s = setup({ helpers: [helperMember('anaxa', 'Erudition', mode)], enemyCount: 5, start: { energy: 1, skillPoints: 5, techniques: false } })
    s.start()
    s.act('ultimate')
    // 5 enemies: stacks [1,1,26,1,1], +1 each, Message 1 + 2 on the middle: [2,2,30,2,2].
    expect(stacksOf(s, 5)).toEqual([2, 2, 30, 2, 2])
    s.act('skill')
    // Middle: 0.8 + 0.16 x 30 = 5.6 on the first hit, 0.8 x 2, 0.4: 7.6.
    near(s.took('enemy3', 'SKILL'), 7.6 * 2000)
    // enemy2 / enemy4 (first hit in instance 2): 0.8 + 0.08 x 30 = 3.2, then 0.8, then 0.4 = 4.4.
    near(s.took('enemy2', 'SKILL'), 4.4 * 2000)
    // Outer (first hit in instance 3): 3.2 + 0.4 = 3.6.
    near(s.took('enemy1', 'SKILL'), 3.6 * 2000)
  })

  it('E3: Lv12 numbers; E1 counts N = 45; 45 >= 42 turns the +50% on', () => {
    const s = afterUltimate(3)
    // After the Ultimate [2, 30, 2]; N = 30 + 0.5 x 30 = 45.
    s.act('skill')
    // Middle: 0.88 + 0.088 x 45 = 4.84, + 0.88 + 0.88 + 0.44 = 7.04 -> x 3000 (boost on).
    near(s.took('enemy2', 'SKILL'), 7.04 * 3000)
    // Neighbours: 0.88 + 0.044 x 45 = 2.86, + 0.88 + 0.44 = 4.18.
    near(s.took('enemy1', 'SKILL'), 4.18 * 3000)
  })

  it('an attack hitting 3 enemies gives her 9 fixed energy (the Ultimate included)', () => {
    const s = afterUltimate()
    expect(s.gains.at(-1)).toBe(9)
  })

  it('with 2+ Erudition a 1-enemy attack still gives 9 energy; alone it gives 3', () => {
    const mode = { m: 'single' as Mode }
    const s = setup({ enemyCount: 1, helpers: [helperMember('anaxa', 'Erudition', mode)] })
    s.start()
    s.act('basic', 'anaxa')
    expect(s.gains).toEqual([9])
    const alone = setup({ enemyCount: 1 })
    alone.start()
    alone.act('basic', 'herta')
    expect(alone.gains).toEqual([20, 3])
  })

  it('an Erudition ally attack gives the highest-stacked hit enemy 1 + 2 stacks (+1 Aloofly)', () => {
    const mode = { m: 'single' as Mode }
    const s = setup({ helpers: [helperMember('anaxa', 'Erudition', mode)] })
    s.start()
    s.act('basic', 'anaxa')
    expect(stacksOf(s, 3)).toEqual([1, 30, 1])
  })

  it('E1: N counts 50% more from the most-stacked of the target and its neighbours; reset to 15 (E2 includes E1)', () => {
    const s = afterUltimate(1)
    // After the Ultimate [2, 30, 2]; N = 30 + 0.5 x 30 = 45 >= 42: +50% Skill DMG (rate 3000).
    s.act('skill')
    // Middle first hit 0.8 + 0.08 x 45 = 4.4; total 4.4 + 0.8 + 0.8 + 0.4 = 6.4.
    near(s.took('enemy2', 'SKILL'), 6.4 * 3000)
    // Neighbours: 0.8 + 0.04 x 45 = 2.6, + 0.8 + 0.4 = 3.8.
    near(s.took('enemy1', 'SKILL'), 3.8 * 3000)
    // Reset to 15, then Aloofly +1, then Message +3 (existing [2, 15, 2]: the middle is highest): 19.
    expect(s.q('interpretation_2')).toBe(15 + 1 + 3)
  })

  it('+50% Skill DMG when N reaches 42 (E0: its own stacks); not at 38', () => {
    const mode = { m: 'single' as Mode }
    const run = (attacks: number) => {
      const s = setup({ helpers: [helperMember('anaxa', 'Erudition', mode)], start: { energy: 1, skillPoints: 5, techniques: false } })
      s.start()
      s.act('ultimate') // [2, 30, 2]
      // Each Erudition ally attack adds 4 to the primary.
      for (let i = 0; i < attacks; i++) s.act('basic', 'anaxa')
      const stacks = s.q('interpretation_2') as number
      s.act('skill')
      return { stacks, req: s.requests.at(-1)!.attacker.characterConditionals!, dmg: s.took('enemy2', 'SKILL') }
    }
    const at38 = run(2)
    expect(at38.stacks).toBe(38)
    expect(at38.req.interpretationStacks).toBe(1)
    const at42 = run(3)
    expect(at42.stacks).toBe(42)
    expect(at42.req.interpretationStacks).toBe(42)
    expect(at42.req.enhancedSkill).toBe(true)
    // 2 Erudition, N = 42: middle 0.8 + 0.16 x 42 = 7.52, + 0.8 + 0.8 + 0.4 = 9.52, at rate 3000.
    near(at42.dmg, 9.52 * 3000)
  })

  it('E2: advances her next action by 35% after the Enhanced Skill, not otherwise', () => {
    const times = (eidolon: number) => {
      const s = setup({
        eidolon,
        cycles: 2,
        start: { energy: 0, skillPoints: 5, techniques: false },
        policy: [rule('herta', 'skill', [{ what: 'herta.inspiration', min: 1 }]), rule('herta', 'basic')],
      })
      const at: number[] = []
      s.battle.timeline.bus.on('actionUsed', (a) => {
        if (a.actor === 'herta') at.push(s.battle.timeline.now)
      })
      s.battle.run()
      return at
    }
    // Base SPD 100: turns at AV 100 and 200. E2: the Enhanced Skill at 100 advances the next one by 35: 165.
    expect(times(2).slice(0, 2)).toEqual([100, 165])
    // E1 has no Inspiration at the start, so no Enhanced Skill: 100, 200.
    expect(times(1).slice(0, 2)).toEqual([100, 200])
  })
})

describe('reactions to random hits (K17/K22): 3 bounces on 5 enemies', () => {
  it('stacks and energy follow the exact distribution of the enemies hit', () => {
    const mode = { m: 'bounce3' as Mode }
    const s = setup({ enemyCount: 5, helpers: [helperMember('h', 'Harmony', mode)] })
    s.start()
    s.act('basic', 'h')
    const chance = 1 - 0.8 ** 3
    const stacks = stacksOf(s, 5)
    // Middle (26): hit with chance 0.488, and it is the best hit enemy whenever it is hit: + 2 x 0.488.
    near(stacks[2]!, 26 + 2 * chance)
    // Enemy 1 (edge, 1 stack): Aloofly 0.488 + Message when it is the best hit: the middle (rank 1), enemies 2 and 4 (ranks 2, 3)
    // are all unhit and enemy 1 is hit: P = (2/5)^3 - (1/5)^3 = 0.056 (all 3 hits on {enemy1, enemy5}, at least one on enemy1).
    near(stacks[0]!, 1 + chance + 0.056)
    // Energy: 3 x E[distinct enemies hit] = 3 x 5 x 0.488 = 7.32 (1 Erudition: no minimum of 3).
    near(s.gains[0]!, 3 * 5 * chance)
  })

  it('with 2+ Erudition the energy has a floor of 3 targets: E[max(3, min(K, 5))] over the distribution', () => {
    const mode = { m: 'bounce3' as Mode }
    const s = setup({ enemyCount: 5, helpers: [helperMember('anaxa', 'Erudition', mode)] })
    s.start()
    s.act('basic', 'anaxa')
    // 3 hits reach at most 3 distinct enemies: K = 3 whenever all differ, otherwise fewer (floored to 3). Always 3 targets.
    near(s.gains[0]!, 9)
  })
})

describe('what teammates and the kernel are told', () => {
  it('the kit states the switches explicitly, for her and as a teammate', () => {
    const s = setup({ eidolon: 6 })
    s.start()
    s.act('basic')
    expect(s.requests.at(-1)!.attacker.characterConditionals).toMatchObject({
      enhancedSkill: false,
      ultAtkBuff: false,
      eruditionTeammate: true,
      e4EruditionSpdBuff: true,
      e6Buffs: true,
    })
    expect(s.battle.member('herta').instance.teammateState(s.battle.member('herta'), 'enemy2')).toEqual({
      characterConditionals: { eruditionTeammate: true, e4EruditionSpdBuff: true },
    })
  })
})

describe('team policy: Basic ATK instead of the Skill when Skill Points are short', () => {
  it('"skill when team.skill_points >= 2, else basic" picks Enhanced Skill / Skill / Basic by Skill Points and Inspiration', () => {
    const s = setup({
      eidolon: 2,
      cycles: 8,
      start: { energy: 0, skillPoints: 3, techniques: false },
      policy: [rule('herta', 'skill', [{ what: 'team.skill_points', min: 2 }]), rule('herta', 'basic')],
    })
    const log: Array<[string, number]> = []
    s.battle.timeline.bus.on('actionUsed', (a) => {
      if (a.actor === 'herta') log.push([a.action, s.battle.skillPoints])
    })
    s.battle.run()
    // SP 3: Enhanced Skill (E2 starts with 1 Inspiration) -> 2; Skill -> 1; 1 < 2: Basic -> 2; Skill -> 1; Basic -> 2 ...
    expect(log.slice(0, 5).map((l) => l[0])).toEqual(['skill', 'skill', 'basic', 'skill', 'basic'])
    expect(log.slice(0, 5).map((l) => l[1])).toEqual([2, 1, 2, 1, 2])
  })

  it('quantities a rule can read: inspiration, enhanced, answer, interpretation_target', () => {
    const s = setup({ eidolon: 2 })
    s.start()
    expect(s.q('inspiration')).toBe(1)
    expect(s.q('enhanced')).toBe(true)
    expect(s.q('interpretation_target')).toBe(26)
    expect(s.q('answer')).toBe(28)
    const withRule = setup({
      eidolon: 2,
      policy: [rule('herta', 'skill', [{ what: 'herta.inspiration', min: 1 }, { what: 'herta.interpretation_target', min: 20 }]), rule('herta', 'basic')],
    })
    expect(withRule.battle).toBeDefined()
  })
})

describe('mutation-testing additions', () => {
  const mode = (m: Mode) => ({ m })

  it('stacks cap at 42 and Answer at 99; the Ultimate then reads 99 (+0.99)', () => {
    const s = setup({ enemyCount: 1, helpers: [helperMember('anaxa', 'Erudition', mode('single'))] })
    s.start()
    for (let i = 0; i < 40; i++) s.act('basic', 'anaxa')
    expect(s.q('interpretation_1')).toBe(42)
    expect(s.q('answer')).toBe(99)
    s.battle.party.setEnergy('herta', 220)
    s.act('ultimate')
    near(s.took('enemy1', 'ULT'), (2.0 + 0.99) * 3000)
  })

  it('Additional DMG parts are not an attack: the enemy that only took Additional DMG gets nothing; the real part still triggers', () => {
    const s = setup({ helpers: [helperMember('h', 'Harmony', mode('extra'))] })
    s.start()
    s.act('basic', 'h')
    expect(stacksOf(s, 3)).toEqual([1, 28, 1])
    expect(s.gains).toEqual([3])
  })

  it('an action by a unit that is not an ally (no member, memosprite or owner) does not trigger her', () => {
    const s = setup({ helpers: [helperMember('h', 'Harmony', mode('single'))] })
    s.start()
    s.battle.performAction('stranger', 'x', 'followUp', () => {
      s.battle.attack({ attacker: 'h', ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
    })
    expect(stacksOf(s, 3)).toEqual([1, 26, 1])
    expect(s.gains).toEqual([])
  })

  it('downed: her reactions stop', () => {
    const s = setup({ helpers: [helperMember('h', 'Harmony', mode('single'))] })
    s.start()
    s.battle.party.takeDamage('herta', 1e12, 'enemy1')
    expect(s.battle.party.get('herta').downed).toBe(true)
    s.act('basic', 'h')
    expect(stacksOf(s, 3)).toEqual([1, 26, 1])
  })

  it('a memosprite of an Erudition character is an ally attacker but not an Erudition character (+1 +1, not +2)', () => {
    const s = setup({ helpers: [helperMember('anaxa', 'Erudition', mode('single'))] })
    s.start()
    s.battle.addMemosprite({ id: 'anaxa.memo', owner: 'anaxa', name: 'memo', maxHp: 1000, baseAggro: 1, takeTurn: () => {} })
    s.battle.performAction('anaxa.memo', 'x', 'followUp', () => {
      s.battle.attack({ attacker: 'anaxa', ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
    })
    expect(stacksOf(s, 3)).toEqual([1, 28, 1])
    expect(s.gains).toEqual([9])
  })

  it('the plain Skill hits the middle enemy even when another enemy has more stacks', () => {
    const s = setup({ helpers: [helperMember('anaxa', 'Erudition', mode('edge1'))] })
    s.start()
    for (let i = 0; i < 8; i++) s.act('basic', 'anaxa')
    expect(stacksOf(s, 3)[0]).toBeGreaterThan(stacksOf(s, 3)[1]!)
    s.act('skill')
    expect(s.requests.at(-1)!.attacker.characterConditionals!.enhancedSkill).toBe(false)
    near(s.took('enemy2', 'SKILL'), 3 * 0.7 * 2000)
    near(s.took('enemy1', 'SKILL'), 2 * 0.7 * 2000)
  })

  it('the Skill can be used with exactly 1 Skill Point', () => {
    const s = setup({ start: { energy: 0, skillPoints: 1, techniques: false } })
    expect(s.herta.actions.skill!.canUse()).toBe(true)
  })

  it('the Ultimate ATK buff is +80% (Lv10) through E4 and +88% only from E5', () => {
    expect(theHertaScalings(3).ultAtk).toBe(0.8)
    expect(theHertaScalings(4).ultAtk).toBe(0.8)
  })
})
