import { describe, expect, it } from 'vitest'
import { loadEnemyProfile } from '../enemy/profile'
import { GoodNightAndSleepWell } from '../equipment/goodNightAndSleepWell'
import { InTheNameOfTheWorld } from '../equipment/inTheNameOfTheWorld'
import { PioneerDiverOfDeadWaters } from '../equipment/pioneerDiverOfDeadWaters'
import type { LightConeModule, MemberEquipment } from '../equipment/equipment'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Kit } from '../kits/kit'
import type { EngineEvents } from '../engine'
import { Battle, certain, expectedCapped, MAX_UNCERTAIN_MODIFIERS } from './battle'
import type { HitPart, MemberSetup } from './battle'

/**
 * Expected-value debuffs (DESIGN.md, K22): presence probabilities on modifiers, the expected count and chance of debuffs, an
 * action's `debuffChance`, and the pricing of a hit as the weighted mean over the debuff states, against fake kernels whose
 * numbers can be checked by hand.
 */

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/** A made-up attacker: the Basic ATK is one part on the primary target, or the parts a test sets. */
function probe(parts: () => HitPart[] = () => [{ shape: 'single', scaling: 1, hit: 0 }]): Kit {
  return {
    characterId: 'probe',
    path: 'Hunt',
    element: 'Fire',
    maxEnergy: 0,
    create: (battle, self) => ({
      actions: {
        basic: {
          kind: 'basic',
          canUse: () => true,
          use: () => battle.performAction(self.key, 'basic', 'basic', () => battle.attack({ attacker: self.key, ability: 'BASIC', parts: parts() })),
        },
      },
      attackerState: (enemy) => ({ characterConditionals: { marked: certain(battle.debuffChance(enemy)) } }),
      teammateState: () => ({}),
    }),
  }
}

