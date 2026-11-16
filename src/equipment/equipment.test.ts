import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { BattleSetup, MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild, KernelUnit } from '../kernel/types'
import { Acheron } from '../kits/acheron'
import type { Kit } from '../kits/kit'
import type { Rule } from '../scenario/types'
import { AlongThePassingShore, DanceDanceDance, EQUIPMENT, PioneerDiverOfDeadWaters } from './index'
import type { EquipmentInstance, LightConeModule, MemberEquipment, SetModule } from './index'
import { createRegistry, lightConeWithoutBehaviour, resolveEquipment, setWithoutBehaviour } from './index'

const profile = loadEnemyProfile('generic-moc')
const noBuild: KernelBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/** A kernel that records what it is asked and prices every hit at 1,000 per 100%. */
function recordingKernel() {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = {
    actionDamage(request) {
      requests.push(request)
      const hit = [{ damage: 1000, scaling: 1 }]
      return fakeResult({ BASIC: hit, SKILL: hit, ULT: hit, FUA: hit })
    },
  }
  return { kernel, requests }
}

/** A made-up character whose Basic ATK is `parts` separate attacks against the primary target, in one action. */
const prober = (parts = 2, path: 'Hunt' | 'Harmony' = 'Hunt', ultimate = false): Kit => ({
  characterId: 'prober',
  path,
  element: 'Fire',
  maxEnergy: 0,
  create: (battle, self) => {
    let charged = ultimate
    return {
      actions: {
        basic: {
          kind: 'basic',
          canUse: () => true,
          use: () =>
            battle.performAction(self.key, 'basic', 'basic', () => {
              for (let i = 0; i < parts; i++) {
                battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'aoe', scaling: 1, hit: 0 }] })
              }
            }),
        },
        ultimate: {
          kind: 'ultimate',
          canUse: () => charged,
          use: () =>
            battle.performAction(self.key, 'ultimate', 'ultimate', () => {
              charged = false
              battle.attack({ attacker: self.key, ability: 'ULT', parts: [{ shape: 'aoe', scaling: 1, hit: 0 }] })
            }),
        },
      },
      attackerState: () => ({}),
      teammateState: () => ({}),
    }
  },
})

const member = (key: string, kit: Kit, equipment: MemberEquipment | undefined, baseSpd = 100, superimposition = 1): MemberSetup => ({
  key,
  kit,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
  kernel: { unit: { characterId: key, lightConeId: 'x', eidolon: 0, superimposition }, build: noBuild },
  ...(equipment && { equipment }),
})

const lc = (module: LightConeModule): MemberEquipment => ({ lightCone: module, sets: [] })
const rule = (unit: string, use: string): Rule => ({ unit, use, when: [] })

function battleOf(members: MemberSetup[], policy: Rule[], kernel: DamageKernel, overrides: Partial<BattleSetup> = {}) {
  return new Battle({
    members,
    policy,
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 3,
    start: { energy: 0.5, skillPoints: 3, techniques: false },
    kernel,
    ...overrides,
  })
}

