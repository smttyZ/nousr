import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadStandardBuild, parseStandardBuild, readStandardBuildFile, STANDARD_BUILD_DIR } from './load'
import { StandardBuildError } from './types'

const read = (id: string) => JSON.parse(readFileSync(join(STANDARD_BUILD_DIR, `${id}.json`), 'utf8')) as Record<string, any>
/** Acheron's file, changed by `edit`. */
const acheron = (edit: (file: Record<string, any>) => void = () => {}) => {
  const file = read('1308')
  edit(file)
  return file
}
const problemsOf = (input: unknown): string[] => {
  try {
    parseStandardBuild(input, 'test-file.json')
  } catch (cause) {
    if (cause instanceof StandardBuildError) return cause.problems
    throw cause
  }
  return []
}

describe('the shipped standard-build files', () => {
  const ids = readdirSync(STANDARD_BUILD_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))

  it('are 14, and every one loads under every rule', () => {
    expect(ids).toHaveLength(14)
    for (const id of ids) {
      const file = readStandardBuildFile(join(STANDARD_BUILD_DIR, `${id}.json`))
      expect(file.character).toBe(id)
      expect(Object.values(file.distributed).reduce((a, b) => a + b, 0)).toBe(24)
    }
  })

  it('are found by character and ability version', () => {
    expect(loadStandardBuild('1308', 0).name).toBe('Acheron')
    expect(loadStandardBuild('1006', 1).name).toMatch(/^Silver Wolf/)
  })

  it('return the file as a typed build', () => {
    const build = loadStandardBuild('1308', 0)
    expect(build.relicSets).toEqual({ fourPiece: { setId: '117', name: 'Pioneer Diver of Dead Waters' } })
    expect(build.ornamentSet).toEqual({ setId: '314', name: 'Izumo Gensei and Takama Divine Realm' })
    expect(build.mainStats).toEqual({ Body: 'CRIT Rate', Feet: 'SPD', 'Planar Sphere': 'Lightning DMG Boost', 'Link Rope': 'ATK%' })
    expect(build.spdTarget.value).toBe(133.34)
    expect(build.distributed).toMatchObject({ SPD: 2, 'CRIT DMG': 12, 'CRIT Rate': 10, 'ATK%': 0, HP: 0 })
    expect(Object.keys(build.distributed)).toHaveLength(12)
    expect(build.priority).toEqual(['CRIT DMG', 'CRIT Rate', 'ATK%', 'ATK'])
  })

  it('a two-piece pair loads as two sets', () => {
    const files = ids.map((id) => loadStandardBuild(id, read(id).ability_version))
    for (const f of files) {
      if ('twoPiece' in f.relicSets) expect(f.relicSets.twoPiece[0].name).not.toBe(f.relicSets.twoPiece[1].name)
    }
  })
})

describe('loading a file by character', () => {
  it('stops for a character with no file, or the wrong ability version, saying what exists', () => {
    expect(() => loadStandardBuild('9999', 0)).toThrow(/no standard build for character 9999, ability_version 0 in /)
    expect(() => loadStandardBuild('1308', 1)).toThrow(/no standard build for character 1308, ability_version 1.*that character has: ability_version 0/)
  })

  it('names the file when it cannot be read or is not JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nousr-standard-'))
    writeFileSync(join(dir, '1308.json'), '{ nope')
    expect(() => loadStandardBuild('1308', 0, { dir })).toThrow(/no standard build for character 1308/)
    expect(() => readStandardBuildFile(join(dir, '1308.json'))).toThrow(/1308\.json: cannot read: /)
  })

  it('finds a file by what it declares, not its name, and refuses two that declare the same', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nousr-standard-'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'acheron-old.json'), JSON.stringify(acheron((f) => { f.ability_version = 1 })))
    writeFileSync(join(dir, '1308.json'), JSON.stringify(acheron()))
    expect(loadStandardBuild('1308', 1, { dir }).source).toMatch(/acheron-old\.json$/)
    expect(loadStandardBuild('1308', 0, { dir }).source).toMatch(/1308\.json$/)
    writeFileSync(join(dir, 'copy.json'), JSON.stringify(acheron((f) => { f.ability_version = 1 })))
    expect(() => loadStandardBuild('1308', 1, { dir })).toThrow(/both declare character 1308, ability_version 1/)
  })
})