const member = (kit: Kit, equipment?: MemberEquipment): MemberSetup => ({
  key: 'a',
  kit,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 1 },
  kernel: { unit: { characterId: 'probe', lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
  ...(equipment && { equipment }),
})

/** 1,000 per 100%, 20% more when the attacker's `marked` switch is on. Every request is kept. */
function recording(price: (request: DamageRequest) => number = (r) => (r.attacker.characterConditionals?.marked === true ? 1200 : 1000)) {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = {
    actionDamage(request) {
      requests.push(request)
      return fakeResult({ BASIC: [{ damage: price(request), scaling: 1 }], BREAK: [{ damage: 100 }] })
    },
  }
  return { kernel, requests }
}

function setup(options: { kit?: Kit, enemyCount?: number, equipment?: MemberEquipment, kernel?: DamageKernel } = {}) {
  const { kernel } = options.kernel ? { kernel: options.kernel } : recording()
  const battle = new Battle({
    members: [member(options.kit ?? probe(), options.equipment)],
    policy: [{ unit: 'a', use: 'basic', when: [] }],
    profile,
    enemyCount: options.enemyCount ?? 1,
    weaknesses: 'all',
    cycles: 3,
    start: { energy: 0, skillPoints: 3, techniques: false },
    kernel,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  const actions: EngineEvents['actionUsed'][] = []
  battle.timeline.bus.on('damageDealt', (d) => dealt.push(d))
  battle.timeline.bus.on('actionUsed', (a) => actions.push(a))
  const debuff = (enemy: string, id: string, chance = 1, extra: { spdPct?: number, source?: string } = {}) =>
    battle.timeline.modifiers.apply({ id, target: enemy, source: extra.source ?? 'x', debuff: true, chance, ...(extra.spdPct !== undefined && { spdPct: extra.spdPct }) })
  const use = () => battle.member('a').instance.actions.basic!.use()
  return { battle, dealt, actions, debuff, use }
}

describe('presence probability on a modifier', () => {
  it('defaults to 1 and counts as one debuff', () => {
    const { battle, debuff } = setup()
    debuff('enemy1', 'd')
    expect(battle.timeline.modifiers.get('enemy1', 'd')!.chance).toBe(1)
    expect(battle.presence('enemy1', 'd')).toBe(1)
    expect(battle.debuffCount('enemy1')).toBe(1)
    expect(battle.debuffChance('enemy1')).toBe(1)
  })

  it('must be in (0, 1]', () => {
    const { debuff } = setup()
    expect(() => debuff('enemy1', 'd', 0)).toThrow(/chance must be in \(0, 1\]/)
    expect(() => debuff('enemy1', 'd', 1.5)).toThrow(/chance must be in \(0, 1\]/)
  })

  it('applying the same id again combines the two as independent applications', () => {
    const { battle, debuff } = setup()
    debuff('enemy1', 'd', 0.5)
    debuff('enemy1', 'd', 0.5)
    expect(battle.presence('enemy1', 'd')).toBeCloseTo(0.75, 12)
    debuff('enemy1', 'd', 1)
    expect(battle.presence('enemy1', 'd')).toBe(1)
    expect(battle.timeline.modifiers.on('enemy1')).toHaveLength(1)
  })

  it('an expected count adds the chances; the chance of at least one is 1 minus the product of the misses', () => {
    const { battle, debuff } = setup()
    debuff('enemy1', 'a', 0.5)
    debuff('enemy1', 'b', 0.25)
    debuff('enemy1', 'c', 1)
    expect(battle.debuffCount('enemy1')).toBeCloseTo(1.75, 12)
    const none = setup()
    none.debuff('enemy1', 'a', 0.5)
    none.debuff('enemy1', 'b', 0.25)
    expect(none.battle.debuffChance('enemy1')).toBeCloseTo(1 - 0.5 * 0.75, 12)
    expect(none.battle.debuffChance('enemy1')).not.toBe(1)
  })

  it('a non-debuff modifier is not counted', () => {
    const { battle } = setup()
    battle.timeline.modifiers.apply({ id: 'buff', target: 'enemy1', source: 'x', chance: 0.5 })
    expect(battle.debuffCount('enemy1')).toBe(0)
    expect(battle.debuffChance('enemy1')).toBe(0)
  })

  it('its SPD change counts at its chance: the unit\'s expected SPD', () => {
    const { battle, debuff } = setup()
    const base = battle.timeline.spd('enemy1')
    debuff('enemy1', 'slow', 0.5, { spdPct: -0.1 })
    expect(battle.timeline.spd('enemy1')).toBeCloseTo(base * 0.95, 9)
    debuff('enemy1', 'slow', 1, { spdPct: -0.1 })
    expect(battle.timeline.spd('enemy1')).toBeCloseTo(base * 0.9, 9)
  })

  it('the distribution of the count is a Poisson-binomial: [.25, .5, .25] for two coin flips, shifted by a certain debuff', () => {
    const { battle, debuff } = setup()
    debuff('enemy1', 'a', 0.5)
    debuff('enemy1', 'b', 0.5)
    expect(battle.debuffCountDistribution('enemy1').map((p) => +p.toFixed(12))).toEqual([0.25, 0.5, 0.25])
    debuff('enemy1', 'c', 1)
    expect(battle.debuffCountDistribution('enemy1').map((p) => +p.toFixed(12))).toEqual([0, 0.25, 0.5, 0.25])
    expect(expectedCapped(battle.debuffCountDistribution('enemy1'), 2)).toBeCloseTo(0.25 * 1 + 0.5 * 2 + 0.25 * 2, 12)
  })

  it('anyPresent: the chance that some modifier of a kind is there (Slowed: any SPD reduction)', () => {
    const { battle, debuff } = setup()
    debuff('enemy1', 'slow1', 0.5, { spdPct: -0.1 })
    debuff('enemy1', 'slow2', 0.5, { spdPct: -0.05 })
    debuff('enemy1', 'plain', 1)
    expect(battle.anyPresent('enemy1', (m) => m.spdPct < 0)).toBeCloseTo(0.75, 12)
  })
})

describe('an action\'s debuffChance mirrors hitChance (K22)', () => {
  const act = (chances: Array<{ enemy: string, chance: number, id?: string }>, extra?: (battle: Battle) => void) => {
    const { battle, actions } = setup({ enemyCount: 3 })
    battle.performAction('a', 'basic', 'basic', () => {
      chances.forEach(({ enemy, chance, id }, i) => battle.applyDebuff({ id: id ?? `d${i}`, target: enemy, source: 'a', chance }))
      extra?.(battle)
    })
    return actions[0]!
  }

  it('lists the enemies that could have been debuffed, each at the chance a debuff landed', () => {
    const action = act([{ enemy: 'enemy1', chance: 0.3 }, { enemy: 'enemy3', chance: 1 }])
    expect(action.debuffed).toEqual(['enemy1', 'enemy3'])
    expect(Object.keys(action.debuffChance)).toEqual(['enemy1', 'enemy3'])
    expect(action.debuffChance.enemy1).toBeCloseTo(0.3, 12)
    expect(action.debuffChance.enemy3).toBe(1)
  })

  it('combines several applications on one enemy as independent ones', () => {
    const action = act([{ enemy: 'enemy1', chance: 0.5 }, { enemy: 'enemy1', chance: 0.5, id: 'other' }])
    expect(action.debuffChance.enemy1).toBeCloseTo(0.75, 12)
  })

  it('applyRandomDebuff: each option at landing / n, the application counted once at its landing chance', () => {
    const { battle, actions } = setup({ enemyCount: 3 })
    battle.performAction('a', 'basic', 'basic', () => {
      battle.applyRandomDebuff(['x', 'y', 'z'].map((id) => ({ id, target: 'enemy2', source: 'a' })), 0.9)
    })
    for (const id of ['x', 'y', 'z']) expect(battle.presence('enemy2', id)).toBeCloseTo(0.3, 12)
    expect(battle.debuffCount('enemy2')).toBeCloseTo(0.9, 12)
    expect(actions[0]!.debuffChance.enemy2).toBeCloseTo(0.9, 12)
  })

  it('a random debuff that surely landed is one expected debuff and a chance of 1 for the action', () => {
    const { battle, actions } = setup()
    battle.performAction('a', 'basic', 'basic', () => battle.applyRandomDebuff(['x', 'y', 'z'].map((id) => ({ id, target: 'enemy1', source: 'a' }))))
    expect(battle.debuffCount('enemy1')).toBeCloseTo(1, 12)
    expect(actions[0]!.debuffChance).toEqual({ enemy1: 1 })
  })

  it('a bare application (outside an action) records nothing', () => {
    const { battle, actions } = setup()
    battle.applyDebuff({ id: 'd', target: 'enemy1', source: 'a', chance: 0.5 })
    expect(actions).toEqual([])
    expect(battle.presence('enemy1', 'd')).toBe(0.5)
  })

  it('a chance of 0 applies nothing', () => {
    const { battle } = setup()
    battle.applyDebuff({ id: 'd', target: 'enemy1', source: 'a', chance: 0 })
    expect(battle.timeline.modifiers.on('enemy1')).toHaveLength(0)
  })
})

describe('damageDealt carries the chance the enemy was hit (K17)', () => {
  it('1 for a single, blast or AoE part, the bounce\'s chance for an enemy only a bounce reaches', () => {
    const kit = probe(() => [
      { shape: 'single', scaling: 1, hit: 0 },
      { shape: 'bounce', scaling: 1, hits: 3, hit: 0 },
    ])
    const { use, dealt } = setup({ kit, enemyCount: 3 })
    use()
    const by = Object.fromEntries(dealt.map((d) => [d.enemy, d.chance]))
    expect(by.enemy2).toBe(1)
    expect(by.enemy1).toBeCloseTo(1 - (2 / 3) ** 3, 12)
    expect(by.enemy3).toBeCloseTo(1 - (2 / 3) ** 3, 12)
  })

  it('0 for an enemy reached only by Additional DMG that rides on hits dealt elsewhere; 1 for Break DMG', () => {
    const kit = probe(() => [
      { shape: 'single', scaling: 1, hit: 0, toughness: 100_000 },
      { shape: 'single', target: 'enemy1', scaling: 0.5, hit: 0, additional: true, random: { hits: 1, chance: 0 } },
    ])
    const { use, dealt } = setup({ kit, enemyCount: 3 })
    use()
    expect(dealt.find((d) => d.enemy === 'enemy1' && d.ability === 'BASIC')!.chance).toBe(0)
    expect(dealt.find((d) => d.ability === 'BREAK')!.chance).toBe(1)
  })
})

describe('pricing a hit as the weighted mean over the debuff states', () => {
  it('a switch on "has a debuff" is priced both ways and weighted by the chance: 1000 and 1200 at 0.3 is 1060', () => {
    const { debuff, use, dealt, battle } = setup()
    debuff('enemy1', 'd', 0.3)
    use()
    expect(dealt[0]!.damage).toBeCloseTo(1000 * 0.7 + 1200 * 0.3, 9)
    // Not a coarse threshold: with no debuff it is 1000, with a certain one 1200.
    const certainOne = setup()
    certainOne.debuff('enemy1', 'd')
    certainOne.use()
    expect(certainOne.dealt[0]!.damage).toBe(1200)
    expect(battle.timeline.modifiers.on('enemy1')).toHaveLength(1)
  })

  it('asks the kernel once per distinct state, not once per hit, and not at all when nothing is uncertain', () => {
    const { kernel, requests } = recording()
    const { debuff, use } = setup({ kernel })
    use()
    expect(requests).toHaveLength(1)
    debuff('enemy1', 'd', 0.3)
    use()
    // The certain state was cached; one new request for the debuffed state.
    expect(requests).toHaveLength(2)
  })

  it('independent uncertain debuffs are all enumerated, each combination weighted by the product of its chances', () => {
    // Price 1000 + 100 per debuff present, read as the debuff count (a count switch).
    const kit: Kit = {
      ...probe(),
      create: (battle, self) => ({
        ...probe().create(battle, self),
        attackerState: (enemy) => ({ characterConditionals: { n: battle.debuffCount(enemy) } }),
      }),
    }
    const { kernel } = recording((r) => 1000 + 100 * Number(r.attacker.characterConditionals?.n))
    const { debuff, use, dealt } = setup({ kit, kernel })
    debuff('enemy1', 'a', 0.5)
    debuff('enemy1', 'b', 0.25)
    debuff('enemy1', 'c', 1)
    use()
    // Mean count 1.75, linear: 1000 + 175.
    expect(dealt[0]!.damage).toBeCloseTo(1175, 9)
  })

  it('a capped count is not the cap of the mean: min(3, N) with N = 2 + Binomial(3, 1/2) is 2.875, not 3', () => {
    const kit: Kit = {
      ...probe(),
      create: (battle, self) => ({
        ...probe().create(battle, self),
        attackerState: (enemy) => ({ characterConditionals: { n: Math.min(3, battle.debuffCount(enemy)) } }),
      }),
    }
    const { kernel } = recording((r) => 1000 * Number(r.attacker.characterConditionals?.n))
    const { debuff, use, dealt } = setup({ kit, kernel })
    debuff('enemy1', 'c1')
    debuff('enemy1', 'c2')
    for (const id of ['u1', 'u2', 'u3']) debuff('enemy1', id, 0.5)
    use()
    expect(dealt[0]!.damage).toBeCloseTo(1000 * (2 * (1 / 8) + 3 * (7 / 8)), 9)
  })

  it('an uncertain modifier on an ally (a doubling, a buff) is a state too', () => {
    const kit: Kit = {
      ...probe(),
      create: (battle, self) => ({
        ...probe().create(battle, self),
        attackerState: () => ({ characterConditionals: { marked: certain(battle.presence('a', 'buff')) } }),
      }),
    }
    const { battle, use, dealt } = setup({ kit })
    battle.timeline.modifiers.apply({ id: 'buff', target: 'a', source: 'a', chance: 0.25 })
    use()
    expect(dealt[0]!.damage).toBeCloseTo(0.75 * 1000 + 0.25 * 1200, 9)
  })

  it('stops with a clear error when too many uncertain modifiers surround one enemy', () => {
    const { debuff, use } = setup()
    for (let i = 0; i <= MAX_UNCERTAIN_MODIFIERS; i++) debuff('enemy1', `d${i}`, 0.5)
    expect(() => use()).toThrow(/uncertain modifiers/)
  })

  it('combatStats is the mean of the stats over the states', () => {
    const kernel: DamageKernel = {
      actionDamage: (r) => fakeResult({ BASIC: [{ damage: 1, scaling: 1 }] }, { ATK: r.attacker.characterConditionals?.marked === true ? 2000 : 1000, DEF: 0, HP: 0, SPD: 0, CR: 0, CD: 0, EHR: 0, RES: 0, BE: 0, ERR: 0, OHB: 0 }),
    }
    const { battle, debuff } = setup({ kernel })
    debuff('enemy1', 'd', 0.5)
    expect(battle.combatStats('a').ATK).toBeCloseTo(1500, 9)
  })
})

describe('worldWeight: a part priced in the states that set its size', () => {
  const state = (battle: Battle, enemy: string) => certain(battle.debuffChance(enemy))

  it('a part that exists only where the enemy is debuffed is priced as against a debuffed enemy, not at the mean price', () => {
    // The hit is 1000 plain and 1200 against a debuffed enemy (the kernel's switch). A hit that only happens on a debuffed enemy
    // is worth 1200 x the chance, not (0.7 x 1000 + 0.3 x 1200) x the chance.
    const kit = (battle: Battle) => probe(() => [{ shape: 'single', scaling: 1, hit: 0, worldWeight: () => (state(battle, 'enemy1') ? 1 : 0) }])
    let built: Battle | undefined
    const lazy: Kit = {
      ...probe(),
      create: (battle, self) => {
        built = battle
        return kit(battle).create(battle, self)
      },
    }
    const { debuff, use, dealt } = setup({ kit: lazy })
    expect(built).toBeDefined()
    debuff('enemy1', 'd', 0.3)
    use()
    expect(dealt[0]!.damage).toBeCloseTo(0.3 * 1200, 9)
    expect(dealt[0]!.scaling).toBeCloseTo(0.3, 12)
  })

  it('a part whose size is the debuff count is priced state by state: the price and the count are read together', () => {
    // Price 1000 x count; the part is "count" of a 100% hit: E[count x price] is not E[count] x E[price].
    const kit: Kit = {
      characterId: 'probe',
      path: 'Hunt',
      element: 'Fire',
      maxEnergy: 0,
      create: (battle, self) => ({
        actions: {
          basic: {
            kind: 'basic',
            canUse: () => true,
            use: () =>
              battle.performAction(self.key, 'basic', 'basic', () =>
                battle.attack({
                  attacker: self.key,
                  ability: 'BASIC',
                  parts: [{ shape: 'single', scaling: 1, hit: 0, worldWeight: () => battle.debuffCount('enemy1') }],
                }),
              ),
          },
        },
        attackerState: (enemy) => ({ characterConditionals: { n: battle.debuffCount(enemy) } }),
        teammateState: () => ({}),
      }),
    }
    const { kernel } = recording((r) => 100 + 1000 * Number(r.attacker.characterConditionals?.n))
    const { debuff, use, dealt } = setup({ kit, kernel })
    debuff('enemy1', 'u', 0.5)
    use()
    // States: no debuff (price 100, count 0) and one debuff (price 1100, count 1), half each: 0.5 x 1 x 1100.
    expect(dealt[0]!.damage).toBeCloseTo(550, 9)
    expect(dealt[0]!.scaling).toBeCloseTo(0.5, 12)
  })
})

describe('the equipment modules read the debuffs in the state being priced', () => {
  const lc = (module: LightConeModule): MemberEquipment => ({ lightCone: module, sets: [] })
  const read = (request: DamageRequest, key: string) => request.attacker.lightConeConditionals?.[key]

  it('In the Name of the World: the DMG bonus counts at the chance the enemy is debuffed', () => {
    const { kernel } = recording((r) => (read(r, 'enemyDebuffedDmgBoost') === true ? 1240 : 1000))
    const { debuff, use, dealt } = setup({ equipment: lc(InTheNameOfTheWorld), kernel })
    debuff('enemy1', 'd', 0.3)
    use()
    expect(dealt[0]!.damage).toBeCloseTo(1000 + 240 * 0.3, 9)
    // A break effect counts as a debuff too.
    const withBreak = setup({ equipment: lc(InTheNameOfTheWorld), kernel })
    withBreak.battle.imprison('enemy1', 'x', 0.3, false)
    withBreak.use()
    expect(withBreak.dealt[0]!.damage).toBeCloseTo(1240, 9)
  })

  it('Good Night and Sleep Well: min(3, debuffs) is priced per state, 2.875 stacks where the mean count is 3.5', () => {
    const { kernel } = recording((r) => 1000 * (1 + 0.12 * Number(read(r, 'debuffStacksDmgIncrease'))))
    const { debuff, use, dealt } = setup({ equipment: lc(GoodNightAndSleepWell), kernel })
    debuff('enemy1', 'c1')
    debuff('enemy1', 'c2')
    for (const id of ['u1', 'u2', 'u3']) debuff('enemy1', id, 0.5)
    use()
    expect(dealt[0]!.damage).toBeCloseTo(1000 * (1 + 0.12 * 2.875), 9)
  })

  it('Pioneer Diver: the tiers are priced per state: one certain debuff and one at 1/2 is half tier 0 and half tier 1', () => {
    const menu: Record<number, number> = { [-1]: 1000, 0: 1100, 1: 1300, 2: 1500, 3: 1700, 4: 1900 }
    const { kernel } = recording((r) => menu[Number(r.setConditionals?.['Pioneer Diver of Dead Waters'])]!)
    const { debuff, use, dealt } = setup({ equipment: { lightCone: lc(InTheNameOfTheWorld).lightCone, sets: [{ module: PioneerDiverOfDeadWaters, pieces: 4 }] }, kernel })
    debuff('enemy1', 'c')
    debuff('enemy1', 'u', 0.5)
    use()
    // The light cone's own switch is irrelevant to this kernel; the set is tier 0 (1 debuff) or 1 (2 debuffs), half each.
    expect(dealt[0]!.damage).toBeCloseTo(0.5 * 1100 + 0.5 * 1300, 9)
  })

  it('Pioneer Diver\'s doubling is a state too: the wearer\'s debuff at chance 0.5 doubles at 0.5', () => {
    const menu: Record<number, number> = { [-1]: 1000, 0: 1100, 1: 1300, 2: 1500, 3: 1700, 4: 1900 }
    const { kernel } = recording((r) => menu[Number(r.setConditionals?.['Pioneer Diver of Dead Waters'])]!)
    const { battle, use, dealt } = setup({ equipment: { lightCone: lc(InTheNameOfTheWorld).lightCone, sets: [{ module: PioneerDiverOfDeadWaters, pieces: 4 }] }, kernel })
    // Two certain debuffs by someone else (tier 1, 1300) and a wearer's debuff at 0.5 elsewhere (the doubling, at 0.5).
    for (const id of ['c1', 'c2']) battle.timeline.modifiers.apply({ id, target: 'enemy1', source: 'x', debuff: true })
    battle.applyDebuff({ id: 'own', target: 'enemy1', source: 'a', chance: 0.5 })
    expect(battle.presence('a', 'set.117.doubled')).toBeCloseTo(0.5, 12)
    use()
    // States: the own debuff present or not (count 3 or 2) and the doubling on or off, independent halves each (an approximation: they
    // are one event). Tiers: count 2 plain 1 (1300), 2 doubled 3 (1700), 3 plain 2 (1500), 3 doubled 4 (1900); the four states weigh .25.
    expect(dealt[0]!.damage).toBeCloseTo(0.25 * (1300 + 1700 + 1500 + 1900), 9)
  })
})
