import { describe, expect, it } from 'vitest'
import { EventBus } from '../engine/events'
import type { EngineEvents } from '../engine/events'
import { Party } from './party'

function setup() {
  const bus = new EventBus<EngineEvents>()
  const log: string[] = []
  bus.on('hpLost', (e) => log.push(`hpLost ${e.unit} ${e.amount} ${e.cause}`))
  bus.on('damageRedirected', (e) => log.push(`redirected ${e.from}->${e.to} ${e.amount}`))
  bus.on('hpBorne', (e) => log.push(`borne ${e.unit} by ${e.by} lost ${e.lost}`))
  bus.on('knockdownPrevented', (e) => log.push(`prevented ${e.unit} hp ${e.hp} by ${e.by}`))
  bus.on('unitDowned', (e) => log.push(`downed ${e.unit}`))
  bus.on('memospriteDefeated', (e) => log.push(`defeated ${e.unit}`))
  bus.on('shieldGranted', (e) => log.push(`shield ${e.unit} ${e.key} ${e.previous}->${e.amount} from ${e.source}`))
  const party = new Party(bus)
  return { party, bus, log }
}

const unit = (id: string, position: number, maxHp = 1000, extra: object = {}) => ({ id, position, baseAggro: 4, maxHp, def: 100, ...extra })

describe('knockdown guard', () => {
  it('holds a unit at the HP the guard names instead of downing it, with the loss already reported', () => {
    const { party, log } = setup()
    party.add(unit('a', 0))
    party.addKnockdownGuard('g', () => 700)
    party.takeDamage('a', 5000, 'enemy1')
    expect(party.get('a').hp).toBe(700)
    expect(party.get('a').downed).toBe(false)
    expect(log).toEqual(['hpLost a 1000 damage', 'prevented a hp 700 by g'])
  })

  it('lets the knockdown happen when the guard returns undefined, and does not run for a hit that leaves HP', () => {
    const { party, log } = setup()
    party.add(unit('a', 0))
    let calls = 0
    party.addKnockdownGuard('g', () => {
      calls += 1
      return undefined
    })
    party.takeDamage('a', 400, 'enemy1')
    expect(calls).toBe(0)
    party.takeDamage('a', 5000, 'enemy1')
    expect(calls).toBe(1)
    expect(party.get('a').downed).toBe(true)
    expect(log.at(-1)).toBe('downed a')
  })

  it('the first guard to veto wins, later ones are not asked; a guard can be removed; HP is capped at Max HP', () => {
    const { party } = setup()
    party.add(unit('a', 0))
    const asked: string[] = []
    party.addKnockdownGuard('one', () => {
      asked.push('one')
      return undefined
    })
    party.addKnockdownGuard('two', () => {
      asked.push('two')
      return 99_999
    })
    party.addKnockdownGuard('three', () => {
      asked.push('three')
      return 1
    })
    party.takeDamage('a', 5000, 'x')
    expect(asked).toEqual(['one', 'two'])
    expect(party.get('a').hp).toBe(1000)
    party.removeKnockdownGuard('two')
    party.removeKnockdownGuard('three')
    party.takeDamage('a', 5000, 'x')
    expect(party.get('a').downed).toBe(true)
  })

  it('is told who the unit is and what caused the loss', () => {
    const { party } = setup()
    party.add(unit('a', 0))
    const seen: unknown[] = []
    party.addKnockdownGuard('g', (info) => {
      seen.push(info)
      return undefined
    })
    party.takeDamage('a', 5000, 'enemy1')
    expect(seen).toEqual([{ unit: 'a', source: 'enemy1', cause: 'damage' }])
  })

  it('a memosprite saved by a guard is not defeated', () => {
    const { party, log } = setup()
    party.add(unit('m', 0, 500, { kind: 'memosprite' }))
    party.addKnockdownGuard('g', ({ unit: id }) => (id === 'm' ? 350 : undefined))
    party.takeDamage('m', 9999, 'enemy1')
    expect(party.get('m').hp).toBe(350)
    expect(log).toEqual(['hpLost m 500 damage', 'prevented m hp 350 by g'])
  })

  describe('order with the redirect and the backup rule', () => {
    it('a covered ally is held at 1 HP by the backup, so the guard never sees it; the backup itself is guarded', () => {
      const { party, log } = setup()
      party.add(unit('a', 0, 100))
      party.add(unit('nw', 0.5, 200, { kind: 'memosprite', targetable: false }))
      party.addBackup({ id: 'b', by: 'nw', multiplier: 5 })
      const asked: string[] = []
      party.addKnockdownGuard('g', ({ unit: id }) => {
        asked.push(id)
        return id === 'nw' ? 100 : undefined
      })
      party.takeDamage('a', 130, 'enemy1')
      // a: 100 HP, hit of 130, held at 1; the excess 31 x 5 = 155 goes to nw (200 HP), no veto needed.
      expect(party.get('a').hp).toBe(1)
      expect(asked).toEqual([])
      // Another hit: the excess 400 x 5 = 2000 would kill nw, and the guard saves it.
      party.takeDamage('a', 400, 'enemy1')
      expect(asked).toEqual(['nw'])
      expect(party.get('nw').hp).toBe(100)
      expect(log).toContain('prevented nw hp 100 by g')
      expect(log.filter((l) => l.startsWith('downed') || l.startsWith('defeated'))).toEqual([])
    })

    it('the redirect moves its share first, so the guard sees the share that reached each unit', () => {
      const { party, log } = setup()
      party.add(unit('a', 0, 1000))
      party.add(unit('fx', 1, 500))
      party.addRedirect({ id: 'matrix', to: 'fx', share: 0.65 })
      const asked: string[] = []
      party.addKnockdownGuard('g', ({ unit: id }) => {
        asked.push(id)
        return id === 'a' ? 700 : undefined
      })
      // a would take 5000: 3250 goes to fx (which dies, unguarded), 1750 stays with a (which the guard saves).
      party.takeDamage('a', 5000, 'enemy1')
      expect(asked).toEqual(['fx', 'a'])
      expect(party.get('fx').downed).toBe(true)
      expect(party.get('a').hp).toBe(700)
      expect(log[0]).toBe('redirected a->fx 3250')
    })

    it('a shield absorbs before the guard is ever asked', () => {
      const { party } = setup()
      party.add(unit('a', 0, 1000))
      party.addKnockdownGuard('g', () => 500)
      party.setShield('a', 's', 5000)
      party.takeDamage('a', 3000, 'enemy1')
      expect(party.get('a').hp).toBe(1000)
      expect(party.get('a').downed).toBe(false)
    })
  })
})

