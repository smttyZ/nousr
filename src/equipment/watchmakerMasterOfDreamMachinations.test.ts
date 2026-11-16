import { describe, expect, it } from 'vitest'
import { WatchmakerMasterOfDreamMachinations } from './watchmakerMasterOfDreamMachinations'
import { battleOf, idle, instanceOf, memberOf, policyOf, recordingKernel, scriptedKit, watch, type Step } from './setTestKit'

const NAME = 'Watchmaker, Master of Dream Machinations'
const MODIFIER = 'set.118.be'

/** An Ultimate on ally 'a' that attacks nothing. */
const ultOnAlly: Step = {
  use: 'ultimate',
  attack: false,
  effect: (b, self) => void b.timeline.modifiers.apply({ id: 'buff', target: 'a', source: self, duration: { turns: 2, tick: 'turnEnd' } }),
}

function team(script: Step[], pieces: 2 | 4 = 4) {
  const { kernel, requests } = recordingKernel()
  const battle = battleOf(
    [
      memberOf('w', scriptedKit('w', script), { module: WatchmakerMasterOfDreamMachinations, pieces }),
      memberOf('a', scriptedKit('a'), undefined, { baseSpd: 500 }),
    ],
    [...policyOf('w', script), idle('a')],
    kernel,
  )
  return { battle, requests }
}

describe("Watchmaker, Master of Dream Machinations", () => {
  it('is the relic set Fribbels calls by name, with its set id', () => {
    expect(WatchmakerMasterOfDreamMachinations.name).toBe(NAME)
    expect(WatchmakerMasterOfDreamMachinations.setId).toBe('118')
    expect(WatchmakerMasterOfDreamMachinations.type).toBe('relic')
  })

  it("marks every ally for 2 turns of its own after an Ultimate on an ally, and changes nobody's SPD", () => {
    const { battle } = team([ultOnAlly])
    const given: string[] = []
    const gone: string[] = []
    battle.timeline.bus.on('modifierApplied', ({ modifier }) => {
      if (modifier.id !== MODIFIER) return
      given.push(modifier.target)
      expect(modifier.spdPct).toBe(0)
      expect(modifier.turnsLeft).toBe(2)
    })
    battle.timeline.bus.on('modifierRemoved', ({ modifier, reason }) => modifier.id === MODIFIER && gone.push(`${modifier.target}:${reason}`))
    battle.run()
    expect(given.sort()).toEqual(['a', 'w'])
    expect(gone.sort().slice(0, 2)).toEqual(['a:expired', 'w:expired'])
    expect(battle.timeline.spd('a')).toBe(500)
  })

  it('lasts through two of the ally\'s turns and is gone for the third', () => {
    const { battle } = team([ultOnAlly])
    const holds = watch(battle, 'a', () => battle.timeline.modifiers.has('a', MODIFIER))
    // 'a' basics every turn; the effect was given between turns, so its first two turns have it.
    battle.run()
    expect(holds.slice(0, 4)).toEqual([true, true, false, false])
  })

  it("gives the wearer's switch true only while the wearer holds the marker, false otherwise: not Fribbels' default of off or on", () => {
    const { battle } = team([ultOnAlly, { use: 'basic' }, { use: 'basic' }, { use: 'basic' }])
    const flags = watch(battle, 'w', () => instanceOf(battle, 'w').attackerState!(battle.primary).setConditionals?.[NAME])
    battle.run()
    expect(flags.slice(0, 4)).toEqual([true, true, false, false])
  })

  it('gives a teammate the team form exactly while that teammate holds the marker', () => {
    const { battle } = team([ultOnAlly])
    const teammate = battle.member('a')
    const flags = watch(battle, 'a', () => instanceOf(battle, 'w').teammateState!(teammate, battle.primary).teamRelicSet)
    battle.run()
    expect(flags.slice(0, 4)).toEqual([NAME, NAME, undefined, undefined])
  })

  it('is off before the first Ultimate: the switch is false and there is no team form', () => {
    const { battle, requests } = team([])
    battle.run()
    expect(requests.filter((r) => r.attacker.characterId === 'w').every((r) => r.setConditionals?.[NAME] === false)).toBe(true)
    expect(requests.every((r) => r.teammates.every((t) => t.teamRelicSet === undefined))).toBe(true)
  })

  it('a second Ultimate while it is up refreshes the same marker: no stacking', () => {
    const { battle } = team([ultOnAlly, { use: 'basic' }, ultOnAlly])
    const counts: number[] = []
    battle.timeline.bus.on('actionUsed', () => counts.push(battle.timeline.modifiers.on('a').filter((m) => m.id === MODIFIER).length))
    battle.run()
    expect(Math.max(...counts)).toBe(1)
  })

  it('does nothing for an Ultimate that attacks, an Ultimate on the wearer alone, or at 2 pieces', () => {
    const attacking: Step = { ...ultOnAlly, attack: true }
    const onSelf: Step = { use: 'ultimate', attack: false, effect: (b, self) => void b.timeline.modifiers.apply({ id: 'buff', target: self, source: self }) }
    for (const [script, pieces] of [[[attacking], 4], [[onSelf], 4], [[ultOnAlly], 2]] as const) {
      const { battle, requests } = team([...script], pieces)
      const given: string[] = []
      battle.timeline.bus.on('modifierApplied', ({ modifier }) => modifier.id === MODIFIER && given.push(modifier.target))
      battle.run()
      expect(given).toEqual([])
      expect(requests.every((r) => r.teammates.every((t) => t.teamRelicSet === undefined))).toBe(true)
    }
  })
})
