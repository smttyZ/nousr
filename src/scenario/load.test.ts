import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadScenarioFile, parseScenario, ScenarioError } from './load'
import type { AccountScan, ScanRelic, ScenarioFile } from './types'

const EXAMPLE = resolve(import.meta.dirname, '../../examples/acheron-welt-vs-tribbie.scenario.json')

const relic = (uid: string, slot: ScanRelic['slot'], location: string): ScanRelic => ({
  set_id: '117',
  name: 'test relic',
  slot,
  rarity: 5,
  level: 15,
  mainstat: slot === 'Head' ? 'HP' : 'ATK',
  substats: [{ key: 'SPD', value: 4.6 }, { key: 'CRIT Rate_', value: 5.8 }],
  location,
  _uid: uid,
})

const scan = (): AccountScan => ({
  source: 'reliquary_archiver',
  build: 'v0.8.0',
  version: 4,
  characters: [
    { id: '1308', eidolon: 1 },
    { id: '1006', eidolon: 2, ability_version: 1 },
    { id: '1414', eidolon: 0 },
  ],
  light_cones: [
    { id: '23024', superimposition: 1, location: '1308' },
    { id: '21001', superimposition: 5, location: '1006' },
    { id: '20000', superimposition: 3, location: '' },
  ],
  relics: [
    relic('r1', 'Head', '1308'),
    relic('r2', 'Hands', '1308'),
    relic('r3', 'Head', '1006'),
    relic('r4', 'Head', ''),
    relic('r5', 'Body', ''),
  ],
})

/** The smallest scenario the schema accepts, with no account. */
const minimal = (): ScenarioFile => ({
  format: 'nousr-scenario',
  version: 1,
  game_version: '4.7',
  battle: { mode: 'moc', cycles: 3 },
  enemies: { profile: 'generic-moc', counts: [1] },
  teams: [
    {
      id: 'solo',
      members: [
        { key: 'acheron', character: '1308', eidolon: 0, light_cone: { id: '23024', superimposition: 1 } },
      ],
      policy: [{ unit: 'acheron', use: 'basic' }],
    },
  ],
})

/** A scenario whose members lean on the account scan. */
const withAccount = (): ScenarioFile => ({
  ...minimal(),
  account: scan(),
  teams: [
    {
      id: 'duo',
      members: [
        { key: 'acheron', character: '1308' },
        { key: 'silver_wolf', character: '1006' },
      ],
      policy: [
        { unit: 'acheron', use: 'basic' },
        { unit: 'silver_wolf', use: 'basic' },
      ],
    },
  ],
})

function problemsOf(input: unknown, options?: Parameters<typeof parseScenario>[1]): string[] {
  try {
    parseScenario(input, options)
  } catch (error) {
    if (error instanceof ScenarioError) return error.problems
    throw error
  }
  return []
}

describe('the example scenario', () => {
  it('loads from disk', () => {
    const s = loadScenarioFile(EXAMPLE)
    expect(s.gameVersion).toBe('4.7')
    expect(s.battle).toEqual({
      mode: 'moc',
      cycles: 5,
      period: 'moc-2026-11-survival-of-the-fittest',
      start: { energy: 0.5, skillPoints: 3, techniques: true },
    })
    expect(s.enemies).toEqual({ profile: 'generic-moc', counts: [1, 3, 5], weaknesses: 'all' })
    expect(s.teams.map((t) => t.id)).toEqual(['sw_welt_dhpt', 'sw_tribbie_dhpt'])
  })

  it('resolves its members', () => {
    const [welt, tribbie] = loadScenarioFile(EXAMPLE).teams
    expect(welt!.members.map((m) => m.key)).toEqual(['acheron', 'silver_wolf', 'welt', 'dan_heng'])
    expect(welt!.members[0]).toEqual({
      key: 'acheron',
      character: '1308',
      abilityVersion: undefined,
      eidolon: 1,
      affinitiveEidolon: true,
      lightCone: { id: '23024', superimposition: 1 },
      relics: 'standard',
      technique: true,
      techniqueGiven: false,
    })
    expect(welt!.members[1]).toMatchObject({ character: '1006', abilityVersion: 1, affinitiveEidolon: false })
    expect(tribbie!.members[2]).toMatchObject({ key: 'tribbie', eidolon: 1, lightCone: { id: '21018', superimposition: 3 } })
  })

  it('keeps the policy in file order, with notes dropped and "when" always present', () => {
    const policy = loadScenarioFile(EXAMPLE).teams[0]!.policy
    expect(policy[0]).toEqual({ unit: 'acheron', use: 'ultimate', when: [] })
    expect(policy[6]).toEqual({
      unit: 'silver_wolf',
      use: 'skill',
      when: [
        { what: 'team.skill_points', min: 2 },
        { what: 'acheron.slashed_dream', max: 8 },
      ],
    })
    expect(policy[10]).toEqual({
      unit: 'dan_heng',
      use: 'skill',
      target: 'acheron',
      when: [{ what: 'dan_heng.has_bondmate', is: false }],
    })
  })
})

