import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { Battle } from '../../battle/battle'
import type { MemberSetup } from '../../battle/battle'
import { loadEnemyProfile } from '../../enemy/profile'
import { EQUIPMENT, resolveEquipment } from '../../equipment/index'
import { Acheron } from '../../kits/acheron'
import { Tribbie } from '../../kits/tribbie'
import type { Rule } from '../../scenario/types'
import type { KernelBuild } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * The guard on the undecided "highest HP" tie (DESIGN.md, "Known approximations") with the real kernel.
 * Acheron and Tribbie (the pinned team of acheronPerCycle.integration.test.ts) against 3 enemies: after
 * Tribbie's Ultimate puts the Zone's instances on the primary target, the two neighbours are tied for the
 * highest HP and the primary is not among them. With identical neighbours the tie is harmless and the guard is
 * quiet. A debuff on one neighbour changes what Pioneer Diver of Dead Waters (worn by Tribbie) gives her hit
 * against it, so the choice between the neighbours changes damage, and the run says so.
 */

const acheronBuild: KernelBuild = {
  relicSet1: Sets.PioneerDiverOfDeadWaters,
  relicSet2: Sets.PioneerDiverOfDeadWaters,
  ornamentSet: Sets.IzumoGenseiAndTakamaDivineRealm,
  body: Stats.CD,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const tribbieBuild: KernelBuild = { ...acheronBuild, feet: Stats.HP_P, planarSphere: Stats.Quantum_DMG, linkRope: Stats.HP_P, substatRolls: { [Stats.HP_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 } }

const gear = (lightConeId: string, build: KernelBuild, eidolon: number) =>
  resolveEquipment({ characterId: 'x', lightConeId, eidolon, superimposition: 1 }, build, EQUIPMENT)

const acheron = (eidolon: number, ex: boolean): MemberSetup => ({
  equipment: gear('23024', acheronBuild, eidolon),
  key: 'acheron',
  kit: Acheron,
  eidolon,
  affinitiveEidolon: ex,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 101 },
  kernel: { unit: { characterId: '1308', lightConeId: '23024', eidolon, superimposition: 1, ex: ex ? 1 : 0 }, build: acheronBuild },
})
const tribbie = (eidolon: number): MemberSetup => ({
  equipment: gear('21018', tribbieBuild, eidolon),
  key: 'tribbie',
  kit: Tribbie,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 120 },
  kernel: { unit: { characterId: '1403', lightConeId: '21018', eidolon, superimposition: 1 }, build: tribbieBuild },
})

const rule = (unit: string, use: string): Rule => ({ unit, use, when: [] })
const policy = [
  rule('acheron', 'ultimate'), rule('acheron', 'skill'), rule('acheron', 'basic'),
  rule('tribbie', 'ultimate'), rule('tribbie', 'skill'), rule('tribbie', 'basic'),
]

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

/**
 * Tribbie, wrapped so that enemy 1 carries a debuff only while she picks the enemy for the Zone's Additional DMG
 * after one of Acheron's actions. Her own listener is subscribed when she is created, so one subscribed first
 * runs before it; the test removes the debuff again with a listener subscribed after the battle is built. The
 * debuff is therefore never on enemy 1 when a hit lands: both neighbours take identical damage and stay tied,
 * and the only thing the debuff changes is what her hit would be worth against enemy 1.
 */
const tribbieSeeingADebuff: MemberSetup['kit'] = {
  ...Tribbie,
  create(battle, self) {
    battle.timeline.bus.on('actionUsed', (action) => {
      if (action.actor === 'acheron') battle.applyDebuff({ id: MARK, target: 'enemy1', source: 'acheron' })
    })
    return Tribbie.create(battle, self)
  },
}
const MARK = 'test.debuff'

function runMembers(members: MemberSetup[], enemyCount: number) {
  const battle = new Battle({
    members,
    policy: policy.filter((r) => members.some((m) => m.key === r.unit)),
    profile: loadEnemyProfile('generic-moc'),
    enemyCount,
    weaknesses: 'all',
    cycles: 5,
    start: { energy: 0.5, skillPoints: 3, techniques: true },
    kernel,
  })
  battle.timeline.bus.on('actionUsed', () => battle.timeline.modifiers.remove('enemy1', MARK))
  return battle.run()
}

const run = (debuffedNeighbour: boolean) =>
  runMembers([acheron(2, true), debuffedNeighbour ? { ...tribbie(1), kit: tribbieSeeingADebuff } : tribbie(1)], 3)

describe('the "highest HP" tie guard, with the real kernel', () => {
  it('is quiet when the tied neighbours are identical', () => {
    expect(run(false).warnings).toEqual([])
  })

  // The battles pinned in acheronPerCycle.integration.test.ts and Tribbie alone at 3 and 5 enemies: identical
  // enemies, so the guard must say nothing and the pinned numbers cannot have moved because of it.
  it.each([
    ['Acheron E0 alone, 1 enemy', () => [acheron(0, false)], 1],
    ['Acheron E6 with the Affinitive Eidolon alone, 3 enemies', () => [acheron(6, true)], 3],
    ['Acheron E2 with the Affinitive Eidolon beside Tribbie E1, 5 enemies', () => [acheron(2, true), tribbie(1)], 5],
    ['Acheron E6 with the Affinitive Eidolon beside Tribbie E0, 3 enemies', () => [acheron(6, true), tribbie(0)], 3],
    ['Tribbie E0 alone, 3 enemies', () => [tribbie(0)], 3],
    ['Tribbie E6 alone, 5 enemies', () => [tribbie(6)], 5],
  ] as const)('is quiet in an existing battle: %s', (_name, members, enemyCount) => {
    expect(runMembers(members(), enemyCount).warnings).toEqual([])
  })

  it('warns, once per hit and tied set with a count, when a debuff on one tied neighbour changes the price', () => {
    const { warnings: records } = run(true)
    expect(records.length).toBeGreaterThan(0)
    expect(records.every((r) => r.severity === 'warning' && r.code === 'undecided-tie')).toBe(true)
    const warnings = records.map((r) => r.message)
    for (const w of warnings) {
      expect(w).toContain('Undecided "highest HP" tie')
      expect(w).toContain('enemy1, enemy3 tied')
      expect(w).toContain('went to enemy1')
      expect(w).toContain('DESIGN.md, "Known approximations"')
    }
    expect(warnings.some((w) => w.includes("tribbie's"))).toBe(true)
    // One line per (attacker, ability, hit, tied set): no two lines name the same attacker, ability and hit.
    const heads = warnings.map((w) => /([a-z]+'s [A-Z]+ hit \d+)/.exec(w)![1])
    expect(new Set(heads).size).toBe(heads.length)
    // Deterministic: the same battle gives the same sentences.
    expect(run(true).warnings.map((r) => r.message)).toEqual(warnings)
    // For example: "Undecided "highest HP" tie: tribbie's UNIQUE hit 0 had the enemies enemy1, enemy3 tied ... (damage
    // per 100% of the scaling stat: enemy1 22405.21, enemy3 21970.33). It went to enemy1 ..."
    const prices = /enemy1 (\d+\.\d+), enemy3 (\d+\.\d+)\)/.exec(warnings[0]!)!
    expect(Number(prices[1])).not.toBe(Number(prices[2]))
  })
})
