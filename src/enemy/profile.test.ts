import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EnemyProfileError, loadEnemyProfile, parseEnemyProfile } from './profile'

const valid = () => ({
  format: 'nousr-enemy-profile',
  version: 1,
  id: 'test-enemy',
  level: 95,
  atk: 625.5,
  spd: 158.4,
  toughness: 360,
  res: 0.2,
  attacks: [
    { id: 'strike', target: 'single', multiplier: 2.5, energy: 10 },
    { id: 'cleave', target: 'blast', multiplier: 2.5, adjacent_multiplier: 1.8, energy: 10 },
    { id: 'flurry', target: 'bounce', multiplier: 0.6, hits: 5, energy: 5 },
    { id: 'sweep', target: 'aoe', multiplier: 3, energy: 10 },
  ],
  pattern: ['strike', 'cleave', 'flurry', 'sweep'],
})

function problemsOf(input: unknown): string[] {
  try {
    parseEnemyProfile(input)
  } catch (error) {
    if (error instanceof EnemyProfileError) return error.problems
    throw error
  }
  return []
}

describe('the generic Memory of Chaos profile', () => {
  it('loads by id with the decided numbers', () => {
    const p = loadEnemyProfile('generic-moc')
    expect(p).toMatchObject({ id: 'generic-moc', level: 95, atk: 625.5, spd: 158.4, hp: 2904993, toughness: 480, res: 0.2 })
  })

  it('attacks single, single, AoE, each giving 10 energy', () => {
    const p = loadEnemyProfile('generic-moc')
    expect(p.pattern.map((a) => [a.id, a.target, a.multiplier, a.energy])).toEqual([
      ['strike', 'single', 2.5, 10],
      ['strike', 'single', 2.5, 10],
      ['sweep', 'aoe', 3, 10],
    ])
  })
})

describe('parsing', () => {
  it('resolves the pattern to attacks and fills in hits and the adjacent multiplier', () => {
    const p = parseEnemyProfile(valid())
    expect(p.pattern.map((a) => a.id)).toEqual(['strike', 'cleave', 'flurry', 'sweep'])
    expect(p.attacks.find((a) => a.id === 'strike')).toEqual({
      id: 'strike', target: 'single', multiplier: 2.5, adjacentMultiplier: 0, hits: 1, energy: 10,
    })
    expect(p.attacks.find((a) => a.id === 'cleave')?.adjacentMultiplier).toBe(1.8)
    expect(p.attacks.find((a) => a.id === 'flurry')?.hits).toBe(5)
  })

  it('rejects unknown keys and bad values through the schema', () => {
    const file = { ...valid(), speed: 100, level: 0 }
    const problems = problemsOf(file).join('\n')
    expect(problems).toMatch(/must NOT have additional properties \("speed"\)/)
    expect(problems).toMatch(/\/level: must be >= 1/)
  })

  it('rejects a pattern entry that is not an attack, and duplicate attack ids', () => {
    const file = valid()
    file.pattern.push('roar')
    file.attacks.push({ id: 'strike', target: 'single', multiplier: 1, energy: 0 })
    expect(problemsOf(file)).toEqual([
      'attack id "strike" is used more than once',
      'pattern[4]: "roar" is not one of this profile\'s attacks',
    ])
  })

  it('rejects blast and bounce fields that are missing or misplaced', () => {
    const file = valid()
    file.attacks = [
      { id: 'a', target: 'blast', multiplier: 2, energy: 10 },
      { id: 'b', target: 'bounce', multiplier: 1, energy: 5 },
      { id: 'c', target: 'single', multiplier: 2, adjacent_multiplier: 1, energy: 10 },
      { id: 'd', target: 'aoe', multiplier: 2, hits: 3, energy: 10 },
    ] as never
    file.pattern = ['a']
    expect(problemsOf(file)).toEqual([
      'attack "a": a blast needs adjacent_multiplier',
      'attack "b": a bounce needs hits',
      'attack "c": adjacent_multiplier only applies to a blast',
      'attack "d": hits only applies to a bounce',
    ])
  })

  it('reports a profile that does not exist or has a malformed id', () => {
    expect(() => loadEnemyProfile('no-such-enemy')).toThrow(/cannot read enemy profile "no-such-enemy"/)
    expect(() => loadEnemyProfile('../secrets')).toThrow(/not a valid profile id/)
  })
})

describe('enemy HP in a profile', () => {
  it('is optional: a profile without it parses and has no hp', () => {
    expect(parseEnemyProfile(valid()).hp).toBeUndefined()
  })

  it('is read when given, and must be positive', () => {
    expect(parseEnemyProfile({ ...valid(), hp: 1_000_000 }).hp).toBe(1_000_000)
    expect(problemsOf({ ...valid(), hp: 0 }).join('\n')).toMatch(/\/hp: must be > 0/)
  })
})

describe('the test fixture profile', () => {
  it('has the same numbers as generic-moc except for its attack, so the kernel sees the same enemy', () => {
    const dummy = loadEnemyProfile('test-dummy', resolve(import.meta.dirname, '../run/fixtures'))
    const generic = loadEnemyProfile('generic-moc')
    expect({ level: dummy.level, atk: dummy.atk, spd: dummy.spd, hp: dummy.hp, toughness: dummy.toughness, res: dummy.res }).toEqual({
      level: generic.level, atk: generic.atk, spd: generic.spd, hp: generic.hp, toughness: generic.toughness, res: generic.res,
    })
  })
})
