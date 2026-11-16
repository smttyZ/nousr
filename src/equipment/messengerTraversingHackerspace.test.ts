import { describe, expect, it } from 'vitest'
import type { Battle } from '../battle/battle'
import { MessengerTraversingHackerspace } from './messengerTraversingHackerspace'
import { battleOf, idle, instanceOf, memberOf, policyOf, recordingKernel, scriptedKit, watch, type Step } from './setTestKit'

const NAME = 'Messenger Traversing Hackerspace'
const MODIFIER = 'set.114.spd'

/** An Ultimate on ally 'a' that attacks nothing (a buff on it, as Sunday's and Robin's do). */
const ultOnAlly: Step = {
  use: 'ultimate',
  attack: false,
  effect: (b, self) => void b.timeline.modifiers.apply({ id: 'buff', target: 'a', source: self, duration: { turns: 2, tick: 'turnEnd' } }),
}

/** The wearer 'w' (SPD 1000) with Messenger at `pieces`, an ally 'a' (SPD 500) and a bystander 'c' (SPD 250). */
function team(script: Step[], pieces: 2 | 4 = 4) {
  const { kernel, requests } = recordingKernel()
  const battle = battleOf(
    [
      memberOf('w', scriptedKit('w', script), { module: MessengerTraversingHackerspace, pieces }),
      memberOf('a', scriptedKit('a'), undefined, { baseSpd: 500 }),
      memberOf('c', scriptedKit('c'), undefined, { baseSpd: 250 }),
    ],
    [...policyOf('w', script), idle('a'), idle('c')],
    kernel,
  )
  return { battle, requests }
}

const spds = (battle: Battle) => ({ w: battle.timeline.spd('w'), a: battle.timeline.spd('a'), c: battle.timeline.spd('c') })

describe('Messenger Traversing Hackerspace', () => {
  it('is the relic set Fribbels calls by name, with its set id', () => {
    expect(MessengerTraversingHackerspace.name).toBe(NAME)
    expect(MessengerTraversingHackerspace.setId).toBe('114')
    expect(MessengerTraversingHackerspace.type).toBe('relic')
  })

  describe('the timeline', () => {
    it('gives every ally +12% of its base SPD after an Ultimate on an ally', () => {
      const { battle } = team([ultOnAlly])
      const seen: ReturnType<typeof spds>[] = []
      battle.timeline.bus.on('actionUsed', () => seen.push(spds(battle)), { priority: -1000 })
      battle.run()
      expect(seen[0]).toEqual({ w: 1120, a: 560, c: 280 })
    })

    it('puts one shared modifier on each ally, for 1 turn of its own: gone after its next turn', () => {
      const { battle } = team([ultOnAlly])
      const given: string[] = []
      const gone: string[] = []
      battle.timeline.bus.on('modifierApplied', ({ modifier }) => modifier.id === MODIFIER && given.push(modifier.target))
      battle.timeline.bus.on('modifierRemoved', ({ modifier, reason }) => modifier.id === MODIFIER && gone.push(`${modifier.target}:${reason}`))
      battle.run()
      expect(given.sort()).toEqual(['a', 'c', 'w'])
      expect(gone.slice(0, 3).sort()).toEqual(['a:expired', 'c:expired', 'w:expired'])
      // Each ally lost it after one of its own turns: the fastest first.
      expect(gone[0]).toBe('w:expired')
    })

    it('cannot be stacked: a second Ultimate while it is up refreshes it, the SPD stays +12%', () => {
      const { battle } = team([ultOnAlly, ultOnAlly])
      let peak = 0
      battle.timeline.bus.on('actionUsed', () => (peak = Math.max(peak, battle.timeline.spd('a'))), { priority: -1000 })
      battle.run()
      expect(peak).toBe(560)
      expect(battle.timeline.modifiers.on('a').filter((m) => m.id === MODIFIER).length).toBeLessThanOrEqual(1)
    })

    it('does nothing for an Ultimate that attacks, an Ultimate on the wearer alone, or at 2 pieces', () => {
      const attacking: Step = { ...ultOnAlly, attack: true }
      const onSelf: Step = { use: 'ultimate', attack: false, effect: (b, self) => void b.timeline.modifiers.apply({ id: 'buff', target: self, source: self }) }
      for (const [script, pieces] of [[[attacking], 4], [[onSelf], 4], [[ultOnAlly], 2]] as const) {
        const { battle } = team([...script], pieces)
        const given: string[] = []
        battle.timeline.bus.on('modifierApplied', ({ modifier }) => modifier.id === MODIFIER && given.push(modifier.target))
        battle.run()
        expect(given).toEqual([])
      }
    })

    it('skips an ally that is not on the timeline (downed)', () => {
      const { battle } = team([ultOnAlly])
      battle.party.takeDamage('c', 2_000_000_000, 'enemy')
      const given: string[] = []
      battle.timeline.bus.on('modifierApplied', ({ modifier }) => modifier.id === MODIFIER && given.push(modifier.target))
      battle.run()
      expect(given).not.toContain('c')
    })
  })

  describe('the kernel: the wearer and its teammates are priced with the SPD the timeline has', () => {
    it("is off for the wearer's own attacks before the Ultimate and on until the end of its next turn, as the timeline's SPD is", () => {
      const { battle } = team([ultOnAlly, { use: 'basic' }, { use: 'basic' }])
      const flags = watch(battle, 'w', () => ({
        flag: instanceOf(battle, 'w').attackerState!(battle.primary).setConditionals?.[NAME],
        faster: battle.timeline.spd('w') > 1000,
      }))
      battle.run()
      // The Ultimate itself attacks nothing; the wearer's next turn is the first priced hit, in the 1-turn window.
      expect(flags[0]).toEqual({ flag: true, faster: true })
      expect(flags[1]).toEqual({ flag: false, faster: false })
      expect(flags.every((f) => f.flag === f.faster)).toBe(true)
    })

    it("gives a teammate the team form exactly while that teammate holds the buff, and never 'on' by default", () => {
      const { battle } = team([ultOnAlly])
      const teammate = battle.member('a')
      const flags = watch(battle, 'a', () => ({
        form: instanceOf(battle, 'w').teammateState!(teammate, battle.primary).teamRelicSet,
        faster: battle.timeline.spd('a') > 500,
      }))
      battle.run()
      expect(flags[0]).toEqual({ form: NAME, faster: true })
      expect(flags[1]).toEqual({ form: undefined, faster: false })
      expect(flags.every((f) => (f.form === NAME) === f.faster)).toBe(true)
    })

    it('gives the kernel the wearer\'s switch as false (not Fribbels\' default) before anything happens', () => {
      const { battle, requests } = team([])
      battle.run()
      const mine = requests.filter((r) => r.attacker.characterId === 'w')
      expect(mine.length).toBeGreaterThan(0)
      expect(mine.every((r) => r.setConditionals?.[NAME] === false)).toBe(true)
      expect(requests.every((r) => r.teammates.every((t) => t.teamRelicSet === undefined))).toBe(true)
    })

    it('at 2 pieces supplies nothing to the kernel', () => {
      const { battle, requests } = team([ultOnAlly], 2)
      battle.run()
      expect(requests.every((r) => r.setConditionals === undefined && r.teammates.every((t) => t.teamRelicSet === undefined))).toBe(true)
    })
  })
})
