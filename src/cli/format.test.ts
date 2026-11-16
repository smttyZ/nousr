import { describe, expect, it } from 'vitest'
import type { NousrResult, ResultAction, ResultRun } from '../result/types'
import { resultProblems } from '../result/validate'
import { formatInt, formatRatio, formatReport, formatShare } from './format'

const member = (key: string) => ({
  key,
  character: '9001',
  ability_version: 0,
  eidolon: 0,
  affinitive_eidolon: false,
  light_cone: { id: '20000', superimposition: 1 },
  relics: 'standard' as const,
  technique: true,
  stats: { spd: 134.5, hp: 1, def: 1, err: 0, effect_res: 0 },
})

const action = (serial: number, at: number, cycle: number, actor: string, kind: ResultAction['kind'], damage: number, before: number, after: number, owner?: string): ResultAction => ({
  serial, at, cycle, actor, ...(owner !== undefined && { owner }), action: kind === 'skill' ? 'Skill' : 'Basic', kind, damage, sp_before: before, sp_after: after, expected_enemies_hit: 1, debuffed: {},
})

function run(team: string, enemies: number, total: number, damages: [number, number], cycles: number[], extra: Partial<ResultRun> = {}): ResultRun {
  return {
    team,
    enemy_count: enemies,
    window: { cycles: 2, action_value: 250 },
    total,
    per_cycle: cycles,
    by_member: [
      { member: 'acheron', damage: damages[0], share: damages[0] / total, actions: { basic: 1, skill: 2, ultimate: 1, follow_up: 3 }, by_ability: {} },
      { member: 'welt', damage: damages[1], share: damages[1] / total, actions: { basic: 4, skill: 0, ultimate: 0, follow_up: 0 }, by_ability: {} },
    ],
    downed: [],
    objectives: { no_downed: true },
    actions: [
      action(1, 100, 1, 'acheron', 'skill', 1234567.89, 3, 2),
      action(2, 125.5, 1, 'netherwing', 'basic', 800, 2, 3, 'welt'),
    ],
    ...extra,
  }
}

/** A made-up result: two teams at 1 and 3 enemies, one run with a downed ally. Numbers chosen to exercise rounding and separators. */
const RESULT: NousrResult = {
  format: 'nousr-result',
  version: 1,
  game_version: '4.7',
  generator: { nousr: '0.1.0', nousr_commit: null, kernel: 'fribbels/hsr-optimizer@31644d9' },
  scenario: {
    path: 'examples/x.scenario.json',
    sha256: 'a'.repeat(64),
    content: {
      name: 'Example',
      battle: { cycles: 2, start: { energy: 0.5, skill_points: 3, techniques: true } },
      enemies: { profile: 'generic-moc', weaknesses: 'all' },
    },
  },
  teams: [{ id: 'base', members: [member('acheron'), member('welt')] }, { id: 'other', members: [member('acheron'), member('welt')] }],
  runs: [
    run('base', 1, 2_000_000, [1_500_000, 500_000], [1_200_000, 800_000]),
    run('base', 3, 6_000_000.4, [4_500_000, 1_500_000.4], [3_000_000, 3_000_000.4]),
    run('other', 1, 2_500_000, [2_000_000, 500_000], [1_000_000, 1_500_000]),
    run('other', 3, 5_000_000, [4_000_000, 1_000_000], [2_500_000, 2_500_000], {
      downed: [{ member: 'welt', at: 212.34, cycle: 2 }],
      objectives: { no_downed: false },
    }),
  ],
  comparison: {
    baseline: 'base',
    ratios: [
      { team: 'other', enemy_count: 1, ratio: 1.25 },
      { team: 'other', enemy_count: 3, ratio: 5_000_000 / 6_000_000.4 },
    ],
  },
  warnings: [],
}

