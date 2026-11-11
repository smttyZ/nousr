import { describe, expect, it } from 'vitest'
import { Timeline } from './index'
import type { Step } from './index'

const turnTimes = (steps: Step[], unit: string) =>
  steps.filter((s) => s.kind === 'turn' && s.unit === unit).map((s) => (s as { at: number }).at)

describe('timed modifiers', () => {
  it('a modifier without a duration stays until removed', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    t.modifiers.apply({ id: 'aura', target: 'a', source: 'a', spdFlat: 25 })
    t.run({ cycles: 3 })
    expect(t.modifiers.has('a', 'aura')).toBe(true)
    expect(t.modifiers.remove('a', 'aura')).toBe(true)
    expect(t.modifiers.remove('a', 'aura')).toBe(false)
    expect(t.spd('a')).toBe(100)
  })

  it('a 2-turn buff from an ally lasts through two of the holder\'s turns, then SPD drops back', () => {
    const t = new Timeline()
    t.addUnit({ id: 'dps', baseSpd: 100 })
    // Applied before anyone acts, as an ally would between turns.
    t.modifiers.apply({
      id: 'haste', target: 'dps', source: 'support', spdPct: 0.25, duration: { turns: 2, tick: 'turnEnd' },
    })
    // 125 SPD for two gauges (80 AV each), then 100 SPD again.
    expect(turnTimes(t.run({ cycles: 3 }), 'dps')).toEqual([80, 160, 260])
    expect(t.modifiers.has('dps', 'haste')).toBe(false)
  })

  it('a buff a unit gives itself on its own turn does not count that turn', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    const steps = t.run({
      cycles: 4,
      takeTurn: (turn, tl) => {
        if (turn.index === 1) {
          tl.modifiers.apply({
            id: 'self', target: 'a', source: 'a', spdPct: 0.25, duration: { turns: 2, tick: 'turnEnd' },
          })
        }
      },
    })
    // Turn 1 at 100 applies it. It is up for the waits before turns 2 and 3 (80 AV each) and
    // expires at the end of turn 3.
    expect(turnTimes(steps, 'a')).toEqual([100, 180, 260, 360])
  })

  it('countApplicationTurn makes the application turn count', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    const steps = t.run({
      cycles: 4,
      takeTurn: (turn, tl) => {
        if (turn.index === 1) {
          tl.modifiers.apply({
            id: 'self', target: 'a', source: 'a', spdPct: 0.25,
            duration: { turns: 2, tick: 'turnEnd', countApplicationTurn: true },
          })
        }
      },
    })
    expect(turnTimes(steps, 'a')).toEqual([100, 180, 280, 380])
  })

  it('a turnStart duration drops at the start of the holder\'s turn, after listeners have seen it', () => {
    const t = new Timeline()
    t.addUnit({ id: 'enemy', baseSpd: 100 })
    t.modifiers.apply({
      id: 'dot', target: 'enemy', source: 'ally', duration: { turns: 2, tick: 'turnStart' },
    })
    const seenAtTurnStart: boolean[] = []
    const seenWhenActing: boolean[] = []
    t.bus.on('turnStart', () => seenAtTurnStart.push(t.modifiers.has('enemy', 'dot')))
    t.run({ cycles: 3, takeTurn: () => seenWhenActing.push(t.modifiers.has('enemy', 'dot')) })
    expect(seenAtTurnStart).toEqual([true, true, false])
    expect(seenWhenActing).toEqual([true, false, false])
  })

  it('a duration can count another unit\'s turns', () => {
    const t = new Timeline()
    t.addUnit({ id: 'caster', baseSpd: 100 })
    t.addUnit({ id: 'dps', baseSpd: 200 })
    t.modifiers.apply({
      id: 'field', target: 'dps', source: 'caster', spdPct: 0.1,
      duration: { turns: 1, tick: 'turnStart', clock: 'caster' },
    })
    const removedAt: number[] = []
    t.bus.on('modifierRemoved', () => removedAt.push(t.now))
    t.run({ cycles: 1 })
    // The dps acts twice before then; only the caster's turn at 100 ends it.
    // Elapsed time is a running sum of floats, so compare with a tolerance.
    expect(removedAt).toHaveLength(1)
    expect(removedAt[0]).toBeCloseTo(100, 9)
  })

  it('applying the same id again replaces it and restarts the count', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    const events: string[] = []
    t.bus.on('modifierApplied', (e) => events.push(`applied stacks=${e.modifier.stacks} previous=${e.previous?.stacks}`))
    t.bus.on('modifierRemoved', (e) => events.push(`removed ${e.reason}`))

    t.modifiers.apply({ id: 's', target: 'a', source: 'a', stacks: 1, duration: { turns: 1, tick: 'turnEnd' } })
    t.step() // turn 1: one turn used, so it would expire here...
    expect(t.modifiers.has('a', 's')).toBe(false)

    t.modifiers.apply({ id: 's', target: 'a', source: 'a', stacks: 1, duration: { turns: 2, tick: 'turnEnd' } })
    t.step() // turn 2: one of two used
    t.modifiers.apply({ id: 's', target: 'a', source: 'a', stacks: 2, duration: { turns: 2, tick: 'turnEnd' } })
    expect(t.modifiers.get('a', 's')?.turnsLeft).toBe(2)
    expect(t.modifiers.on('a')).toHaveLength(1)

    expect(events).toEqual([
      'applied stacks=1 previous=undefined',
      'removed expired',
      'applied stacks=1 previous=undefined',
      'applied stacks=2 previous=1',
    ])
  })

  it('records when a modifier was applied', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    const between = t.modifiers.apply({ id: 'x', target: 'a', source: 'a' })
    expect([between.appliedAt, between.appliedInTurn]).toEqual([0, undefined])
    t.run({
      cycles: 1,
      takeTurn: (turn, tl) => {
        const during = tl.modifiers.apply({ id: 'y', target: 'a', source: 'a' })
        expect([during.appliedAt, during.appliedInTurn]).toEqual([100, turn.serial])
      },
    })
  })

  it('rejects a duration that is not a positive whole number of turns', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    expect(() =>
      t.modifiers.apply({ id: 'bad', target: 'a', source: 'a', duration: { turns: 0, tick: 'turnEnd' } }),
    ).toThrow(/positive whole number/)
  })
})