describe('defaults', () => {
  it('fills in the Memory of Chaos starting state, no period, and weak to everything', () => {
    const s = parseScenario(minimal())
    expect(s.battle.start).toEqual({ energy: 0.5, skillPoints: 3, techniques: true })
    expect(s.battle.period).toBeNull()
    expect(s.enemies.weaknesses).toBe('all')
  })

  it('a partial start keeps the other defaults', () => {
    const file = minimal()
    file.battle.start = { skill_points: 5 }
    expect(parseScenario(file).battle.start).toEqual({ energy: 0.5, skillPoints: 5, techniques: true })
  })

  it('without an account, relics default to standard', () => {
    expect(parseScenario(minimal()).teams[0]!.members[0]!.relics).toBe('standard')
  })
})

describe('account resolution', () => {
  it("carries the scan's source, and none without an account", () => {
    expect(parseScenario(withAccount()).scanSource).toBe('reliquary_archiver')
    expect(parseScenario(minimal()).scanSource).toBeUndefined()
  })

  it('takes eidolon, light cone, ability version and equipped relics from the scan', () => {
    const [acheron, silverWolf] = parseScenario(withAccount()).teams[0]!.members
    expect(acheron).toMatchObject({
      eidolon: 1,
      abilityVersion: undefined,
      lightCone: { id: '23024', superimposition: 1 },
    })
    expect((acheron!.relics as ScanRelic[]).map((r) => r._uid)).toEqual(['r1', 'r2'])
    expect(silverWolf).toMatchObject({
      eidolon: 2,
      abilityVersion: 1,
      lightCone: { id: '21001', superimposition: 5 },
    })
  })

  it('values in the scenario override the scan', () => {
    const file = withAccount()
    Object.assign(file.teams[0]!.members[1]!, {
      eidolon: 6,
      ability_version: 0,
      light_cone: { id: '23004', superimposition: 2 },
      relics: 'standard',
    })
    expect(parseScenario(file).teams[0]!.members[1]).toMatchObject({
      eidolon: 6,
      abilityVersion: 0,
      lightCone: { id: '23004', superimposition: 2 },
      relics: 'standard',
    })
  })

  it('a relic list mixes scan uids and full relic objects', () => {
    const file = withAccount()
    file.teams[0]!.members[0]!.relics = ['r4', relic('inline', 'Feet', '')]
    const relics = parseScenario(file).teams[0]!.members[0]!.relics as ScanRelic[]
    expect(relics.map((r) => [r._uid, r.slot])).toEqual([['r4', 'Head'], ['inline', 'Feet']])
  })

  it('an account path is read through readAccount', () => {
    const file = { ...withAccount(), account: './scan.json' }
    const asked: string[] = []
    const s = parseScenario(file, {
      readAccount: (path) => {
        asked.push(path)
        return scan()
      },
    })
    expect(asked).toEqual(['./scan.json'])
    expect(s.teams[0]!.members[0]!.eidolon).toBe(1)
  })

  describe('from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nousr-scenario-'))
    afterAll(() => rmSync(dir, { recursive: true, force: true }))

    it('reads the account relative to the scenario file, tolerating a byte-order mark', () => {
      writeFileSync(join(dir, 'scan.json'), `﻿${JSON.stringify(scan())}`)
      writeFileSync(join(dir, 'team.scenario.json'), JSON.stringify({ ...withAccount(), account: 'scan.json' }))
      const s = loadScenarioFile(join(dir, 'team.scenario.json'))
      expect(s.teams[0]!.members[1]!.eidolon).toBe(2)
    })

    it('reports a missing file, bad JSON, and an account that is not a v4 scan', () => {
      expect(() => loadScenarioFile(join(dir, 'nope.json'))).toThrow(/cannot read/)

      writeFileSync(join(dir, 'broken.json'), '{ not json')
      expect(() => loadScenarioFile(join(dir, 'broken.json'))).toThrow(/not valid JSON/)

      writeFileSync(join(dir, 'v3.json'), JSON.stringify({ ...scan(), version: 3 }))
      writeFileSync(join(dir, 'old.scenario.json'), JSON.stringify({ ...withAccount(), account: 'v3.json' }))
      expect(() => loadScenarioFile(join(dir, 'old.scenario.json'))).toThrow(/account file "v3.json": \/version/)
    })
  })
})

