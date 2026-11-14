import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BenchmarkBuild } from '../kernel/types'
import type { StandardBuildOverride } from '../scenario/types'
import { loadStandardBuild, parseStandardBuild, STANDARD_BUILD_DIR } from './load'
import { resolveStandardBuild } from './resolve'
import { physicalLimit } from './rules'
import { StandardBuildError } from './types'

/**
 * A stand-in for the kernel's out-of-combat SPD that follows the arithmetic in the files' notes:
 * base SPD + traces + the boots' 25.032 + the SPD rolls at the build's SPD roll value.
 */
const spdOf = (base: number, trace = 0) => (build: BenchmarkBuild) =>
  base + trace + (build.feet === 'SPD' ? 25.032 : 0) + build.substatRolls.SPD! * (build.speedRollValue ?? 2.6)
const acheronSpd = spdOf(101)
const cyreneSpd = spdOf(101, 9)

const acheron = () => loadStandardBuild('1308', 0)
const resolve = (override?: StandardBuildOverride, probe = acheronSpd) => resolveStandardBuild(acheron(), { ...(override && { override }), spd: probe })
const errorOf = (f: () => unknown): string[] => {
  try {
    f()
  } catch (cause) {
    if (cause instanceof StandardBuildError) return cause.problems
    throw cause
  }
  throw new Error('did not throw')
}

describe('a standard build with no override', () => {
  const { build, report } = resolve()

  it('becomes a benchmark build: the file\'s sets and main stats, and K14d\'s average roll values', () => {
    expect(build).toMatchObject({
      relicSet1: 'Pioneer Diver of Dead Waters',
      relicSet2: 'Pioneer Diver of Dead Waters',
      ornamentSet: 'Izumo Gensei and Takama Divine Realm',
      body: 'CRIT Rate',
      feet: 'SPD',
      planarSphere: 'Lightning DMG Boost',
      linkRope: 'ATK%',
      rollQuality: 0.9,
      speedRollValue: 2.3,
    })
  })

  it('has 2 fixed rolls on each of the 12 types plus the file\'s 24 distributed rolls', () => {
    expect(Object.keys(build.substatRolls)).toHaveLength(12)
    expect(build.substatRolls).toEqual({
      'ATK%': 2, ATK: 2, 'HP%': 2, HP: 2, 'DEF%': 2, DEF: 2, SPD: 4, 'CRIT Rate': 12, 'CRIT DMG': 14, 'Effect Hit Rate': 2, 'Effect RES': 2, 'Break Effect': 2,
    })
    expect(Object.values(build.substatRolls).reduce((a, b) => a + b, 0)).toBe(24 + 24)
  })

  it('reports the file\'s split, no moves, and the SPD against the target', () => {
    expect(report.path).toBe('file')
    expect(report.moves).toEqual([])
    expect(report.swaps).toEqual([])
    expect(report.distributed).toMatchObject({ SPD: 2, 'CRIT DMG': 12, 'CRIT Rate': 10 })
    expect(report.totals).toMatchObject({ SPD: 4, 'CRIT DMG': 14, 'CRIT Rate': 12, 'ATK%': 2 })
    expect(report.mainStats).toEqual({ Head: 'HP', Hands: 'ATK', Body: 'CRIT Rate', Feet: 'SPD', 'Planar Sphere': 'Lightning DMG Boost', 'Link Rope': 'ATK%' })
    expect(report.spd?.target).toBe(133.34)
    expect(report.spd?.outOfCombat).toBeCloseTo(135.232, 9)
    expect(report.spd?.missedBy).toBeUndefined()
    expect(report.file).toMatch(/1308\.json$/)
  })

  it('works without an SPD probe, and says nothing about SPD then', () => {
    expect(resolveStandardBuild(acheron()).report.spd).toBeUndefined()
  })
})

