import { describe, expect, it } from 'vitest'
import { EXIT, parseCommandLine } from './args'

describe('command line parsing', () => {
  it('run takes one scenario and defaults every option off, with the log on', () => {
    expect(parseCommandLine(['run', 's.json'])).toEqual({
      command: 'run',
      scenario: 's.json',
      json: false,
      log: true,
      logRuns: [],
      cycles: false,
      noColor: false,
      strict: false,
    })
  })

  it('reads every option, and options may come before or after the scenario', () => {
    expect(parseCommandLine([
      'run', '-o', 'out.json', 's.json', '--baseline', 'b', '--teams', 'a, b,a', '--enemies', '3,1',
      '--no-log', '--log', 'a:1', '--log', 'b:3', '--cycles', '--no-color', '--strict',
    ])).toEqual({
      command: 'run',
      scenario: 's.json',
      out: 'out.json',
      json: false,
      baseline: 'b',
      teams: ['a', 'b'],
      enemies: [3, 1],
      log: false,
      logRuns: [{ team: 'a', enemyCount: 1 }, { team: 'b', enemyCount: 3 }],
      cycles: true,
      noColor: true,
      strict: true,
    })
    expect(parseCommandLine(['run', '--out=-', 's.json'])).toMatchObject({ out: '-' })
  })

  it('validate takes a scenario, --no-color and --strict', () => {
    expect(parseCommandLine(['validate', 's.json', '--strict'])).toEqual({ command: 'validate', scenario: 's.json', noColor: false, strict: true })
    expect(parseCommandLine(['validate', '--json', 's.json'])).toMatchObject({ command: 'error' })
  })

  it('version and help', () => {
    expect(parseCommandLine(['version'])).toEqual({ command: 'version' })
    expect(parseCommandLine(['--version'])).toEqual({ command: 'version' })
    expect(parseCommandLine(['--help'])).toEqual({ command: 'help' })
    expect(parseCommandLine(['run', '-h'])).toEqual({ command: 'help' })
  })

  it.each([
    [[], /no command/],
    [['frobnicate'], /unknown command "frobnicate"/],
    [['run'], /no scenario file/],
    [['run', 'a.json', 'b.json'], /expected one scenario file, got 2/],
    [['run', 's.json', '--nope'], /nope/],
    [['run', 's.json', '--out'], /argument missing|requires an argument|--out/i],
    [['run', 's.json', '--enemies', '0'], /--enemies takes whole numbers from 1 to 5/],
    [['run', 's.json', '--enemies', '6'], /--enemies/],
    [['run', 's.json', '--enemies', 'x'], /--enemies/],
    [['run', 's.json', '--teams', ','], /--teams needs/],
    [['run', 's.json', '--log', 'team'], /--log takes <team>:<enemy count>/],
    [['run', 's.json', '--log', 'a:9'], /--log takes/],
    [['run', 's.json', '--json', '-o', '-'], /both print the JSON to stdout/],
    [['run', 's.json', '--json', '--log', 'a:1'], /--log prints a table/],
    [['version', 'x'], /takes no arguments/],
  ] as [string[], RegExp][])('refuses %j', (argv, message) => {
    const parsed = parseCommandLine(argv)
    expect(parsed.command).toBe('error')
    expect((parsed as { message: string }).message).toMatch(message)
  })

  it('has the exit codes the proposal lists', () => {
    expect([EXIT.ok, EXIT.cannotRun, EXIT.badArguments, EXIT.warnings]).toEqual([0, 1, 2, 3])
  })
})
