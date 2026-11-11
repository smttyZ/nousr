import { describe, expect, it } from 'vitest'
import { ACTION_GAUGE, Timeline } from './index'
import type { Step } from './index'

function turnsOf(steps: Step[], unit?: string) {
  return steps.filter((s) => s.kind === 'turn').filter((s) => unit === undefined || s.unit === unit)
}

describe('action gauge and action value', () => {
  it('time to act is 10,000 / SPD', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    t.addUnit({ id: 'b', baseSpd: 160 })
    expect(ACTION_GAUGE).toBe(10_000)
    expect(t.av('a')).toBe(100)
    expect(t.av('b')).toBe(62.5)
  })

  it('SPD is base x (1 + SPD%) + flat SPD', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100, spdPct: 0.06, spdFlat: 25 })
    expect(t.spd('a')).toBeCloseTo(131, 10)
    t.modifiers.apply({ id: 'buff', target: 'a', source: 'a', spdPct: 0.12, spdFlat: 4 })
    expect(t.spd('a')).toBeCloseTo(147, 10)
  })

  it('units act in AV order and the gauge refills after each turn', () => {
    const t = new Timeline()
    t.addUnit({ id: 'slow', baseSpd: 100 })
    t.addUnit({ id: 'fast', baseSpd: 200 })
    const turns = turnsOf(t.run({ cycles: 1 }))
    expect(turns.map((s) => [s.unit, s.at])).toEqual([
      ['fast', 50],
      // Both are due at 100. Neither was advanced, so the unit added first goes first.
      ['slow', 100],
      ['fast', 100],
      ['fast', 150],
    ])
  })

  it('numbers turns per unit and across the battle', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    t.addUnit({ id: 'b', baseSpd: 200 })
    const turns = turnsOf(t.run({ cycles: 1 }))
    expect(turns.map((s) => s.serial)).toEqual([1, 2, 3, 4])
    expect(turnsOf(turns, 'b').map((s) => s.index)).toEqual([1, 2, 3])
  })
})

// Formulas: https://hsr.keqingmains.com/misc/speed-guide (Formula Compendium)
describe('advance and delay', () => {
  it('advance removes a share of the full gauge, not of what is left', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100, gauge: 4000 })
    t.advance('a', 0.25)
    expect(t.gauge('a')).toBe(1500)
    expect(t.av('a')).toBe(15)
  })

  it('advance stops at 0', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100, gauge: 2000 })
    t.advance('a', 0.5)
    expect(t.gauge('a')).toBe(0)
  })

  it('delay adds a share of the full gauge and has no ceiling', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    t.delay('a', 0.3)
    expect(t.gauge('a')).toBe(13_000)
    expect(t.av('a')).toBe(130)
  })

  it('a 100% advance makes the unit act next without time passing', () => {
    const t = new Timeline()
    t.addUnit({ id: 'support', baseSpd: 160 })
    t.addUnit({ id: 'dps', baseSpd: 100 })
    const turns = turnsOf(
      t.run({
        cycles: 1,
        takeTurn: (turn, tl) => {
          if (turn.unit === 'support' && turn.index === 1) tl.advance('dps', 1)
        },
      }),
    )
    expect(turns.slice(0, 3).map((s) => [s.unit, s.at])).toEqual([
      ['support', 62.5],
      ['dps', 62.5],
      ['support', 125],
    ])
  })

  it('after consecutive 100% advances the last unit advanced acts first', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    t.addUnit({ id: 'b', baseSpd: 100 })
    t.addUnit({ id: 'c', baseSpd: 100 })
    t.advance('a', 1)
    t.advance('c', 1)
    t.advance('b', 1)
    expect(t.order().map((o) => o.unit)).toEqual(['b', 'c', 'a'])
  })

  it('an advanced unit goes before one that reached 0 by waiting', () => {
    const t = new Timeline()
    t.addUnit({ id: 'first', baseSpd: 100 })
    t.addUnit({ id: 'waiting', baseSpd: 100 })
    t.addUnit({ id: 'pulled', baseSpd: 50 })
    const turns = turnsOf(
      t.run({
        cycles: 1,
        takeTurn: (turn, tl) => {
          if (turn.unit === 'first' && turn.index === 1) tl.advance('pulled', 1)
        },
      }),
    )
    expect(turns.slice(0, 3).map((s) => s.unit)).toEqual(['first', 'pulled', 'waiting'])
  })

  it('an advance during turnStart is wasted, one during the action shortens the next turn', () => {
    const wasted = new Timeline()
    wasted.addUnit({ id: 'a', baseSpd: 100 })
    wasted.bus.on('turnStart', (turn) => wasted.advance(turn.unit, 0.24))
    expect(turnsOf(wasted.run({ cycles: 2 })).map((s) => s.at)).toEqual([100, 200])

    const used = new Timeline()
    used.addUnit({ id: 'a', baseSpd: 100 })
    const turns = turnsOf(used.run({ cycles: 2, takeTurn: (turn, tl) => tl.advance(turn.unit, 0.24) }))
    // 7,600 gauge after the first turn, so the second lands at 176 and the third (252) misses cycle 2.
    expect(turns.map((s) => s.at)).toEqual([100, 176])
  })

  it('reports gauge changes', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    const seen: unknown[] = []
    t.bus.on('gaugeChanged', (e) => seen.push(e))
    t.advance('a', 0.25)
    t.delay('a', 0.1)
    expect(seen).toEqual([
      { unit: 'a', before: 10_000, after: 7500, cause: 'advance' },
      { unit: 'a', before: 7500, after: 8500, cause: 'delay' },
    ])
  })
})

