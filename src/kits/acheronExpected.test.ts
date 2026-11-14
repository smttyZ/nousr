import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel } from '../kernel/types'
import type { Rule } from '../scenario/types'
import { Acheron, acheronScalings } from './acheron'
import type { Kit } from './kit'

/**
 * Acheron's talent, thresholds and Affinitive Eidolon under expected-value debuffs (DESIGN.md, K22). A debuff that landed with a
 * chance gives the talent's Slashed Dream and Crimson Knot at that chance, and the numbers that read them are thresholds on an
 * expected value. Every case here is whole-number-identical to the old behaviour when the chance is 1.
 */

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/** 1,000 damage per 100% ATK, times 1.18 against a debuffed enemy (her E1). One hit per ability, as Fribbels builds them. */
const kernel: DamageKernel = {
  actionDamage(request) {
    const c = request.attacker.characterConditionals ?? {}
    const s = acheronScalings(request.attacker.eidolon)
    const multiples = request.attacker.characterId === '1308'
      ? { BASIC: s.basic, SKILL: s.skillMain, ULT: 3 * s.rainblade + 3 * s.knot + s.stygianResurge, FUA: 3.0 + (0.8 * 6) / (request.enemy?.count ?? 1) }
      : { BASIC: 1 }
    const boost = c.e1EnemyDebuffed ? 1.18 : 1
    return fakeResult(Object.fromEntries(Object.entries(multiples).map(([ability, scaling]) => [ability, [{ damage: 1000 * scaling * boost, scaling }]])))
  },
}

const acheron = (eidolon = 0, affinitiveEidolon = false): MemberSetup => ({
  key: 'acheron',
  kit: Acheron,
  eidolon,
  affinitiveEidolon,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 1 },
  kernel: { unit: { characterId: '1308', lightConeId: '23024', eidolon, superimposition: 1, ex: affinitiveEidolon ? 1 : 0 }, build: noBuild },
})

/** A made-up teammate whose action puts a debuff on each of `targets` at the given chance, and attacks the primary if asked. */
const chancer = (targets: ReadonlyArray<{ enemy: string, chance: number }>, attack = false): MemberSetup => ({
  key: 'chancer',
  kit: {
    characterId: 'chancer',
    path: 'Harmony',
    element: 'Ice',
    maxEnergy: 0,
    create: (battle, self) => ({
      actions: {
        basic: {
          kind: 'basic',
          canUse: () => true,
          use: () =>
            battle.performAction(self.key, 'basic', 'basic', () => {
              targets.forEach(({ enemy, chance }, i) => battle.applyDebuff({ id: `chancer.debuff${i}`, target: enemy, source: self.key, chance }))
              if (attack) battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
            }),
        },
      },
      attackerState: () => ({}),
      teammateState: () => ({}),
    }),
  } as Kit,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 1 },
  kernel: { unit: { characterId: 'chancer', lightConeId: 'none', eidolon: 0, superimposition: 1 }, build: noBuild },
})

const policy: Rule[] = [{ unit: 'acheron', use: 'basic', when: [] }]