describe('Along the Passing Shore', () => {
  it('puts a debuff on the enemy when the wearer hits, so it counts in the action and for "debuffed" checks', () => {
    const { kernel } = recordingKernel()
    const battle = battleOf([member('a', prober(1), lc(AlongThePassingShore))], [rule('a', 'basic')], kernel, { cycles: 1 })
    const landed: string[] = []
    battle.timeline.bus.on('modifierApplied', ({ modifier }) => {
      if (modifier.debuff) landed.push(`${modifier.target} from ${modifier.source}`)
    })
    const { actions } = battle.run()
    expect(actions[0]!.debuffed).toEqual(['enemy1'])
    expect(landed).toEqual(['enemy1 from a'])
  })

  it('without the module there is no debuff', () => {
    const { kernel } = recordingKernel()
    const battle = battleOf([member('a', prober(1), undefined)], [rule('a', 'basic')], kernel, { cycles: 1 })
    expect(battle.run().actions[0]!.debuffed).toEqual([])
  })

  it('the hit that applies Mirage Fizzle already gets the bonus: the first hit and a later part of the action are both priced with it (settled in game, 2026-11-15)', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('a', prober(2), lc(AlongThePassingShore))], [rule('a', 'basic')], kernel, { cycles: 1 }).run()
    // (Identical requests are asked once, so there may be one; the old reading asked for the first hit without the bonus first.)
    expect(requests.length).toBeGreaterThan(0)
    for (const r of requests) expect(r.attacker.lightConeConditionals).toEqual({ emptyBubblesDebuff: true })
  })

  it('is one Mirage Fizzle per enemy however many attacks the action has: refreshed, one debuff, chance 1', () => {
    const { kernel } = recordingKernel()
    const battle = battleOf([member('a', prober(3), lc(AlongThePassingShore))], [rule('a', 'basic')], kernel, { cycles: 1 })
    const actions: Array<{ debuffed: string[], debuffChance: Record<string, number> }> = []
    battle.timeline.bus.on('actionUsed', (a) => actions.push(a))
    battle.member('a').instance.actions.basic!.use()
    expect(battle.debuffCount('enemy1')).toBe(1)
    expect(actions[0]!.debuffed).toEqual(['enemy1'])
    expect(actions[0]!.debuffChance).toEqual({ enemy1: 1 })
  })

  describe('on a bounce, per enemy at the chance the bounce hit it (K22)', () => {
    /** Basic ATK: one bounce of `hits` hits. */
    const bouncer = (hits: number): Kit => ({
      characterId: 'bouncer',
      path: 'Hunt',
      element: 'Fire',
      maxEnergy: 0,
      create: (battle, self) => ({
        actions: {
          basic: {
            kind: 'basic',
            canUse: () => true,
            use: () =>
              battle.performAction(self.key, 'basic', 'basic', () => {
                battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'bounce', scaling: 1, hits, hit: 0 }] })
              }),
          },
        },
        attackerState: () => ({}),
        teammateState: () => ({}),
      }),
    })

    it('each enemy gets the Fizzle at 1 - (1 - 1/n)^hits, which the action reports and the debuff count adds up', () => {
      const { kernel } = recordingKernel()
      const battle = battleOf([member('a', bouncer(3), lc(AlongThePassingShore))], [rule('a', 'basic')], kernel, { cycles: 1, enemyCount: 3 })
      const actions: Array<{ debuffChance: Record<string, number> }> = []
      battle.timeline.bus.on('actionUsed', (a) => actions.push(a))
      battle.member('a').instance.actions.basic!.use()
      const chance = 1 - (2 / 3) ** 3
      for (const enemy of battle.enemies.ids) {
        expect(battle.presence(enemy, 'lightcone.23024.mirage_fizzle:a')).toBeCloseTo(chance, 12)
        expect(actions[0]!.debuffChance[enemy]).toBeCloseTo(chance, 12)
      }
      expect(battle.debuffChance('enemy1')).toBeCloseTo(chance, 12)
    })

    it('every hit, the one that applies the Fizzle included, gets the full 24% DMG whatever the chance the bounce landed (settled in game, 2026-11-15)', () => {
      const requests: DamageRequest[] = []
      const kernel: DamageKernel = {
        actionDamage(request) {
          requests.push(request)
          const bonus = request.attacker.lightConeConditionals?.emptyBubblesDebuff === true ? 1.24 : 1
          return fakeResult({ BASIC: [{ damage: 1000 * bonus, scaling: 1 }] })
        },
      }
      const battle = battleOf([member('a', bouncer(3), lc(AlongThePassingShore), 1000)], [rule('a', 'basic')], kernel, { cycles: 1, enemyCount: 3 })
      const dealt: number[] = []
      battle.timeline.bus.on('damageDealt', (d) => {
        if (d.enemy === 'enemy1') dealt.push(d.damage)
      })
      const actions = battle.member('a').instance.actions
      actions.basic!.use()
      actions.basic!.use()
      // 3 hits split over 3 enemies: 1000 per enemy, and 1.24 times that in both actions.
      expect(dealt[0]).toBeCloseTo(1240, 6)
      expect(dealt[1]).toBeCloseTo(1240, 6)
    })
  })

  it('reaches every enemy the action damaged', () => {
    const { kernel } = recordingKernel()
    const battle = battleOf([member('a', prober(1), lc(AlongThePassingShore))], [rule('a', 'basic')], kernel, { cycles: 1, enemyCount: 3 })
    expect(battle.run().actions[0]!.debuffed).toEqual(['enemy1', 'enemy2', 'enemy3'])
  })

  it('lasts 1 turn of the enemy: the next action meets it gone once the enemy has acted, and still up if not', () => {
    // The wearer is far faster than the enemy (generic enemy SPD 158.4), so it acts twice before the enemy does. The debuff is read
    // at the start of each of the wearer's turns.
    const upAtTurnStart = (baseSpd: number, cycles: number): boolean[] => {
      const { kernel } = recordingKernel()
      const battle = battleOf([member('a', prober(1), lc(AlongThePassingShore), baseSpd)], [rule('a', 'basic')], kernel, { cycles })
      const seen: boolean[] = []
      battle.timeline.bus.on('turnStart', (turn) => {
        if (turn.unit === 'a') seen.push(battle.debuffCount('enemy1') > 0)
      })
      battle.run()
      return seen
    }
    const fast = upAtTurnStart(1000, 1)
    expect(fast[0]).toBe(false)
    expect(fast[1]).toBe(true) // second action, the enemy has not had a turn
    // The enemy acts between every action of a slow wearer.
    expect(upAtTurnStart(50, 3).every((up) => !up)).toBe(true)
  })

  it('feeds Acheron\'s talent: each action gives her a Slashed Dream and a Crimson Knot, which an unequipped Acheron does not get', () => {
    const acheron = (equipment: MemberEquipment | undefined) => ({
      ...member('acheron', Acheron, equipment, 100),
      kernel: { unit: { characterId: '1308', lightConeId: '23024', eidolon: 0, superimposition: 1 }, build: noBuild },
    })
    const quantity = (battle: Battle, name: string) => battle.member('acheron').instance.quantities![name]!() as number
    const run = (equipment: MemberEquipment | undefined) => {
      const { kernel } = recordingKernel()
      const battle = battleOf([acheron(equipment)], [rule('acheron', 'basic')], kernel, { cycles: 3 })
      const { actions } = battle.run()
      return { actions: actions.length, dream: quantity(battle, 'slashed_dream'), knots: quantity(battle, 'crimson_knots') }
    }
    const without = run(undefined)
    const wearing = run(lc(AlongThePassingShore))
    expect(without.actions).toBe(3)
    expect(without.dream).toBe(5)
    expect(without.knots).toBe(5)
    // Red Oni's 5 plus one per action; the knots are on the primary target she attacks.
    expect(wearing.actions).toBe(3)
    expect(wearing.dream).toBe(5 + wearing.actions)
    expect(wearing.knots).toBe(5 + wearing.actions)
  })

  it('supplies nothing as a teammate: Fribbels has no teammate keys for it', () => {
    const { kernel, requests } = recordingKernel()
    battleOf(
      [member('a', prober(1), undefined), member('b', prober(1), lc(AlongThePassingShore))],
      [rule('a', 'basic'), rule('b', 'basic')],
      kernel,
      { cycles: 1 },
    ).run()
    expect(requests[0]!.teammates[0]!.lightConeConditionals).toBeUndefined()
  })
})

