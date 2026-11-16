import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { main } from './cli'
import type { NousrResult } from './result/types'
import { fakeResult } from './kernel/testing'
import { accountScan, BASIC, captureDeps, scenarioFile, tempDir, writeJson } from './result/testing'
import { resultProblems } from './result/validate'
import type { ScenarioFile } from './scenario/types'

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

/** A scenario file with a warning: one team on the account's equipped relics, read from a scanner that rounds SPD down. */
function warningScenario(account: unknown = 'acct.json'): ScenarioFile {
  const file = scenarioFile({ account: account as ScenarioFile['account'] })
  file.teams = [file.teams[0]!]
  file.teams[0]!.members[0]!.relics = 'equipped'
  return file
}

async function run(argv: string[], dir = tempDir(), options: Parameters<typeof captureDeps>[1] = {}) {
  const io = captureDeps(dir, options)
  const code = await main(argv, io.deps)
  return { code, out: io.out(), err: io.err(), dir }
}

describe('nousr run', () => {
  it('runs a scenario relative to the current folder and prints the tables', async () => {
    const dir = tempDir()
    writeJson(dir, 'sub/s.json', scenarioFile())
    const r = await run(['run', 'sub/s.json'], dir)
    expect(r.code).toBe(0)
    expect(r.err).toBe('')
    expect(r.out).toContain('NouSR 9.9.9 · kernel fribbels/hsr-optimizer@31644d9 · game 4.7')
    expect(r.out).toContain('Scenario: Fake scenario (sub/s.json)')
    expect(r.out).toContain('solo (baseline)')
    expect(r.out).toMatch(/pair +[\d,]+ +\d\.\d{3}/)
    expect(r.out).toContain('pair, 3 enemies')
    expect(r.out).toContain('downed: none')
  })

  it('-o writes valid JSON to the file and still prints the tables', async () => {
    const dir = tempDir()
    writeJson(dir, 's.json', scenarioFile())
    const r = await run(['run', 's.json', '-o', 'results/out.json'], dir)
    expect(r.code).toBe(0)
    expect(r.out).toContain('Total damage')
    expect(r.err).toContain('Wrote results/out.json')
    const result = JSON.parse(readFileSync(join(dir, 'results/out.json'), 'utf8')) as NousrResult
    expect(resultProblems(result)).toEqual([])
    expect(result.runs).toHaveLength(4)
    expect(result.runs[0]!.actions!.length).toBeGreaterThan(0)
  })

  it('--json and -o - print only the JSON on stdout', async () => {
    const dir = tempDir()
    writeJson(dir, 's.json', scenarioFile())
    for (const flags of [['--json'], ['-o', '-']]) {
      const r = await run(['run', 's.json', ...flags], dir)
      expect(r.code).toBe(0)
      expect(r.out.startsWith('{\n')).toBe(true)
      expect(r.out).not.toContain('Total damage')
      expect(resultProblems(JSON.parse(r.out))).toEqual([])
    }
  })

  it('the same input gives byte-identical JSON (no timestamp)', async () => {
    const dir = tempDir()
    writeJson(dir, 's.json', scenarioFile())
    const a = await run(['run', 's.json', '--json'], dir)
    const b = await run(['run', 's.json', '--json'], dir)
    expect(a.out).toBe(b.out)
    expect(a.out).not.toContain('"created"')
  })

  it("hashes the scenario file's bytes and embeds the scenario as given", async () => {
    const dir = tempDir()
    const file = writeJson(dir, 's.json', scenarioFile())
    const r = await run(['run', 's.json', '--json'], dir)
    const result = JSON.parse(r.out) as NousrResult
    expect(result.scenario.sha256).toBe(sha(readFileSync(file)))
    expect(result.scenario.path).toBe('s.json')
    expect(result.scenario.content).toEqual(JSON.parse(readFileSync(file, 'utf8')))
    expect('account_sha256' in result.scenario).toBe(false)
  })

  it('hashes an account file named by path and never copies its content', async () => {
    const dir = tempDir()
    writeJson(dir, 's.json', warningScenario('acct.json'))
    const account = writeJson(dir, 'acct.json', accountScan('reliquary_archiver'))
    const r = await run(['run', 's.json', '--json'], dir)
    expect(r.code).toBe(0)
    const result = JSON.parse(r.out) as NousrResult
    expect(result.scenario.account_sha256).toBe(sha(readFileSync(account)))
    expect((result.scenario.content as { account: string }).account).toBe('acct.json')
    // Nothing of the scan: not its relic id, set id, nor its substats.
    expect(r.out).not.toContain('"r1"')
    expect(r.out).not.toContain('"set_id"')
    expect(r.out).not.toContain('"substats"')
  })

  it('an account written inline in the scenario is embedded as the author wrote it', async () => {
    const dir = tempDir()
    writeJson(dir, 's.json', warningScenario(accountScan('reliquary_archiver')))
    const r = await run(['run', 's.json', '--json'], dir)
    const result = JSON.parse(r.out) as NousrResult
    expect((result.scenario.content as { account: { source: string } }).account.source).toBe('reliquary_archiver')
    expect('account_sha256' in result.scenario).toBe(false)
  })

  it('--no-log leaves the log out of the JSON but not out of --log', async () => {
    const dir = tempDir()
    writeJson(dir, 's.json', scenarioFile())
    const json = await run(['run', 's.json', '--json', '--no-log'], dir)
    expect((JSON.parse(json.out) as NousrResult).runs.every((x) => !('actions' in x))).toBe(true)
    const file = await run(['run', 's.json', '--no-log', '-o', 'o.json', '--log', 'solo:1'], dir)
    expect(file.code).toBe(0)
    expect(file.out).toContain('Action log: solo, 1 enemy')
    expect(readFileSync(join(dir, 'o.json'), 'utf8')).not.toContain('"sp_before"')
  })

  it('--cycles adds the per-cycle tables, --log the action log', async () => {
    const dir = tempDir()
    writeJson(dir, 's.json', scenarioFile())
    const r = await run(['run', 's.json', '--cycles', '--log', 'pair:3'], dir)
    expect(r.out).toContain('Damage per cycle, 1 enemy')
    expect(r.out).toContain('Damage per cycle, 3 enemies')
    expect(r.out).toContain('Action log: pair, 3 enemies')
  })

  it('--teams, --enemies and --baseline pick what runs and what the ratios are against', async () => {
    const dir = tempDir()
    writeJson(dir, 's.json', scenarioFile())
    const r = await run(['run', 's.json', '--json', '--enemies', '3', '--baseline', 'pair'], dir)
    const result = JSON.parse(r.out) as NousrResult
    expect(result.runs.map((x) => [x.team, x.enemy_count])).toEqual([['solo', 3], ['pair', 3]])
    expect(result.comparison).toMatchObject({ baseline: 'pair', ratios: [{ team: 'solo', enemy_count: 3 }] })
    const only = JSON.parse((await run(['run', 's.json', '--json', '--teams', 'pair'], dir)).out) as NousrResult
    expect(only.teams.map((t) => t.id)).toEqual(['pair'])
    expect(only.runs.map((x) => x.enemy_count)).toEqual([1, 3])
    // The scenario is embedded whole, whatever was run.
    expect((only.scenario.content as { teams: unknown[] }).teams).toHaveLength(2)
  })

  it.each([
    [['--teams', 'nobody'], /--teams: no team "nobody" in the scenario \(teams: solo, pair\)/],
    [['--enemies', '5'], /--enemies: the scenario has no run with 5 enemies \(it lists 1, 3\)/],
    [['--teams', 'solo', '--baseline', 'pair'], /--baseline: "pair" is not one of the teams that run \(solo\)/],
    [['--log', 'solo:5'], /--log solo:5: no such run/],
    [['--enemies', '1', '--log', 'solo:3'], /--log solo:3: no such run/],
  ] as [string[], RegExp][])('exits 2 for %j', async (flags, message) => {
    const dir = tempDir()
    writeJson(dir, 's.json', scenarioFile())
    const r = await run(['run', 's.json', ...flags], dir)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(message)
    expect(r.out).toBe('')
  })

  it('exits 2 with the usage for bad arguments, before reading anything', async () => {
    const r = await run(['run'])
    expect(r.code).toBe(2)
    expect(r.err).toContain('no scenario file given')
    expect(r.err).toContain('Usage:')
    expect(r.out).toBe('')
  })

  it('exits 1 for a scenario that cannot run, listing every problem', async () => {
    const dir = tempDir()
    const missing = await run(['run', 'missing.json'], dir)
    expect(missing.code).toBe(1)
    expect(missing.err).toMatch(/cannot read .*missing\.json/)
    writeFileSync(join(dir, 'bad.json'), '{ nope')
    const badJson = await run(['run', 'bad.json'], dir)
    expect(badJson.code).toBe(1)
    expect(badJson.err).toMatch(/is not valid JSON/)

    writeJson(dir, 'schema.json', { ...scenarioFile(), game_version: 'x', surprise: true })
    const schema = await run(['run', 'schema.json'], dir)
    expect(schema.code).toBe(1)
    expect(schema.err).toContain('Invalid scenario:')
    expect(schema.err).toContain('surprise')

    const file = scenarioFile()
    file.teams[0]!.members[0]!.character = '9999'
    writeJson(dir, 'run.json', file)
    const unrunnable = await run(['run', 'run.json'], dir)
    expect(unrunnable.code).toBe(1)
    expect(unrunnable.err).toContain('Cannot run the scenario:')
    expect(unrunnable.err).toContain('9999')
    expect(unrunnable.out).toBe('')
  })

  it('refuses a period module that does not exist yet, as the runner does', async () => {
    const dir = tempDir()
    writeJson(dir, 's.json', scenarioFile({ battle: { mode: 'moc', cycles: 3, period: 'moc-2026-11-survival-of-the-fittest' } }))
    const r = await run(['run', 's.json'], dir)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/period modules are not built yet/)
  })
})

