import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { Battle } from '../../battle/battle'
import { loadEnemyProfile } from '../../enemy/profile'
import {
  AlongThePassingShore,
  DanceDanceDance,
  EQUIPMENT,
  IzumoGensei,
  InertSalsotto,
  MusketeerOfWildWheat,
  PioneerDiverOfDeadWaters,
  resolveEquipment,
} from '../../equipment/index'
import { Acheron } from '../../kits/acheron'
import type { DamageRequest, KernelBuild, KernelUnit, ScannedBuild, ScannedRelic } from '../types'
import { FribbelsKernel } from './fribbelsKernel'
import { scannedRelicsByPart } from './scannedRelics'

/**
 * The equipment modules against the real Fribbels kernel (DESIGN.md, K4): each module's conditionals change
 * Fribbels' numbers the way the in-game text says, and what Fribbels does with an item that has no module.
 */

const SET = Sets.PioneerDiverOfDeadWaters
const build: KernelBuild = {
  relicSet1: SET,
  relicSet2: SET,
  ornamentSet: Sets.IzumoGenseiAndTakamaDivineRealm,
  body: Stats.CD,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const acheron: KernelUnit = { characterId: '1308', eidolon: 0, lightConeId: '23024', superimposition: 1 }

const kernel = new FribbelsKernel()

const damage = (overrides: Partial<DamageRequest> = {}) => kernel.actionDamage({ attacker: acheron, teammates: [], build, ...overrides })
const withSet = (value: number | boolean) => damage({ setConditionals: { [SET]: value } })
const withLightCone = (emptyBubblesDebuff: boolean) =>
  damage({ attacker: { ...acheron, lightConeConditionals: { emptyBubblesDebuff } } })

describe('what Fribbels does for an item with no module', () => {
  // These are why `resolveEquipment` refuses an unregistered item: left alone, Fribbels counts the effect as on.
  it('switches Along the Passing Shore\'s debuff on by default', () => {
    expect(damage().damage.BASIC).toBe(withLightCone(true).damage.BASIC)
    expect(damage().damage.BASIC).toBeGreaterThan(withLightCone(false).damage.BASIC!)
  })

  it('prices Pioneer Diver at its strongest state by default: 3 or more debuffs, doubled (menu value 4)', () => {
    expect(damage().damage.BASIC).toBe(withSet(4).damage.BASIC)
    expect(damage().damage.BASIC).toBeGreaterThan(withSet(2).damage.BASIC!)
    expect(damage().damage.BASIC).toBeGreaterThan(withSet(-1).damage.BASIC!)
  })

  it('has no conditionals at all for Dance! Dance! Dance!, so a key for it is refused', () => {
    expect(() => damage({ attacker: { ...acheron, lightConeId: '21018', lightConeConditionals: { anything: true } } })).toThrow(/Unknown conditional "anything"/)
    expect(() => damage({ attacker: { ...acheron, lightConeId: '21018' } })).not.toThrow()
  })
})

describe('Along the Passing Shore', () => {
  const on = withLightCone(true)
  const off = withLightCone(false)

  it('adds 24% DMG to every hit against a Fizzled target, and 24% more to the Ultimate (superimposition 1)', () => {
    // The bonus is additive with the attacker's other DMG%, so measure it as a change in the multiplier: the
    // Basic ATK gains (b + 0.24) / b and the Ultimate (b + 0.48) / b, so the Ultimate's gain is twice the Basic's.
    const gainBasic = on.damage.BASIC! / off.damage.BASIC! - 1
    const gainUlt = on.damage.ULT! / off.damage.ULT! - 1
    expect(gainBasic).toBeGreaterThan(0)
    expect(gainUlt / gainBasic).toBeCloseTo(2, 6)
  })

  it('changes nothing about the wearer\'s stats: the CRIT DMG is in the always-on part', () => {
    expect(on.stats).toEqual(off.stats)
  })

  it('through the battle: an action prices as Fribbels does with the switch the module says', () => {
    // Skill at 1 enemy, first action, no debuff on the enemy yet: the hit that applies Mirage Fizzle already gets the bonus (the
    // module says on, settled in game 2026-11-15), and no set debuffs (value -1).
    const battle = new Battle({
      members: [{
        key: 'acheron', kit: Acheron, eidolon: 0, affinitiveEidolon: false,
        stats: { maxHp: 1_000_000, def: 1000, baseSpd: 101 },
        kernel: { unit: acheron, build },
        equipment: resolveEquipment(acheron, build, EQUIPMENT),
      }],
      policy: [{ unit: 'acheron', use: 'skill', when: [] }, { unit: 'acheron', use: 'basic', when: [] }],
      profile: loadEnemyProfile('generic-moc'),
      enemyCount: 1,
      weaknesses: 'all',
      cycles: 1,
      start: { energy: 0.5, skillPoints: 3, techniques: false },
      kernel,
    })
    const dealt: number[] = []
    battle.timeline.bus.on('damageDealt', (d) => dealt.push(d.damage))
    battle.run()
    const direct = kernel.actionDamage({
      attacker: { ...acheron, lightConeConditionals: { emptyBubblesDebuff: true }, characterConditionals: {
        crimsonKnotStacks: 0, stygianResurgeHitsOnTarget: 0, thunderCoreStacks: 0, nihilityTeammatesBuff: true,
        e1EnemyDebuffed: false, e4UltVulnerability: true, e6UltBuffs: true,
      } },
      teammates: [],
      build,
      setConditionals: { [SET]: -1 },
    })
    expect(dealt[0]).toBeCloseTo(direct.damage.SKILL!, 6)
  })
})

describe('Pioneer Diver of Dead Waters', () => {
  const at = (value: number) => withSet(value)

  it('gives the 2-piece DMG from one debuff, then the CRIT DMG tiers: 8%, 12%, and 16%/24% doubled', () => {
    const [off, one, two, three, twoDoubled, threeDoubled] = [-1, 0, 1, 2, 3, 4].map(at)
    // The finished CRIT DMG stat does not include this set's CRIT DMG (Fribbels keeps it in a separate bucket), so
    // read it from the damage: damage is proportional to 1 + CR * (CD + extra) with everything else equal.
    const crit = (r: ReturnType<typeof at>) => 1 + r.stats.CR * r.stats.CD
    const extraCd = (r: ReturnType<typeof at>) => ((r.damage.BASIC! / one.damage.BASIC!) * crit(one) - 1) / r.stats.CR - r.stats.CD
    // -1 to 0: the 2-piece's 12% DMG only, and no CRIT change.
    // The 12% is added to the wearer's other DMG bonuses, so the damage grows by less than 12%.
    const gain = one.damage.BASIC! / off.damage.BASIC!
    expect(gain).toBeGreaterThan(1)
    expect(gain).toBeLessThan(1.12)
    expect(one.stats.CR).toBeCloseTo(off.stats.CR, 9)
    expect(extraCd(two)).toBeCloseTo(0.08, 3)
    expect(extraCd(three)).toBeCloseTo(0.12, 3)
    expect(extraCd(twoDoubled)).toBeCloseTo(0.16, 3)
    expect(extraCd(threeDoubled)).toBeCloseTo(0.24, 3)
    // The doubled tiers also double the 4% CRIT Rate.
    expect(twoDoubled.stats.CR - two.stats.CR).toBeCloseTo(0.04, 9)
    expect(threeDoubled.stats.CR - three.stats.CR).toBeCloseTo(0.04, 9)
    expect(two.stats.CR).toBeCloseTo(one.stats.CR, 9)
    expect(three.damage.BASIC!).toBeGreaterThan(two.damage.BASIC!)
    expect(threeDoubled.damage.BASIC!).toBeGreaterThan(twoDoubled.damage.BASIC!)
  })

  it('is not a Fribbels teammate set: a teamRelicSet for it is not how it reaches the kernel', () => {
    expect(() => damage({ setConditionals: { 'No Such Set': true } })).toThrow(/Unknown set "No Such Set"/)
  })
})

describe('the modules name what Fribbels names', () => {
  const sets: [string, string][] = [
    [PioneerDiverOfDeadWaters.name, Sets.PioneerDiverOfDeadWaters],
    [IzumoGensei.name, Sets.IzumoGenseiAndTakamaDivineRealm],
    [MusketeerOfWildWheat.name, Sets.MusketeerOfWildWheat],
    [InertSalsotto.name, Sets.InertSalsotto],
  ]
  it.each(sets)('set %s', (name, fribbels) => expect(name).toBe(fribbels))

  it('light cone ids are ids Fribbels has', () => {
    for (const lightConeId of [AlongThePassingShore.id, DanceDanceDance.id]) {
      expect(() => damage({ attacker: { ...acheron, lightConeId } })).not.toThrow()
    }
  })

  it('a scanned relic\'s set_id reads as the set the module is named for', () => {
    const scan = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../run/fixtures/scan-reliquary-archiver.json'), 'utf8')) as {
      source: string, relics: ScannedRelic[]
    }
    const head = scan.relics.find((r) => r.slot === 'Head')!
    for (const module of [PioneerDiverOfDeadWaters, MusketeerOfWildWheat]) {
      const one: ScannedBuild = { source: scan.source, relics: [{ ...head, set_id: module.setId! }] }
      const parsed = scannedRelicsByPart(one) as unknown as Record<string, { set: string } | undefined>
      expect(Object.values(parsed).filter(Boolean).map((r) => r!.set)).toEqual([module.name])
    }
    const orn = scan.relics.find((r) => r.slot === 'Planar Sphere')!
    for (const module of [IzumoGensei, InertSalsotto]) {
      const one: ScannedBuild = { source: scan.source, relics: [{ ...orn, set_id: module.setId! }] }
      const parsed = scannedRelicsByPart(one) as unknown as Record<string, { set: string } | undefined>
      expect(Object.values(parsed).filter(Boolean).map((r) => r!.set)).toEqual([module.name])
    }
  })
})