describe('Dance! Dance! Dance!', () => {
  it('advances every ally, the wearer included, by 16% at superimposition 1 when the wearer uses the Ultimate', () => {
    const { kernel } = recordingKernel()
    const second = battleOf(
      [member('wearer', prober(1, 'Harmony', true), lc(DanceDanceDance), 100), member('friend', prober(1), undefined, 120)],
      [rule('wearer', 'ultimate'), rule('wearer', 'basic'), rule('friend', 'basic')],
      kernel,
    )
    const seen: Record<string, number> = {}
    second.timeline.bus.on('gaugeChanged', (g) => {
      if (g.cause === 'advance') seen[g.unit] = (g.before - g.after) / 10_000
    })
    second.run()
    expect(seen.wearer).toBeCloseTo(0.16, 9)
    expect(seen.friend).toBeCloseTo(0.16, 9)
  })

  it('scales with superimposition and ignores teammates\' Ultimates', () => {
    const { kernel } = recordingKernel()
    const run = (superimposition: number, wearerUltimate: boolean) => {
      const battle = battleOf(
        [
          member('wearer', prober(1, 'Harmony', wearerUltimate), lc(DanceDanceDance), 100, superimposition),
          member('friend', prober(1, 'Hunt', !wearerUltimate), undefined, 120),
        ],
        [rule('wearer', 'ultimate'), rule('friend', 'ultimate'), rule('wearer', 'basic'), rule('friend', 'basic')],
        kernel,
      )
      const seen: number[] = []
      battle.timeline.bus.on('gaugeChanged', (g) => {
        if (g.cause === 'advance' && g.unit === 'friend') seen.push((g.before - g.after) / 10_000)
      })
      battle.run()
      return seen
    }
    expect(run(5, true)[0]).toBeCloseTo(0.24, 9)
    expect(run(3, false)).toEqual([])
  })

  it('has no conditionals for Fribbels', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('a', prober(1), lc(DanceDanceDance))], [rule('a', 'basic')], kernel, { cycles: 1 }).run()
    expect(requests[0]!.attacker.lightConeConditionals).toBeUndefined()
  })

  it('rejects a superimposition outside 1 to 5', () => {
    const { kernel } = recordingKernel()
    expect(() => battleOf([member('a', prober(1), lc(DanceDanceDance), 100, 6)], [rule('a', 'basic')], kernel)).toThrow(/1 to 5, got 6/)
  })
})