describe('warnings', () => {
  function setup(source: string) {
    const dir = tempDir()
    writeJson(dir, 's.json', warningScenario())
    writeJson(dir, 'acct.json', accountScan(source))
    return dir
  }

  it('go to stderr via formatWarning, once each, and are in the JSON too', async () => {
    const dir = setup('HSR-Scanner')
    const r = await run(['run', 's.json', '-o', 'o.json'], dir)
    expect(r.code).toBe(0)
    expect(r.err.match(/⚠/g)).toHaveLength(1)
    expect(r.err).toMatch(/⚠ team "solo", member "striker": SPD may be understated/)
    expect(r.out).not.toContain('⚠')
    const result = JSON.parse(readFileSync(join(dir, 'o.json'), 'utf8')) as NousrResult
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatchObject({ code: 'spd-may-be-understated', team: 'solo', member: 'striker' })
  })

  it('--strict exits 3 on a warning-severity warning, and 0 without one', async () => {
    expect((await run(['run', 's.json', '--strict'], setup('HSR-Scanner'))).code).toBe(3)
    expect((await run(['run', 's.json'], setup('HSR-Scanner'))).code).toBe(0)
    expect((await run(['run', 's.json', '--strict'], setup('reliquary_archiver'))).code).toBe(0)
  })

  it('are red on a terminal, plain with --no-color, NO_COLOR or when output is not a terminal', async () => {
    const red = '\u001B[31m'
    expect((await run(['run', 's.json'], setup('HSR-Scanner'), { tty: true })).err).toContain(red)
    expect((await run(['run', 's.json', '--no-color'], setup('HSR-Scanner'), { tty: true })).err).not.toContain(red)
    expect((await run(['run', 's.json'], setup('HSR-Scanner'), { tty: true, env: { NO_COLOR: '1' } })).err).not.toContain(red)
    expect((await run(['run', 's.json'], setup('HSR-Scanner'), { tty: false })).err).not.toContain(red)
  })
})

