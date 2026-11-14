import { describe, expect, it } from 'vitest'
import { formatWarning, type RunWarning } from './warnings'

const warning: RunWarning = {
  severity: 'warning',
  code: 'spd-target-missed',
  message: 'The SPD target 133.34 is missed by 23.14.',
  team: 'solo',
  enemyCount: 3,
  member: 'striker',
}

describe('formatWarning', () => {
  it('puts a warning sign, then where it applies, then the message', () => {
    expect(formatWarning(warning)).toBe('⚠ team "solo", 3 enemies, member "striker": The SPD target 133.34 is missed by 23.14.')
  })

  it('names only the parts the warning has', () => {
    expect(formatWarning({ severity: 'warning', code: 'undecided-tie', message: 'm' })).toBe('⚠ m')
    expect(formatWarning({ ...warning, team: undefined, member: undefined, enemyCount: 1 })).toBe('⚠ 1 enemy: The SPD target 133.34 is missed by 23.14.')
  })

  it('wraps the text in ANSI red when asked, sign included, and not otherwise', () => {
    const plain = formatWarning(warning)
    expect(formatWarning(warning, { color: true })).toBe(`\u001B[31m${plain}\u001B[0m`)
    expect(formatWarning(warning, { color: false })).toBe(plain)
    expect(plain).not.toContain('\u001B')
  })

  it('an info line has its own sign and is never red', () => {
    const info: RunWarning = { severity: 'info', code: 'undecided-tie', message: 'fyi' }
    expect(formatWarning(info, { color: true })).toBe('ℹ fyi')
  })
})