describe('what the schema rejects', () => {
  it('unknown keys, naming the key and where it is', () => {
    const file = minimal() as unknown as Record<string, Record<string, unknown>>
    file.battle!.cycle = 3
    expect(problemsOf(file)).toEqual(['/battle: must NOT have additional properties ("cycle")'])
  })

  it('out-of-range and malformed values', () => {
    const file = minimal()
    file.enemies.counts = [1, 1]
    file.teams[0]!.members[0]!.eidolon = 7
    file.teams[0]!.members[0]!.key = 'Acheron'
    file.teams[0]!.policy[0]!.when = [{ what: 'team.skill_points' }]
    const problems = problemsOf(file).join('\n')
    expect(problems).toMatch(/\/enemies\/counts: must NOT have duplicate items/)
    expect(problems).toMatch(/\/teams\/0\/members\/0\/eidolon: must be <= 6/)
    expect(problems).toMatch(/\/teams\/0\/members\/0\/key: must match pattern/)
    expect(problems).toMatch(/\/teams\/0\/policy\/0\/when\/0: must NOT have fewer than 2 properties/)
  })

  it('a file that is not a scenario at all', () => {
    expect(problemsOf({ source: 'HSR-Scanner', version: 4 }).length).toBeGreaterThan(0)
    expect(problemsOf(null)).toEqual(['(top level): must be object'])
  })
})

describe('what the cross-reference checks reject', () => {
  it('a game version this build does not model', () => {
    expect(problemsOf({ ...minimal(), game_version: '4.8' })).toEqual([
      'game_version "4.8" is not modelled by this build (supported: 4.7)',
    ])
  })

  it('duplicate team ids, member keys and characters, and reserved member keys', () => {
    const file = minimal()
    const member = file.teams[0]!.members[0]!
    file.teams[0]!.members.push({ ...member }, { ...member, key: 'team', character: '1006' })
    file.teams.push({ ...file.teams[0]! })
    const problems = problemsOf(file)
    expect(problems).toContain('teams[1]: team id "solo" is used more than once')
    expect(problems).toContain('team "solo": member key "acheron" is used more than once')
    expect(problems).toContain('team "solo": character 1308 is in the team more than once')
    expect(problems).toContain('team "solo": member key "team" is reserved (team, battle)')
  })

  it('policy rules that point at nobody', () => {
    const file = minimal()
    file.teams[0]!.policy = [
      { unit: 'welt', use: 'basic' },
      { unit: 'acheron', use: 'skill', target: 'sunday' },
      { unit: 'acheron', use: 'basic', when: [{ what: 'jing_yuan.stacks', min: 3 }] },
      { unit: 'acheron', use: 'basic', when: [{ what: 'team.skill_points', min: 1 }, { what: 'battle.cycle', max: 2 }] },
    ]
    expect(problemsOf(file)).toEqual([
      'team "solo", policy[0]: unit "welt" is not a member of this team',
      'team "solo", policy[1]: target "sunday" is not a member of this team',
      'team "solo", policy[2]: condition "jing_yuan.stacks" must start with team, battle or a member key of this team',
    ])
  })

  it('members that cannot be resolved without an account', () => {
    const file = minimal()
    file.teams[0]!.members[0] = { key: 'acheron', character: '1308', relics: 'equipped' }
    expect(problemsOf(file)).toEqual([
      'team "solo", member "acheron": eidolon is required because there is no account',
      'team "solo", member "acheron": light_cone is required because there is no account',
      'team "solo", member "acheron": relics "equipped" needs an account',
    ])
  })

  it('members the account cannot fill in', () => {
    const file = withAccount()
    file.teams[0]!.members = [
      { key: 'welt', character: '1004' },
      { key: 'dan_heng', character: '1414' },
      { key: 'acheron', character: '1308', relics: ['r1', 'r4', 'missing'] },
    ]
    file.teams[0]!.policy = [{ unit: 'acheron', use: 'basic' }]
    expect(problemsOf(file)).toEqual([
      'team "duo", member "welt": eidolon is required because character 1004 is not in the account scan',
      'team "duo", member "welt": light_cone is required because character 1004 is not in the account scan',
      'team "duo", member "welt": the scan shows no relics on character 1004; use "standard" or list the relics',
      'team "duo", member "dan_heng": light_cone is required because the scan shows none on this character',
      'team "duo", member "dan_heng": the scan shows no relics on character 1414; use "standard" or list the relics',
      'team "duo", member "acheron": relic "missing" is not in the account scan',
      'team "duo", member "acheron": more than one relic in the Head slot',
    ])
  })

  it('an account path with nothing to read it', () => {
    expect(problemsOf({ ...withAccount(), account: './scan.json' })[0]).toMatch(/account is the path ".\/scan.json"/)
  })
})

