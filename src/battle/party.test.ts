import { describe, expect, it } from 'vitest'
import { EventBus } from '../engine/events'
import type { EngineEvents } from '../engine/events'
import { BASE_AGGRO, Party } from './party'

function setup() {
  const bus = new EventBus<EngineEvents>()
  const log: string[] = []
  bus.on('hpLost', (e) => log.push(`hpLost ${e.unit} ${e.amount} ${e.cause} by ${e.source}`))
  bus.on('healed', (e) => log.push(`healed ${e.unit} ${e.amount} overheal ${e.overheal}`))
  bus.on('energyGained', (e) => log.push(`energy ${e.unit} ${e.amount}`))
  bus.on('unitDowned', (e) => log.push(`downed ${e.unit}`))
  const party = new Party(bus)
  return { party, log }
}

const member = (id: string, position: number, baseAggro = 4) => ({ id, position, baseAggro, maxHp: 4000, def: 1000 })

describe('base aggro by path', () => {
  // AvatarPromotionConfig.BaseAggro in the game data, in points of 25.
  it('matches the game data', () => {
    expect(BASE_AGGRO).toEqual({
      Preservation: 6,
      Destruction: 5,
      Harmony: 4,
      Nihility: 4,
      Abundance: 4,
      Remembrance: 4,
      Elation: 4,
      Hunt: 3,
      Erudition: 3,
    })
  })
})

describe('target shares', () => {
  it('are aggro over the team total, listed left to right', () => {
    const { party } = setup()
    party.add(member('hunt', 3, 3))
    party.add(member('tank', 0, 6))
    party.add(member('support', 2, 4))
    party.add(member('destruction', 1, 5))
    expect(party.standing()).toEqual(['tank', 'destruction', 'support', 'hunt'])
    const shares = party.targetShares()
    expect(shares.get('tank')).toBeCloseTo(6 / 18, 12)
    expect(shares.get('destruction')).toBeCloseTo(5 / 18, 12)
    expect(shares.get('support')).toBeCloseTo(4 / 18, 12)
    expect(shares.get('hunt')).toBeCloseTo(3 / 18, 12)
  })

  it('an aggro modifier multiplies base aggro by (1 + modifier)', () => {
    const { party } = setup()
    party.add(member('tank', 0, 6))
    party.add(member('dps', 1, 3))
    // "+500% chance to be attacked": 6 x 6 = 36 against 3.
    party.setAggroModifier('tank', 'taunt-skill', 5)
    expect(party.aggro('tank')).toBe(36)
    expect(party.targetShares().get('tank')).toBeCloseTo(36 / 39, 12)
    party.setAggroModifier('tank', 'taunt-skill', undefined)
    expect(party.aggro('tank')).toBe(6)
  })

  it('modifiers add together before multiplying, and aggro never goes negative', () => {
    const { party } = setup()
    party.add(member('a', 0, 4))
    party.setAggroModifier('a', 'x', 2)
    party.setAggroModifier('a', 'y', -0.5)
    expect(party.aggro('a')).toBe(4 * 2.5)
    party.setAggroModifier('a', 'z', -10)
    expect(party.aggro('a')).toBe(0)
  })
})

describe('taking damage', () => {
  it('comes off HP and is reported', () => {
    const { party, log } = setup()
    party.add(member('a', 0))
    expect(party.takeDamage('a', 836.5, 'enemy1')).toEqual({ absorbed: 0, lost: 836.5 })
    expect(party.get('a').hp).toBe(3163.5)
    expect(log).toEqual(['hpLost a 836.5 damage by enemy1'])
  })

  it('a shield absorbs first and only the rest reaches HP', () => {
    const { party, log } = setup()
    party.add(member('a', 0))
    party.setShield('a', 'aventurine', 600)
    expect(party.takeDamage('a', 1000, 'enemy1')).toEqual({ absorbed: 600, lost: 400 })
    expect(party.shield('a')).toBe(0)
    expect(party.get('a').hp).toBe(3600)
    expect(log).toEqual(['hpLost a 400 damage by enemy1'])
  })

  it('a hit fully absorbed loses no HP and reports nothing', () => {
    const { party, log } = setup()
    party.add(member('a', 0))
    party.setShield('a', 's', 600)
    expect(party.takeDamage('a', 250, 'enemy1')).toEqual({ absorbed: 250, lost: 0 })
    expect(party.shield('a')).toBe(350)
    expect(log).toEqual([])
  })

  it('shieldOf reads one shield by its key and ignores the others', () => {
    const { party } = setup()
    party.add(member('a', 0))
    expect(party.shieldOf('a', 'mine')).toBe(0)
    party.setShield('a', 'foreign', 2000)
    party.setShield('a', 'mine', 1000)
    expect(party.shieldOf('a', 'mine')).toBe(1000)
    expect(party.shieldOf('a', 'foreign')).toBe(2000)
    expect(party.shield('a')).toBe(2000)
    party.setShield('a', 'mine', undefined)
    expect(party.shieldOf('a', 'mine')).toBe(0)
    expect(() => party.shieldOf('nobody', 'mine')).toThrow(/No combatant/)
  })

  it('several shields do not add up: the largest absorbs and each loses the hit', () => {
    const { party } = setup()
    party.add(member('a', 0))
    party.setShield('a', 'big', 500)
    party.setShield('a', 'small', 200)
    expect(party.shield('a')).toBe(500)
    expect(party.takeDamage('a', 300, 'enemy1')).toEqual({ absorbed: 300, lost: 0 })
    expect(party.shield('a')).toBe(200) // big has 200 left, small is gone
    expect(party.takeDamage('a', 300, 'enemy1')).toEqual({ absorbed: 200, lost: 100 })
  })

  it('damage reductions multiply together', () => {
    const { party } = setup()
    party.add(member('a', 0))
    party.setDamageReduction('a', 'fu-xuan', 0.18)
    party.setDamageReduction('a', 'trace', 0.1)
    expect(party.damageTakenMultiplier('a')).toBeCloseTo(0.82 * 0.9, 12)
    party.setDamageReduction('a', 'fu-xuan', undefined)
    expect(party.damageTakenMultiplier('a')).toBeCloseTo(0.9, 12)
  })
})

