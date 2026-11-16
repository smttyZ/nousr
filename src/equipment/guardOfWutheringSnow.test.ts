import { describe, expect, it } from 'vitest'
import type { Battle } from '../battle/battle'
import { GuardOfWutheringSnow } from './guardOfWutheringSnow'
import { battleOf, idle, memberOf, recordingKernel, scriptedKit } from './setTestKit'

const MAX_HP = 100_000

/** A wearer that acts before every enemy (SPD 1000), with `hp` of 100000 Max HP and 100 Energy capacity at 50 Energy. */
function setup(pieces: 2 | 4 | undefined, hp: number, energyRegen = 0) {
  const { kernel } = recordingKernel()
  const wearer = memberOf('w', scriptedKit('w', [], 100), pieces ? { module: GuardOfWutheringSnow, pieces } : undefined, { maxHp: MAX_HP, energyRegen })
  const battle = battleOf([wearer], [idle('w')], kernel)
  battle.party.takeDamage('w', MAX_HP - hp, 'enemy')
  const heals: { amount: number, source: string }[] = []
  const energy: number[] = []
  battle.timeline.bus.on('healed', (e) => heals.push({ amount: e.amount, source: e.source }))
  battle.timeline.bus.on('energyGained', (e) => energy.push(e.amount))
  return { battle, heals, energy }
}

/** Runs until the wearer's first turn has started. */
function firstTurnStart(battle: Battle): void {
  battle.timeline.bus.on('turnStart', () => {
    throw new Error('stop')
  }, { priority: -1000 })
  try {
    battle.run()
  } catch (e) {
    if (!(e instanceof Error && e.message === 'stop')) throw e
  }
}

describe('Guard of Wuthering Snow', () => {
  it('is the relic set Fribbels calls by name, with its set id', () => {
    expect(GuardOfWutheringSnow.name).toBe('Guard of Wuthering Snow')
    expect(GuardOfWutheringSnow.setId).toBe('106')
    expect(GuardOfWutheringSnow.type).toBe('relic')
  })

  describe('2 pieces: 8% less DMG taken', () => {
    it.each([2, 4] as const)('at %i pieces the wearer takes 8% less damage', (pieces) => {
      const { battle } = setup(pieces, MAX_HP)
      expect(battle.party.damageTakenMultiplier('w')).toBeCloseTo(0.92, 12)
    })

    it('without the set the multiplier is 1', () => {
      const { battle } = setup(undefined, MAX_HP)
      expect(battle.party.damageTakenMultiplier('w')).toBe(1)
    })

    it('multiplies with another damage reduction instead of adding to it', () => {
      const { battle } = setup(2, MAX_HP)
      battle.party.setDamageReduction('w', 'other', 0.18)
      expect(battle.party.damageTakenMultiplier('w')).toBeCloseTo(0.92 * 0.82, 12)
    })
  })

  describe('4 pieces: heal 8% Max HP and 5 Energy at the start of the turn at 50% HP or less', () => {
    it('heals and gives energy at exactly 50% HP', () => {
      const { battle, heals, energy } = setup(4, 50_000)
      firstTurnStart(battle)
      expect(heals).toEqual([{ amount: 8000, source: 'w' }])
      expect(energy).toEqual([5])
      expect(battle.party.get('w').hp).toBeCloseTo(58_000, 6)
    })

    it('heals below 50% HP', () => {
      const { battle, heals } = setup(4, 10_000)
      firstTurnStart(battle)
      expect(heals).toEqual([{ amount: 8000, source: 'w' }])
    })

    it('does nothing just above 50% HP', () => {
      const { battle, heals, energy } = setup(4, 50_001)
      firstTurnStart(battle)
      expect(heals).toEqual([])
      expect(energy).toEqual([])
    })

    it('does nothing at full HP', () => {
      const { battle, heals } = setup(4, MAX_HP)
      firstTurnStart(battle)
      expect(heals).toEqual([])
    })

    it('does nothing at 2 pieces', () => {
      const { battle, heals, energy } = setup(2, 10_000)
      firstTurnStart(battle)
      expect(heals).toEqual([])
      expect(energy).toEqual([])
    })

    it("the 5 Energy is flat: Energy Regeneration Rate does not scale it (IN-GAME CHECK)", () => {
      const { battle, energy } = setup(4, 10_000, 0.5)
      firstTurnStart(battle)
      expect(energy).toEqual([5])
    })

    it("heals 8% of the party's current Max HP, which kits that raise it keep in step", () => {
      const { battle, heals } = setup(4, 10_000)
      battle.party.setStats('w', { maxHp: 120_000 })
      firstTurnStart(battle)
      expect(heals[0]!.amount).toBeCloseTo(9600, 6)
    })

    it('acts on every turn of the wearer while it stays low, not once', () => {
      const { battle, heals } = setup(4, 1_000)
      battle.run()
      expect(heals.length).toBeGreaterThan(1)
    })

    it('does not act on a teammate\'s turn start', () => {
      const { kernel } = recordingKernel()
      const battle = battleOf(
        [memberOf('w', scriptedKit('w', [], 100), { module: GuardOfWutheringSnow, pieces: 4 }, { maxHp: MAX_HP, baseSpd: 10 }), memberOf('f', scriptedKit('f'))],
        [idle('w'), idle('f')],
        kernel,
      )
      battle.party.takeDamage('w', 90_000, 'enemy')
      const heals: string[] = []
      battle.timeline.bus.on('healed', (e) => heals.push(e.unit))
      firstTurnStart(battle)
      // The first turn to start is the fast teammate's: the slow, low wearer has not had a turn yet.
      expect(heals).toEqual([])
    })
  })
})
