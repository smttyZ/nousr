import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { GoodNightAndSleepWell } from './goodNightAndSleepWell'

/**
 * Good Night and Sleep Well passes the target's own debuff count (capped at 3) to the kernel, per enemy (K1), live.
 */

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/** Attacks one chosen enemy with a Basic ATK. */
let aim: string | undefined
const Wearer: Kit = {
  characterId: 'wearer',
  path: 'Nihility',
  element: 'Quantum',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'basic', 'basic', () =>
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0, ...(aim && { target: aim }) }] }),
          ),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
}

function setup(enemies = 3, wearEquipment = true) {
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
    kernel: { unit: { characterId: 'wearer', lightConeId: '21001', eidolon: 0, superimposition: 5 }, build: noBuild },
    ...(wearEquipment && { equipment: { lightCone: GoodNightAndSleepWell, sets: [] } }),
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
  const debuff = (enemy: string, name: string) => battle.applyDebuff({ id: name, target: enemy, source: 'w' })
  /** The stacks the module hands the kernel when the wearer hits `enemy` now. */
  const stacksOn = (enemy: string) => battle.member('w').equipmentInstances[0]!.attackerState!(enemy).lightConeConditionals?.debuffStacksDmgIncrease
  /** What the kernel is really asked when the wearer attacks `enemy`. */
  const askedOn = (enemy: string) => {
    aim = enemy
    requests.length = 0
    battle.member('w').instance.actions.basic!.use()
    return requests.at(-1)?.attacker.lightConeConditionals?.debuffStacksDmgIncrease
  }
  return { battle, debuff, stacksOn, askedOn, requests }
}

describe('Good Night and Sleep Well', () => {
  it('is light cone 21001 and is registered under that id', () => {
    expect(GoodNightAndSleepWell).toMatchObject({ kind: 'lightCone', id: '21001', name: 'Good Night and Sleep Well' })
  })

  it('counts the debuffs on the enemy being hit: 0, 1, 2 and 3 stack, 4 and 5 stay at 3', () => {
    const { debuff, stacksOn } = setup(1)
    const seen: unknown[] = [stacksOn('enemy1')]
    for (let n = 1; n <= 5; n++) {
      debuff('enemy1', `d${n}`)
      seen.push(stacksOn('enemy1'))
    }
    expect(seen).toEqual([0, 1, 2, 3, 3, 3])
  })

  it('is per enemy (K1): debuffs on one enemy do not count for another', () => {
    const { debuff, stacksOn } = setup(3)
    debuff('enemy1', 'a')
    debuff('enemy1', 'b')
    debuff('enemy3', 'c')
    expect([stacksOn('enemy1'), stacksOn('enemy2'), stacksOn('enemy3')]).toEqual([2, 0, 1])
  })

  it('counts a debuff from any source, once per debuff, and a refresh does not add one', () => {
    const { debuff, stacksOn } = setup(1)
    debuff('enemy1', 'same')
    debuff('enemy1', 'same')
    expect(stacksOn('enemy1')).toBe(1)
    debuff('enemy1', 'other')
    expect(stacksOn('enemy1')).toBe(2)
  })

  it('does not count a modifier that is not a debuff', () => {
    const { battle, stacksOn } = setup(1)
    battle.timeline.modifiers.apply({ id: 'mark', target: 'enemy1', source: 'w' })
    expect(stacksOn('enemy1')).toBe(0)
  })

  it('follows a debuff that expires', () => {
    const { battle, stacksOn } = setup(1)
    battle.applyDebuff({ id: 'short', target: 'enemy1', source: 'w', duration: { turns: 1, tick: 'turnEnd' } })
    expect(stacksOn('enemy1')).toBe(1)
    battle.timeline.modifiers.remove('enemy1', 'short')
    expect(stacksOn('enemy1')).toBe(0)
  })

  it('supplies nothing for a teammate: the effect is the wearer\'s own', () => {
    const { requests, battle } = setup(1)
    const instance = battle.member('w').equipmentInstances[0]!
    expect(instance.teammateState).toBeUndefined()
    expect(requests).toHaveLength(0)
  })
})

describe('Good Night and Sleep Well through a real attack', () => {
  it('the kernel is asked with the target enemy\'s own count, and a different one when a different enemy is hit', () => {
    const { debuff, askedOn } = setup(3)
    debuff('enemy1', 'a')
    debuff('enemy1', 'b')
    expect(askedOn('enemy1')).toBe(2)
    expect(askedOn('enemy2')).toBe(0)
  })

  it('without the module the kernel gets no value for it, which is why a scenario run refuses a light cone with no module', () => {
    const { askedOn, debuff } = setup(1, false)
    debuff('enemy1', 'a')
    expect(askedOn('enemy1')).toBeUndefined()
  })
})
