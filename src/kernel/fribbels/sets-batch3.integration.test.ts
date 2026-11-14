import { describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { AmphoreusTheEternalLand } from '../../equipment/amphoreusTheEternalLand'
import { BoneCollectionsSereneDemesne } from '../../equipment/boneCollectionsSereneDemesne'
import { GiantTreeOfRaptBrooding } from '../../equipment/giantTreeOfRaptBrooding'
import { PoetOfMourningCollapse } from '../../equipment/poetOfMourningCollapse'
import { WorldRemakingDeliverer } from '../../equipment/worldRemakingDeliverer'
import type { DamageRequest, KernelBuild, KernelUnit } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * The batch 3 equipment modules against the real Fribbels kernel (DESIGN.md, K4): each comparison changes one
 * thing and keeps the rest of the build fixed, so the difference is the set's effect.
 *
 * Constants Fribbels uses for these builds, read from its own tables (`vendor/hsr-optimizer/src/lib/relics/statCalculator.ts`
 * and the characters' config): Acheron's base SPD is 101, Castorice's is 95, and the Head's flat HP main stat, maxed,
 * is 705.6. Every HP percentage in these tests applies to the HP that is left after that flat part.
 */

const HEAD_FLAT_HP = 705.6
const ACHERON_BASE_SPD = 101
const CASTORICE_BASE_SPD = 95

const acheron: KernelUnit = { characterId: '1308', eidolon: 0, lightConeId: '23024', superimposition: 1 }
const castorice: KernelUnit = { characterId: '1407', eidolon: 0, lightConeId: '23024', superimposition: 1 }

/** Poet of Mourning at 4 pieces, Izumo Gensei as the ornament, ATK feet and ATK link rope, CRIT and CRIT DMG substats. */
const base: KernelBuild = {
  relicSet1: Sets.PoetOfMourningCollapse,
  relicSet2: Sets.PoetOfMourningCollapse,
  ornamentSet: Sets.IzumoGenseiAndTakamaDivineRealm,
  body: Stats.CD,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}

const kernel = new FribbelsKernel()
const damage = (build: KernelBuild, overrides: Partial<DamageRequest> = {}) =>
  kernel.actionDamage({ attacker: acheron, teammates: [], build, ...overrides })

describe('the modules name the sets Fribbels names', () => {
  it.each([
    [PoetOfMourningCollapse.name, Sets.PoetOfMourningCollapse],
    [GiantTreeOfRaptBrooding.name, Sets.GiantTreeOfRaptBrooding],
    [BoneCollectionsSereneDemesne.name, Sets.BoneCollectionsSereneDemesne],
    [WorldRemakingDeliverer.name, Sets.WorldRemakingDeliverer],
    [AmphoreusTheEternalLand.name, Sets.AmphoreusTheEternalLand],
  ])('%s', (name, fribbels) => {
    expect(name).toBe(fribbels)
  })
})

describe('Poet of Mourning Collapse: the CRIT Rate threshold reads the SPD after the set\'s own -8%', () => {
  // Pre-battle SPD from the build: boots of flat SPD (25) for the high case, ATK boots for the low ones, and SPD
  // substat rolls (flat, 2.6 each at the top) to land the middle case between the two thresholds.
  const poet = (feet: string, rolls: Record<string, number>) => damage({ ...base, feet, substatRolls: { ...base.substatRolls, ...rolls } })
  const high = poet(Stats.SPD, {})
  const low = poet(Stats.ATK_P, {})
  const middle = poet(Stats.ATK_P, { [Stats.SPD]: 4 })

  it('the cases are where each threshold needs them', () => {
    expect(high.stats.SPD).toBeGreaterThanOrEqual(110)
    expect(middle.stats.SPD).toBeGreaterThanOrEqual(95)
    expect(middle.stats.SPD).toBeLessThan(110)
    expect(low.stats.SPD).toBeLessThan(95)
  })

  it('under 95 SPD the CRIT Rate is 32 points higher than above 110, and from 95 to under 110 it is 20 points higher', () => {
    expect(low.stats.CR - high.stats.CR).toBeCloseTo(0.32, 6)
    expect(middle.stats.CR - high.stats.CR).toBeCloseTo(0.2, 6)
  })

  it('reads the SPD after the -8%: the middle case is above 110 before the reduction, and still gets the 20 points', () => {
    expect(middle.stats.SPD / 0.92).toBeGreaterThanOrEqual(110)
    expect(middle.stats.CR).toBeGreaterThan(high.stats.CR)
  })
})

describe('Giant Tree of Rapt Brooding: its SPD +6% is Fribbels\' own, and it has no switch', () => {
  it('adds 6% of the base SPD to the wearer\'s SPD, against the same build with Izumo Gensei', () => {
    const giant = damage({ ...base, ornamentSet: GiantTreeOfRaptBrooding.name })
    const izumo = damage(base)
    expect(giant.stats.SPD - izumo.stats.SPD).toBeCloseTo(0.06 * ACHERON_BASE_SPD, 3)
  })
})

describe('Bone Collection\'s Serene Demesne: its Max HP +12% is Fribbels\' own, and its CRIT DMG threshold is at Max HP 5000', () => {
  const bone = (rolls: Record<string, number>, rope: string) =>
    damage({ ...base, ornamentSet: BoneCollectionsSereneDemesne.name, linkRope: rope, substatRolls: { ...base.substatRolls, ...rolls } })

  it('adds 12% of the percentage-scaled HP to the wearer\'s Max HP, against Izumo Gensei', () => {
    const bone0 = damage({ ...base, ornamentSet: BoneCollectionsSereneDemesne.name })
    const izumo = damage(base)
    expect(bone0.stats.HP - izumo.stats.HP).toBeCloseTo(0.12 * (izumo.stats.HP - HEAD_FLAT_HP), 3)
  })

  it('gives its CRIT DMG only from Max HP 5000: the same damage with the threshold met is bigger by the CRIT DMG it adds', () => {
    // 11 HP% substat rolls and an HP% link rope lift the wearer over 5000; with an ATK% rope it stays under.
    const rolls = { [Stats.HP_P]: 11 }
    const low = bone(rolls, Stats.ATK_P)
    const high = bone(rolls, Stats.HP_P)
    expect(low.stats.HP).toBeLessThan(5000)
    expect(high.stats.HP).toBeGreaterThanOrEqual(5000)
    // The two cases differ in ATK and HP only. CRIT Rate and CRIT DMG are the same, and the damage is linear in ATK,
    // so the damage per ATK differs by the CRIT multiplier the bonus adds: (1 + CR x (CD + 0.28)) / (1 + CR x CD).
    expect(high.stats.CR).toBeCloseTo(low.stats.CR, 6)
    // The bonus is in the wearer's CRIT DMG stat when the threshold is met: exactly 28 points more.
    expect(high.stats.CD - low.stats.CD).toBeCloseTo(0.28, 5)
    const cr = low.stats.CR
    const cd = low.stats.CD
    const expected = (1 + cr * (cd + 0.28)) / (1 + cr * cd)
    const ratio = (high.damage.BASIC! / high.stats.ATK) / (low.damage.BASIC! / low.stats.ATK)
    expect(ratio).toBeCloseTo(expected, 4)
  })
})

describe('World-Remaking Deliverer: its CRIT Rate +8% is Fribbels\' own, and its 4-piece switch is the memosprite effect', () => {
  const deliverer = (value?: boolean) =>
    damage(
      { ...base, relicSet1: WorldRemakingDeliverer.name, relicSet2: WorldRemakingDeliverer.name },
      value === undefined ? {} : { setConditionals: { [WorldRemakingDeliverer.name]: value } },
    )
  const musketeer = damage({ ...base, relicSet1: Sets.MusketeerOfWildWheat, relicSet2: Sets.MusketeerOfWildWheat })

  it('the 2-piece CRIT Rate +8% is always on: against Musketeer, which gives no CRIT Rate, the gain is 8 points', () => {
    expect(deliverer(false).stats.CR - musketeer.stats.CR).toBeCloseTo(0.08, 6)
  })

  it('its Max HP +24% is on only with the switch on: 24% of the percentage-scaled HP', () => {
    const on = deliverer(true)
    const off = deliverer(false)
    expect(on.stats.HP - off.stats.HP).toBeCloseTo(0.24 * (off.stats.HP - HEAD_FLAT_HP), 3)
  })

  it('its team DMG +15% is on only with the switch on: the damage with it is bigger', () => {
    expect(deliverer(true).damage.BASIC!).toBeGreaterThan(deliverer(false).damage.BASIC!)
  })

  it('Fribbels\' own value for this switch depends on the path (its presets turn it on for Remembrance only), so the module must pass its live value', () => {
    // Acheron is not a Remembrance character, and her preset is off: the value passed is the one that stands.
    expect(deliverer().stats.HP).toBeCloseTo(deliverer(false).stats.HP, 9)
  })
})

describe('Amphoreus, The Eternal Land: its CRIT Rate +8% is Fribbels\' own, and its team SPD needs the wearer\'s memosprite', () => {
  const amphoreus = (attacker: KernelUnit, value: boolean, teammates: KernelUnit[] = []) =>
    kernel.actionDamage({
      attacker,
      teammates,
      build: { ...base, ornamentSet: AmphoreusTheEternalLand.name },
      setConditionals: { [AmphoreusTheEternalLand.name]: value },
    })

  it('the 2-piece CRIT Rate +8% is always on: against Izumo Gensei with the same relics, the gain is 8 points', () => {
    const izumo = damage(base)
    expect(amphoreus(acheron, false).stats.CR - izumo.stats.CR).toBeCloseTo(0.08, 6)
  })

  it('for a wearer with a memosprite, the switch on adds 8% of its base SPD to its own SPD (the team buff reads the same SPD)', () => {
    const on = amphoreus(castorice, true)
    const off = amphoreus(castorice, false)
    expect(on.stats.SPD - off.stats.SPD).toBeCloseTo(0.08 * CASTORICE_BASE_SPD, 3)
  })

  it('a memosprite teammate does not switch the team buff on for a wearer with no memosprite: the wearer\'s own memosprite is the condition', () => {
    const on = amphoreus(acheron, true, [castorice])
    const off = amphoreus(acheron, false, [castorice])
    expect(on.stats.SPD).toBeCloseTo(off.stats.SPD, 9)
  })
})
