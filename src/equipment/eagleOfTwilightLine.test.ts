import { describe, expect, it } from 'vitest'
import type { Battle } from '../battle/battle'
import { EagleOfTwilightLine } from './eagleOfTwilightLine'
import { battleOf, idle, memberOf, policyOf, recordingKernel, scriptedKit, type Step } from './setTestKit'

const ult: Step[] = [{ use: 'ultimate' }]

/** Every advance of `unit`: how far its gauge moved (10000 is a full gauge). */
function advances(battle: Battle, unit: string): number[] {
  const moved: number[] = []
  battle.timeline.bus.on('gaugeChanged', (e) => {
    if (e.unit === unit && e.cause === 'advance') moved.push(e.before - e.after)
  })
  return moved
}

describe('Eagle of Twilight Line', () => {
  it('is the relic set Fribbels calls by name, with its set id', () => {
    expect(EagleOfTwilightLine.name).toBe('Eagle of Twilight Line')
    expect(EagleOfTwilightLine.setId).toBe('110')
    expect(EagleOfTwilightLine.type).toBe('relic')
  })

  it("advances the wearer's action by 25% after its Ultimate", () => {
    const { kernel } = recordingKernel()
    const battle = battleOf([memberOf('w', scriptedKit('w', ult), { module: EagleOfTwilightLine, pieces: 4 })], policyOf('w', ult), kernel)
    const moved = advances(battle, 'w')
    battle.run()
    expect(moved[0]).toBeCloseTo(2500, 6)
  })

  it('advances once per Ultimate, not per action', () => {
    const { kernel } = recordingKernel()
    const script: Step[] = [{ use: 'ultimate' }, { use: 'basic' }, { use: 'skill' }, { use: 'ultimate' }]
    const battle = battleOf([memberOf('w', scriptedKit('w', script), { module: EagleOfTwilightLine, pieces: 4 })], policyOf('w', script), kernel)
    const moved = advances(battle, 'w')
    battle.run()
    // The advance moves the gauge it finds: after a turn the gauge has refilled, so each Ultimate gives one 2500 advance.
    expect(moved.filter((m) => Math.abs(m - 2500) < 1e-6).length).toBe(2)
  })

  it('does nothing at 2 pieces', () => {
    const { kernel } = recordingKernel()
    const battle = battleOf([memberOf('w', scriptedKit('w', ult), { module: EagleOfTwilightLine, pieces: 2 })], policyOf('w', ult), kernel)
    const moved = advances(battle, 'w')
    battle.run()
    expect(moved).toEqual([])
  })

  it("does not advance the wearer for a teammate's Ultimate, nor a teammate for the wearer's", () => {
    const { kernel } = recordingKernel()
    const members = [
      memberOf('w', scriptedKit('w'), { module: EagleOfTwilightLine, pieces: 4 }),
      memberOf('f', scriptedKit('f', ult)),
    ]
    const battle = battleOf(members, [...policyOf('f', ult), idle('w')], kernel)
    const movedW = advances(battle, 'w')
    const movedF = advances(battle, 'f')
    battle.run()
    expect(movedW).toEqual([])
    expect(movedF).toEqual([])
  })

  it('makes the wearer act sooner: an Ultimate leaves it with a quarter less gauge than the same Ultimate without the set', () => {
    const gaugeAfterUltimate = (pieces: 2 | 4): number => {
      const { kernel } = recordingKernel()
      const battle = battleOf([memberOf('w', scriptedKit('w', ult), { module: EagleOfTwilightLine, pieces })], policyOf('w', ult), kernel)
      let gauge = -1
      battle.timeline.bus.on('actionUsed', (a) => {
        if (a.kind === 'ultimate') gauge = battle.timeline.gauge('w')
      }, { priority: -1000 })
      battle.run()
      return gauge
    }
    expect(gaugeAfterUltimate(2) - gaugeAfterUltimate(4)).toBeCloseTo(2500, 6)
  })
})
