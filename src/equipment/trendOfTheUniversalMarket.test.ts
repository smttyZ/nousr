import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import type { TurnInfo } from '../engine/events'
import { loadEnemyProfile } from '../enemy/profile'
import type { EnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { TrendOfTheUniversalMarket } from './trendOfTheUniversalMarket'

const generic = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

const Plain: Kit = {
  characterId: 'plain',
  path: 'Preservation',
  element: 'Physical',
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

const kernel: DamageKernel = { actionDamage: () => fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] }) }

const member = (key: string, wearing: boolean, path: Kit['path'] = 'Preservation'): MemberSetup => ({
  key,
  kit: { ...Plain, path },
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: 'plain', lightConeId: wearing ? '21016' : 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
  ...(wearing && { equipment: { lightCone: TrendOfTheUniversalMarket, sets: [] } }),
})

/** The attack on `enemy1` is the profile's only pattern entry, so each `takeTurn` uses it. */
function setup(attack: EnemyProfile['attacks'][number], keys: Array<[string, boolean, Kit['path']?]> = [['w', true], ['o', false]]) {
  const profile: EnemyProfile = { ...generic, attacks: [attack], pattern: [attack] }
  const battle = new Battle({
    members: keys.map(([key, wearing, path]) => member(key, wearing, path)),
    policy: keys.map(([key]) => ({ unit: key, use: 'basic' as const, when: [] })),
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 4,
    start: { energy: 0, skillPoints: 3, techniques: false },
    kernel,
  })
  const enemyTurn = (): TurnInfo => ({ unit: 'enemy1', serial: 100, index: 1, at: 0, cycle: 1 })
  return { battle, attackOnce: () => battle.enemies.takeTurn(enemyTurn()) }
}

const strike = { id: 'strike', target: 'single' as const, multiplier: 2.5, adjacentMultiplier: 0, hits: 1, energy: 10 }
const sweep = { id: 'sweep', target: 'aoe' as const, multiplier: 3, adjacentMultiplier: 0, hits: 1, energy: 10 }
const blast = { id: 'blast', target: 'blast' as const, multiplier: 3, adjacentMultiplier: 1.5, hits: 1, energy: 10 }
const bounce = { id: 'bounce', target: 'bounce' as const, multiplier: 1, adjacentMultiplier: 0, hits: 4, energy: 5 }

const BURN = 'lightcone.21016.burn:w'

