import { describe, expect, it } from 'vitest'
import { EventBus } from '../engine/events'
import type { EngineEvents } from '../engine/events'
import { Party } from './party'

function setup() {
  const bus = new EventBus<EngineEvents>()
  const log: string[] = []
  bus.on('hpLost', (e) => log.push(`hpLost ${e.unit} ${e.amount} ${e.cause}`))
  bus.on('damageRedirected', (e) => log.push(`redirected ${e.from}->${e.to} ${e.amount}`))
  bus.on('hpBorne', (e) => log.push(`borne ${e.unit} by ${e.by} excess ${e.excess} requested ${e.requested} lost ${e.lost} ${e.cause}`))
  bus.on('unitDowned', (e) => log.push(`downed ${e.unit}`))
  bus.on('memospriteDefeated', (e) => log.push(`defeated ${e.unit}`))
  const party = new Party(bus)
  return { party, log }
}

const unit = (id: string, position: number, maxHp = 1000, extra: object = {}) => ({ id, position, baseAggro: 4, maxHp, def: 100, ...extra })

describe('damage redirection (Fu Xuan)', () => {
  function team() {
    const s = setup()
    s.party.add(unit('a', 0))
    s.party.add(unit('b', 1))
    s.party.add(unit('fx', 2, 4000))
    return s
  }

  it('moves its share of every hit on the covered ally to the receiver, before shields', () => {
    const { party, log } = team()
    party.addRedirect({ id: 'matrix', to: 'fx', share: 0.65 })
    party.setShield('a', 's', 1000)
    party.takeDamage('a', 1000, 'enemy1')
    // The shield sees only the 350 that stays with a; the receiver loses the 650 with no shield of its own.
    expect(party.shield('a')).toBeCloseTo(650, 9)
    expect(party.get('a').hp).toBe(1000)
    expect(party.get('fx').hp).toBeCloseTo(4000 - 650, 9)
    expect(log).toEqual(['redirected a->fx 650', 'hpLost fx 650 damage'])
  })

  it("the receiver's own shield absorbs the moved share", () => {
    const { party } = team()
    party.addRedirect({ id: 'matrix', to: 'fx', share: 0.65 })
    party.setShield('fx', 's', 500)
    party.takeDamage('b', 1000, 'enemy1')
    expect(party.get('fx').hp).toBeCloseTo(4000 - 150, 9)
    expect(party.get('b').hp).toBeCloseTo(1000 - 350, 9)
  })

  it('never moves the receiver\'s own damage', () => {
    const { party } = team()
    party.addRedirect({ id: 'matrix', to: 'fx', share: 0.65 })
    party.takeDamage('fx', 1000, 'enemy1')
    expect(party.get('fx').hp).toBe(3000)
    expect(party.get('a').hp).toBe(1000)
  })

  it('lasts only while its active check holds (a modifier on the receiver), and can be removed', () => {
    const { party } = team()
    let on = true
    party.addRedirect({ id: 'matrix', to: 'fx', share: 0.5, active: () => on })
    party.takeDamage('a', 200, 'enemy1')
    expect(party.get('fx').hp).toBe(3900)
    on = false
    party.takeDamage('a', 200, 'enemy1')
    expect(party.get('fx').hp).toBe(3900)
    on = true
    party.removeRedirect('matrix')
    party.takeDamage('a', 200, 'enemy1')
    expect(party.get('fx').hp).toBe(3900)
  })

  it('covers only the allies it names, and the default covers memosprites too', () => {
    const { party } = team()
    party.add(unit('m', 3, 1000, { kind: 'memosprite' }))
    party.addRedirect({ id: 'matrix', to: 'fx', share: 0.5, from: (id) => id !== 'b' })
    party.takeDamage('b', 100, 'enemy1')
    expect(party.get('fx').hp).toBe(4000)
    party.takeDamage('m', 100, 'enemy1')
    expect(party.get('fx').hp).toBe(3950)
  })

  it("is dropped when the receiver is downed or removed, so nothing is moved to a dead ally", () => {
    const { party } = team()
    party.addRedirect({ id: 'matrix', to: 'fx', share: 0.5 })
    party.takeDamage('fx', 1e9, 'enemy1')
    expect(party.get('fx').downed).toBe(true)
    party.takeDamage('a', 200, 'enemy1')
    expect(party.get('a').hp).toBe(800)
  })

  it("the receiver's own reductions apply to the share only when the rule says so", () => {
    const { party } = team()
    party.setDamageReduction('fx', 'avoidance', 0.18)
    party.addRedirect({ id: 'plain', to: 'fx', share: 0.5 })
    party.takeDamage('a', 1000, 'enemy1')
    expect(party.get('fx').hp).toBeCloseTo(3500, 9)
    party.addRedirect({ id: 'plain', to: 'fx', share: 0.5, targetReductions: true })
    party.takeDamage('a', 1000, 'enemy1')
    expect(party.get('fx').hp).toBeCloseTo(3500 - 500 * 0.82, 9)
  })

  it('rejects a share outside 0 to 1', () => {
    const { party } = team()
    expect(() => party.addRedirect({ id: 'x', to: 'fx', share: 1.2 })).toThrow(/share/)
  })
})

