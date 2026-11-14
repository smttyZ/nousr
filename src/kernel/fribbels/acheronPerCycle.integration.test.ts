import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { Battle } from '../../battle/battle'
import type { MemberSetup } from '../../battle/battle'
import { loadEnemyProfile } from '../../enemy/profile'
import { Acheron } from '../../kits/acheron'
import { EQUIPMENT, resolveEquipment } from '../../equipment/index'
import { Tribbie } from '../../kits/tribbie'
import type { Rule } from '../../scenario/types'
import type { KernelBuild } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Acheron's damage per cycle through the real kernel, before and after the kernel started returning
 * damage per hit (DESIGN.md, K11). Her abilities are each one Fribbels hit, so per-hit pricing must not
 * move her numbers: the figures below were recorded with the earlier one-number-per-ability pricing, and
 * they hold to the precision Fribbels' own arithmetic gives (about 1e-10 here; checked to 1e-6).
 *
 * A change here that is not a deliberate change to her kit or to Fribbels is a pricing bug. If Fribbels
 * is updated in the submodule, these figures move with it and are re-recorded.
 *
 * Re-pinned 2026-11-13 when light cones and sets became equipment modules (DESIGN.md, K4). Every member now
 * wears real modules: Along the Passing Shore and Pioneer Diver of Dead Waters (4 pieces) on Acheron, Dance!
 * Dance! Dance! and Pioneer Diver on Tribbie, and Izumo Gensei, which Fribbels derives itself. Three things
 * moved the numbers, and each was measured alone before this was written (case, then the figures per cycle
 * with only that module on):
 *
 * - Pioneer Diver, read live: before, Fribbels' default priced every hit as against 3 or more debuffs with the
 *   set's doubling up (its strongest state, menu value 4; see equipment.integration.test.ts). Now
 *   the value follows the debuffs the enemy really has, so a hit on an enemy with none loses the set's DMG
 *   and CRIT DMG. Alone it lowers Acheron's cycles by 10 to 15% where she has no debuffs on the enemy (E0 alone
 *   against 1 enemy: 10623 to 9001 in cycle 1).
 * - Along the Passing Shore, read live: its Mirage Fizzle is a debuff of hers, so it feeds her own talent
 *   (a Slashed Dream and a Crimson Knot per action) and she reaches her Ultimate sooner. That moves damage
 *   between cycles far more than the 24% bonus moves it within one (E0 alone against 1 enemy: the 73905 Ultimate
 *   in cycle 5 becomes a 72511 Ultimate in cycle 2, and the quiet cycles lose the Fizzle-free first hit's 24%).
 *   The hit that applies the debuff is priced without the bonus (IN-GAME CHECK in the module).
 * - Dance! Dance! Dance!, on the cases with Tribbie: her Ultimate advances every ally by 16%, which changes
 *   the turn order, and with it when Acheron's Ultimate and Tribbie's Zone line up.
 *
 * Re-pinned 2026-11-14 for K22 (expected-value debuffs) and K24 (break effects are debuffs): the two Tribbie cases moved, in cycles 4 and 5
 * only, and only through K24; see the comments on each case.
 *
 * Re-pinned 2026-11-13 when weakness break was built (DESIGN.md, K7 and K7b). Enemies now have a toughness bar
 * (480, internal units), hits remove it, and a broken enemy (1) takes x1.0 instead of x0.9 from every hit
 * until its next turn, (2) takes the kernel's Break DMG once, priced broken (x1.0), credited to the breaker
 * (so it is in the sums below), and (3) is delayed 25%, plus 20% x (1 + BE) for a Quantum breaker (Tribbie).
 * Each effect was measured alone (the other two switched off, by a scratch test that wrapped the kernel and
 * undid the delay) and the case figures are Acheron's damage per cycle, old -> new, with the effect alone
 * in brackets (change against old). The bar refills at the enemy's turn (every ~63 AV at SPD 158.4), so enemies
 * break rarely: Acheron alone almost never, and the first case never.
 *
 * - E0 alone, 1 enemy: no break at all in 5 cycles. Nothing moves.
 * - E6 + Affinitive Eidolon alone, 3 enemies: one break, in cycle 5. 39786.54 -> 47672.11 (+7885.58). Broken
 *   multiplier alone 0 (no later hit lands on the broken enemy before its bar refills); Break DMG alone
 *   +7097.04 (priced at 0.9, the multiplier off); delay alone 0 (she has no energy, so enemy turns do not
 *   change her output). The other +788.54 is the Break DMG at x1.0 instead of x0.9 (7885.58 / 7097.04 = 1/0.9).
 * - E2 + Tribbie E1, 5 enemies, 5 breaks: cycle 3 958189.98 -> 990961.66 (+32771.67: multiplier alone
 *   +20060.12, Break DMG alone +11440.40 at 0.9, delay alone 0; Break DMG at x1.0 is 12711.55, which with the
 *   multiplier gives the total). Cycle 4 805747.19 -> 839704.11 (multiplier alone +33956.92, the rest 0). Cycle 5
 *   252630.49 -> 298276.80 (+45646.31: the delay alone is +32672.23, a Tribbie Quantum break delaying enemies
 *   so they hit less often, which moves Tribbie's energy and so her Ultimate and Zone; the multiplier alone is
 *   0 here, and the rest is the delay and the multiplier acting on the re-timed hits).
 * - E6 + Affinitive Eidolon beside Tribbie E0, 3 enemies, 3 breaks: cycle 3 723791.30 -> 761531.79 (+37740.50:
 *   multiplier alone +25028.92, Break DMG alone +11440.40, delay alone 0). Cycle 4 670296.22 -> 741444.10
 *   (+71147.88: multiplier alone +44727.21, delay alone +26420.68, Break DMG alone 0, and the sum is more than
 *   the three because the delay re-times which hits land on a broken enemy).
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
const acheronPolicy = [rule('acheron', 'ultimate'), rule('acheron', 'skill'), rule('acheron', 'basic')]
const tribbiePolicy = [rule('tribbie', 'ultimate'), rule('tribbie', 'skill'), rule('tribbie', 'basic')]

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

/** Acheron's damage in each of 5 cycles against generic-moc, 3 starting skill points, 50% energy, techniques on. */
function acheronByCycle(members: MemberSetup[], policy: Rule[], enemyCount: number): number[] {
  const battle = new Battle({
    members,
    policy,
    profile: loadEnemyProfile('generic-moc'),
    enemyCount,
    weaknesses: 'all',
    cycles: 5,
    start: { energy: 0.5, skillPoints: 3, techniques: true },
    kernel,
  })
  const byCycle = [0, 0, 0, 0, 0]
  battle.timeline.bus.on('damageDealt', (d) => {
    if (d.attacker === 'acheron') byCycle[Math.min(d.cycle, 5) - 1]! += d.damage
  })
  battle.run()
  return byCycle
}

describe('Acheron per cycle is unchanged by per-hit pricing', () => {
  const cases: { name: string, members: MemberSetup[], policy: Rule[], enemyCount: number, expected: number[] }[] = [
    {
      name: 'E0 alone against 1 enemy',
      members: [acheron(0, false)],
      policy: acheronPolicy,
      enemyCount: 1,
      // Old: [10623.375144859256, 10623.375144859256, 10623.375144859256, 6639.609465537035, 73905.02233897817]
      // Pioneer alone: [9000.885, 9000.885, 9000.885, 5625.553, 63908.243]; Along alone: [9229.231, 72510.879, 14457.270, 9035.794, 14457.270].
      expected: [7736.715825864165, 65118.68542569704, 12477.35049630593, 7798.344060191204, 12477.35049630593],
    },
    {
      name: 'E6 with the Affinitive Eidolon alone against 3 enemies',
      members: [acheron(6, true)],
      policy: acheronPolicy,
      enemyCount: 3,
      // Old: [36457.04003921268, 262606.65092128265, 52317.12119916089, 18684.68614255746, 52317.12119916089]
      // Pioneer alone: [33072.320, 238225.899, 47459.930, 16949.975, 47459.930]; Along alone: [27998.330, 273412.598, 43858.411, 252606.011, 43858.411].
      // Weakness break (K7): cycle 5 was 39786.53780486456, now with one Break DMG hit (see the header).
      expected: [25398.92774981611, 266791.2389769713, 39786.53780486456, 245039.99289891825, 47672.11447928316],
    },
    {
      name: 'E2 with the Affinitive Eidolon beside Tribbie E1 against 5 enemies',
      members: [acheron(2, true), tribbie(1)],
      policy: [...acheronPolicy, ...tribbiePolicy],
      enemyCount: 5,
      // Re-pinned 2026-11-13 after the Tribbie review fixes: her E1 (+24% True DMG while the Zone is up) was
      // wrongly off before. Every cycle moved by exactly x1.24 (the old values were 269700.016229085,
      // 581868.4422266292, 359993.30912714277, 15970.299675910124, 250434.52540388276).
      // Old (after the Tribbie fix above): [334428.0201240654, 721516.8683610207, 446391.70331765705, 19803.171598128552, 310538.8115008146]
      // Pioneer alone: [285403.277, 622034.428, 388350.104, 17167.281, 265162.627]; Along alone: [1284015.523, 18061.468, 899579.012, 407900.801, 24080.506];
      // Along and Pioneer: [1149081.998, 15587.954, 799490.304, 356614.939, 21844.840]; Dance moves the last four cycles to the figures below.
      // Weakness break (K7), was [1149081.9975542831, 356614.9391330746, 958189.9831990919, 805747.1893770439, 252630.49444410455].
      // K22 / K24 (2026-11-14), was [1149081.9975542831, 356614.9391330746, 990961.6572651827, 839704.1145080819, 298276.803192375]: cycles 4 and 5 only
      // (+54630.86 and +10562.47). Each cause alone: K22 on bounces 0 (Acheron's own parts reach every enemy for certain, so Along the Passing Shore's
      // chance is always 1; the old and new Fizzle give the same numbers), expected talent stacks 0 (no debuff in this run lands with a chance below
      // 1, so the stacks stay whole), K24 break debuffs all of it: Tribbie's Quantum break leaves Entangled on the enemy, a debuff, so her next
      // Acheron hits count it (Pioneer Diver's tier, her E1's +18% CRIT Rate against debuffed enemies).
      expected: [1149081.9975542831, 356614.9391330746, 990961.6572651827, 894334.9762539868, 308839.2669066245],
    },
    {
      name: 'E6 with the Affinitive Eidolon beside Tribbie E0 against 3 enemies',
      members: [acheron(6, true), tribbie(0)],
      policy: [...acheronPolicy, ...tribbiePolicy],
      enemyCount: 3,
      // Old: [306365.3944767085, 725884.0384614432, 28649.852085254774, 388075.2691548146, 28649.852085254774]
      // Pioneer alone: [277922.022, 658491.995, 25989.962, 352045.843, 25989.962]; Along alone: [945487.145, 344701.495, 740747.241, 704923.031, 24017.701];
      // Along and Pioneer: [913328.725, 321547.257, 723791.297, 674929.068, 21787.866]; Dance moves cycles 2, 4 and 5 to the figures below.
      // Weakness break (K7), was [913328.7246385348, 295126.54774301045, 723791.2971497488, 670296.2246838908, 275505.7258835326].
      // K22 / K24 (2026-11-14), was [913328.7246385348, 295126.54774301045, 761531.7946724296, 741444.101858762, 275505.7258835326]: cycle 4 only
      // (+21221.87), all of it K24 (Entangled counts as a debuff after Tribbie's Quantum break); K22 on bounces and expected talent stacks 0, as above.
      expected: [913328.7246385348, 295126.54774301045, 761531.7946724296, 762665.9727559718, 275505.7258835326],
    },
  ]

  it.each(cases)('$name', ({ members, policy, enemyCount, expected }) => {
    const actual = acheronByCycle(members, policy, enemyCount)
    expected.forEach((value, i) => expect(actual[i]!, `cycle ${i + 1}`).toBeCloseTo(value, 6))
  })
})