describe('Trend of the Universal Market', () => {
  it('an AoE attack Burns the enemy for certain; it is a debuff with a 2-turn duration counted at the start of the enemy\'s turns', () => {
    const { battle, attackOnce } = setup(sweep)
    attackOnce()
    const burn = battle.timeline.modifiers.get('enemy1', BURN)!
    expect(burn.chance).toBe(1)
    expect(burn.debuff).toBe(true)
    expect(burn.source).toBe('w')
    expect(burn.duration).toMatchObject({ turns: 2, tick: 'turnStart', clock: 'enemy1' })
    expect(battle.debuffCount('enemy1')).toBe(1)
  })

  it('a single-target attack Burns it with the chance the wearer was the target (its aggro share): debuffs always land, so no base chance', () => {
    const { battle, attackOnce } = setup(strike)
    attackOnce()
    // Two Preservation allies of equal aggro.
    expect(battle.timeline.modifiers.get('enemy1', BURN)!.chance).toBeCloseTo(0.5, 12)
    expect(battle.debuffCount('enemy1')).toBeCloseTo(0.5, 12)
  })

  it('follows aggro: a Destruction teammate draws more of the single-target attacks, so the wearer is Burned less often', () => {
    const { battle, attackOnce } = setup(strike, [['w', true], ['o', false, 'Destruction']])
    attackOnce()
    // 6 / (6 + 5)
    expect(battle.timeline.modifiers.get('enemy1', BURN)!.chance).toBeCloseTo(6 / 11, 12)
  })

  it('a blast that reaches the wearer as the main target or as a neighbour counts as an attack on the wearer', () => {
    // Line w, a, b with equal aggro: w is hit as main (1/3) or as a neighbour of a (1/3), not when b is the main target.
    const three = setup(blast, [['w', true], ['a', false], ['b', false]])
    three.attackOnce()
    expect(three.battle.timeline.modifiers.get('enemy1', BURN)!.chance).toBeCloseTo(2 / 3, 12)
    // In the middle every main target is the wearer or its neighbour.
    const middle = setup(blast, [['a', false], ['w', true], ['b', false]])
    middle.attackOnce()
    expect(middle.battle.timeline.modifiers.get('enemy1', BURN)!.chance).toBeCloseTo(1, 12)
  })

  it('a bounce Burns with the chance of at least one hit on the wearer, 1 - (1 - share)^hits', () => {
    const { battle, attackOnce } = setup(bounce)
    attackOnce()
    expect(battle.timeline.modifiers.get('enemy1', BURN)!.chance).toBeCloseTo(1 - 0.5 ** 4, 12)
  })

  it('does nothing when the attack does not reach the wearer, including damage a redirection moves onto the wearer', () => {
    const { battle, attackOnce } = setup(strike)
    battle.enemies.setForcedTarget('enemy1', 'o')
    battle.party.addRedirect({ id: 'matrix', to: 'w', share: 0.65 })
    attackOnce()
    expect(battle.party.get('w').hp).toBeLessThan(1_000_000)
    expect(battle.timeline.modifiers.has('enemy1', BURN)).toBe(false)
  })

  it('does nothing for a teammate that is attacked: only the wearer\'s Burn counts', () => {
    const { battle, attackOnce } = setup(strike)
    battle.enemies.setForcedTarget('enemy1', 'o')
    attackOnce()
    expect(battle.timeline.modifiers.on('enemy1')).toHaveLength(0)
  })

  it('attacks in a row combine as independent chances and keep the newer 2 turns', () => {
    const { battle, attackOnce } = setup(strike)
    attackOnce()
    attackOnce()
    expect(battle.timeline.modifiers.get('enemy1', BURN)!.chance).toBeCloseTo(1 - 0.5 * 0.5, 12)
  })

  it('ends after the 2nd of the enemy\'s turns that follows', () => {
    const { battle, attackOnce } = setup(sweep)
    attackOnce()
    const turn: TurnInfo = { unit: 'enemy1', serial: 101, index: 2, at: 0, cycle: 1 }
    battle.timeline.modifiers.tick(turn, 'turnStart')
    expect(battle.timeline.modifiers.has('enemy1', BURN)).toBe(true)
    battle.timeline.modifiers.tick({ ...turn, serial: 102, index: 3 }, 'turnStart')
    expect(battle.timeline.modifiers.has('enemy1', BURN)).toBe(false)
  })

  it('two wearers\' Burns are separate debuffs', () => {
    const { battle, attackOnce } = setup(sweep, [['w', true], ['v', true]])
    attackOnce()
    expect(battle.debuffCount('enemy1')).toBe(2)
  })

  it('a wearer that is downed is not attacked', () => {
    const { battle, attackOnce } = setup(sweep)
    battle.party.takeDamage('w', 1e9, 'enemy1')
    attackOnce()
    expect(battle.timeline.modifiers.has('enemy1', BURN)).toBe(false)
  })

  it('rejects a superimposition outside 1 to 5', () => {
    const bad = member('w', true)
    bad.kernel.unit.superimposition = 6
    expect(
      () =>
        new Battle({
          members: [bad],
          policy: [{ unit: 'w', use: 'basic', when: [] }],
          profile: generic,
          enemyCount: 1,
          weaknesses: 'all',
          cycles: 1,
          start: { energy: 0, skillPoints: 3, techniques: false },
          kernel,
        }),
    ).toThrow(/superimposition/)
  })
})
