import { describe, expect, it } from 'vitest'
import type { Battle } from '../battle/battle'
import type { EnemyProfile } from '../enemy/profile'
import { LongevousDisciple } from './longevousDisciple'
import { battleOf, byAttacker, idle, instanceOf, memberOf, policyOf, profile, recordingKernel, scriptedKit, watch, type Step } from './setTestKit'

const NAME = 'Longevous Disciple'
const bounceProfile: EnemyProfile = {
  ...profile,
  attacks: [...profile.attacks, { id: 'bounce', target: 'bounce', multiplier: 1, adjacentMultiplier: 0, hits: 3, energy: 0 }],
}

/** An enemy hit on `unit`: `hits` is the expected number of times, as the enemy turn reports it. */
const hit = (battle: Battle, unit: string, hits: number, attack = 'strike') =>
  battle.timeline.bus.emit('allyHit', { unit, enemy: battle.primary, attack, hits, damage: 0 })

/** The stacks the kernel is priced with at each of the wearer's hits, in order. */
const stacksOf = (battle: Battle): (number | boolean | undefined)[] =>
  watch(battle, 'w', () => instanceOf(battle, 'w').attackerState?.(battle.primary).setConditionals?.[NAME])

describe('Longevous Disciple', () => {
  it('is the relic set Fribbels calls by name, with its set id', () => {
    expect(LongevousDisciple.name).toBe(NAME)
    expect(LongevousDisciple.setId).toBe('113')
    expect(LongevousDisciple.type).toBe('relic')
  })

  /** The wearer plays `script` (one Basic ATK or so per step), then Basic ATKs: the first enemy turn comes long after. */
  const wearing = (script: Step[], pieces: 2 | 4 = 4, overrides = {}) => {
    const { kernel, requests } = recordingKernel()
    const battle = battleOf([memberOf('w', scriptedKit('w', script), { module: LongevousDisciple, pieces })], policyOf('w', script), kernel, overrides)
    const stacks = stacksOf(battle)
    return { battle, requests, stacks }
  }

  it("gives 0 stacks to the kernel before anything happens: not Fribbels' default of 2", () => {
    const { battle, stacks } = wearing([])
    battle.run()
    expect(stacks.slice(0, 3)).toEqual([0, 0, 0])
  })

  it('gains a stack each time its HP is consumed, up to 2', () => {
    const consume: Step = { use: 'basic', effect: (battle) => void battle.party.consumeHp('w', 100) }
    const { battle, stacks } = wearing([consume, consume, consume])
    battle.run()
    expect(stacks.slice(0, 4)).toEqual([1, 2, 2, 2])
  })

  it('also gains a stack when an ally consumes its HP', () => {
    const { kernel } = recordingKernel()
    const members = [
      memberOf('w', scriptedKit('w'), { module: LongevousDisciple, pieces: 4 }, { baseSpd: 200 }),
      memberOf('f', scriptedKit('f', [{ use: 'basic', effect: (battle) => void battle.party.consumeHp('w', 100, 'f'), attack: false }]), undefined, { baseSpd: 900 }),
    ]
    const battle = battleOf(members, [idle('f'), idle('w')], kernel)
    const stacks = stacksOf(battle)
    battle.run()
    expect(stacks[0]).toBe(1) // the ally acts first (SPD 900 against 200, and both before the enemy) and consumes the wearer's HP; the wearer's first hit has the stack
  })

  it('gains a stack when hit, and an uncertain hit gives the expected stacks', () => {
    const { battle, stacks } = wearing([
      { use: 'basic', effect: (b) => hit(b, 'w', 0.5) },
      { use: 'basic', effect: (b) => hit(b, 'w', 0.5) },
      { use: 'basic', effect: (b) => hit(b, 'w', 1) },
    ])
    battle.run()
    // After the first hit: P(1) = 0.5, mean 0.5. After the second: P(0) .25, P(1) .5, P(2) .25, mean 1. A certain hit then: P(1) .25 -> 2 w.p. .25+... = [0, .25, .75], mean 1.75.
    expect(stacks.slice(0, 3)).toEqual([0.5, 1, 1.75])
  })

  it('HP lost to damage with no hit event (a redirect) is not a stack, only consumed HP is', () => {
    const { battle, stacks } = wearing([{ use: 'basic', effect: (b) => void b.party.takeDamage('w', 100, 'enemy') }])
    battle.run()
    expect(stacks[0]).toBe(0)
  })

  it('a hit on someone else gives the wearer nothing', () => {
    const { battle, stacks } = wearing([{ use: 'basic', effect: (b) => hit(b, 'someone-else', 1) }])
    battle.run()
    expect(stacks[0]).toBe(0)
  })

  it('a hit with no chance of landing gives nothing', () => {
    const { battle, stacks } = wearing([{ use: 'basic', effect: (b) => hit(b, 'w', 0) }])
    battle.run()
    expect(stacks[0]).toBe(0)
  })

  it('a bounce attack is one trial per hit, each with its share of the expected hits', () => {
    // 1.5 expected hits of 3: p = 0.5 each. 3 trials at 0.5, capped at 2: P(0) = 1/8, P(1) = 3/8, P(2) = 1/2; mean 3/8 + 1 = 1.375.
    const { battle, stacks } = wearing([{ use: 'basic', effect: (b) => hit(b, 'w', 1.5, 'bounce') }], 4, { profile: bounceProfile })
    battle.run()
    expect(stacks[0]).toBeCloseTo(1.375, 12)
  })

  it('a hit from an attack the profile does not have is an error, not a guess', () => {
    const { battle } = wearing([{ use: 'basic', effect: (b) => hit(b, 'w', 1, 'nonexistent') }])
    expect(() => battle.run()).toThrow(/no enemy attack "nonexistent"/)
  })

  it("lasts 2 of the wearer's turns, then the stacks are gone", () => {
    const { battle, stacks } = wearing([
      { use: 'basic', effect: (b) => hit(b, 'w', 1) },
      { use: 'basic' },
      { use: 'basic' },
      { use: 'basic' },
    ])
    battle.run()
    // Given in the wearer's own turn 1: that turn does not count, so it is up for turns 2 and 3 and gone for turn 4.
    expect(stacks.slice(0, 4)).toEqual([1, 1, 1, 0])
  })

  it('a new stack refreshes the duration', () => {
    const { battle, stacks } = wearing([
      { use: 'basic', effect: (b) => hit(b, 'w', 1) },
      { use: 'basic' },
      { use: 'basic', effect: (b) => hit(b, 'w', 1) },
      { use: 'basic' },
      { use: 'basic' },
      { use: 'basic' },
    ])
    battle.run()
    expect(stacks.slice(0, 6)).toEqual([1, 1, 2, 2, 2, 0])
  })

  it('after expiry the next hit starts from 0 stacks again', () => {
    const { battle, stacks } = wearing([
      { use: 'basic', effect: (b) => hit(b, 'w', 1) },
      { use: 'basic' },
      { use: 'basic' },
      { use: 'basic' },
      { use: 'basic', effect: (b) => hit(b, 'w', 1) },
    ])
    battle.run()
    expect(stacks.slice(0, 5)).toEqual([1, 1, 1, 0, 1])
  })

  it('at 2 pieces nothing is supplied to the kernel and nothing is tracked', () => {
    const { battle, requests } = wearing([{ use: 'basic', effect: (b) => hit(b, 'w', 1) }], 2)
    battle.run()
    expect(byAttacker(requests, 'w').every((r) => r.setConditionals === undefined)).toBe(true)
    expect(battle.timeline.modifiers.on('w')).toEqual([])
  })

  it("reaches the kernel as the module's value, not Fribbels' default: the request carries 0 stacks", () => {
    const { battle, requests } = wearing([])
    battle.run()
    expect(byAttacker(requests, 'w')[0]!.setConditionals).toEqual({ [NAME]: 0 })
  })

  it("gives no team form to a teammate: the CRIT Rate is the wearer's only", () => {
    const { kernel, requests } = recordingKernel()
    const battle = battleOf(
      [memberOf('w', scriptedKit('w'), { module: LongevousDisciple, pieces: 4 }), memberOf('f', scriptedKit('f'))],
      [idle('w'), idle('f')],
      kernel,
    )
    battle.run()
    const friend = byAttacker(requests, 'f')
    expect(friend.length).toBeGreaterThan(0)
    expect(friend.every((r) => r.teammates.every((t) => t.teamRelicSet === undefined && t.teamOrnamentSet === undefined))).toBe(true)
  })
})
