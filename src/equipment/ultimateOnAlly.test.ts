import { describe, expect, it } from 'vitest'
import type { Battle } from '../battle/battle'
import type { SetModule } from './equipment'
import { onUltimateOnAlly } from './ultimateOnAlly'
import { battleOf, idle, memberOf, policyOf, recordingKernel, scriptedKit, type Step } from './setTestKit'

/** A set whose only effect is to count the triggers of `onUltimateOnAlly`. */
function counting(): { module: SetModule, triggers: string[] } {
  const triggers: string[] = []
  const module: SetModule = {
    kind: 'set',
    type: 'relic',
    name: 'Counting',
    create(battle, wearer) {
      onUltimateOnAlly(battle, wearer, (action) => triggers.push(`${action.actor}:${action.action}`))
      return {}
    },
  }
  return { module, triggers }
}

/**
 * The wearer 'w' (SPD 1000) uses `step` as its Ultimate; ally 'a' (SPD 500, 100 energy, damaged to 50% HP so a heal has room) acts after.
 * Returns the triggers.
 */
function run(step: Step): string[] {
  const { module, triggers } = counting()
  const { kernel } = recordingKernel()
  const script: Step[] = [step]
  const battle = battleOf(
    [
      memberOf('w', scriptedKit('w', script, 100), { module, pieces: 4 }),
      memberOf('a', scriptedKit('a', [], 100), undefined, { baseSpd: 500, maxHp: 1_000_000 }),
    ],
    [...policyOf('w', script), idle('a')],
    kernel,
  )
  battle.party.takeDamage('a', 500_000, 'enemy')
  battle.run()
  return triggers
}

const buff = (target: string) => (battle: Battle, self: string) =>
  void battle.timeline.modifiers.apply({ id: 'buff', target, source: self, duration: { turns: 2, tick: 'turnEnd' } })

describe('onUltimateOnAlly: what counts as an Ultimate on an ally', () => {
  it('a buff on an ally counts', () => {
    expect(run({ use: 'ultimate', attack: false, effect: buff('a') })).toEqual(['w:ultimate'])
  })

  it('energy given to an ally counts', () => {
    expect(run({ use: 'ultimate', attack: false, effect: (b) => void b.party.gainEnergy('a', 10, { fixed: true }) })).toEqual(['w:ultimate'])
  })

  it('a heal on an ally counts (an Ultimate on all allies)', () => {
    expect(run({ use: 'ultimate', attack: false, effect: (b, self) => void b.party.heal('a', 1000, self) })).toEqual(['w:ultimate'])
  })

  it('an advance of an ally counts', () => {
    expect(run({ use: 'ultimate', attack: false, effect: (b) => b.timeline.advance('a', 0.5) })).toEqual(['w:ultimate'])
  })

  it('an Ultimate that attacks enemies is on enemies, even with an ally effect (Fu Xuan: heals, Tribbie: her own Zone)', () => {
    expect(run({ use: 'ultimate', attack: true, effect: (b, self) => void b.party.heal('a', 1000, self) })).toEqual([])
    expect(run({ use: 'ultimate', attack: true, effect: buff('a') })).toEqual([])
  })

  it('an Ultimate on the wearer alone is not on an ally', () => {
    expect(run({ use: 'ultimate', attack: false, effect: buff('w') })).toEqual([])
    expect(run({ use: 'ultimate', attack: false, effect: (b) => void b.party.gainEnergy('w', 10, { fixed: true }) })).toEqual([])
  })

  it('an Ultimate that does nothing to anyone is not on an ally', () => {
    expect(run({ use: 'ultimate', attack: false })).toEqual([])
  })

  it('a buff the wearer did not give does not count (another unit is the source)', () => {
    expect(run({ use: 'ultimate', attack: false, effect: (b) => void b.timeline.modifiers.apply({ id: 'buff', target: 'a', source: 'someone-else' }) })).toEqual([])
  })

  it('a Skill or Basic ATK with an ally effect is not an Ultimate', () => {
    expect(run({ use: 'skill', attack: false, effect: buff('a') })).toEqual([])
    expect(run({ use: 'basic', attack: false, effect: buff('a') })).toEqual([])
  })

  it("a teammate's Ultimate does not trigger the wearer's", () => {
    const { module, triggers } = counting()
    const { kernel } = recordingKernel()
    const script: Step[] = [{ use: 'ultimate', attack: false, effect: buff('w') }]
    const battle = battleOf(
      [memberOf('w', scriptedKit('w', [], 100), { module, pieces: 4 }), memberOf('a', scriptedKit('a', script, 100), undefined, { baseSpd: 500 })],
      [...policyOf('a', script), idle('w')],
      kernel,
    )
    battle.run()
    expect(triggers).toEqual([])
  })

  it('one effect on an ally in an earlier action does not leak into a later Ultimate', () => {
    const { module, triggers } = counting()
    const { kernel } = recordingKernel()
    const script: Step[] = [
      { use: 'skill', attack: false, effect: buff('a') },
      { use: 'ultimate', attack: false },
    ]
    battleOf([memberOf('w', scriptedKit('w', script, 100), { module, pieces: 4 }), memberOf('a', scriptedKit('a', [], 100), undefined, { baseSpd: 500 })], [...policyOf('w', script), idle('a')], kernel).run()
    expect(triggers).toEqual([])
  })
})
