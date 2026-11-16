import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { Battle } from '../../battle/battle'
import type { MemberSetup } from '../../battle/battle'
import type { EngineEvents } from '../../engine'
import { loadEnemyProfile } from '../../enemy/profile'
import { GiantTreeOfRaptBrooding } from '../../equipment/giantTreeOfRaptBrooding'
import { lightConeWithoutBehaviour } from '../../equipment/equipment'
import { FuXuan } from '../../kits/fuXuan'
import type { Kit } from '../../kits/kit'
import type { KernelBuild, KernelUnit } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Giant Tree of Rapt Brooding through the real kernel, with Fu Xuan's Dunjia heal (Fribbels' TALENT_HEAL hit) as the heal.
 * What these pin:
 * - Fribbels applies the set's Outgoing Healing itself, on the wearer's in-combat SPD: 0 below 135, +12% from 135, +20% from 180.
 * - The heal the sim applies is the kernel's heal hit, so it carries that bonus: 5% of her Max HP + 133, times (1 + Outgoing Healing Boost).
 * - Where the timeline's SPD and the kernel's agree (nothing but the build's SPD), the module lets the run go on.
 */

const profile = loadEnemyProfile('generic-moc')
const unit: KernelUnit = { characterId: '1208', lightConeId: '21016', eidolon: 0, superimposition: 1 }

const build = (feet: string, spdRolls: number, ornament: string = Sets.GiantTreeOfRaptBrooding): KernelBuild => ({
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: ornament,
  body: Stats.HP_P,
  feet,
  planarSphere: Stats.HP_P,
  linkRope: Stats.HP_P,
  substatRolls: { [Stats.HP_P]: 5, [Stats.SPD]: spdRolls },
})

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

const ally: Kit = {
  characterId: 'stub',
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

/** Fu Xuan wearing the set, with her timeline SPD taken from the kernel's basic SPD for the build (nothing else moves it). */
function dunjia(feet: string, spdRolls: number, wearsSet = true) {
  const fxBuild = build(feet, spdRolls, wearsSet ? Sets.GiantTreeOfRaptBrooding : Sets.InertSalsotto)
  const basic = kernel.basicStats(unit, fxBuild)
  const fx: MemberSetup = {
    key: 'fx',
    kit: FuXuan,
    eidolon: 0,
    affinitiveEidolon: false,
    stats: { maxHp: 1_000_000, def: 1000, baseSpd: basic.baseSPD, spdFlat: basic.SPD - basic.baseSPD },
    kernel: { unit, build: fxBuild },
    equipment: {
      lightCone: lightConeWithoutBehaviour({ id: '21016', name: 'Trend of the Universal Market', reason: 'test: its Burn is not what is under test' }),
      sets: wearsSet ? [{ module: GiantTreeOfRaptBrooding, pieces: 2 }] : [],
    },
  }
  const a: MemberSetup = {
    key: 'a',
    kit: ally,
    eidolon: 0,
    affinitiveEidolon: false,
    stats: { maxHp: 1_000_000, def: 1000, baseSpd: 90 },
    kernel: { unit: { characterId: '1308', lightConeId: '23024', eidolon: 0, superimposition: 1 }, build: fxBuild },
  }
  const battle = new Battle({
    members: [fx, a],
    policy: [{ unit: 'fx', use: 'basic', when: [] }],
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0, skillPoints: 0, techniques: false },
    kernel,
  })
  const healed: EngineEvents['healed'][] = []
  battle.timeline.bus.on('healed', (e) => healed.push(e))
  battle.party.takeDamage('a', 5000, 'enemy1')
  battle.party.setEnergy('fx', 135)
  battle.member('fx').instance.actions.ultimate!.use()
  const toAlly = healed.find((h) => h.unit === 'a')!
  const stats = battle.combatStats('fx')
  return { amount: toAlly.amount + toAlly.overheal, stats }
}

describe('Giant Tree of Rapt Brooding: the Outgoing Healing is in the heal the kernel prices', () => {
  let low!: ReturnType<typeof dunjia>
  let mid!: typeof low
  let high!: typeof low
  beforeAll(() => {
    low = dunjia(Stats.HP_P, 0)
    mid = dunjia(Stats.SPD, 10)
    high = dunjia(Stats.SPD, 40)
  })

  it('the three builds are where each threshold needs them', () => {
    expect(low.stats.SPD).toBeLessThan(135)
    expect(mid.stats.SPD).toBeGreaterThanOrEqual(135)
    expect(mid.stats.SPD).toBeLessThan(180)
    expect(high.stats.SPD).toBeGreaterThanOrEqual(180)
  })

  it('Outgoing Healing Boost is 0 under 135 SPD, 12% from 135 and 20% from 180 (Fribbels\' own evaluation)', () => {
    expect(low.stats.OHB).toBeCloseTo(0, 9)
    expect(mid.stats.OHB).toBeCloseTo(0.12, 9)
    expect(high.stats.OHB).toBeCloseTo(0.2, 9)
  })

  it('the heal applied is (5% of her Max HP + 133) x (1 + Outgoing Healing Boost), for each build', () => {
    for (const r of [low, mid, high]) expect(r.amount).toBeCloseTo((0.05 * r.stats.HP + 133) * (1 + r.stats.OHB), 6)
  })

  it('without the set on, the same build heals with no bonus', () => {
    const bare = dunjia(Stats.SPD, 40, false)
    expect(bare.stats.OHB).toBeCloseTo(0, 9)
    expect(bare.amount).toBeCloseTo(0.05 * bare.stats.HP + 133, 6)
  })
})
