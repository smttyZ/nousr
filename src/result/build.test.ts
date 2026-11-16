import { describe, expect, it } from 'vitest'
import type { BenchmarkBuild } from '../kernel/types'
import { runScenario, type TeamRun } from '../run/run'
import { loadStandardBuild } from '../standard/load'
import { resolveStandardBuild } from '../standard/resolve'
import { parseScenario } from '../scenario/load'
import type { AccountScan, ScenarioFile } from '../scenario/types'
import { buildResult, windowActionValue } from './build'
import { accountScan, BASIC, FAKE_EQUIPMENT, FAKE_KITS, fakeKernel, scenarioFile } from './testing'
import { assertValidResult, ResultContractError, resultProblems } from './validate'

const HASH = 'a'.repeat(64)

function runFake(file: ScenarioFile = scenarioFile(), account?: AccountScan) {
  const scenario = parseScenario(file, { readAccount: () => account })
  const runs = runScenario(scenario, { kernel: fakeKernel(), kits: FAKE_KITS, equipment: FAKE_EQUIPMENT, standardBuild: () => ({
    relicSet1: 'Set A', relicSet2: 'Set A', ornamentSet: 'Ornament', body: 'CRIT DMG', feet: 'SPD',
    planarSphere: 'Fire DMG Boost', linkRope: 'ATK%', substatRolls: {},
  }) })
  return { scenario, runs, content: file as unknown as Record<string, unknown> }
}

function build(overrides: Partial<Parameters<typeof buildResult>[0]> = {}, file: ScenarioFile = scenarioFile()) {
  const { scenario, runs, content } = runFake(file)
  return buildResult({
    runs,
    scenario,
    content,
    scenarioPath: 'scenario.json',
    scenarioSha256: HASH,
    generator: { nousr: '9.9.9', nousr_commit: null, kernel: 'fribbels/hsr-optimizer@31644d9' },
    ...overrides,
  })
}

