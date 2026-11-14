import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { EQUIPMENT, resolveEquipment } from './index'
import { InTheNameOfTheWorld } from './inTheNameOfTheWorld'

/**
 * In the Name of the World: its DMG bonus is live per enemy (any debuff on it right now), and the Skill-only
 * ATK and EHR switches stay on because Fribbels itself restricts them to the Skill ability.
 */

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

const Wearer: Kit = {
  characterId: 'wearer',
  path: 'Nihility',
  element: 'Imaginary',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () => battle.performAction(self.key, 'basic', 'basic', () => battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
}

function setup(enemies = 1, superimposition = 1) {
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
    kernel: { unit: { characterId: 'wearer', lightConeId: '23004', eidolon: 0, superimposition }, build: noBuild },
    equipment: { lightCone: InTheNameOfTheWorld, sets: [] },
  }
  const battle = new Battle({
    members: [member],
    policy: [],
    profile,
    enemyCount: enemies,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0, skillPoints: 0, techniques: false },
    kernel,
  })
  return { battle, requests, basic: () => battle.member('w').instance.actions.basic!.use() }
}

describe('In the Name of the World', () => {
  it('is 23004, and is not in the registry until someone adds it (the registry is not this module\'s to edit)', () => {
    expect(InTheNameOfTheWorld.id).toBe('23004')
    expect(InTheNameOfTheWorld.kind).toBe('lightCone')
    // Not registered here: resolveEquipment refuses it by name until src/equipment/index.ts lists it.
    const unit = { characterId: 'x', lightConeId: '23004', eidolon: 0, superimposition: 1 }
    const registered = EQUIPMENT.lightCones.has('23004')
    if (!registered) expect(() => resolveEquipment(unit, noBuild, EQUIPMENT)).toThrow(/no equipment module/)
  })

  it('the DMG bonus is off against an enemy with no debuff and on against one with a debuff', () => {
    const { battle, requests, basic } = setup()
    basic()
    expect(requests.at(-1)!.attacker.lightConeConditionals).toEqual({ enemyDebuffedDmgBoost: false, skillAtkBoost: true, skillEhrBoost: true })
    battle.applyDebuff({ id: 'someone.debuff', target: 'enemy1', source: 'ally' })
    basic()
    expect(requests.at(-1)!.attacker.lightConeConditionals).toEqual({ enemyDebuffedDmgBoost: true, skillAtkBoost: true, skillEhrBoost: true })
  })

  it('is read per enemy: only the debuffed enemy gets the bonus', () => {
    const { battle, requests } = setup(3)
    battle.applyDebuff({ id: 'someone.debuff', target: 'enemy1', source: 'ally' })
    // One attack on all three: the kernel is asked once per enemy.
    battle.attack({ attacker: 'w', ability: 'BASIC', parts: [{ shape: 'aoe', scaling: 1, hit: 0 }] })
    const byBonus = requests.map((r) => r.attacker.lightConeConditionals!.enemyDebuffedDmgBoost)
    // Identical requests are cached, so the two undebuffed enemies share one kernel call.
    expect(byBonus.sort()).toEqual([false, true])
  })

  it('the bonus ends when the debuff does', () => {
    const { battle, requests, basic } = setup()
    battle.applyDebuff({ id: 'slow', target: 'enemy1', source: 'ally', duration: { turns: 1, tick: 'turnEnd' } })
    battle.timeline.modifiers.tick({ unit: 'enemy1', serial: 9, index: 1, at: 0, cycle: 1 }, 'turnEnd')
    basic()
    expect(requests.at(-1)!.attacker.lightConeConditionals!.enemyDebuffedDmgBoost).toBe(false)
  })

  it('has no teammate effect: it sets nothing for a teammate\'s attack', () => {
    const { battle } = setup()
    const instance = battle.member('w').equipmentInstances[0]!
    expect(instance.teammateState).toBeUndefined()
  })
})