describe('Pioneer Diver of Dead Waters', () => {
  const pioneer: MemberEquipment = { lightCone: lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' }), sets: [{ module: PioneerDiverOfDeadWaters, pieces: 4 }] }
  const value = (r: DamageRequest) => r.setConditionals!['Pioneer Diver of Dead Waters'] as number

  /** A debuffer on the field: puts `n` named debuffs on the enemy at the start of the battle, sourced from the helper. */
  const debuffer = (n: number, sourceIsWearer: boolean): Kit => ({
    ...prober(1, 'Harmony'),
    characterId: 'debuffer',
    create: (battle, self) => {
      const base = prober(1, 'Harmony').create(battle, self)
      return {
        ...base,
        onBattleStart: () => {
          for (let i = 0; i < n; i++) battle.applyDebuff({ id: `d${i}`, target: battle.primary, source: sourceIsWearer ? 'wearer' : self.key })
        },
      }
    },
  })

  it('reads the number of debuffs on the enemy being hit, from any source', () => {
    const results: number[] = []
    for (const n of [0, 1, 2, 3, 5]) {
      const { kernel, requests } = recordingKernel()
      battleOf(
        [member('wearer', prober(1), pioneer, 100), member('other', debuffer(n, false), undefined, 10)],
        [rule('wearer', 'basic')],
        kernel,
        { cycles: 1 },
      ).run()
      results.push(value(requests[0]!))
    }
    // No debuff: off (-1). One: 0. Two: 1. Three or more: 2.
    expect(results).toEqual([-1, 0, 1, 2, 2])
  })

  it('doubles for a turn after the wearer inflicts a debuff', () => {
    const { kernel, requests } = recordingKernel()
    battleOf(
      [member('wearer', prober(1), pioneer, 100), member('other', debuffer(3, true), undefined, 10)],
      [rule('wearer', 'basic')],
      kernel,
      { cycles: 1 },
    ).run()
    // Three debuffs, all put on by the wearer at the start: doubled, 3 or more.
    expect(value(requests[0]!)).toBe(4)
    const two = recordingKernel()
    battleOf(
      [member('wearer', prober(1), pioneer, 100), member('other', debuffer(2, true), undefined, 10)],
      [rule('wearer', 'basic')],
      two.kernel,
      { cycles: 1 },
    ).run()
    expect(value(two.requests[0]!)).toBe(3)
  })

  it('with Along the Passing Shore, the light cone\'s debuff is the first to be counted and starts the doubling', () => {
    const both: MemberEquipment = { lightCone: AlongThePassingShore, sets: [{ module: PioneerDiverOfDeadWaters, pieces: 4 }] }
    const { kernel, requests } = recordingKernel()
    battleOf([member('wearer', prober(2), both, 100)], [rule('wearer', 'basic')], kernel, { cycles: 1 }).run()
    // First part: no debuff yet. Second part: Mirage Fizzle is the one debuff, and it was inflicted by the wearer
    // (doubling needs two debuffs for the menu's doubled states, so it reads as 0).
    expect(requests.map(value)).toEqual([-1, 0])
    expect(requests[1]!.attacker.lightConeConditionals).toEqual({ emptyBubblesDebuff: true })
  })

  it('does not reach the kernel as a teammate flag: Pioneer is not on Fribbels\' team list', () => {
    const { kernel, requests } = recordingKernel()
    battleOf(
      [member('a', prober(1), undefined), member('b', prober(1), pioneer)],
      [rule('a', 'basic'), rule('b', 'basic')],
      kernel,
      { cycles: 1 },
    ).run()
    expect(requests[0]!.teammates[0]).not.toHaveProperty('teamRelicSet')
    expect(requests[0]!.setConditionals).toBeUndefined()
  })
})

describe('how conditionals reach the kernel', () => {
  const fixture = (instance: EquipmentInstance): LightConeModule => ({ kind: 'lightCone', id: 'f', name: 'Fixture', create: () => instance })
  const setFixture = (instance: EquipmentInstance, name = 'Fixture Set'): SetModule => ({ kind: 'set', type: 'relic', name, create: () => instance })

  it('as the attacker: light cone conditionals on the attacker, set conditionals on the request', () => {
    const { kernel, requests } = recordingKernel()
    const wearing: MemberEquipment = {
      lightCone: fixture({ attackerState: () => ({ lightConeConditionals: { k: 1 } }) }),
      sets: [{ module: setFixture({ attackerState: () => ({ setConditionals: { 'Fixture Set': true } }) }), pieces: 4 }],
    }
    battleOf([member('a', prober(1), wearing)], [rule('a', 'basic')], kernel, { cycles: 1 }).run()
    expect(requests[0]!.attacker.lightConeConditionals).toEqual({ k: 1 })
    expect(requests[0]!.setConditionals).toEqual({ 'Fixture Set': true })
  })

  it('as a teammate: the other member\'s light cone teammate keys and team set flags, given the attacker and the enemy', () => {
    const { kernel, requests } = recordingKernel()
    const seen: string[] = []
    const wearing: MemberEquipment = {
      lightCone: fixture({
        teammateState: (attacker, enemy) => {
          seen.push(`${attacker.key}>${enemy}`)
          return { lightConeConditionals: { t: true } }
        },
      }),
      sets: [
        { module: setFixture({ teammateState: () => ({ teamRelicSet: 'Watchmaker, Master of Dream Machinations' }) }), pieces: 4 },
        { module: { ...setFixture({ teammateState: () => ({ teamOrnamentSet: 'Broken Keel' }) }, 'Orn'), type: 'ornament' }, pieces: 2 },
      ],
    }
    battleOf([member('a', prober(1), undefined), member('b', prober(1), wearing)], [rule('a', 'basic'), rule('b', 'basic')], kernel, { cycles: 1 }).run()
    expect(requests[0]!.teammates).toHaveLength(1)
    expect(requests[0]!.teammates[0]).toMatchObject({
      lightConeConditionals: { t: true },
      teamRelicSet: 'Watchmaker, Master of Dream Machinations',
      teamOrnamentSet: 'Broken Keel',
    })
    expect(seen[0]).toBe('a>enemy1')
  })

  it('two modules setting the same key is an error, not a silent merge', () => {
    const { kernel } = recordingKernel()
    const wearing: MemberEquipment = {
      lightCone: fixture({ attackerState: () => ({ setConditionals: { s: 1 } }) }),
      sets: [{ module: setFixture({ attackerState: () => ({ setConditionals: { s: 2 } }) }), pieces: 2 }],
    }
    expect(() => battleOf([member('a', prober(1), wearing)], [rule('a', 'basic')], kernel, { cycles: 1 }).run()).toThrow(/both set "s"/)
  })

  it('modules are created once per member, before the kits, and see the whole field', () => {
    const { kernel } = recordingKernel()
    const created: string[] = []
    const wearing: MemberEquipment = {
      lightCone: fixture({}),
      sets: [],
    }
    wearing.lightCone = { ...wearing.lightCone, create: (battle, wearer) => {
      created.push(`${wearer.key}:${battle.members.length}`)
      return {}
    } }
    battleOf([member('a', prober(1), wearing), member('b', prober(1), wearing)], [rule('a', 'basic')], kernel, { cycles: 1 })
    expect(created).toEqual(['a:2', 'b:2'])
  })
})

describe('resolving a member\'s equipment', () => {
  const unit = (lightConeId: string): KernelUnit => ({ characterId: '1308', eidolon: 0, lightConeId, superimposition: 1 })
  const build = (relicSet1: string, relicSet2: string, ornamentSet: string): KernelBuild => ({ ...noBuild, relicSet1, relicSet2, ornamentSet })

  it('finds the light cone and the 4-piece relic set and the 2-piece ornament of a benchmark build', () => {
    const resolved = resolveEquipment(unit('23024'), build('Pioneer Diver of Dead Waters', 'Pioneer Diver of Dead Waters', 'Izumo Gensei and Takama Divine Realm'), EQUIPMENT)
    expect(resolved.lightCone).toBe(AlongThePassingShore)
    expect(resolved.sets.map((s) => [s.module.name, s.pieces])).toEqual([
      ['Pioneer Diver of Dead Waters', 4],
      ['Izumo Gensei and Takama Divine Realm', 2],
    ])
  })

  it('reads two different relic sets as 2 pieces each', () => {
    const resolved = resolveEquipment(unit('23024'), build('Pioneer Diver of Dead Waters', 'Musketeer of Wild Wheat', 'Inert Salsotto'), EQUIPMENT)
    expect(resolved.sets.map((s) => [s.module.name, s.pieces])).toEqual([
      ['Pioneer Diver of Dead Waters', 2],
      ['Musketeer of Wild Wheat', 2],
      ['Inert Salsotto', 2],
    ])
  })

  it('counts a scanned build\'s pieces by set_id, and ignores a lone piece', () => {
    const relic = (set_id: string, slot: string) => ({ set_id, slot, rarity: 5, level: 15, mainstat: 'HP', substats: [] })
    const scanned: KernelBuild = {
      source: 'HSR-Scanner',
      relics: [relic('117', 'Head'), relic('117', 'Hands'), relic('117', 'Body'), relic('117', 'Feet'), relic('314', 'Planar Sphere'), relic('99999', 'Link Rope')],
    }
    const resolved = resolveEquipment(unit('23024'), scanned, EQUIPMENT)
    expect(resolved.sets.map((s) => [s.module.name, s.pieces])).toEqual([['Pioneer Diver of Dead Waters', 4]])
  })

  it('stops, naming every missing item, rather than let the kernel count conditional effects as always on', () => {
    const attempt = () => resolveEquipment(unit('99999'), build('Mystery Set', 'Mystery Set', 'Mystery Ornament'), EQUIPMENT)
    expect(attempt).toThrow(/light cone 99999 has no equipment module/)
    expect(attempt).toThrow(/set "Mystery Set" \(4 pieces\) has no equipment module/)
    expect(attempt).toThrow(/set "Mystery Ornament" \(2 pieces\)/)
  })

  it('a module with no behaviour must say why', () => {
    expect(() => lightConeWithoutBehaviour({ id: '1', name: 'x', reason: ' ' })).toThrow(/needs a reason/)
    expect(() => setWithoutBehaviour({ type: 'relic', name: 'x', reason: '' })).toThrow(/needs a reason/)
  })

  it('a registry refuses duplicates', () => {
    const a = lightConeWithoutBehaviour({ id: '1', name: 'a', reason: 'test' })
    expect(() => createRegistry([a, a])).toThrow(/registered twice/)
  })
})
