// Tests for the committed level tables (DESIGN.md K20): data/levels/*.json, written by
// tools/gamedata/level-tables.mjs. They run on the committed files, so they need no game-data download;
// the regeneration check at the end runs only when .gamedata/ is present.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import schema from '../../schema/level-table.schema.json' with { type: 'json' }

const ROOT = resolve(import.meta.dirname, '../..')
const DIR = resolve(ROOT, 'data/levels')
const GAMEDATA = resolve(ROOT, '.gamedata')

// The v1 roster: [character id, ability_version]. Keep in step with ROSTER in the generator.
const ROSTER: [string, number][] = [
  ['1308', 0], ['1204', 0], ['1006', 1], ['1004', 1], ['1414', 0], ['1208', 0], ['1313', 0],
  ['1403', 0], ['1512', 0], ['1407', 0], ['1415', 0], ['1409', 0], ['1401', 0], ['1405', 0],
]
const fileFor = (id: string, version: number) => `${id}${version ? `_v${version}` : ''}.json`

interface Skill { levels: number[][] }
interface Ability { point: number; tree_max_level: number; eidolon_levels: { eidolon: number; levels: number }[]; skills: Record<string, Skill> }
interface Trace { key: string; point: number; requires: number[]; stat?: string; value?: number }
interface Table {
  game_version: string; game_data_commit: string; character: string; ability_version: number
  abilities: Record<string, Ability>; major_traces: Trace[]; minor_traces: Trace[]
}
const read = (name: string) => JSON.parse(readFileSync(resolve(DIR, name), 'utf8')) as Table
const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
const validate = new Ajv2020({ allErrors: true }).compile(schema)

describe('level tables: files and schema', () => {
  it('has exactly the roster files', () => {
    expect(files).toEqual(ROSTER.map(([id, v]) => fileFor(id, v)).sort())
  })

  it.each(files)('%s validates against schema/level-table.schema.json', (name) => {
    const table = read(name)
    expect(validate(table), JSON.stringify(validate.errors)).toBe(true)
    expect(name).toBe(fileFor(table.character, table.ability_version))
  })

  it('rejects unknown keys and bad shapes', () => {
    const good = read('1415.json')
    expect(validate({ ...good, extra: 1 })).toBe(false)
    expect(validate({ ...good, character: '15' })).toBe(false)
    expect(validate({ ...good, minor_traces: good.minor_traces.slice(1) })).toBe(false)
    const withText = structuredClone(good)
    ;(withText.abilities.skill as unknown as Record<string, unknown>).name = 'Zone'
    expect(validate(withText)).toBe(false)
  })

  it('holds no game text: every string value is an id, a key or a hash', () => {
    const strings: string[] = []
    const walk = (x: unknown) => {
      if (typeof x === 'string') strings.push(x)
      else if (Array.isArray(x)) x.forEach(walk)
      else if (x && typeof x === 'object') Object.values(x).forEach(walk)
    }
    for (const f of files) walk(read(f))
    for (const s of strings) expect(s).toMatch(/^([A-Za-z0-9_.-]{1,40}|[0-9a-f]{40})$/)
  })
})