describe('a main-stat swap re-splits by the published rule (K14c)', () => {
  it('Acheron to a CRIT DMG body: 2 rolls move from CRIT DMG to CRIT Rate', () => {
    const { build, report } = resolve({ mainStats: { Body: 'CRIT DMG' } })
    expect(report.path).toBe('re-split')
    expect(report.moves).toEqual([{ from: 'CRIT DMG', to: 'CRIT Rate', rolls: 2 }])
    expect(report.moveText).toEqual(['2 CRIT DMG -> CRIT Rate'])
    expect(report.swaps).toEqual([{ slot: 'Body', from: 'CRIT Rate', to: 'CRIT DMG' }])
    expect(report.distributed).toMatchObject({ SPD: 2, 'CRIT DMG': 10, 'CRIT Rate': 12 })
    expect(build.body).toBe('CRIT DMG')
    expect(build.substatRolls).toMatchObject({ 'CRIT DMG': 12, 'CRIT Rate': 14 })
  })

  it('a swap that breaks no cap moves nothing and keeps the file\'s split', () => {
    const { report } = resolve({ mainStats: { 'Planar Sphere': 'ATK%' } })
    expect(report.path).toBe('file')
    expect(report.moves).toEqual([])
    expect(report.distributed).toMatchObject({ 'CRIT DMG': 12, 'CRIT Rate': 10 })
    expect(report.swaps).toEqual([{ slot: 'Planar Sphere', from: 'Lightning DMG Boost', to: 'ATK%' }])
  })

  it('a swap to the value the file already has is no swap', () => {
    const { report } = resolve({ mainStats: { Body: 'CRIT Rate' } })
    expect(report.swaps).toEqual([])
    expect(report.path).toBe('file')
  })

  it('fills the stats below the overflowing one in turn, then stops at the first with room', () => {
    // A file with an ATK% body, so that CRIT Rate and CRIT DMG both have cap 12 to start with.
    const file = parseStandardBuild(
      { ...loadStandardBuildJson(), main_stats: { Body: 'ATK%', Feet: 'SPD', 'Planar Sphere': 'Lightning DMG Boost', 'Link Rope': 'ATK%' },
        distributed: { rolls: { SPD: 2, 'CRIT DMG': 12, 'CRIT Rate': 6, 'ATK%': 2, ATK: 2 }, priority: ['CRIT DMG', 'CRIT Rate', 'ATK%', 'ATK'] } },
      'inline.json',
    )
    // Body to CRIT DMG: CRIT DMG cap 10 (excess 2). CRIT Rate has room 12 - 6 = 6 and takes both.
    const a = resolveStandardBuild(file, { override: { mainStats: { Body: 'CRIT DMG' } } })
    expect(a.report.moves).toEqual([{ from: 'CRIT DMG', to: 'CRIT Rate', rolls: 2 }])
    // The same, with less room in CRIT Rate: it has 11 of 12.
    const tight = parseStandardBuild(
      { ...loadStandardBuildJson(), main_stats: { Body: 'ATK%', Feet: 'SPD', 'Planar Sphere': 'Lightning DMG Boost', 'Link Rope': 'ATK%' },
        distributed: { rolls: { SPD: 1, 'CRIT DMG': 12, 'CRIT Rate': 11 }, priority: ['CRIT DMG', 'CRIT Rate', 'ATK%', 'ATK'] } },
      'inline.json',
    )
    const b = resolveStandardBuild(tight, { override: { mainStats: { Body: 'CRIT DMG' } } })
    // CRIT Rate has room for 1; the next in the list with room is ATK% (cap 10: only the Rope has ATK% as a main stat).
    expect(b.report.moves).toEqual([
      { from: 'CRIT DMG', to: 'CRIT Rate', rolls: 1 },
      { from: 'CRIT DMG', to: 'ATK%', rolls: 1 },
    ])
    expect(b.report.moveText).toEqual(['1 CRIT DMG -> CRIT Rate', '1 CRIT DMG -> ATK%'])
    expect(b.report.distributed).toMatchObject({ 'CRIT DMG': 10, 'CRIT Rate': 12, 'ATK%': 1 })
  })

  it('a stat not in the priority list never receives rolls: leftover rolls are an error naming the stat', () => {
    const file = parseStandardBuild(
      { ...loadStandardBuildJson(), main_stats: { Body: 'ATK%', Feet: 'SPD', 'Planar Sphere': 'Lightning DMG Boost', 'Link Rope': 'ATK%' },
        distributed: { rolls: { 'CRIT DMG': 12, 'CRIT Rate': 12 }, priority: ['CRIT DMG', 'CRIT Rate'] } },
      'inline.json',
    )
    const problems = errorOf(() => resolveStandardBuild(file, { override: { mainStats: { Body: 'CRIT DMG' } } }))
    expect(problems).toEqual([expect.stringMatching(/^inline\.json: the re-split cannot place 2 of CRIT DMG's 12 distributed rolls: .*cap is 10.*\(CRIT Rate\) is full\. Give the split yourself in standard_build\.distributed$/)])
  })
})

describe('an explicit split replaces the file\'s whole, with no re-split (K14c)', () => {
  const explicit = { SPD: 2, 'CRIT DMG': 6, 'CRIT Rate': 12, 'ATK%': 4 }

  it('is used as given: no merging, no moves', () => {
    const { report, build } = resolve({ mainStats: { Body: 'CRIT DMG' }, distributed: explicit })
    expect(report.path).toBe('explicit')
    expect(report.moves).toEqual([])
    expect(report.distributed).toMatchObject(explicit)
    expect(report.distributed['CRIT Rate']).toBe(12)
    expect(build.substatRolls).toMatchObject({ 'CRIT DMG': 8, 'CRIT Rate': 14, 'ATK%': 6, SPD: 4 })
  })

  it('without main stats, it is checked against the file\'s own', () => {
    expect(resolve({ distributed: { SPD: 2, 'CRIT DMG': 12, 'CRIT Rate': 10 } }).report.path).toBe('explicit')
    expect(errorOf(() => resolve({ distributed: { SPD: 2, 'CRIT DMG': 6, 'CRIT Rate': 12, 'ATK%': 4 } })))
      .toEqual([expect.stringMatching(/standard_build\.distributed gives CRIT Rate 12 rolls, over its cap of 10 with the main stats Body CRIT Rate/)])
  })

  it('that does not add up to 24 is an error', () => {
    expect(errorOf(() => resolve({ distributed: { SPD: 2, 'CRIT DMG': 10, 'CRIT Rate': 10 } })))
      .toEqual([expect.stringMatching(/1308\.json: rule \(a\) 24 distributed rolls: standard_build\.distributed adds up to 22, not 24$/)])
  })

  it('that breaks a cap is an error naming the stat, its rolls and its cap, never fixed', () => {
    expect(errorOf(() => resolve({ mainStats: { Body: 'CRIT DMG' }, distributed: { SPD: 2, 'CRIT DMG': 12, 'CRIT Rate': 10 } })))
      .toEqual([expect.stringMatching(/1308\.json: rule \(b\) per-stat cap: standard_build\.distributed gives CRIT DMG 12 rolls, over its cap of 10 with the main stats Body CRIT DMG/)])
  })

  it('that names an unknown stat or a bad count is an error', () => {
    expect(errorOf(() => resolve({ distributed: { Luck: 24 } }))).toEqual([expect.stringContaining('"Luck" is not a substat type')])
    expect(errorOf(() => resolve({ distributed: { SPD: 2.5, 'CRIT DMG': 21.5 } }))).toEqual([
      expect.stringContaining('SPD must be a whole number of rolls'),
      expect.stringContaining('CRIT DMG must be a whole number of rolls'),
    ])
    expect(errorOf(() => resolve({ distributed: { SPD: -1, 'CRIT DMG': 25 } }))[0]).toContain('SPD must be a whole number')
  })
})

describe('main stats that cannot be given are errors', () => {
  it('a slot that is not free, and a stat not allowed in a slot', () => {
    expect(errorOf(() => resolve({ mainStats: { Head: 'HP%' } as never })))
      .toEqual([expect.stringContaining('"Head" is not a slot whose main stat can change')])
    expect(errorOf(() => resolve({ mainStats: { Feet: 'CRIT Rate' } })))
      .toEqual([expect.stringMatching(/Feet cannot have the main stat "CRIT Rate" \(allowed: HP%, ATK%, DEF%, SPD\)/)])
  })
})

describe('the SPD rule (K14e): SPD passes its cap only as far as the target needs', () => {
  const cyrene = () => loadStandardBuild('1415', 0)
  const resolveCyrene = (override?: StandardBuildOverride) =>
    resolveStandardBuild(cyrene(), { ...(override && { override }), spd: cyreneSpd })

  it("Cyrene's file passes the plain cap of 10 with 18 SPD rolls, the fewest that reach 180", () => {
    const { report } = resolveCyrene()
    expect(report.distributed.SPD).toBe(18)
    expect(report.spd?.outOfCombat).toBeCloseTo(181.032, 9)
    // 17 rolls make 178.732: the target needs 18.
    expect(cyreneSpd({ ...resolveCyrene().build, substatRolls: { SPD: 2 + 17 } })).toBeCloseTo(178.732, 9)
  })

  it('one roll more than the target needs is an error, and so is any SPD roll over the cap when the target is none', () => {
    const split = { SPD: 19, 'CRIT DMG': 3, 'CRIT Rate': 2 }
    expect(errorOf(() => resolveCyrene({ distributed: split })))
      .toEqual([expect.stringMatching(/rule \(f\) SPD cap: standard_build\.distributed gives SPD 19 distributed rolls, over the cap of 10; SPD may pass the cap only as far as reaching spd_target 180, which takes 18 with these main stats/)])
    const tribbie = loadStandardBuild('1403', 0)
    const problems = errorOf(() => resolveStandardBuild(tribbie, { override: { distributed: { SPD: 11, 'CRIT DMG': 10, 'CRIT Rate': 3 } }, spd: spdOf(96) }))
    expect(problems).toEqual([expect.stringMatching(/over the cap of 10; SPD may pass the cap only as far as the build needs for an SPD target, and this file has none/)])
  })

  it('on boots that are not SPD, the cap is 12 and the target allows more: 13 rolls reach 133.34, 14 are one too many', () => {
    const noBoots = { Feet: 'ATK%' }
    expect(resolve({ mainStats: noBoots, distributed: { SPD: 13, 'CRIT DMG': 11 } }).report.distributed.SPD).toBe(13)
    expect(errorOf(() => resolve({ mainStats: noBoots, distributed: { SPD: 14, 'CRIT DMG': 10 } })))
      .toEqual([expect.stringMatching(/gives SPD 14 distributed rolls, over the cap of 12; .*reaching spd_target 133.34, which takes 13 with these main stats/)])
  })

  it('the physical limit is 6 rolls on each relic that does not have SPD as its main stat', () => {
    const mains = { Body: 'CRIT Rate', Feet: 'SPD', 'Planar Sphere': 'Lightning DMG Boost', 'Link Rope': 'ATK%' }
    expect(physicalLimit('SPD', mains)).toBe(30)
    expect(physicalLimit('SPD', { ...mains, Feet: 'ATK%' })).toBe(36)
    // 24 distributed + 2 fixed can never pass it, so no build reaches this limit today: it is a guard.
  })

  it('without a probe the plain cap does not apply to SPD, only the physical limit', () => {
    expect(resolveStandardBuild(cyrene()).report.distributed.SPD).toBe(18)
  })
})

describe('swapping the SPD boots away (K14f): the rolls stay and the run says how far short', () => {
  it('Acheron on ATK% boots: SPD rolls unchanged, SPD down by the boots, target missed by the difference', () => {
    const { report, build } = resolve({ mainStats: { Feet: 'ATK%' } })
    expect(report.path).toBe('file')
    expect(report.distributed.SPD).toBe(2)
    expect(build.feet).toBe('ATK%')
    expect(report.spd?.outOfCombat).toBeCloseTo(135.232 - 25.032, 9)
    expect(report.spd?.missedBy).toBeCloseTo(133.34 - 110.2, 9)
    expect(report.swaps).toEqual([{ slot: 'Feet', from: 'SPD', to: 'ATK%' }])
  })

  it('and SPD boots onto a build without them are not re-solved either', () => {
    const noBoots = resolveStandardBuild(acheron(), { override: { mainStats: { Feet: 'ATK%' } }, spd: acheronSpd })
    expect(noBoots.build.substatRolls.SPD).toBe(4)
    // The comparison "what do SPD boots buy": same rolls, +25.032.
    const boots = resolve()
    expect(boots.report.spd!.outOfCombat - noBoots.report.spd!.outOfCombat).toBeCloseTo(25.032, 9)
  })

})

/** The Acheron file as JSON, for building variants. */
function loadStandardBuildJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(STANDARD_BUILD_DIR, '1308.json'), 'utf8'))
}