describe('shield granted event', () => {
  it('is emitted for a new shield and one refreshed upward, with the provider (default: the shielded unit)', () => {
    const { party, log } = setup()
    party.add(unit('a', 0))
    party.setShield('a', 'k', 100)
    party.setShield('a', 'k', 250, 'dh')
    expect(log).toEqual(['shield a k 0->100 from a', 'shield a k 100->250 from dh'])
  })

  it('is not emitted for the same amount, a lower one or a removal', () => {
    const { party, log } = setup()
    party.add(unit('a', 0))
    party.setShield('a', 'k', 100)
    log.length = 0
    party.setShield('a', 'k', 100)
    party.setShield('a', 'k', 40)
    party.setShield('a', 'k', undefined)
    party.setShield('a', 'k', 0)
    expect(log).toEqual([])
  })

  it('a shield that took a hit and is set back up is a refresh upward', () => {
    const { party, log } = setup()
    party.add(unit('a', 0))
    party.setShield('a', 'k', 100, 'dh')
    party.takeDamage('a', 60, 'enemy1')
    log.length = 0
    party.setShield('a', 'k', 100, 'dh')
    expect(log).toEqual(['shield a k 40->100 from dh'])
  })
})

describe('settable energy cap', () => {
  it('raises the cap so energy can be stored beyond the normal maximum, and cuts the energy when it is lowered', () => {
    const { party } = setup()
    party.add({ ...unit('r', 0), maxEnergy: 140, energy: 100 })
    expect(party.gainEnergy('r', 100, { fixed: true })).toBe(40)
    party.setMaxEnergy('r', 280)
    expect(party.get('r').maxEnergy).toBe(280)
    expect(party.gainEnergy('r', 200, { fixed: true })).toBe(140)
    expect(party.get('r').energy).toBe(280)
    party.setMaxEnergy('r', 140)
    expect(party.get('r').energy).toBe(140)
    expect(() => party.setMaxEnergy('r', -1)).toThrow(/maxEnergy/)
  })
})