describe('spending HP', () => {
  it('skips shields, stops at 1 HP, and is reported as consumed', () => {
    const { party, log } = setup()
    party.add({ ...member('castorice', 0), hp: 1000 })
    party.setShield('castorice', 's', 500)
    expect(party.consumeHp('castorice', 300)).toBe(300)
    expect(party.shield('castorice')).toBe(500)
    expect(party.consumeHp('castorice', 5000)).toBe(699)
    expect(party.get('castorice')).toMatchObject({ hp: 1, downed: false })
    expect(party.consumeHp('castorice', 100)).toBe(0)
    expect(log).toEqual([
      'hpLost castorice 300 consume by castorice',
      'hpLost castorice 699 consume by castorice',
    ])
  })
})

describe('healing', () => {
  it('stops at max HP and reports the overheal', () => {
    const { party, log } = setup()
    party.add({ ...member('a', 0), hp: 3500 })
    expect(party.heal('a', 800, 'healer')).toBe(500)
    expect(party.get('a').hp).toBe(4000)
    expect(log).toEqual(['healed a 500 overheal 300'])
  })

  it('gainHp raises HP up to max HP without a healed event', () => {
    const { party, log } = setup()
    party.add({ ...member('a', 0), hp: 3500 })
    expect(party.gainHp('a', 800)).toBe(500)
    expect(party.get('a').hp).toBe(4000)
    expect(party.gainHp('a', 100)).toBe(0)
    expect(log).toEqual([])
  })
})

describe('energy', () => {
  it('is scaled by Energy Regeneration Rate and capped at the maximum', () => {
    const { party, log } = setup()
    party.add({ ...member('a', 0), maxEnergy: 120, energy: 60, energyRegen: 0.194 })
    expect(party.gainEnergy('a', 10)).toBeCloseTo(11.94, 12)
    expect(party.gainEnergy('a', 100)).toBeCloseTo(120 - 71.94, 12)
    expect(party.get('a').energy).toBe(120)
    expect(party.gainEnergy('a', 10)).toBe(0)
    expect(log).toHaveLength(2)
  })

  it('a fixed gain ignores Energy Regeneration Rate', () => {
    const { party } = setup()
    party.add({ ...member('a', 0), maxEnergy: 120, energyRegen: 0.194 })
    expect(party.gainEnergy('a', 10, { fixed: true })).toBe(10)
  })

  it('a unit without energy gains none, and energy can be set directly', () => {
    const { party } = setup()
    party.add(member('acheron', 0))
    party.add({ ...member('b', 1), maxEnergy: 120, energy: 120 })
    expect(party.gainEnergy('acheron', 10)).toBe(0)
    party.setEnergy('b', 5)
    expect(party.get('b').energy).toBe(5)
  })
})

describe('being downed', () => {
  it('happens once at 0 HP, and the unit then takes no part', () => {
    const { party, log } = setup()
    party.add({ ...member('a', 0), hp: 500, maxEnergy: 100 })
    party.add(member('b', 1))
    party.setShield('a', 's', 100)
    expect(party.anyDowned()).toBe(false)
    expect(party.takeDamage('a', 900, 'enemy1')).toEqual({ absorbed: 100, lost: 500 })
    expect(party.get('a')).toMatchObject({ hp: 0, downed: true })
    expect(party.anyDowned()).toBe(true)
    expect(party.standing()).toEqual(['b'])
    expect(party.targetShares().get('b')).toBe(1)

    expect(party.takeDamage('a', 100, 'enemy1')).toEqual({ absorbed: 0, lost: 0 })
    expect(party.heal('a', 100, 'healer')).toBe(0)
    expect(party.gainEnergy('a', 10)).toBe(0)
    expect(log).toEqual(['hpLost a 500 damage by enemy1', 'downed a'])
  })
})

describe('membership and stats', () => {
  it('a memosprite can join between two characters and leave again', () => {
    const { party } = setup()
    party.add(member('castorice', 1))
    party.add(member('hyacine', 2))
    party.add({ ...member('netherwing', 1.5), maxHp: 30000 })
    expect(party.standing()).toEqual(['castorice', 'netherwing', 'hyacine'])
    party.remove('netherwing')
    expect(party.has('netherwing')).toBe(false)
    expect(party.anyDowned()).toBe(false)
  })

  it('lowering max HP below current HP brings HP down with it', () => {
    const { party } = setup()
    party.add(member('a', 0))
    party.setStats('a', { maxHp: 3000, def: 1200 })
    expect(party.get('a')).toMatchObject({ maxHp: 3000, hp: 3000, def: 1200 })
    party.setStats('a', { maxHp: 5000 })
    expect(party.get('a').hp).toBe(3000)
  })

  it('rejects duplicates, unknown ids and impossible stats', () => {
    const { party } = setup()
    party.add(member('a', 0))
    expect(() => party.add(member('a', 1))).toThrow(/already/)
    expect(() => party.add({ ...member('b', 1), maxHp: 0 })).toThrow(/maxHp/)
    expect(() => party.get('nobody')).toThrow(/No combatant/)
  })
})
