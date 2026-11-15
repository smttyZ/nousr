import { describe, expect, it } from 'vitest'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { Battle } from './battle'
import type { MemberSetup } from './battle'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const kernel: DamageKernel = { actionDamage: () => fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] }) }

const Plain: Kit = {
  characterId: 'plain',
  path: 'Hunt',
  element: 'Lightning',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'basic', 'basic', () =>
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] }),
          ),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
}

const member = (key: string, baseSpd = 100): MemberSetup => ({
  key,
  kit: Plain,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1e6, def: 1000, baseSpd },
  kernel: { unit: { characterId: 'plain', lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
})

function setup(enemyCount = 3) {
  const battle = new Battle({
    members: [member('a'), member('b', 90)],
    policy: [{ unit: 'a', use: 'basic', when: [] }, { unit: 'b', use: 'basic', when: [] }],
    profile,
    enemyCount,
    weaknesses: 'all',
    cycles: 2,
    start: { energy: 0, skillPoints: 0, techniques: false },
    kernel,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  return { battle, dealt }
}

describe('Battle.dealFlatDamage', () => {
  it('lowers the enemy HP by the amount and is recorded as a damageDealt event marked with its kind', () => {
    const { battle, dealt } = setup()
    const enemy = battle.enemies.ids[1]!
    const before = battle.enemyHp(enemy).current
    const dealtNow = battle.dealFlatDamage({ attacker: 'a', enemy, amount: 1234, kind: 'TRUE', label: 'E1_TRUE_DMG' })
    expect(dealtNow).toBe(1234)
    expect(battle.enemyHp(enemy).current).toBeCloseTo(before - 1234, 9)
    expect(dealt).toHaveLength(1)
    expect(dealt[0]).toMatchObject({ attacker: 'a', enemy, ability: 'E1_TRUE_DMG', scaling: 0, damage: 1234, kind: 'TRUE', chance: 1, cycle: 1 })
  })

  it('counts in the attacker total and the per-cycle total of the result, and never asks the kernel', () => {
    const { battle } = setup(1)
    const [enemy] = battle.enemies.ids
    battle.dealFlatDamage({ attacker: 'b', enemy: enemy!, amount: 500, kind: 'TRUE', label: 'X' })
    const result = battle.run()
    expect(result.damageByMember.b).toBeGreaterThanOrEqual(500)
    // Everything the run priced is the 1,000 Basic ATKs; the 500 is on top, in cycle 1 (it was dealt before the first turn).
    const priced = result.actions.length * 1000
    expect(result.totalDamage).toBeCloseTo(priced + 500, 9)
    expect(result.damageByCycle.reduce((x, y) => x + y, 0)).toBeCloseTo(priced + 500, 9)
    expect(result.damageByMember.a! + result.damageByMember.b!).toBeCloseTo(priced + 500, 9)
  })

  it('priced hits carry no kind', () => {
    const { battle, dealt } = setup(1)
    battle.member('a').instance.actions.basic!.use()
    expect(dealt).toHaveLength(1)
    expect(dealt[0]!.kind).toBeUndefined()
  })

  it('a zero amount is a no-op; a negative amount, an unknown enemy or an unknown attacker throws', () => {
    const { battle, dealt } = setup(1)
    const enemy = battle.enemies.ids[0]!
    expect(battle.dealFlatDamage({ attacker: 'a', enemy, amount: 0, kind: 'TRUE', label: 'X' })).toBe(0)
    expect(dealt).toHaveLength(0)
    expect(() => battle.dealFlatDamage({ attacker: 'a', enemy, amount: -1, kind: 'TRUE', label: 'X' })).toThrow(/negative/)
    expect(() => battle.dealFlatDamage({ attacker: 'a', enemy: 'nobody', amount: 1, kind: 'TRUE', label: 'X' })).toThrow(/not an enemy/)
    expect(() => battle.dealFlatDamage({ attacker: 'zzz', enemy, amount: 1, kind: 'TRUE', label: 'X' })).toThrow(/No member/)
  })
})

describe('Battle.addMemosprite with suspended', () => {
  it('puts the memosprite on the timeline suspended, with its gauge, until the kit resumes it', () => {
    const { battle } = setup(1)
    battle.addMemosprite({ id: 'a.m', owner: 'a', name: 'x', maxHp: 100, baseAggro: 4, baseSpd: 500, suspended: true, takeTurn: () => undefined })
    const { timeline } = battle
    expect(timeline.has('a.m')).toBe(true)
    expect(timeline.isSuspended('a.m')).toBe(true)
    expect(timeline.order().map((o) => o.unit)).not.toContain('a.m')
    timeline.resume('a.m', { gauge: 10_000 })
    expect(timeline.order()[0]!.unit).toBe('a.m')
  })

  it('needs an SPD', () => {
    const { battle } = setup(1)
    expect(() =>
      battle.addMemosprite({ id: 'a.m', owner: 'a', name: 'x', maxHp: 100, baseAggro: 4, suspended: true, takeTurn: () => undefined }),
    ).toThrow(/baseSpd/)
  })
})