describe('nousr validate', () => {
  it('checks the teams without running a battle', async () => {
    const dir = tempDir()
    writeJson(dir, 's.json', scenarioFile())
    const r = await run(['validate', 's.json'], dir)
    expect(r).toMatchObject({ code: 0, out: 's.json: OK (2 teams, enemy counts 1, 3, 3 cycles)\n', err: '' })
  })

  it('exits 1 for an invalid scenario and for a team that cannot be set up', async () => {
    const dir = tempDir()
    writeJson(dir, 'schema.json', { nope: true })
    expect((await run(['validate', 'schema.json'], dir)).code).toBe(1)
    const file = scenarioFile()
    file.teams[1]!.members[0]!.character = '9999'
    writeJson(dir, 'run.json', file)
    const r = await run(['validate', 'run.json'], dir)
    expect(r.code).toBe(1)
    expect(r.err).toContain('9999')
  })

  it('--strict exits 3 on a warning', async () => {
    const dir = tempDir()
    writeJson(dir, 's.json', warningScenario())
    writeJson(dir, 'acct.json', accountScan('HSR-Scanner'))
    const r = await run(['validate', 's.json', '--strict'], dir)
    expect(r.code).toBe(3)
    expect(r.out).toContain('OK')
    expect(r.err.match(/⚠/g)).toHaveLength(1)
  })
})

