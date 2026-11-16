import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { main } from '../../cli'
import { repoPath } from '../../paths'
import { KERNEL_ID } from '../../result/identity'
import type { NousrResult } from '../../result/types'
import { resultProblems } from '../../result/validate'
import { runScenario } from '../../run/run'
import { loadScenarioFile } from '../../scenario/load'
import { FribbelsKernel } from './fribbelsKernel'

const EXAMPLE = 'examples/acheron-welt-vs-tribbie.scenario.json'

/** The command, in process, with the real kernel: what `node dist/cli.js` does, minus the bundle. */
async function cli(argv: string[], cwd = repoPath('.')) {
  let out = ''
  let err = ''
  const code = await main(argv, {
    stdout: { write: (t) => ((out += t), true) },
    stderr: { write: (t) => ((err += t), true) },
    env: {},
    cwd,
    kernel: () => new FribbelsKernel(),
  })
  return { code, out, err }
}

// Full battles through the real kernel (2 teams x 3 enemy counts x 5 cycles): seconds each, more on CI's runners.
const FULL_RUN = { timeout: 60_000 }

describe('the example scenario runs through the real kernel', FULL_RUN, () => {
  it('loads and runs: every team at every enemy count, damage above zero, same totals as runScenario', () => {
    const scenario = loadScenarioFile(repoPath(EXAMPLE))
    expect(scenario.battle.period).toBe('moc-2026-11-survival-of-the-fittest')
    const runs = runScenario(scenario, { kernel: new FribbelsKernel() })
    expect(runs.map((r) => [r.team, r.enemyCount])).toEqual([
      ['sw_welt_dhpt', 1], ['sw_welt_dhpt', 3], ['sw_welt_dhpt', 5],
      ['sw_tribbie_dhpt', 1], ['sw_tribbie_dhpt', 3], ['sw_tribbie_dhpt', 5],
    ])
    for (const r of runs) {
      expect(r.result.totalDamage).toBeGreaterThan(0)
      expect(r.result.actions.length).toBeGreaterThan(10)
    }
  })

  it('Survival of the Fittest changes nothing for these teams (no Elation-path member): same results as period null (step 7)', () => {
    const scenario = loadScenarioFile(repoPath(EXAMPLE))
    const kernel = new FribbelsKernel()
    const withPeriod = runScenario(scenario, { kernel })
    const without = runScenario({ ...scenario, battle: { ...scenario.battle, period: null } }, { kernel })
    expect(withPeriod.map((r) => r.result)).toEqual(without.map((r) => r.result))
  })

  it("has no workaround on Dan Heng's Skill rule: a downed Acheron just skips it (K36)", () => {
    const text = readFileSync(repoPath(EXAMPLE), 'utf8')
    expect(text).toContain('"use": "skill", "target": "acheron"')
    expect(text).not.toContain('hp_share')
  })

  it('validates from the command line', async () => {
    const r = await cli(['validate', EXAMPLE])
    expect(r).toMatchObject({ code: 0, err: '' })
    expect(r.out).toBe(`${EXAMPLE}: OK (2 teams, enemy counts 1, 3, 5, 5 cycles)\n`)
  })
})

describe('nousr run on the example, in process', FULL_RUN, () => {
  it('prints the tables and writes a result that matches the schema and the engine\'s own numbers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nousr-cli-'))
    const out = join(dir, 'result.json')
    const r = await cli(['run', EXAMPLE, '-o', out, '--cycles'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('Total damage')
    expect(r.out).toContain('sw_welt_dhpt (baseline)')
    expect(r.out).toContain('Damage per cycle, 5 enemies')

    const result = JSON.parse(readFileSync(out, 'utf8')) as NousrResult
    expect(resultProblems(result)).toEqual([])
    expect(result.runs).toHaveLength(6)
    expect(result.generator.kernel).toBe(KERNEL_ID)
    expect(result.comparison.baseline).toBe('sw_welt_dhpt')
    expect(result.comparison.ratios.map((x) => [x.team, x.enemy_count])).toEqual([
      ['sw_tribbie_dhpt', 1], ['sw_tribbie_dhpt', 3], ['sw_tribbie_dhpt', 5],
    ])

    // The same numbers the engine gives when called directly: the report adds nothing and rounds nothing.
    const direct = runScenario(loadScenarioFile(repoPath(EXAMPLE)), { kernel: new FribbelsKernel() })
    expect(result.runs.map((x) => x.total)).toEqual(direct.map((x) => x.result.totalDamage))

    for (const run of result.runs) {
      expect(run.by_member.reduce((sum, m) => sum + m.share, 0)).toBeCloseTo(1, 12)
      // Reaction damage (Tribbie's Additional DMG) is credited to the action that set it off (K35): the log adds up to the total.
      const inActions = run.actions!.reduce((sum, a) => sum + a.damage, 0) + (run.unattributed ?? 0)
      expect(run.unattributed).toBeUndefined() // the example has no damage outside an action and its reactions
      expect(Math.abs(inActions - run.total)).toBeLessThan(1e-9 * run.total)
      expect(run.window).toEqual({ cycles: 5, action_value: 550 })
    }
    // The standard builds and members are echoed for every member of both teams.
    for (const team of result.teams) {
      expect(team.members).toHaveLength(4)
      expect(team.standard_builds).toHaveLength(4)
      expect(team.members.every((m) => m.relics === 'standard' && m.stats.spd > 100)).toBe(true)
    }
    expect(result.teams[0]!.members[0]).toMatchObject({ key: 'acheron', character: '1308', eidolon: 1, affinitive_eidolon: true })
  })

  it('--json prints the same document on stdout', async () => {
    const r = await cli(['run', EXAMPLE, '--json', '--enemies', '1', '--teams', 'sw_welt_dhpt', '--no-log'])
    expect(r.code).toBe(0)
    const result = JSON.parse(r.out) as NousrResult
    expect(resultProblems(result)).toEqual([])
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]).not.toHaveProperty('actions')
  })
})

describe('the kernel id in every result', () => {
  it('names the commit the Fribbels submodule is at', () => {
    const vendor = repoPath('vendor/hsr-optimizer')
    if (!existsSync(join(vendor, '.git'))) return
    let head: string
    try {
      head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: vendor, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
      return
    }
    expect(head.startsWith(KERNEL_ID.split('@')[1]!)).toBe(true)
  })
})
