import { describe, expect, it } from 'vitest'
import { ACTION_GAUGE, Timeline } from './timeline'

describe('suspend and resume', () => {
  it('a suspended unit keeps its gauge, is out of the order and takes no turn', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    t.addUnit({ id: 'b', baseSpd: 200 })
    t.suspend('b')
    expect(t.isSuspended('b')).toBe(true)
    expect(t.order().map((o) => o.unit)).toEqual(['a'])
    expect(t.av('b')).toBe(Infinity)
    const log: string[] = []
    t.bus.on('turnStart', (turn) => log.push(`${turn.unit}@${turn.at}`))
    t.step()
    t.step()
    expect(log).toEqual(['a@100'])
    // 150 AV passed (a's turn, then the cycle boundary) and b's gauge, which would have emptied, did not drain.
    expect(t.gauge('b')).toBe(ACTION_GAUGE)
  })

  it('resume keeps the gauge as it was, and `gauge` sets a new one', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    t.addUnit({ id: 'b', baseSpd: 100, gauge: 6000 })
    t.suspend('b')
    t.step() // a acts at AV 100; b would have acted at 60
    expect(t.gauge('b')).toBe(6000)
    t.resume('b')
    expect(t.isSuspended('b')).toBe(false)
    expect(t.av('b')).toBeCloseTo(60, 9)

    t.suspend('b')
    t.resume('b', { gauge: ACTION_GAUGE })
    expect(t.gauge('b')).toBe(ACTION_GAUGE)
  })

  it('advance and delay on a suspended unit move its frozen gauge, and survive the resume', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    t.addUnit({ id: 'b', baseSpd: 100 })
    t.suspend('b')
    t.advance('b', 0.3)
    expect(t.gauge('b')).toBe(7000)
    t.delay('b', 0.1)
    expect(t.gauge('b')).toBe(8000)
    t.step()
    expect(t.gauge('b')).toBe(8000)
    t.resume('b')
    expect(t.gauge('b')).toBe(8000)
  })

  it('a suspended unit advanced to 0 still takes no turn, and acts once resumed', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    t.addUnit({ id: 'b', baseSpd: 100 })
    t.suspend('b')
    t.advance('b', 1)
    const log: string[] = []
    t.bus.on('turnStart', (turn) => log.push(turn.unit))
    t.step()
    expect(log).toEqual(['a'])
    t.resume('b')
    t.step()
    expect(log).toEqual(['a', 'b'])
  })

  it('emits unitSuspended and unitResumed (with the gauge) once, and ignores repeats', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100, gauge: 4000 })
    const log: string[] = []
    t.bus.on('unitSuspended', (e) => log.push(`suspended ${e.unit}`))
    t.bus.on('unitResumed', (e) => log.push(`resumed ${e.unit} ${e.gauge}`))
    t.suspend('a')
    t.suspend('a')
    t.resume('a')
    t.resume('a', { gauge: 1 })
    expect(log).toEqual(['suspended a', 'resumed a 4000'])
  })

  it('with every unit suspended the cycle still ends, and a removed suspended unit is gone', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    t.suspend('a')
    const step = t.step()
    expect(step).toEqual({ kind: 'cycleEnd', cycle: 1, at: 150 })
    t.removeUnit('a')
    expect(t.has('a')).toBe(false)
  })

  it('a SPD change on a suspended unit changes nothing until it is resumed', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    t.addUnit({ id: 'b', baseSpd: 100 })
    t.suspend('b')
    t.modifiers.apply({ id: 'slow', target: 'b', source: 'a', spdPct: -0.5 })
    t.resume('b')
    expect(t.av('b')).toBeCloseTo(200, 9)
  })
})