describe('the rules of a standard-build file, each violation named with the file', () => {
  it('accepts the unchanged file', () => {
    expect(problemsOf(acheron())).toEqual([])
  })

  it('the schema: an unknown key, a wrong stat name, a missing part', () => {
    expect(problemsOf(acheron((f) => { f.extra = 1 }))).toEqual([expect.stringMatching(/^test-file\.json: \(top level\): must NOT have additional properties \("extra"\)/)])
    expect(problemsOf(acheron((f) => { f.distributed.rolls['Crit Rate'] = 1 }))[0]).toMatch(/^test-file\.json: /)
    expect(problemsOf(acheron((f) => { delete f.spd_target }))[0]).toMatch(/^test-file\.json: .*spd_target/)
  })

  it('(a) the distributed rolls add up to 24', () => {
    const problems = problemsOf(acheron((f) => { f.distributed.rolls['CRIT DMG'] = 11 }))
    expect(problems).toEqual(['test-file.json: rule (a) 24 distributed rolls: distributed.rolls add up to 23, not 24'])
    expect(problemsOf(acheron((f) => { f.distributed.rolls.SPD = 3 }))[0]).toMatch(/add up to 25/)
  })

  it('(b) a stat over its cap, which counts the main stats', () => {
    // CRIT Rate body: the CRIT Rate cap is 10. 11 CRIT Rate with 11 CRIT DMG is 24 in all.
    const problems = problemsOf(acheron((f) => { f.distributed.rolls['CRIT Rate'] = 11; f.distributed.rolls['CRIT DMG'] = 11 }))
    expect(problems).toEqual([
      'test-file.json: rule (b) per-stat cap: CRIT Rate has 11 distributed rolls, over its cap of 10 (2 x the 5 relics whose main stat is not CRIT Rate, with these main stats)',
    ])
    // Without a CRIT Rate main stat the same split is legal.
    expect(problemsOf(acheron((f) => {
      f.distributed.rolls['CRIT Rate'] = 11
      f.distributed.rolls['CRIT DMG'] = 11
      f.main_stats.Body = 'ATK%'
    }))).toEqual([])
    // Head is HP and Hands is ATK: flat HP and flat ATK cap at 10.
    const flat = problemsOf(acheron((f) => { f.distributed.rolls.ATK = 11; f.distributed.rolls['CRIT DMG'] = 1 }))
    expect(flat).toEqual([expect.stringContaining('rule (b) per-stat cap: ATK has 11 distributed rolls, over its cap of 10')])
    // Four ATK% main stats leave two relics that can roll it: cap 4.
    const three = problemsOf(acheron((f) => {
      f.main_stats = { Body: 'ATK%', Feet: 'ATK%', 'Planar Sphere': 'ATK%', 'Link Rope': 'ATK%' }
      f.distributed.rolls = { 'ATK%': 5, 'CRIT DMG': 7, 'CRIT Rate': 12 }
    }))
    expect(three).toEqual([expect.stringContaining('ATK% has 5 distributed rolls, over its cap of 4')])
  })

  it('(b) leaves SPD to the SPD rule: a file with SPD over the plain cap is not refused here', () => {
    expect(problemsOf(read('1415'))).toEqual([]) // Cyrene: 18 SPD rolls, cap 10
  })

  it('(c) two 2-piece sets must be different sets', () => {
    const two = (a: object, b: object) => acheron((f) => {
      f.relic_sets = { two_piece: [a, b] }
    })
    const set = { set_id: '117', name: 'Pioneer Diver of Dead Waters' }
    expect(problemsOf(two(set, { ...set, notes: 'again' }))).toEqual([
      'test-file.json: rule (c) two different 2-piece sets: both 2-piece sets are Pioneer Diver of Dead Waters (117)',
    ])
    expect(problemsOf(two(set, { set_id: '108', name: 'Genius of Brilliant Stars' }))).toEqual([])
  })

  it('(d) set id and name agree with the game data', () => {
    expect(problemsOf(acheron((f) => { f.relic_sets.four_piece.name = 'Genius of Brilliant Stars' }))).toEqual([
      'test-file.json: rule (d) set id and name: set_id "117" is "Pioneer Diver of Dead Waters" in the game data, but the file calls it "Genius of Brilliant Stars"',
    ])
    expect(problemsOf(acheron((f) => { f.ornament_set.set_id = '999' }))).toEqual([
      expect.stringContaining('rule (d) set id and name: set_id "999" (Izumo Gensei and Takama Divine Realm) is not a set in the game data'),
    ])
  })

  it('(e) the priority covers every rolled stat, and never lists SPD or a stat twice', () => {
    expect(problemsOf(acheron((f) => { f.distributed.priority = ['CRIT DMG'] }))).toEqual([
      'test-file.json: rule (e) priority covers every rolled stat: CRIT Rate has 10 distributed rolls but is not in distributed.priority',
    ])
    // SPD has rolls and is not in the priority: that is the rule, not an error.
    expect(problemsOf(acheron())).toEqual([])
    expect(problemsOf(acheron((f) => { f.distributed.priority = ['CRIT DMG', 'CRIT Rate', 'SPD'] }))[0]).toMatch(/^test-file\.json: /)
    expect(problemsOf(acheron((f) => { f.distributed.priority = ['CRIT DMG', 'CRIT Rate', 'CRIT DMG'] }))[0]).toMatch(/^test-file\.json: .*duplicate items/)
  })

  it('reports every broken rule together', () => {
    const problems = problemsOf(acheron((f) => {
      f.distributed.rolls['CRIT DMG'] = 11
      f.relic_sets.four_piece.name = 'Wrong'
      f.distributed.priority = ['CRIT DMG']
    }))
    expect(problems.map((p) => /rule \((.)\)/.exec(p)![1]).sort()).toEqual(['a', 'd', 'e'])
  })
})
