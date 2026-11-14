import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { HitPart, MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { EternalCalculus } from './index'

/**
 * Eternal Calculus under K17: its stacks are the expected number of distinct enemies hit (capped at 5) and its
 * SPD rise is a threshold on that expected number.
 */

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

let parts: HitPart[] = []
const Wearer: Kit = {
  characterId: 'wearer',
  path: 'Erudition',
  element: 'Lightning',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () => battle.performAction(self.key, 'basic', 'basic', () => battle.attack({ attacker: self.key, ability: 'BASIC', parts })),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
}

/** Uses its Basic ATK twice by hand (`parts` for each) and reports what the kernel was asked on the second. */
function afterOneAttack(enemies: number, first: HitPart[]) {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = {
    actionDamage(request) {
      requests.push(request)
      return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] })
    },
  }
  const member: MemberSetup = {
    key: 'w',
    kit: Wearer,
    eidolon: 0,
    affinitiveEidolon: false,
    stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
    kernel: { unit: { characterId: 'wearer', lightConeId: '24004', eidolon: 0, superimposition: 1 }, build: noBuild },
    equipment: { lightCone: EternalCalculus, sets: [] },
  }
  const battle = new Battle({
    members: [member],
    policy: [{ unit: 'w', use: 'basic', when: [] }],
    profile,
    enemyCount: enemies,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0, skillPoints: 0, techniques: false },
    kernel,
  })
  parts = first
  const instance = battle.member('w').instance
  instance.actions.basic!.use()
  requests.length = 0
  parts = [{ shape: 'single', scaling: 1, hit: 0 }]
  instance.actions.basic!.use()
  const conditionals = requests[0]!.attacker.lightConeConditionals
  return { stacks: conditionals?.atkBuffStacks as number, spdBuff: conditionals?.spdBuff as boolean, spdPct: battle.timeline.modifiers.spdPct('w') }
}

const aoe: HitPart[] = [{ shape: 'aoe', scaling: 1, hit: 0 }]
const bounce = (hits: number): HitPart[] => [{ shape: 'bounce', scaling: 1, hits, hit: 0 }]

describe('Eternal Calculus counts the expected distinct enemies hit (K17)', () => {
  it('an AoE, single or blast is as before: one stack per enemy hit, SPD from 3 enemies', () => {
    expect(afterOneAttack(5, aoe)).toMatchObject({ stacks: 5, spdBuff: true })
    expect(afterOneAttack(5, aoe).spdPct).toBeCloseTo(0.08, 12)
    expect(afterOneAttack(3, aoe)).toMatchObject({ stacks: 3, spdBuff: true })
    expect(afterOneAttack(2, aoe)).toMatchObject({ stacks: 2, spdBuff: false })
    expect(afterOneAttack(5, [{ shape: 'single', scaling: 1, hit: 0 }])).toMatchObject({ stacks: 1, spdBuff: false })
    expect(afterOneAttack(5, [{ shape: 'blast', scaling: 1, adjacent: 0.5, hit: 0 }])).toMatchObject({ stacks: 3, spdBuff: true })
    expect(afterOneAttack(5, [{ shape: 'blast', scaling: 1, adjacent: 0, hit: 0 }])).toMatchObject({ stacks: 1, spdBuff: false })
  })

  it('stacks cap at 5 with more enemies', () => {
    expect(afterOneAttack(7, aoe).stacks).toBe(5)
  })

  it('3 random hits on 5 enemies leave 2.44 stacks, not 5, and fall short of the 3-enemy SPD rise', () => {
    const result = afterOneAttack(5, bounce(3))
    expect(result.stacks).toBeCloseTo(5 * (1 - (4 / 5) ** 3), 12)
    expect(result.spdBuff).toBe(false)
    expect(result.spdPct).toBe(0)
  })

  it('the SPD rise is a threshold on the expected count: 4 hits on 5 enemies are 2.95, 5 hits are 3.36', () => {
    expect(afterOneAttack(5, bounce(4))).toMatchObject({ spdBuff: false })
    expect(afterOneAttack(5, bounce(4)).stacks).toBeCloseTo(5 * (1 - (4 / 5) ** 4), 12)
    const five = afterOneAttack(5, bounce(5))
    expect(five.stacks).toBeCloseTo(5 * (1 - (4 / 5) ** 5), 12)
    expect(five.spdBuff).toBe(true)
  })

  it('a deterministic hit plus a bounce adds up (Acheron-shaped: AoE and bounce is still every enemy)', () => {
    expect(afterOneAttack(5, [...aoe, ...bounce(6)])).toMatchObject({ stacks: 5, spdBuff: true })
  })
})
