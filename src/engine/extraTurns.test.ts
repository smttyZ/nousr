import { describe, expect, it } from 'vitest'
import { EXTRA_TURN_TICKS_MODIFIERS, Timeline } from './timeline'

describe('extra turns', () => {
  it('run right after the action that granted them, leave the gauge alone and are flagged', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    t.addUnit({ id: 'b', baseSpd: 90 })
    const log: string[] = []
    t.bus.on('turnStart', (turn) => log.push(`${turn.unit}${turn.extra ? '*' : ''}@${turn.at.toFixed(1)}#${turn.index}`))
    let granted = false
    t.run({
      cycles: 1,
      takeTurn: (turn, tl) => {
        if (turn.unit === 'a' && !granted) {
          granted = true
          tl.grantExtraTurn('b')
        }
      },
    })
    // b's gauge was not spent by its extra turn: it still acts at 111.1.
    expect(log).toEqual(['a@100.0#1', 'b*@100.0#1', 'b@111.1#2'])
  })

  it('works for a unit that is not on the timeline, counts its turns, and can be cancelled', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    const log: string[] = []
    t.bus.on('turnStart', (turn) => log.push(`${turn.unit}#${turn.index}${turn.extra ? '*' : ''}`))
    t.grantExtraTurn('ghost')
    t.grantExtraTurn('ghost')
    t.grantExtraTurn('gone')
    t.cancelExtraTurns('gone')
    t.step()
    t.step()
    expect(t.pendingExtraTurns()).toEqual([])
    expect(log).toEqual(['ghost#1*', 'ghost#2*'])
  })

  it('queue in the order granted, and a turn in the queue is taken before the gauge advances', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    const log: string[] = []
    t.bus.on('turnStart', (turn) => log.push(`${turn.unit}@${turn.at}`))
    t.grantExtraTurn('x')
    t.grantExtraTurn('y')
    t.step()
    t.step()
    t.step()
    expect(log).toEqual(['x@0', 'y@0', 'a@100'])
  })

  it('a removed unit loses its queued extra turns', () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    t.addUnit({ id: 'b', baseSpd: 50 })
    t.grantExtraTurn('b')
    t.removeUnit('b')
    expect(t.pendingExtraTurns()).toEqual([])
  })

  it(`durations count down on an extra turn (EXTRA_TURN_TICKS_MODIFIERS = ${EXTRA_TURN_TICKS_MODIFIERS})`, () => {
    const t = new Timeline()
    t.addUnit({ id: 'a', baseSpd: 100 })
    t.modifiers.apply({ id: 'm', target: 'a', source: 'a', duration: { turns: 1, tick: 'turnEnd' } })
    t.grantExtraTurn('a')
    t.step()
    expect(t.modifiers.has('a', 'm')).toBe(!EXTRA_TURN_TICKS_MODIFIERS)
  })
})