describe('buildResult', () => {
  it('writes an object that matches schema/result.schema.json', () => {
    expect(resultProblems(build())).toEqual([])
    expect(resultProblems(build({ log: false }))).toEqual([])
  })

  it('identifies the format, game version and generator', () => {
    const r = build()
    expect(r).toMatchObject({
      format: 'nousr-result',
      version: 1,
      game_version: '4.7',
      generator: { nousr: '9.9.9', nousr_commit: null, kernel: 'fribbels/hsr-optimizer@31644d9' },
    })
    expect('created' in r).toBe(false)
  })

  it('has one run per team and enemy count, in scenario order, with the window', () => {
    const r = build()
    expect(r.runs.map((x) => [x.team, x.enemy_count])).toEqual([['solo', 1], ['solo', 3], ['pair', 1], ['pair', 3]])
    expect(r.runs[0]!.window).toEqual({ cycles: 3, action_value: 350 })
    expect(windowActionValue(1)).toBe(150)
    expect(windowActionValue(5)).toBe(550)
  })

  it('totals are the sum of the cycles and of the members, and shares sum to 1', () => {
    for (const run of build().runs) {
      expect(run.per_cycle).toHaveLength(3)
      expect(run.per_cycle.reduce((a, b) => a + b, 0)).toBeCloseTo(run.total, 6)
      expect(run.by_member.reduce((a, m) => a + m.damage, 0)).toBeCloseTo(run.total, 6)
      expect(run.by_member.reduce((a, m) => a + m.share, 0)).toBeCloseTo(1, 12)
      for (const m of run.by_member) {
        expect(Object.values(m.by_ability).reduce((a, b) => a + b, 0)).toBeCloseTo(m.damage, 6)
      }
    }
  })

  it('counts actions by kind per member and lists members in team order', () => {
    const pair = build().runs.find((r) => r.team === 'pair' && r.enemy_count === 1)!
    expect(pair.by_member.map((m) => m.member)).toEqual(['striker', 'cas'])
    for (const m of pair.by_member) {
      const log = pair.actions!.filter((a) => a.actor === m.member)
      expect(m.actions.skill).toBe(log.filter((a) => a.kind === 'skill').length)
      expect(m.actions.basic).toBe(log.filter((a) => a.kind === 'basic').length)
      expect(m.actions.skill + m.actions.basic).toBeGreaterThan(0)
    }
  })

  it('the action log carries when, damage and Skill Points, and its damage adds up to the total', () => {
    for (const run of build().runs) {
      const actions = run.actions!
      expect(actions.map((a) => a.serial)).toEqual(actions.map((_, i) => i + 1))
      expect(actions.reduce((a, x) => a + x.damage, 0)).toBeCloseTo(run.total, 6)
      expect(actions.map((a) => a.at)).toEqual([...actions.map((a) => a.at)].sort((x, y) => x - y))
      expect(actions.map((a) => a.cycle)).toEqual([...actions.map((a) => a.cycle)].sort((x, y) => x - y))
      for (const a of actions) {
        expect(a.at).toBeGreaterThan(0)
        expect(Number.isInteger(a.sp_before) && Number.isInteger(a.sp_after)).toBe(true)
      }
    }
    const first = build().runs[0]!.actions![0]!
    expect(first).toMatchObject({ actor: 'striker', action: 'skill', kind: 'skill', sp_before: 3, sp_after: 2 })
  })

  it('leaves the log out with log: false, and nothing else changes', () => {
    const withLog = build()
    const without = build({ log: false })
    expect(without.runs.every((r) => !('actions' in r))).toBe(true)
    expect(without.runs.map(({ ...r }) => r.total)).toEqual(withLog.runs.map((r) => r.total))
  })

  it('compares each team with the first by default: the ratio of totals per enemy count, none for the baseline', () => {
    const r = build()
    expect(r.comparison.baseline).toBe('solo')
    expect(r.comparison.ratios.map((x) => [x.team, x.enemy_count])).toEqual([['pair', 1], ['pair', 3]])
    for (const x of r.comparison.ratios) {
      const total = (team: string) => r.runs.find((run) => run.team === team && run.enemy_count === x.enemy_count)!.total
      expect(x.ratio).toBe(total('pair') / total('solo'))
    }
    // Two strikers out-damage one, so the ratio is above 1.
    expect(r.comparison.ratios[0]!.ratio).toBeGreaterThan(1)
  })

  it('takes the baseline from the caller, and refuses a team that did not run', () => {
    const r = build({ baseline: 'pair' })
    expect(r.comparison.baseline).toBe('pair')
    expect(r.comparison.ratios.map((x) => x.team)).toEqual(['solo', 'solo'])
    expect(r.comparison.ratios[0]!.ratio).toBeLessThan(1)
    expect(() => build({ baseline: 'nobody' })).toThrow(/baseline team "nobody"/)
  })

  it('a baseline that dealt nothing gives a null ratio, not Infinity', () => {
    const { scenario, runs, content } = runFake()
    const zeroed: TeamRun[] = runs.map((r) => (r.team === 'solo' ? { ...r, result: { ...r.result, totalDamage: 0 } } : r))
    const r = buildResult({ runs: zeroed, scenario, content, scenarioSha256: HASH, generator: { nousr: '1', nousr_commit: null, kernel: 'k' } })
    expect(r.comparison.ratios.map((x) => x.ratio)).toEqual([null, null])
    expect(resultProblems(r)).toEqual([])
  })

  it('a team with no damage has shares of 0', () => {
    const { scenario, runs, content } = runFake()
    const zeroed: TeamRun[] = runs.map((r) => ({ ...r, result: { ...r.result, totalDamage: 0 } }))
    const r = buildResult({ runs: zeroed, scenario, content, scenarioSha256: HASH, generator: { nousr: '1', nousr_commit: null, kernel: 'k' } })
    expect(r.runs[0]!.by_member.every((m) => m.share === 0)).toBe(true)
  })

  it('writes the run only for the teams that ran (the filters)', () => {
    const { scenario, runs, content } = runFake()
    const only = runs.filter((r) => r.team === 'pair')
    const r = buildResult({ runs: only, scenario, content, scenarioSha256: HASH, generator: { nousr: '1', nousr_commit: null, kernel: 'k' } })
    expect(r.teams.map((t) => t.id)).toEqual(['pair'])
    expect(r.comparison).toEqual({ baseline: 'pair', ratios: [] })
    expect(resultProblems(r)).toEqual([])
  })

  it('echoes the members: version, stats, relics, technique, and the kit options with what was defaulted', () => {
    const solo = build().teams[0]!
    expect(solo.members[0]).toEqual({
      key: 'striker',
      character: '9001',
      ability_version: 1,
      eidolon: 2,
      affinitive_eidolon: true,
      light_cone: { id: '20000', superimposition: 4 },
      relics: 'standard',
      technique: true,
      stats: { spd: BASIC.SPD, hp: BASIC.HP, def: BASIC.DEF, err: BASIC.ERR, effect_res: BASIC.RES },
    })
    expect('kit_options' in solo).toBe(false)
    const pair = build().teams[1]!
    expect(pair.name).toBe('Striker and friend')
    expect(pair.members[1]).toMatchObject({ key: 'cas', ability_version: 0 })
    expect(pair.kit_options).toEqual([{ member: 'cas', options: { netherwing_finish_turn: 2 }, defaulted: [] }])
  })

  it("echoes Cyrene's SPD solving as spd_solved, and leaves it out when nothing was solved", () => {
    // Her standard build with a stand-in SPD probe (110 base and traces + 25.032 boots + 2.6 per SPD roll).
    const probe = (b: BenchmarkBuild) => 110 + (b.feet === 'SPD' ? 25.032 : 0) + b.substatRolls.SPD! * (b.speedRollValue ?? 2.6)
    const { report } = resolveStandardBuild(loadStandardBuild('1415', 0), { spd: probe })
    expect(report.spdSolved).toBeDefined()
    const { scenario, runs, content } = runFake()
    const generator = { nousr: '9.9.9', nousr_commit: null, kernel: 'k' }
    const solved = runs.map((r) => ({ ...r, standardBuilds: [{ member: 'striker', report }, ...r.standardBuilds.slice(1)] }))
    const result = buildResult({ runs: solved, scenario, content, scenarioSha256: HASH, generator })
    expect(resultProblems(result)).toEqual([])
    const echo = result.teams[0]!.standard_builds![0]!
    expect(echo.spd_solved).toEqual({
      file_rolls: report.spdSolved!.fileRolls,
      used_rolls: report.spdSolved!.usedRolls,
      reachable: report.spdSolved!.reachable,
      moves: report.spdSolved!.moves.map((m) => ({ from: m.from, to: m.to, rolls: m.rolls })),
    })
    const plain = { ...runs[0]!, standardBuilds: [{ member: 'striker', report: { ...report, spdSolved: undefined } }] }
    const without = buildResult({ runs: [plain], scenario, content, scenarioSha256: HASH, generator })
    expect(without.teams[0]!.standard_builds![0]).not.toHaveProperty('spd_solved')
  })

  it('writes `unattributed` only when damage belongs to no action', () => {
    const { scenario, runs, content } = runFake()
    expect(build().runs.every((r) => !('unattributed' in r))).toBe(true)
    const bumped = runs.map((r) => ({ ...r, result: { ...r.result, unattributedDamage: 123 } }))
    const result = buildResult({ runs: bumped, scenario, content, scenarioSha256: HASH, generator: { nousr: '9.9.9', nousr_commit: null, kernel: 'k' } })
    expect(resultProblems(result)).toEqual([])
    expect(result.runs[0]!.unattributed).toBe(123)
  })

  it('says whether relics were listed or the account\'s equipped ones', () => {
    const file = scenarioFile({ account: accountScan('reliquary_archiver') })
    file.teams[0]!.members[0]!.relics = 'equipped'
    file.teams[1]!.members[0]!.relics = ['r1']
    file.teams[1]!.members.pop()
    file.teams[1]!.policy = file.teams[1]!.policy.filter((r) => r.unit === 'striker')
    const { scenario, runs } = (() => {
      const scenario = parseScenario(file)
      return { scenario, runs: runScenario(scenario, { kernel: fakeKernel(), kits: FAKE_KITS, equipment: FAKE_EQUIPMENT }) }
    })()
    const r = buildResult({ runs, scenario, content: file as unknown as Record<string, unknown>, scenarioSha256: HASH, generator: { nousr: '1', nousr_commit: null, kernel: 'k' } })
    expect(r.teams.map((t) => t.members[0]!.relics)).toEqual(['equipped', 'list'])
  })

  it('writes each warning once: a team\'s setup warning is not repeated per enemy count', () => {
    const file = scenarioFile({ account: accountScan('HSR-Scanner') })
    file.teams[0]!.members[0]!.relics = 'equipped'
    file.teams.pop()
    const scenario = parseScenario(file)
    const runs = runScenario(scenario, { kernel: fakeKernel(), kits: FAKE_KITS, equipment: FAKE_EQUIPMENT })
    expect(runs.map((r) => r.warnings.length)).toEqual([1, 1])
    const r = buildResult({ runs, scenario, content: file as unknown as Record<string, unknown>, scenarioSha256: HASH, generator: { nousr: '1', nousr_commit: null, kernel: 'k' } })
    expect(r.warnings).toEqual([
      { severity: 'warning', code: 'spd-may-be-understated', message: expect.any(String), team: 'solo', member: 'striker' },
    ])
    expect(resultProblems(r)).toEqual([])
  })

  it('embeds the scenario as given, with its path and hash', () => {
    const file = scenarioFile()
    const r = build({}, file)
    expect(r.scenario.content).toBe(file)
    expect(r.scenario).toMatchObject({ path: 'scenario.json', sha256: HASH })
    expect('account_sha256' in r.scenario).toBe(false)
  })
})