describe('SPD changes mid-gauge', () => {
  // KQM: New AV = Current AV x Current SPD / New SPD
  it('keeps the gauge and rescales the remaining action value', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    t.addUnit({ id: 'pacer', baseSpd: 200 })
    t.step() // pacer acts at 50; a has 5,000 gauge left
    expect(t.gauge('a')).toBe(5000)
    expect(t.av('a')).toBe(50)

    t.modifiers.apply({ id: 'spd', target: 'a', source: 'pacer', spdPct: 0.25 })
    expect(t.gauge('a')).toBe(5000)
    expect(t.av('a')).toBe(40)

    t.modifiers.remove('a', 'spd')
    expect(t.av('a')).toBe(50)
  })

  it('a slow applied mid-gauge pushes the turn later', () => {
    const t = new Timeline()
    t.addUnit({ id: 'enemy', baseSpd: 100 })
    t.addUnit({ id: 'pacer', baseSpd: 400 })
    t.step() // 25 AV pass; enemy has 7,500 gauge left
    t.modifiers.apply({ id: 'slow', target: 'enemy', source: 'pacer', spdPct: -0.1 })
    expect(t.av('enemy')).toBeCloseTo(7500 / 90, 10)
  })

  it('the turn lands where the piecewise drain says it should', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    t.addUnit({ id: 'pacer', baseSpd: 250 })
    const turns = turnsOf(
      t.run({
        cycles: 1,
        takeTurn: (turn, tl) => {
          // At AV 40, a has 6,000 gauge left. +50 flat SPD makes that 6,000 / 150 = 40 more AV.
          if (turn.unit === 'pacer' && turn.index === 1) {
            tl.modifiers.apply({ id: 'spd', target: 'a', source: 'pacer', spdFlat: 50 })
          }
        },
      }),
      'a',
    )
    expect(turns[0]!.at).toBeCloseTo(80, 10)
  })
})

