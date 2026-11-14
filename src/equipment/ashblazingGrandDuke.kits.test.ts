import { describe, expect, it } from 'vitest'
import { Battle, type BattleSetup, type MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import { Acheron, acheronScalings } from '../kits/acheron'
import { JingYuan, jingYuanScalings } from '../kits/jingYuan'
import type { Kit } from '../kits/kit'
import type { Rule } from '../scenario/types'
import { TheAshblazingGrandDuke } from './ashblazingGrandDuke'
import { lightConeWithoutBehaviour } from './equipment'

/**
 * The Ashblazing Grand Duke on the real Follow-Up shapes: Acheron's Affinitive Follow-Up (an AoE part and a 6-hit
 * bounce in one attack) and Jing Yuan's Lightning-Lord (random-target blast parts). The kernel is fake and records
 * the stack count the module passes; the kits are the real ones.
 */

const SET = 'The Ashblazing Grand Duke'
const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const wearing = {
  lightCone: lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' }),
  sets: [{ module: TheAshblazingGrandDuke, pieces: 4 as const }],
}

function setup(members: MemberSetup[], policy: Rule[], kernel: DamageKernel, overrides: Partial<BattleSetup> = {}) {
  return new Battle({
    members,
    policy,
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 3,
    start: { energy: 0, skillPoints: 3, techniques: false },
    kernel,
    ...overrides,
  })
}

/** The stack counts the module gave the kernel, in the order the requests came. */
const stacksSeen = (requests: DamageRequest[]) => [...new Set(requests.map((r) => r.setConditionals?.[SET] as number | undefined))]

describe('The Ashblazing Grand Duke on Acheron\'s Affinitive Follow-Up', () => {
  const helper: Kit = {
    characterId: 'helper',
    path: 'Harmony',
    element: 'Ice',
    maxEnergy: 0,
    create: (battle, self) => ({
      actions: {
        basic: {
          kind: 'basic',
          canUse: () => true,
          use: () => battle.performAction(self.key, 'basic', 'basic', () => {
            battle.gainSkillPoints(1)
            battle.applyDebuff({ id: 'helper.debuff', target: battle.primary, source: self.key })
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
          }),
        },
      },
      attackerState: () => ({}),
      teammateState: () => ({}),
    }),
  }
  const kernelOf = (requests: DamageRequest[]): DamageKernel => ({
    actionDamage(request) {
      requests.push(request)
      const s = acheronScalings(request.attacker.eidolon)
      const count = request.enemy?.count ?? 1
      const hit = (scaling: number) => [{ damage: 1000 * scaling, scaling }]
      return request.attacker.characterId === '1308'
        ? fakeResult({ BASIC: hit(s.basic), SKILL: hit(s.skillMain), ULT: hit(3 * s.rainblade + 3 * s.knot + s.stygianResurge), FUA: hit(3 + (0.8 * 6) / count) })
        : fakeResult({ BASIC: hit(1) })
    },
  })
  const acheron: MemberSetup = {
    key: 'acheron',
    kit: Acheron,
    eidolon: 0,
    affinitiveEidolon: true,
    stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
    kernel: { unit: { characterId: '1308', lightConeId: '23024', eidolon: 0, superimposition: 1, ex: 1 }, build: noBuild },
    equipment: wearing,
  }
  const friend: MemberSetup = {
    key: 'helper',
    kit: helper,
    eidolon: 0,
    affinitiveEidolon: false,
    stats: { maxHp: 1_000_000, def: 1000, baseSpd: 160 },
    kernel: { unit: { characterId: 'helper', lightConeId: 'none', eidolon: 0, superimposition: 1 }, build: noBuild },
  }
  const policy: Rule[] = [{ unit: 'acheron', use: 'basic', when: [] }, { unit: 'helper', use: 'basic', when: [] }]
  const run = (enemyCount: number) => {
    const requests: DamageRequest[] = []
    setup([acheron, friend], policy, kernelOf(requests), { enemyCount, cycles: 2 }).run()
    return stacksSeen(requests)
  }

  it('1 enemy: the AoE (1) and the 6-hit bounce make 7 stacks, not 1', () => {
    const seen = run(1)
    expect(seen).toContain(7)
    expect(seen).not.toContain(1)
  })

  it('3 and 5 enemies: AoE hits every enemy, so 3 + 6 and 5 + 6 reach the cap of 8', () => {
    expect(run(3)).toContain(8)
    expect(run(5)).toContain(8)
  })
})

describe('The Ashblazing Grand Duke on Jing Yuan\'s Lightning-Lord', () => {
  const kernelOf = (requests: DamageRequest[]): DamageKernel => ({
    actionDamage(request) {
      requests.push(request)
      const s = jingYuanScalings(request.attacker.eidolon)
      const hit = (scaling: number) => [{ damage: 1000 * scaling, scaling }]
      return fakeResult({ BASIC: hit(s.basic), SKILL: hit(s.skill), ULT: hit(s.ult), FUA: hit(s.lordHit * Number(request.attacker.characterConditionals?.talentAttacks ?? 3)) })
    },
  })
  const jy: MemberSetup = {
    key: 'jy',
    kit: JingYuan,
    eidolon: 0,
    affinitiveEidolon: false,
    stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
    kernel: { unit: { characterId: '1204', lightConeId: '24004', eidolon: 0, superimposition: 1 }, build: noBuild },
    equipment: wearing,
  }
  const run = (enemyCount: number) => {
    const requests: DamageRequest[] = []
    setup([jy], [{ unit: 'jy', use: 'basic', when: [] }], kernelOf(requests), { enemyCount, cycles: 3 }).run()
    return stacksSeen(requests)
  }

  it('is no longer refused as a wearer', () => {
    expect(() => run(1)).not.toThrow()
  })

  it('1 enemy: the Lord\'s 3 blast hits each reach 1 enemy, 3 stacks', () => {
    expect(run(1)).toContain(3)
  })

  it('3 enemies: each random blast hit reaches 7/3 enemies on average (the middle 3, each end 2), 3 hits is 7 stacks', () => {
    const seen = run(3)
    expect(seen.some((v) => v !== undefined && Math.abs(v - 7) < 1e-9)).toBe(true)
  })

  it('5 enemies: 13/5 enemies per blast hit on average, 3 hits is 7.8 stacks', () => {
    const seen = run(5)
    expect(seen.some((v) => v !== undefined && Math.abs(v - 7.8) < 1e-9)).toBe(true)
  })
})
