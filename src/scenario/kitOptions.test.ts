import { describe, expect, it } from 'vitest'
import { defaultKitOptions, isFiniteOptionSchema, KIT_OPTION_SCHEMAS, resolveKitOptions } from './kitOptions'
import { parseScenario, ScenarioError } from './load'
import type { ScenarioFile } from './types'

const team = new Set(['castorice', 'cyrene', 'hyacine', 'robin'])
const resolve = (character: string, given: Record<string, unknown>) => {
  const problems: string[] = []
  const options = resolveKitOptions(character, given, team, 'here', problems)
  return { options, problems }
}

describe('kit-option schemas', () => {
  it('exist for Castorice and Cyrene', () => {
    expect([...KIT_OPTION_SCHEMAS.keys()].sort()).toEqual(['1407', '1415'])
  })

  it.each([...KIT_OPTION_SCHEMAS.entries()])('%s: every option has a finite domain and a default (searchable by an optimizer)', (_, schema) => {
    expect(isFiniteOptionSchema(schema)).toEqual([])
  })

  it('the finiteness check rejects an unbounded option and one with no default', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        open: { type: 'integer', minimum: 0, default: 0 },
        list: { type: 'array', items: { enum: ['a'] }, default: [] },
        nodefault: { enum: ['a', 'b'] },
        notes: { type: 'string' },
      },
    }
    expect(isFiniteOptionSchema(schema)).toEqual([
      'open: the domain is not finite',
      'list: the domain is not finite',
      'nodefault: no default (give "default" or "x-nousr-computed-default")',
    ])
  })
})

describe('resolving a member\'s kit options', () => {
  it('Castorice: fills the default (burn, finish turn 1)', () => {
    expect(defaultKitOptions('1407')).toEqual({ netherwing_finish_turn: 1 })
    expect(resolve('1407', {})).toEqual({ options: { netherwing_finish_turn: 1 }, problems: [] })
  })

  it('Castorice: takes 1 to 3 and refuses anything else or an unknown key', () => {
    expect(resolve('1407', { netherwing_finish_turn: 3 }).options).toEqual({ netherwing_finish_turn: 3 })
    expect(resolve('1407', { netherwing_finish_turn: 4 }).problems).toEqual(['here: kit_options.netherwing_finish_turn: must be <= 3'])
    expect(resolve('1407', { breaths: 2 }).problems).toEqual(['here: kit_options: must NOT have additional properties ("breaths")'])
  })

  it('Cyrene: an order of member keys and "attack"; after_order defaults to attack; the order has no fixed default', () => {
    const { options, problems } = resolve('1415', { demiurge_order: ['hyacine', 'castorice', 'robin', 'cyrene', 'attack'] })
    expect(problems).toEqual([])
    expect(options).toEqual({ demiurge_order: ['hyacine', 'castorice', 'robin', 'cyrene', 'attack'], after_order: 'attack' })
    expect(defaultKitOptions('1415')).toEqual({ after_order: 'attack' })
  })

  it('Cyrene: an entry that is neither a member of the team nor "attack" is refused, with its position', () => {
    expect(resolve('1415', { demiurge_order: ['hyacine', 'evernight'] }).problems).toEqual([
      'here: kit_options.demiurge_order[1] is "evernight", which is not a member key of this team or "attack"',
    ])
  })

  it('a character with no options schema takes none', () => {
    expect(defaultKitOptions('1308')).toBeUndefined()
    expect(resolve('1308', { x: 1 }).problems).toEqual([
      'here: kit_options given, but character 1308 takes none (no schema/kit-options/1308.schema.json)',
    ])
  })

  it('does not change the object it was given', () => {
    const given = {}
    resolve('1407', given)
    expect(given).toEqual({})
  })
})

describe('in a scenario', () => {
  const file = (members: ScenarioFile['teams'][number]['members']): ScenarioFile => ({
    format: 'nousr-scenario',
    version: 1,
    game_version: '4.7',
    battle: { mode: 'moc', cycles: 3 },
    enemies: { profile: 'generic-moc', counts: [1] },
    teams: [{ id: 't', members, policy: [{ unit: members[0]!.key, use: 'basic' }] }],
  })
  const member = (key: string, character: string, extra: object = {}) => ({
    key, character, eidolon: 0, light_cone: { id: '20000', superimposition: 1 }, ...extra,
  })

  it('resolves to the filled options and remembers which ones the scenario gave; checks keys against the whole team', () => {
    const scenario = parseScenario(file([
      member('cyrene', '1415', { kit_options: { demiurge_order: ['castorice', 'cyrene'] } }),
      member('castorice', '1407'),
    ]))
    const [cyrene, castorice] = scenario.teams[0]!.members
    expect(cyrene!.kitOptions).toEqual({ demiurge_order: ['castorice', 'cyrene'], after_order: 'attack' })
    expect(cyrene!.kitOptionsGiven).toEqual(['demiurge_order'])
    expect(castorice!.kitOptions).toEqual({ netherwing_finish_turn: 1 })
    expect(castorice!.kitOptionsGiven).toEqual([])
  })

  it('a character without options has none, and giving some is an error naming the member', () => {
    expect(parseScenario(file([member('acheron', '1308')])).teams[0]!.members[0]!.kitOptions).toBeUndefined()
    expect(() => parseScenario(file([member('acheron', '1308', { kit_options: { x: 1 } })]))).toThrow(ScenarioError)
    expect(() => parseScenario(file([member('acheron', '1308', { kit_options: { x: 1 } })]))).toThrow(
      /team "t", member "acheron": kit_options given, but character 1308 takes none/,
    )
  })

  it('kit_options must be an object', () => {
    expect(() => parseScenario(file([member('castorice', '1407', { kit_options: 3 })]))).toThrow(/kit_options: must be object/)
  })
})