describe('the schema as a runtime contract', () => {
  it('assertValidResult passes a good result and names the break in a bad one', () => {
    const good = build()
    expect(() => assertValidResult(good)).not.toThrow()
    const bad = structuredClone(good) as unknown as { runs: { total: unknown }[] }
    bad.runs[0]!.total = -1
    expect(() => assertValidResult(bad)).toThrow(ResultContractError)
    expect(() => assertValidResult(bad)).toThrow(/runs\/0\/total/)
  })

  it('rejects an extra key, a missing required key and a wrong version', () => {
    const base = structuredClone(build()) as unknown as Record<string, unknown>
    expect(resultProblems({ ...base, extra: 1 })).toEqual([expect.stringMatching(/additional properties/)])
    const { warnings: _w, ...noWarnings } = base
    expect(resultProblems(noWarnings).join()).toMatch(/warnings/)
    expect(resultProblems({ ...base, version: 2 })).not.toEqual([])
  })

  it('the schema is version 1 and no longer marked as a draft', async () => {
    const schema = (await import('../../schema/result.schema.json', { with: { type: 'json' } })).default as { $id: string, title: string, description: string }
    expect(schema.$id).toBe('urn:nousr:schema:result:1')
    expect(`${schema.title} ${schema.description}`).not.toMatch(/draft/i)
  })
})