describe('backup (Netherwing)', () => {
  function team() {
    const s = setup()
    s.party.add(unit('a', 0, 100))
    s.party.add(unit('b', 1, 100))
    s.party.add(unit('nw', 1.5, 2000, { kind: 'memosprite', targetable: false }))
    s.party.addBackup({ id: 'netherwing', by: 'nw', multiplier: 5 })
    return s
  }

  it('holds a hit at 1 HP and the receiver bears the rest at 500%', () => {
    const { party, log } = team()
    party.takeDamage('a', 130, 'enemy1')
    expect(party.get('a').hp).toBe(1)
    expect(party.get('a').downed).toBe(false)
    expect(party.get('nw').hp).toBeCloseTo(2000 - 31 * 5, 9)
    expect(log).toEqual(['hpLost a 99 damage', 'hpLost nw 155 damage', 'borne a by nw excess 31 requested 155 lost 155 damage'])
  })

  it('covers HP the ally spends itself, and the HP-loss events carry the cause', () => {
    const { party, log } = team()
    party.consumeHp('b', 150)
    expect(party.get('b').hp).toBe(1)
    expect(party.get('nw').hp).toBeCloseTo(2000 - 51 * 5, 9)
    expect(log[0]).toBe('hpLost b 99 consume')
    expect(log[1]).toBe('hpLost nw 255 consume')
  })

  it('a unit already at 1 HP passes the whole loss on, and shields still absorb first', () => {
    const { party } = team()
    party.consumeHp('a', 120)
    party.setShield('a', 's', 10)
    party.takeDamage('a', 30, 'enemy1')
    expect(party.get('a').hp).toBe(1)
    // The 120 spent leaves 21 excess; of the 30 hit, 10 is absorbed by the shield and 20 reaches the HP path, all excess.
    expect(party.get('nw').hp).toBeCloseTo(2000 - 21 * 5 - 20 * 5, 9)
  })

  it("its own HP spending uses the normal path: no backup, stops at 1 HP", () => {
    const { party } = team()
    expect(party.consumeHp('nw', 5000)).toBe(1999)
    expect(party.get('nw').hp).toBe(1)
    expect(party.get('a').hp).toBe(100)
  })

  it('at 0 HP it is defeated (not downed), the rule goes with it, and later hits can down the ally', () => {
    const { party, log } = team()
    party.takeDamage('a', 100 + 2000 / 5 + 1, 'enemy1')
    expect(log).toContain('defeated nw')
    expect(log.filter((l) => l.startsWith('downed'))).toEqual([])
    expect(party.get('nw').downed).toBe(true)
    expect(party.anyDowned()).toBe(false)
    party.remove('nw')
    party.takeDamage('b', 500, 'enemy1')
    expect(party.get('b').downed).toBe(true)
    expect(log).toContain('downed b')
  })

  it('is skipped while its active check fails, and can be removed', () => {
    const { party } = team()
    party.addBackup({ id: 'netherwing', by: 'nw', multiplier: 5, active: () => false })
    party.takeDamage('a', 500, 'enemy1')
    expect(party.get('a').downed).toBe(true)
    expect(party.get('nw').hp).toBe(2000)
    party.removeBackup('netherwing')
    party.takeDamage('b', 500, 'enemy1')
    expect(party.get('b').downed).toBe(true)
  })

  it('does not raise the HP of a unit below 1', () => {
    const { party } = team()
    party.setStats('a', { maxHp: 100 })
    party.consumeHp('a', 99.5)
    expect(party.get('a').hp).toBeCloseTo(1, 9)
    const s = setup()
    s.party.add(unit('x', 0, 0.5))
    s.party.add(unit('nw', 1, 100, { kind: 'memosprite' }))
    s.party.addBackup({ id: 'b', by: 'nw', multiplier: 5 })
    s.party.takeDamage('x', 10, 'enemy1')
    expect(s.party.get('x').hp).toBe(0.5)
    expect(s.party.get('nw').hp).toBeCloseTo(100 - 50, 9)
  })
})
