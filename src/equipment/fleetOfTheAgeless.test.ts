import { describe, expect, it } from 'vitest'
import type { Battle } from '../battle/battle'
import { FleetOfTheAgeless } from './fleetOfTheAgeless'
import { battleOf, idle, instanceOf, memberOf, policyOf, recordingKernel, scriptedKit, watch, type Step } from './setTestKit'
import type { CombatStats } from '../kernel/types'
import { ZERO_STATS } from '../kernel/testing'

const NAME = 'Fleet of the Ageless'

/**
 * The wearer 'w' with Fleet and `baseSpd`, a friend 'f'. The kernel reports each unit's SPD from the timeline (what a consistent kernel
 * does) unless `kernelSpd` overrides the wearer's, so the consistency check can be put against a disagreeing kernel.
 */
function team(baseSpd: number, options: { kernelSpd?: number, script?: Step[] } = {}) {
  let battle: Battle
  const { kernel, requests } = recordingKernel((request): CombatStats => {
    const key = request.attacker.characterId
    const spd = key === 'w' && options.kernelSpd !== undefined ? options.kernelSpd : battle.timeline.has(key) ? battle.timeline.spd(key) : 0
    return { ...ZERO_STATS, SPD: spd }
  })
  const script = options.script ?? []
  battle = battleOf(
    [memberOf('w', scriptedKit('w', script), { module: FleetOfTheAgeless, pieces: 2 }, { baseSpd }), memberOf('f', scriptedKit('f'), undefined, { baseSpd: baseSpd + 100 })],
    [...policyOf('w', script), idle('f')],
    kernel,
  )
  return { battle, requests }
}

/** The team form the wearer gives its friend 'f' now. */
const formFor = (battle: Battle): string | undefined => instanceOf(battle, 'w').teammateState!(battle.member('f'), battle.primary).teamOrnamentSet

describe('Fleet of the Ageless', () => {
  it('is the ornament set Fribbels calls by name, with its set id', () => {
    expect(FleetOfTheAgeless.name).toBe(NAME)
    expect(FleetOfTheAgeless.setId).toBe('302')
    expect(FleetOfTheAgeless.type).toBe('ornament')
  })

  describe("the team's ATK +8% is given from the wearer's SPD 120", () => {
    it.each([
      [119.99, undefined],
      [120, NAME],
      [120.01, NAME],
      [200, NAME],
      [90, undefined],
    ])('wearer SPD %s gives %s', (spd, form) => {
      const { battle } = team(spd)
      expect(formFor(battle)).toBe(form)
    })

    it('follows an SPD buff on the timeline over the threshold, and back under it when the buff ends', () => {
      const { battle } = team(110)
      expect(formFor(battle)).toBeUndefined()
      battle.timeline.modifiers.apply({ id: 'buff', target: 'w', source: 'f', spdPct: 0.1 })
      expect(formFor(battle)).toBe(NAME)
      battle.timeline.modifiers.remove('w', 'buff')
      expect(formFor(battle)).toBeUndefined()
    })

    it('an SPD debuff under 120 turns it off', () => {
      const { battle } = team(125)
      expect(formFor(battle)).toBe(NAME)
      battle.timeline.modifiers.apply({ id: 'slow', target: 'w', source: 'x', spdPct: -0.1 })
      expect(formFor(battle)).toBeUndefined()
    })

    it('ends with a downed wearer', () => {
      const { battle } = team(150)
      expect(formFor(battle)).toBe(NAME)
      battle.party.takeDamage('w', 2_000_000_000, 'enemy')
      expect(formFor(battle)).toBeUndefined()
    })

    it('is what the kernel is given for the friend, request by request, and never for the wearer itself', () => {
      const { battle, requests } = team(130)
      const flags = watch(battle, 'f', () => formFor(battle))
      battle.run()
      expect(flags.length).toBeGreaterThan(0)
      expect(flags.every((f) => f === NAME)).toBe(true)
      expect(requests.filter((r) => r.attacker.characterId === 'f').every((r) => r.teammates[0]!.teamOrnamentSet === NAME)).toBe(true)
      expect(requests.filter((r) => r.attacker.characterId === 'w').every((r) => r.teammates.every((t) => t.teamOrnamentSet === undefined))).toBe(true)
    })

    it('gives the kernel no form for the friend while the wearer is under 120', () => {
      const { battle, requests } = team(100)
      battle.run()
      expect(requests.filter((r) => r.attacker.characterId === 'f').every((r) => r.teammates[0]!.teamOrnamentSet === undefined)).toBe(true)
    })

    it('supplies no setConditionals for the wearer: Fribbels reads its own SPD', () => {
      const { battle, requests } = team(130)
      battle.run()
      expect(requests.every((r) => r.setConditionals === undefined)).toBe(true)
    })
  })

  describe('the timeline and the kernel must agree on which side of 120 the wearer is', () => {
    it('stops the run when the kernel has the wearer under 120 and the timeline over it', () => {
      const { battle } = team(130, { kernelSpd: 110 })
      expect(() => battle.run()).toThrow(/different sides of the 120 SPD threshold/)
    })

    it('stops the run when the kernel has the wearer over 120 and the timeline under it', () => {
      const { battle } = team(110, { kernelSpd: 130 })
      expect(() => battle.run()).toThrow(/different sides of the 120 SPD threshold/)
    })

    it('runs when both are over 120 even by different amounts', () => {
      const { battle } = team(130, { kernelSpd: 150 })
      expect(() => battle.run()).not.toThrow()
    })

    it('runs when both are under 120', () => {
      const { battle } = team(100, { kernelSpd: 90 })
      expect(() => battle.run()).not.toThrow()
    })
  })
})