describe('the table layout', () => {
  it('the fixture is a valid result', () => {
    expect(resultProblems(RESULT)).toEqual([])
  })

  it('prints the header, the totals with ratios and a block per team and enemy count', () => {
    expect(formatReport(RESULT)).toMatchInlineSnapshot(`
      "NouSR 0.1.0 · kernel fribbels/hsr-optimizer@31644d9 · game 4.7
      Scenario: Example (examples/x.scenario.json)
      MoC, 2 cycles (250 AV), generic-moc, weakness: all, start 50% energy, 3 SP, techniques on

      Total damage              1 enemy         3 enemies
                           total  ratio      total  ratio
      base (baseline)  2,000,000  1.000  6,000,000  1.000
      other            2,500,000  1.250  5,000,000  0.833

      base, 1 enemy     damage  share  basic  skill  ult  fup
        acheron      1,500,000  75.0%      1      2    1    3
        welt           500,000  25.0%      4      0    0    0
        downed: none

      other, 1 enemy     damage  share  basic  skill  ult  fup
        acheron       2,000,000  80.0%      1      2    1    3
        welt            500,000  20.0%      4      0    0    0
        downed: none

      base, 3 enemies     damage  share  basic  skill  ult  fup
        acheron        4,500,000  75.0%      1      2    1    3
        welt           1,500,000  25.0%      4      0    0    0
        downed: none

      other, 3 enemies     damage  share  basic  skill  ult  fup
        acheron         4,000,000  80.0%      1      2    1    3
        welt            1,000,000  20.0%      4      0    0    0
        downed: welt (cycle 2, AV 212.3)
      "
    `)
  })

  it('--cycles adds a per-cycle table per enemy count', () => {
    expect(formatReport(RESULT, { cycles: true }).split('\n\n').filter((b) => b.startsWith('Damage per cycle'))).toMatchInlineSnapshot(`
      [
        "Damage per cycle, 1 enemy         C1         C2
        base                     1,200,000    800,000
        other                    1,000,000  1,500,000",
        "Damage per cycle, 3 enemies         C1         C2
        base                       3,000,000  3,000,000
        other                      2,500,000  2,500,000
      ",
      ]
    `)
  })

  it("--log prints one run's action log, a memosprite under its owner", () => {
    expect(formatReport(RESULT, { logs: [{ team: 'base', enemyCount: 1 }] }).split('\n\n').at(-1)).toMatchInlineSnapshot(`
      "Action log: base, 1 enemy
      #     AV  cycle  actor              action  kind      damage  SP
      1  100.0      1  acheron            Skill   skill  1,234,568  3 -> 2
      2  125.5      1  netherwing (welt)  Basic   basic        800  2 -> 3
      "
    `)
  })

  it('a --log for a result without a log says so instead of failing', () => {
    const noLog: NousrResult = { ...RESULT, runs: RESULT.runs.map(({ actions: _a, ...r }) => r) }
    expect(formatReport(noLog, { logs: [{ team: 'base', enemyCount: 1 }] })).toContain('(this result has no action log)')
  })

  it('shows only the counts and teams that are in the result', () => {
    const only: NousrResult = {
      ...RESULT,
      teams: [RESULT.teams[1]!],
      runs: RESULT.runs.filter((r) => r.team === 'other' && r.enemy_count === 3),
      comparison: { baseline: 'other', ratios: [] },
    }
    expect(formatReport(only)).toMatchInlineSnapshot(`
      "NouSR 0.1.0 · kernel fribbels/hsr-optimizer@31644d9 · game 4.7
      Scenario: Example (examples/x.scenario.json)
      MoC, 2 cycles (250 AV), generic-moc, weakness: all, start 50% energy, 3 SP, techniques on

      Total damage             3 enemies
                            total  ratio
      other (baseline)  5,000,000  1.000

      other, 3 enemies     damage  share  basic  skill  ult  fup
        acheron         4,000,000  80.0%      1      2    1    3
        welt            1,000,000  20.0%      4      0    0    0
        downed: welt (cycle 2, AV 212.3)
      "
    `)
  })

  it('a null ratio prints n/a', () => {
    const nulled: NousrResult = { ...RESULT, comparison: { baseline: 'base', ratios: RESULT.comparison.ratios.map((r) => ({ ...r, ratio: null })) } }
    expect(formatReport(nulled)).toContain('n/a')
  })
})

describe('number formats', () => {
  it('rounds totals to integers with thousands separators, ratios to 3 decimals, shares to 1', () => {
    expect(formatInt(1234567.5)).toBe('1,234,568')
    expect(formatInt(999.4)).toBe('999')
    expect(formatInt(0)).toBe('0')
    expect(formatRatio(1.4339)).toBe('1.434')
    expect(formatRatio(null)).toBe('n/a')
    expect(formatShare(0.88846)).toBe('88.8%')
  })
})