describe('the schema as a contract at run time', () => {
  it('a result that breaks schema/result.schema.json is never written: exit 70 and a message naming the field', async () => {
    const dir = tempDir()
    writeJson(dir, 's.json', scenarioFile())
    const io = captureDeps(dir)
    const kernel = io.deps.kernel()
    io.deps.kernel = () => ({ ...kernel, actionDamage: () => fakeResult({ BASIC: [{ damage: Number.NaN, scaling: 1 }], SKILL: [{ damage: Number.NaN, scaling: 2 }] }, { ...BASIC }) })
    const code = await main(['run', 's.json', '-o', 'o.json'], io.deps)
    expect(code).toBe(70)
    expect(io.err()).toContain('does not match schema/result.schema.json')
    expect(existsSync(join(dir, 'o.json'))).toBe(false)
    expect(io.out()).toBe('')
  })
})

describe('the other commands', () => {
  it('version prints NouSR, kernel and game versions', async () => {
    const r = await run(['version'])
    expect(r).toMatchObject({ code: 0, err: '' })
    expect(r.out).toBe('NouSR 9.9.9\nkernel fribbels/hsr-optimizer@31644d9\ngame 4.7\n')
  })

  it('help prints the usage and exits 0; an unknown command exits 2', async () => {
    const help = await run(['--help'])
    expect(help.code).toBe(0)
    expect(help.out).toContain('nousr run <scenario.json>')
    const unknown = await run(['frobnicate'])
    expect(unknown.code).toBe(2)
    expect(unknown.err).toContain('unknown command "frobnicate"')
  })

  it('a bug in NouSR is printed as an internal error with its own exit code, not as a scenario problem', async () => {
    const dir = tempDir()
    writeJson(dir, 's.json', scenarioFile())
    const io = captureDeps(dir)
    io.deps.kernel = () => {
      throw new Error('kaboom')
    }
    expect(await main(['run', 's.json', '-o', 'o.json'], io.deps)).toBe(70)
    expect(io.err()).toContain('internal error')
    expect(io.err()).toContain('kaboom')
    expect(existsSync(join(dir, 'o.json'))).toBe(false)
  })
})