describe('Memory of Chaos cycles', () => {
  it('the first cycle ends at 150 AV and later ones every 100', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    const ends = t.run({ cycles: 4 }).filter((s) => s.kind === 'cycleEnd')
    expect(ends.map((s) => [s.cycle, s.at])).toEqual([[1, 150], [2, 250], [3, 350], [4, 450]])
  })

  it('emits cycleStart and cycleEnd around the turns of each cycle', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    const log: string[] = []
    t.bus.on('battleStart', () => log.push('battleStart'))
    t.bus.on('cycleStart', (e) => log.push(`cycleStart ${e.cycle} ${e.startsAt}-${e.endsAt}`))
    t.bus.on('cycleEnd', (e) => log.push(`cycleEnd ${e.cycle}`))
    t.bus.on('turnStart', (e) => log.push(`turn ${e.at} in cycle ${e.cycle}`))
    t.run({ cycles: 2 })
    expect(log).toEqual([
      'battleStart',
      'cycleStart 1 0-150',
      'turn 100 in cycle 1',
      'cycleEnd 1',
      'cycleStart 2 150-250',
      'turn 200 in cycle 2',
      'cycleEnd 2',
    ])
  })

  it('a turn exactly on the boundary counts in the cycle that is ending', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 200 })
    const turns = turnsOf(t.run({ cycles: 1 }))
    expect(turns.map((s) => s.at)).toEqual([50, 100, 150])
    expect(turns.every((s) => s.cycle === 1)).toBe(true)
  })

  it('gauges keep draining across a cycle boundary', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 80 })
    const turns = turnsOf(t.run({ cycles: 2 }))
    expect(turns.map((s) => [s.at, s.cycle])).toEqual([[125, 1], [250, 2]])
  })

  it('accepts other cycle lengths', () => {
    const t = new Timeline({ cycleRules: { firstCycleAv: 100, laterCycleAv: 100 } })
    t.addUnit({ id: 'a', baseSpd: 100 })
    const ends = t.run({ cycles: 2 }).filter((s) => s.kind === 'cycleEnd')
    expect(ends.map((s) => s.at)).toEqual([100, 200])
  })
})

describe('units joining and leaving', () => {
  it('a unit added mid-battle starts with a full gauge from that moment', () => {
    const t = new Timeline()
    t.addUnit({ id: 'owner', baseSpd: 100 })
    const turns = turnsOf(
      t.run({
        cycles: 2,
        takeTurn: (turn, tl) => {
          if (turn.unit === 'owner' && turn.index === 1) tl.addUnit({ id: 'summon', baseSpd: 80 })
        },
      }),
      'summon',
    )
    expect(turns.map((s) => s.at)).toEqual([225])
  })

  it('a removed unit takes no more turns and loses its modifiers', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    t.addUnit({ id: 'b', baseSpd: 120 })
    t.modifiers.apply({ id: 'buff', target: 'b', source: 'a', spdPct: 0.1 })
    const removed: string[] = []
    t.bus.on('modifierRemoved', (e) => removed.push(`${e.modifier.id}:${e.reason}`))
    t.removeUnit('b')
    expect(removed).toEqual(['buff:unitRemoved'])
    expect(turnsOf(t.run({ cycles: 2 })).every((s) => s.unit === 'a')).toBe(true)
  })

  it('a unit removed at its own turn start does not act', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    t.bus.on('turnStart', (turn) => t.removeUnit(turn.unit))
    let acted = false
    t.run({ cycles: 1, takeTurn: () => { acted = true } })
    expect(acted).toBe(false)
    expect(t.units()).toEqual([])
  })

  it('rejects duplicate ids, unknown ids and non-positive SPD', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    expect(() => t.addUnit({ id: 'a', baseSpd: 100 })).toThrow(/already/)
    expect(() => t.addUnit({ id: 'z', baseSpd: 0 })).toThrow(/positive/)
    expect(() => t.av('nobody')).toThrow(/No unit/)
    t.modifiers.apply({ id: 'stop', target: 'a', source: 'a', spdPct: -1 })
    expect(() => t.spd('a')).toThrow(/non-positive/)
  })
})

describe('determinism', () => {
  it('the same setup gives the same log every time', () => {
    const build = () => {
      const t = new Timeline()
      t.addUnit({ id: 'a', baseSpd: 134 })
      t.addUnit({ id: 'b', baseSpd: 161.3 })
      t.addUnit({ id: 'c', baseSpd: 98 })
      t.addUnit({ id: 'enemy', baseSpd: 132 })
      return t.run({
        cycles: 5,
        takeTurn: (turn, tl) => {
          if (turn.unit === 'b') tl.advance('a', 0.24)
          if (turn.unit === 'c') tl.delay('enemy', 0.25)
          if (turn.unit === 'a') tl.modifiers.apply({
            id: 'haste', target: 'a', source: 'a', spdPct: 0.2, duration: { turns: 2, tick: 'turnEnd' },
          })
        },
      })
    }
    expect(build()).toEqual(build())
  })

  it('stops a kit that advances itself forever', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    expect(() => t.run({ cycles: 1, maxTurns: 50, takeTurn: (turn, tl) => tl.advance(turn.unit, 1) })).toThrow(
      /without end/,
    )
  })
})