describe('level tables: internal consistency', () => {
  it.each(files)('%s has a row for every reachable level of every skill', (name) => {
    const table = read(name)
    for (const [kind, ability] of Object.entries(table.abilities)) {
      const bonus = ability.eidolon_levels.reduce((n, e) => n + e.levels, 0)
      for (const [id, skill] of Object.entries(ability.skills)) {
        expect(skill.levels.length, `${name} ${kind} ${id}`).toBeGreaterThanOrEqual(ability.tree_max_level + bonus)
        // A skill's parameters keep the same count at every level.
        expect(new Set(skill.levels.map((l) => l.length)).size, `${name} ${kind} ${id}`).toBe(1)
      }
    }
  })

  it.each(files)('%s has the four basic abilities and a closed trace tree', (name) => {
    const table = read(name)
    for (const k of ['basic', 'skill', 'ult', 'talent']) expect(table.abilities[k], `${name} ${k}`).toBeDefined()
    const points = new Set([...table.major_traces, ...table.minor_traces].map((t) => t.point))
    expect(points.size).toBe(13)
    for (const t of [...table.major_traces, ...table.minor_traces]) for (const r of t.requires) expect(points.has(r)).toBe(true)
    expect(table.major_traces.map((t) => t.key).sort()).toEqual(['B1', 'B2', 'B3'])
    expect(table.minor_traces.map((t) => t.key).sort()).toEqual(['S1', 'S10', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'])
  })

  it('memosprite abilities exist exactly for the Remembrance characters of the roster', () => {
    const memo = files.filter((f) => read(f).abilities.memo_skill).map((f) => read(f).character)
    expect(memo).toEqual(['1407', '1409', '1415', '1512'])
  })
})

describe('level tables: values against the in-game text', () => {
  // Read from the game's text with `node tools/gamedata/kit-text.mjs <id>` (Lv10 and Lv12 lines).
  it('Acheron Skill: 160% at level 10, 176% at level 12, +2 levels from E5', () => {
    const skill = read('1308.json').abilities.skill!
    expect(skill.tree_max_level).toBe(10)
    expect(skill.eidolon_levels).toEqual([{ eidolon: 5, levels: 2 }])
    expect(skill.skills['130802']!.levels[9]![0]).toBeCloseTo(1.6, 9)
    expect(skill.skills['130802']!.levels[11]![0]).toBeCloseTo(1.76, 9)
  })

  it('Cyrene Skill: Zone 12% at level 1, 24% at level 10, 26.4% at level 12', () => {
    const levels = read('1415.json').abilities.skill!.skills['141502']!.levels
    expect(levels[0]![0]).toBeCloseTo(0.12, 9)
    expect(levels[9]![0]).toBeCloseTo(0.24, 9)
    expect(levels[11]![0]).toBeCloseTo(0.264, 9)
  })

  it('Cyrene eidolons: E3 raises Ultimate, Talent and the memosprite skill; E5 Basic, Skill and the memosprite talent', () => {
    const a = read('1415.json').abilities
    expect(a.ult!.eidolon_levels).toEqual([{ eidolon: 3, levels: 2 }])
    expect(a.talent!.eidolon_levels).toEqual([{ eidolon: 3, levels: 2 }])
    expect(a.memo_skill!.eidolon_levels).toEqual([{ eidolon: 3, levels: 1 }])
    expect(a.basic!.eidolon_levels).toEqual([{ eidolon: 5, levels: 1 }])
    expect(a.skill!.eidolon_levels).toEqual([{ eidolon: 5, levels: 2 }])
    expect(a.memo_talent!.eidolon_levels).toEqual([{ eidolon: 5, levels: 1 }])
  })

  it('a buffed kit has its own skill ids and trace ids', () => {
    const t = read('1006_v1.json')
    expect(t.ability_version).toBe(1)
    expect(Object.keys(t.abilities.skill!.skills)).toEqual(['1100602'])
    expect(t.minor_traces[0]!.point).toBe(11006201)
  })
})

// Fribbels ships the game's trace tree per character (vendor/hsr-optimizer game_data.json) with its own
// stat names. Our minor traces must agree with it on id, stat and value, and on every prerequisite it keeps.
describe('level tables: minor traces against Fribbels game data', () => {
  const STAT: Record<string, string> = {
    AttackAddedRatio: 'ATK%', DefenceAddedRatio: 'DEF%', HPAddedRatio: 'HP%', SpeedDelta: 'SPD',
    CriticalChanceBase: 'CRIT Rate', CriticalDamageBase: 'CRIT DMG', StatusResistanceBase: 'Effect RES',
    StatusProbabilityBase: 'Effect Hit Rate', BreakDamageAddedRatioBase: 'Break Effect',
    ThunderAddedRatio: 'Lightning DMG Boost', IceAddedRatio: 'Ice DMG Boost', WindAddedRatio: 'Wind DMG Boost',
    QuantumAddedRatio: 'Quantum DMG Boost', FireAddedRatio: 'Fire DMG Boost', PhysicalAddedRatio: 'Physical DMG Boost',
    ImaginaryAddedRatio: 'Imaginary DMG Boost',
  }
  interface FNode { id: string; stat: string; value: number; pre: string | null; children: FNode[] }
  const game = JSON.parse(readFileSync(resolve(ROOT, 'vendor/hsr-optimizer/src/data/game_data.json'), 'utf8')) as {
    characters: Record<string, { traceTree: FNode[] }>
  }
  it.each(files)('%s', (name) => {
    const table = read(name)
    const entry = game.characters[`${table.character}${table.ability_version ? `b${table.ability_version}` : ''}`]
    expect(entry, `Fribbels has no entry for ${name}`).toBeDefined()
    const theirs = new Map<string, FNode>()
    const walk = (ns: FNode[]) => ns.forEach((n) => { theirs.set(n.id, n); walk(n.children) })
    walk(entry!.traceTree)
    expect(theirs.size).toBe(10)
    for (const m of table.minor_traces) {
      const f = theirs.get(String(m.point))
      expect(f, `${name} ${m.key} ${m.point}`).toBeDefined()
      expect(STAT[m.stat!], `${name} unmapped stat ${m.stat}`).toBe(f!.stat)
      // The game stores float32 values (0.026999999); Fribbels rounds them (0.027).
      expect(m.value!).toBeCloseTo(f!.value, 6)
      if (f!.pre !== null) expect(m.requires).toContain(Number(f!.pre))
    }
  })
})

// Regeneration is byte-identical to the committed files. Skipped without the game-data download.
describe.skipIf(!existsSync(resolve(GAMEDATA, 'SOURCE.txt')))('level tables: regeneration from .gamedata', () => {
  it('rebuilds every committed file byte for byte', async () => {
    const gen = (await import(pathToFileURL(resolve(ROOT, 'tools/gamedata/level-tables.mjs')).href)) as {
      loadDb: (dir: string) => unknown
      buildTable: (db: unknown, id: number, version: number) => unknown
      stringify: (x: unknown) => string
    }
    const db = gen.loadDb(GAMEDATA)
    for (const [id, version] of ROSTER) {
      const text = `${gen.stringify(gen.buildTable(db, Number(id), version))}\n`
      expect(text, fileFor(id, version)).toBe(readFileSync(resolve(DIR, fileFor(id, version)), 'utf8'))
    }
  }, 60_000)
})