describe('standard_build on a member (K14c)', () => {
  const withOverride = (override: unknown, relics?: unknown): ScenarioFile => {
    const file = minimal()
    Object.assign(file.teams[0]!.members[0]!, { standard_build: override, ...(relics !== undefined && { relics }) })
    return file
  }

  it('is read as main stats and/or a whole split', () => {
    const scenario = parseScenario(withOverride({
      notes: 'CRIT DMG body',
      main_stats: { Body: 'CRIT DMG', Feet: 'ATK%' },
      distributed: { rolls: { SPD: 2, 'CRIT DMG': 6, 'CRIT Rate': 12, 'ATK%': 4 }, notes: 'x' },
    }))
    const member = scenario.teams[0]!.members[0]!
    expect(member.relics).toBe('standard')
    expect(member.standardBuild).toEqual({
      mainStats: { Body: 'CRIT DMG', Feet: 'ATK%' },
      distributed: { SPD: 2, 'CRIT DMG': 6, 'CRIT Rate': 12, 'ATK%': 4 },
    })
    expect(parseScenario(withOverride({ main_stats: { Body: 'CRIT DMG' } })).teams[0]!.members[0]!.standardBuild).toEqual({ mainStats: { Body: 'CRIT DMG' } })
    expect(parseScenario(minimal()).teams[0]!.members[0]!.standardBuild).toBeUndefined()
  })

  it('may be written with relics "standard" stated', () => {
    expect(parseScenario(withOverride({ main_stats: { Body: 'CRIT DMG' } }, 'standard')).teams[0]!.members[0]!.standardBuild).toBeDefined()
  })

  it.each([
    ['an empty standard_build', {}],
    ['only notes', { notes: 'nothing' }],
    ['an empty main_stats', { main_stats: {} }],
    ['Head, which is fixed', { main_stats: { Head: 'HP%' } }],
    ['a stat that slot cannot have', { main_stats: { Feet: 'CRIT Rate' } }],
    ['an unknown key', { main_stats: { Body: 'CRIT DMG' }, sets: [] }],
    ['an unknown substat', { distributed: { rolls: { Luck: 24 } } }],
    ['a negative count', { distributed: { rolls: { SPD: -1 } } }],
    ['a fractional count', { distributed: { rolls: { SPD: 1.5 } } }],
    ['a distributed with no rolls', { distributed: {} }],
  ])('rejects %s', (_name, override) => {
    expect(() => parseScenario(withOverride(override))).toThrow(ScenarioError)
  })

  it('is refused on equipped or listed relics, naming the member', () => {
    const file = withAccount()
    file.teams[0]!.members[0]!.standard_build = { main_stats: { Body: 'CRIT DMG' } }
    expect(problemsOf(file)).toEqual([
      'team "duo", member "acheron": standard_build changes a standard build, but this member\'s relics are "equipped" (the default when there is an account); set relics to "standard" or remove standard_build',
    ])
    file.teams[0]!.members[0]!.relics = ['r1']
    expect(problemsOf(file)[0]).toContain('relics are a list')
    file.teams[0]!.members[0]!.relics = 'equipped'
    expect(problemsOf(file)[0]).toContain('relics are "equipped";')
  })
})

describe('technique per member (K31)', () => {
  const withTechniques = (start: boolean | undefined, members: (boolean | undefined)[]): ScenarioFile => {
    const file = minimal()
    if (start !== undefined) file.battle.start = { techniques: start }
    const first = file.teams[0]!.members[0]!
    file.teams[0]!.members = members.map((technique, i) => ({ ...first, key: `m${i}`, character: String(1000 + i), ...(technique !== undefined && { technique }) }))
    file.teams[0]!.policy = [{ unit: 'm0', use: 'basic' }]
    return file
  }
  const resolved = (file: ScenarioFile) => parseScenario(file).teams[0]!.members.map((m) => [m.technique, m.techniqueGiven])

  it('a member without technique takes battle.start.techniques, which defaults to true', () => {
    expect(resolved(withTechniques(undefined, [undefined]))).toEqual([[true, false]])
    expect(resolved(withTechniques(false, [undefined, undefined]))).toEqual([[false, false], [false, false]])
  })

  it('the own technique of a member overrides the default, in both directions, and is reported as given', () => {
    expect(resolved(withTechniques(true, [false, undefined, true]))).toEqual([[false, true], [true, false], [true, true]])
    expect(resolved(withTechniques(false, [true, undefined]))).toEqual([[true, true], [false, false]])
  })

  it('the schema takes a boolean and nothing else', () => {
    expect(problemsOf(withTechniques(true, ['yes' as unknown as boolean]))[0]).toMatch(/technique/)
    expect(problemsOf(withTechniques(true, [true]))).toEqual([])
  })
})
