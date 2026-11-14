import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { TextureOfMemories } from './textureOfMemories'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const MAX_HP = 1_000_000

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

const member = (key: string, superimposition: number, wearing: boolean): MemberSetup => ({
  key,
  kit: Plain,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: MAX_HP, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: 'plain', lightConeId: wearing ? '24002' : 'x', eidolon: 0, superimposition }, build: noBuild },
  ...(wearing && { equipment: { lightCone: TextureOfMemories, sets: [] } }),
})

function setup(superimposition = 5, others = 1) {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = {
    actionDamage(request) {
      requests.push(request)
      return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] })
    },
  }
  const battle = new Battle({
    members: [member('w', superimposition, true), ...Array.from({ length: others }, (_, i) => member(`o${i}`, 1, false))],
    policy: ['w', ...Array.from({ length: others }, (_, i) => `o${i}`)].map((unit) => ({ unit, use: 'basic' as const, when: [] })),
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 4,
    start: { energy: 0, skillPoints: 3, techniques: false },
    kernel,
  })
  const attack = (id: 'strike' | 'sweep') => battle.timeline.bus.emit('enemyAttack', { enemy: 'enemy1', attack: id })
  return { battle, requests, attack }
}

const SHIELD = 'lightcone.24002.shield:w'
const COOLDOWN = 'lightcone.24002.cooldown:w'

describe('Texture of Memories', () => {
  it('an AoE that hits the wearer with no Shield gives a Shield of 32% Max HP (S5) and reduces the damage by 24%', () => {
    const { battle, attack } = setup()
    attack('sweep')
    expect(battle.party.shield('w')).toBeCloseTo(0.32 * MAX_HP, 6)
    expect(battle.party.damageTakenMultiplier('w')).toBeCloseTo(0.76, 12)
    expect(battle.timeline.modifiers.has('w', COOLDOWN)).toBe(true)
  })

  it('follows the superimposition: 16% and 12% at S1, 24% and 18% at S3', () => {
    for (const [s, shield, reduction] of [[1, 0.16, 0.12], [3, 0.24, 0.18]] as const) {
      const { battle, attack } = setup(s)
      attack('sweep')
      expect(battle.party.shield('w'), `S${s}`).toBeCloseTo(shield * MAX_HP, 6)
      expect(battle.party.damageTakenMultiplier('w'), `S${s}`).toBeCloseTo(1 - reduction, 12)
    }
  })

  it('a single-target attack gives the Shield in proportion to the chance it hits the wearer (expected value)', () => {
    const { battle, attack } = setup(5, 1)
    // Two allies: Preservation (6) and Preservation (6) share the aggro evenly.
    attack('strike')
    expect(battle.party.shield('w')).toBeCloseTo(0.5 * 0.32 * MAX_HP, 6)
  })

  it('once per 3 turns: no new Shield while the cooldown runs, a new one after it', () => {
    const { battle, attack } = setup()
    attack('sweep')
    battle.party.setShield('w', SHIELD, undefined)
    attack('sweep')
    expect(battle.party.shield('w')).toBe(0)
    expect(battle.party.damageTakenMultiplier('w')).toBe(1)
    battle.timeline.modifiers.remove('w', COOLDOWN)
    attack('sweep')
    expect(battle.party.shield('w')).toBeCloseTo(0.32 * MAX_HP, 6)
  })

  it('a Shield from another source stops the new one and still reduces the damage', () => {
    const { battle, attack } = setup()
    battle.party.setShield('w', 'dhpt.shield', 5000)
    attack('sweep')
    expect(battle.party.shield('w')).toBe(5000)
    expect(battle.timeline.modifiers.has('w', COOLDOWN)).toBe(false)
    expect(battle.party.damageTakenMultiplier('w')).toBeCloseTo(0.76, 12)
  })

  it('the Shield lasts 2 of the wearer\'s turns, the cooldown 3', () => {
    const { battle, attack } = setup()
    attack('sweep')
    const atTurnStart: [number, boolean][] = []
    battle.timeline.bus.on('turnStart', (t) => {
      if (t.unit === 'w') atTurnStart.push([battle.party.shield('w'), battle.timeline.modifiers.has('w', COOLDOWN)])
    })
    battle.run()
    expect(atTurnStart.length).toBeGreaterThanOrEqual(3)
    expect(atTurnStart[0]![0]).toBeGreaterThan(0)
    expect(atTurnStart[1]![0]).toBeGreaterThan(0)
    expect(atTurnStart[2]![0]).toBe(0)
    // The cooldown is still running at the start of the 3rd turn: no new Shield was gained meanwhile.
    expect(atTurnStart[2]![1]).toBe(true)
  })

  it('tells the kernel whether the wearer has a Shield right now', () => {
    const { battle, requests, attack } = setup()
    battle.member('w').instance.actions.basic!.use()
    expect(requests.at(-1)!.attacker.lightConeConditionals).toEqual({ activeShieldDmgDecrease: false })
    attack('sweep')
    battle.member('w').instance.actions.basic!.use()
    expect(requests.at(-1)!.attacker.lightConeConditionals).toEqual({ activeShieldDmgDecrease: true })
  })

  it('a wearer who is downed gets nothing', () => {
    const { battle, attack } = setup()
    battle.party.takeDamage('w', 1e12, 'enemy1')
    attack('sweep')
    expect(battle.party.shield('w')).toBe(0)
  })

  it('rejects a superimposition outside 1 to 5', () => {
    expect(() => setup(6)).toThrow(/superimposition/)
  })
})