function setup(members: MemberSetup[], enemyCount = 1) {
  const battle = new Battle({
    members,
    policy,
    profile,
    enemyCount,
    weaknesses: 'all',
    cycles: 5,
    start: { energy: 0.5, skillPoints: 3, techniques: false },
    kernel,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  const read = (name: string) => battle.member('acheron').instance.quantities![name]!() as number
  const knotsOn = (enemy: string) => battle.timeline.modifiers.get(enemy, 'acheron.crimson_knot')?.stacks ?? 0
  const act = () => battle.member('chancer').instance.actions.basic!.use()
  return { battle, dealt, read, knotsOn, act }
}

describe('Acheron\'s talent at a chance (K22)', () => {
  it('a debuff that landed with chance 0.4 gives 0.4 Slashed Dream and 0.4 Crimson Knot', () => {
    const { read, knotsOn, act } = setup([acheron(), chancer([{ enemy: 'enemy1', chance: 0.4 }])])
    act()
    expect(read('slashed_dream')).toBeCloseTo(0.4, 12)
    expect(knotsOn('enemy1')).toBeCloseTo(0.4, 12)
  })

  it('a certain debuff is exactly the old behaviour: one of each', () => {
    const { read, knotsOn, act } = setup([acheron(), chancer([{ enemy: 'enemy1', chance: 1 }])])
    act()
    expect(read('slashed_dream')).toBe(1)
    expect(knotsOn('enemy1')).toBe(1)
  })

  it('several debuffed enemies: Slashed Dream at the chance that any landed, the knot by rank among the debuffed', () => {
    const { read, knotsOn, act } = setup([acheron(), chancer([{ enemy: 'enemy1', chance: 0.5 }, { enemy: 'enemy2', chance: 0.5 }])], 3)
    act()
    // Independent enemies: a debuff landed with 1 - 0.5 x 0.5 = 0.75. With no knots anywhere the primary (enemy2) ranks first and takes
    // the knot when it was debuffed (0.5); enemy1 takes it when only it was (0.5 x 0.5).
    expect(read('slashed_dream')).toBeCloseTo(0.75, 12)
    expect(knotsOn('enemy2')).toBeCloseTo(0.5, 12)
    expect(knotsOn('enemy1')).toBeCloseTo(0.25, 12)
    expect(knotsOn('enemy3')).toBe(0)
  })

  it('a certain debuff on the first-ranked enemy takes the whole knot', () => {
    const { read, knotsOn, act } = setup([acheron(), chancer([{ enemy: 'enemy1', chance: 0.5 }, { enemy: 'enemy2', chance: 1 }])], 3)
    act()
    expect(read('slashed_dream')).toBe(1)
    expect(knotsOn('enemy2')).toBe(1)
    expect(knotsOn('enemy1')).toBe(0)
  })

  it('the knot goes to the enemy with the most knots among those debuffed', () => {
    const { battle, knotsOn, act } = setup([acheron(), chancer([{ enemy: 'enemy1', chance: 0.5 }, { enemy: 'enemy2', chance: 0.5 }])], 3)
    battle.timeline.modifiers.apply({ id: 'acheron.crimson_knot', target: 'enemy1', source: 'acheron', stacks: 2 })
    act()
    expect(knotsOn('enemy1')).toBeCloseTo(2 + 0.5, 12)
    expect(knotsOn('enemy2')).toBeCloseTo(0.25, 12)
  })

  it('THRESHOLD ON AN EXPECTED VALUE: the Ultimate is ready when the expected Slashed Dream reaches 9, not when a 9 is likely', () => {
    const { battle, read, act } = setup([acheron(), chancer([{ enemy: 'enemy1', chance: 0.4 }])])
    battle.member('acheron').instance.onBattleStart!({ techniques: false })
    expect(read('slashed_dream')).toBe(5)
    for (let i = 0; i < 9; i++) act()
    // 5 + 9 x 0.4 = 8.6: not ready, though a 9 is likely. The tenth use makes 9 (float sums within 1e-9 count as 9).
    expect(battle.member('acheron').instance.actions.ultimate!.canUse()).toBe(false)
    act()
    expect(read('slashed_dream')).toBeCloseTo(9, 9)
    expect(battle.member('acheron').instance.actions.ultimate!.canUse()).toBe(true)
  })

  it('E1 against an enemy debuffed at chance 0.4: priced in both states and weighted, +18% at 0.4', () => {
    const { battle, dealt, act } = setup([acheron(1), chancer([{ enemy: 'enemy1', chance: 0.4 }])])
    act()
    battle.member('acheron').instance.actions.basic!.use()
    // The fake kernel pays 1.18 against a debuffed enemy: the expected damage of a 100% hit is 1000 x (1 + 0.18 x 0.4).
    expect(dealt[0]!.damage).toBeCloseTo(1000 * (1 + 0.18 * 0.4), 9)
  })

  it('a certain debuff pays the whole E1 bonus, an absent one none', () => {
    const certain = setup([acheron(1), chancer([{ enemy: 'enemy1', chance: 1 }])])
    certain.act()
    certain.battle.member('acheron').instance.actions.basic!.use()
    expect(certain.dealt[0]!.damage).toBeCloseTo(1180, 9)
    const none = setup([acheron(1), chancer([])])
    none.battle.member('acheron').instance.actions.basic!.use()
    expect(none.dealt[0]!.damage).toBeCloseTo(1000, 9)
  })
})

describe('Acheron\'s knots as expected values', () => {
  it('a Rainblade at a half-knotted enemy detonates at half: min(1, knots) of the 15% base and the knot count itself', () => {
    const { battle, dealt, act } = setup([acheron(), chancer([{ enemy: 'enemy1', chance: 1 }])])
    // 9 Slashed Dream: 5 from Red Oni and 4 from certain debuffs; then the knots are put at exactly one half.
    battle.member('acheron').instance.onBattleStart!({ techniques: false })
    for (let i = 0; i < 4; i++) act()
    battle.timeline.modifiers.apply({ id: 'acheron.crimson_knot', target: battle.primary, source: 'acheron', stacks: 0.5 })
    expect(battle.member('acheron').instance.actions.ultimate!.canUse()).toBe(true)
    battle.member('acheron').instance.actions.ultimate!.use()
    const s = acheronScalings(0)
    // The first Rainblade finds 0.5 knots (the later ones none): one AoE detonation of 0.15 x (0.5 + 0.5) on every enemy (1 here),
    // beside the three single Rainblades, Stygian Resurge and Thunder Core's six hits (0.25 each, 1.5 over the bounce).
    const total = dealt.filter((d) => d.ability === 'ULT').reduce((sum, d) => sum + d.scaling, 0)
    expect(total).toBeCloseTo(3 * s.rainblade + s.knot * (0.5 + 0.5) + s.stygianResurge + 6 * 0.25, 9)
    expect(battle.timeline.modifiers.get(battle.primary, 'acheron.crimson_knot')).toBeUndefined()
    // Half a Thunder Core stack from the one half-knotted Rainblade.
    expect(battle.timeline.modifiers.get('acheron', 'acheron.thunder_core')!.stacks).toBeCloseTo(0.5, 12)
  })

  it('the Affinitive Eidolon follow-up is used at the chance an enemy the attack hit had a knot, and keeps the rest of its once per turn', () => {
    const { battle, dealt, act } = setup([acheron(0, true), chancer([], true)])
    battle.timeline.modifiers.apply({ id: 'acheron.crimson_knot', target: battle.primary, source: 'acheron', stacks: 0.5 })
    const used = () => dealt.filter((d) => d.ability === 'FUA').reduce((sum, d) => sum + d.scaling, 0)
    act()
    // Half a knot on the enemy: the follow-up counts at 0.5 (1 enemy: 300% AoE and 6 x 80% bounce is 7.8).
    expect(used()).toBeCloseTo(0.5 * 7.8, 9)
    // Its own stack at weight 0.5 left 1 knot: the next attack finds a whole one, and the other half of the turn's follow-up is still free.
    dealt.length = 0
    act()
    expect(used()).toBeCloseTo(0.5 * 7.8, 9)
    // Spent now.
    dealt.length = 0
    act()
    expect(used()).toBe(0)
  })

  it('whole knots behave as before: the first qualifying attack in a turn fires the follow-up once, at full', () => {
    const { battle, dealt, act } = setup([acheron(0, true), chancer([], true)])
    battle.timeline.modifiers.apply({ id: 'acheron.crimson_knot', target: battle.primary, source: 'acheron', stacks: 1 })
    act()
    act()
    expect(dealt.filter((d) => d.ability === 'FUA').reduce((sum, d) => sum + d.scaling, 0)).toBeCloseTo(7.8, 9)
  })
})
