import { describe, expect, it } from 'vitest'
import { createRegistry, lightConeWithoutBehaviour, setWithoutBehaviour } from '../equipment/equipment'
import { fakeResult } from '../kernel/testing'
import type { BasicStats, KernelBuild, KernelUnit, ScenarioKernel } from '../kernel/types'
import type { RegisteredKit } from '../kits/index'
import type { Kit } from '../kits/kit'
import { buildBattleSetup, planTeam } from '../run/run'
import { parseScenario, ScenarioError } from '../scenario/load'
import type { AccountScan, MemberFile, ScenarioFile } from '../scenario/types'
import { describeBelowMax, LevelView, loadLevelTable, lockedMinorPoints, maxAbilityLevel, maxLevels } from './levels'

/**
 * Levels from the scan to the member (K15, K18): the scan's `skills`, `memosprite` and `traces` reach `Member.levels`, a member's
 * `levels` overrides them, the locked minor traces reach the kernel unit, and what a kit does not follow warns. Synthetic scans
 * only: nothing here is read from a real account.
 */

const CYRENE = '1415'
const ACHERON = '1308'

const TRACE_KEYS = ['ability_1', 'ability_2', 'ability_3', ...Array.from({ length: 10 }, (_, i) => `stat_${i + 1}`)]
/** A scan character's `traces`: everything unlocked except the named keys. */
const traces = (locked: string[] = []) => Object.fromEntries(TRACE_KEYS.map((k) => [k, !locked.includes(k)]))

const cyreneScan = (overrides: Record<string, unknown> = {}) => ({
  id: CYRENE,
  eidolon: 0,
  ability_version: 0,
  // Three abilities at level 1 and five minor traces locked (S3, S4, S5, S7, S10), like the character the feature was written for.
  skills: { basic: 1, skill: 10, ult: 1, talent: 10 },
  memosprite: { skill: 6, talent: 1 },
  traces: traces(['stat_3', 'stat_4', 'stat_5', 'stat_7', 'stat_10']),
  ...overrides,
})
const acheronScan = (overrides: Record<string, unknown> = {}) => ({
  id: ACHERON,
  eidolon: 0,
  ability_version: 0,
  skills: { basic: 6, skill: 10, ult: 10, talent: 10 },
  traces: traces(),
  ...overrides,
})

function scan(characters: unknown[]): AccountScan {
  return {
    source: 'reliquary_archiver',
    version: 4,
    characters,
    light_cones: [
      { id: '20000', superimposition: 1, location: CYRENE },
      { id: '20000', superimposition: 1, location: ACHERON },
    ],
    relics: [],
  } as AccountScan
}

const STAND_IN: Omit<Kit, 'characterId' | 'levelsModelled'> = {
  path: 'Remembrance',
  element: 'Ice',
  maxEnergy: 0,
  abilityVersions: [0],
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'basic', 'basic', () => {
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
          }),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
}
const standIn = (characterId: string, levelsModelled?: Kit['levelsModelled']): RegisteredKit => {
  const kit: Kit = { ...STAND_IN, characterId, ...(levelsModelled !== undefined && { levelsModelled }) }
  // Cyrene takes kit options (a schema exists for her), so the registry entry must be able to configure one.
  return { name: `stand-in ${characterId}`, kit, configure: () => kit }
}

const BASIC: BasicStats = { ATK: 3000, DEF: 1200, HP: 1_000_000, SPD: 134.5, CR: 0.5, CD: 1, EHR: 0, RES: 0.35, BE: 0, ERR: 0, OHB: 0, baseSPD: 101 }
const build: KernelBuild = { relicSet1: 'Set A', relicSet2: 'Set A', ornamentSet: 'Ornament', body: 'CRIT DMG', feet: 'SPD', planarSphere: 'Ice DMG Boost', linkRope: 'HP%', substatRolls: {} }
const equipment = createRegistry([
  lightConeWithoutBehaviour({ id: '20000', name: 'Fake Cone', reason: 'test item' }),
  setWithoutBehaviour({ type: 'relic', name: 'Set A', reason: 'test item' }),
  setWithoutBehaviour({ type: 'ornament', name: 'Ornament', reason: 'test item' }),
])

function fakeKernel() {
  const units: KernelUnit[] = []
  const kernel: ScenarioKernel = {
    characterId: (gameId) => gameId,
    basicStats(unit) {
      units.push(unit)
      return { ...BASIC }
    },
    scanSource: () => ({ speedVerified: true }),
    actionDamage: () => fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] }, { ...BASIC }),
  }
  return { kernel, units }
}

function scenario(members: MemberFile[], account?: AccountScan): ScenarioFile {
  return {
    format: 'nousr-scenario',
    version: 1,
    game_version: '4.7',
    ...(account !== undefined && { account }),
    battle: { mode: 'moc', cycles: 1, period: null },
    enemies: { profile: 'generic-moc', counts: [1] },
    teams: [{ id: 'team', members, policy: members.map((m) => ({ unit: m.key, use: 'basic' })) }],
  }
}
const cyreneMember = (extra: Partial<MemberFile> = {}): MemberFile => ({ key: 'cyrene', character: CYRENE, relics: 'standard', ...extra })

function plan(file: ScenarioFile, kits: ReadonlyMap<string, RegisteredKit>) {
  const { kernel, units } = fakeKernel()
  const resolved = parseScenario(file)
  const result = planTeam(resolved, 'team', 1, { kernel, kits, equipment, standardBuild: () => build })
  return { resolved, units, ...result }
}
const kitsOf = (...entries: RegisteredKit[]): ReadonlyMap<string, RegisteredKit> => new Map(entries.map((e) => [e.kit.characterId, e]))

const problemsOf = (file: ScenarioFile): string[] => {
  try {
    parseScenario(file)
  } catch (error) {
    expect(error).toBeInstanceOf(ScenarioError)
    return (error as ScenarioError).problems
  }
  return []
}

describe('the scan\'s levels reach the member', () => {
  it('reads abilities, the memosprite and both kinds of trace (default with an account: "scan")', () => {
    const { resolved } = plan(scenario([cyreneMember()], scan([cyreneScan()])), kitsOf(standIn(CYRENE)))
    const levels = resolved.teams[0]!.members[0]!.levels!
    expect(levels.source).toBe('scan')
    expect(levels.abilities).toEqual({ basic: 1, skill: 10, ult: 1, talent: 10, memo_skill: 6, memo_talent: 1 })
    expect(levels.majorTraces).toEqual([true, true, true])
    expect(levels.minorTraces).toEqual([true, true, false, false, false, true, false, true, true, false])
    expect(levels.scanMissing).toBeUndefined()
  })

  it('gives the kernel unit exactly the locked minor traces, by PointID, and the kit the view', () => {
    const { units, setup } = (() => {
      const p = plan(scenario([cyreneMember()], scan([cyreneScan()])), kitsOf(standIn(CYRENE)))
      return { units: p.units, setup: p.setup }
    })()
    const member = setup.members[0]!
    expect(member.kernel.unit.deactivatedTraces).toEqual(['1415203', '1415204', '1415205', '1415207', '1415210'])
    expect(units[0]!.deactivatedTraces).toEqual(['1415203', '1415204', '1415205', '1415207', '1415210'])
    expect(member.levels).toBeInstanceOf(LevelView)
    expect(member.levels!.level('basic')).toBe(1)
    expect(member.levels!.max('basic')).toBe(6)
    expect(member.levels!.below('skill')).toBe(false)
    expect(member.levels!.minor(3)).toBe(false)
    expect(member.levels!.major(3)).toBe(true)
  })

  it('a fully built scan leaves the unit alone and the kits at a ratio of exactly 1', () => {
    const { setup, levels } = plan(scenario([{ key: 'acheron', character: ACHERON, relics: 'standard' }], scan([acheronScan()])), kitsOf(standIn(ACHERON)))
    expect(setup.members[0]!.kernel.unit.deactivatedTraces).toBeUndefined()
    expect(setup.members[0]!.levels!.ratio('skill', '130802', 0)).toBe(1)
    expect(setup.members[0]!.levels!.delta('skill', '130802', 0)).toBe(0)
    expect(levels[0]!.abilities).toEqual(levels[0]!.maxAbilities)
  })

  it('the run echoes the levels used, with each ability\'s maximum for the eidolon', () => {
    const { levels } = plan(scenario([cyreneMember()], scan([cyreneScan()])), kitsOf(standIn(CYRENE)))
    expect(levels).toEqual([
      {
        member: 'cyrene',
        source: 'scan',
        abilities: { basic: 1, skill: 10, ult: 1, talent: 10, memo_skill: 6, memo_talent: 1 },
        maxAbilities: { basic: 6, skill: 10, ult: 10, talent: 10, memo_skill: 6, memo_talent: 6 },
        majorTraces: [true, true, true],
        minorTraces: [true, true, false, false, false, true, false, true, true, false],
      },
    ])
  })

  it('"max" (and no account) is everything at maximum for the eidolon: E3 Cyrene has Ultimate 12', () => {
    const noAccount = plan(scenario([cyreneMember({ eidolon: 3, light_cone: { id: '20000', superimposition: 1 } })]), kitsOf(standIn(CYRENE)))
    const levels = noAccount.resolved.teams[0]!.members[0]!.levels!
    expect(levels.source).toBe('max')
    expect(levels.abilities.ult).toBe(12)
    expect(levels.abilities.memo_skill).toBe(7)
    expect(levels.abilities.basic).toBe(6)
    const withAccount = plan(scenario([cyreneMember({ levels: 'max' })], scan([cyreneScan()])), kitsOf(standIn(CYRENE)))
    expect(withAccount.resolved.teams[0]!.members[0]!.levels!.source).toBe('max')
    expect(withAccount.setup.members[0]!.kernel.unit.deactivatedTraces).toBeUndefined()
  })

  it('a character with no level table has no levels and nothing is modelled for it', () => {
    const file = scenario([{ key: 'made_up', character: '9001', eidolon: 0, light_cone: { id: '20000', superimposition: 1 }, relics: 'standard' }])
    expect(parseScenario(file).teams[0]!.members[0]!.levels).toBeUndefined()
    // ... and an explicit `levels` object is refused, since there is nothing to check it against.
    const given = scenario([{ key: 'made_up', character: '9001', eidolon: 0, light_cone: { id: '20000', superimposition: 1 }, relics: 'standard', levels: { abilities: { skill: 1 } } }])
    expect(problemsOf(given).join('\n')).toContain('there is no level table for this character')
  })
})

describe('a scenario overrides the scan, per member and per item', () => {
  it('names abilities and traces; the rest keeps what the scan says (source "scenario")', () => {
    const { resolved, setup } = plan(
      scenario([cyreneMember({ levels: { abilities: { basic: 6, ult: 10 }, traces: { minor: { unlocked: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } } } })], scan([cyreneScan()])),
      kitsOf(standIn(CYRENE)),
    )
    const levels = resolved.teams[0]!.members[0]!.levels!
    expect(levels.source).toBe('scenario')
    expect(levels.abilities).toEqual({ basic: 6, skill: 10, ult: 10, talent: 10, memo_skill: 6, memo_talent: 1 })
    expect(levels.minorTraces.every(Boolean)).toBe(true)
    expect(setup.members[0]!.kernel.unit.deactivatedTraces).toBeUndefined()
  })

  it('"locked" locks the named minor traces and "base": "max" ignores the scan', () => {
    const { setup, resolved } = plan(
      scenario([cyreneMember({ levels: { base: 'max', abilities: { basic: 2 }, traces: { minor: { locked: [3, 10] } } } })], scan([cyreneScan()])),
      kitsOf(standIn(CYRENE)),
    )
    const levels = resolved.teams[0]!.members[0]!.levels!
    expect(levels.abilities.ult).toBe(10)
    expect(levels.abilities.basic).toBe(2)
    expect(setup.members[0]!.kernel.unit.deactivatedTraces).toEqual(['1415203', '1415210'])
  })

  it('works without an account too, from "max"', () => {
    const file = scenario([cyreneMember({ eidolon: 0, light_cone: { id: '20000', superimposition: 1 }, levels: { abilities: { skill: 1 } } })])
    expect(parseScenario(file).teams[0]!.members[0]!.levels!.abilities.skill).toBe(1)
  })
})

describe('illegal levels are reported together, naming the legal range', () => {
  const noAccount = (levels: MemberFile['levels'], extra: Partial<MemberFile> = {}) =>
    scenario([cyreneMember({ eidolon: 0, light_cone: { id: '20000', superimposition: 1 }, levels, ...extra })])

  it('a level above the eidolon\'s maximum or below 1', () => {
    expect(problemsOf(noAccount({ abilities: { skill: 13 } }))).toEqual([
      expect.stringContaining('levels.abilities.skill is 13, but at E0 1415\'s skill goes from 1 up to 10'),
    ])
    expect(problemsOf(noAccount({ abilities: { ult: 11 } }, { eidolon: 3 }))).toEqual([]) // E3 gives Ultimate 12
    expect(problemsOf(noAccount({ abilities: { ult: 13 } }, { eidolon: 3 }))).toEqual([expect.stringContaining('up to 12 (12 at E3)')])
    expect(problemsOf(noAccount({ abilities: { basic: 0 } }))).not.toEqual([]) // schema: minimum 1
  })

  it('an ability the character does not have', () => {
    const file = scenario([{ key: 'acheron', character: ACHERON, eidolon: 0, light_cone: { id: '20000', superimposition: 1 }, levels: { abilities: { memo_skill: 3, elation: 1 } } }])
    const problems = problemsOf(file)
    expect(problems).toHaveLength(2)
    expect(problems.join('\n')).toContain('has no memo_skill ability')
    expect(problems.join('\n')).toContain('has no elation ability')
  })

  it('a minor trace unlocked while its prerequisite is locked names both', () => {
    // S2 needs S1; S4 needs major trace B1.
    const problems = problemsOf(noAccount({ traces: { minor: { unlocked: [2] } } }))
    expect(problems.join('\n')).toContain('trace S2 is unlocked but S1, which it needs, is locked')
    const major = problemsOf(noAccount({ traces: { major: [false, true, true], minor: { unlocked: [4] } } }))
    expect(major.join('\n')).toContain('trace S4 is unlocked but B1, which it needs, is locked')
  })

  it('major traces need exactly 3 entries; minor accepts one of locked or unlocked', () => {
    expect(problemsOf(noAccount({ traces: { major: [true, true] } })).join('\n')).toContain('exactly 3 entries')
    expect(problemsOf(noAccount({ traces: { minor: { locked: [1], unlocked: [2] } } } as never))).not.toEqual([])
    expect(problemsOf(noAccount({ traces: { minor: { locked: [11] } } }))).not.toEqual([])
    expect(problemsOf(noAccount({ nonsense: 1 } as never))).not.toEqual([])
  })

  it('"scan" with no account', () => {
    expect(problemsOf(noAccount('scan')).join('\n')).toContain('needs an account')
  })

  it('a stale scan (levels above what an eidolon override allows) is an error with the way out', () => {
    const stale = scan([cyreneScan({ eidolon: 3, skills: { basic: 1, skill: 10, ult: 12, talent: 12 }, memosprite: { skill: 7, talent: 1 } })])
    expect(problemsOf(scenario([cyreneMember({ eidolon: 0 })], stale)).join('\n')).toMatch(/goes from 1 up to 10.*Set "eidolon" to match the scan, or "levels": "max"/)
    // The same scan with its own eidolon is fine.
    expect(problemsOf(scenario([cyreneMember()], stale))).toEqual([])
  })

  it('a scan that breaks the prerequisite rule (a mapping the loader would otherwise trust blindly)', () => {
    const broken = scan([cyreneScan({ traces: traces(['stat_1']) })]) // S2 and S3 need S1
    expect(problemsOf(scenario([cyreneMember()], broken)).join('\n')).toContain('trace S2 is unlocked but S1')
  })
})

describe('a scan without levels', () => {
  it('"scan" falls back to maximum and the run says so (info)', () => {
    const bare = scan([{ id: CYRENE, eidolon: 0, ability_version: 0 }])
    const { warnings, resolved } = plan(scenario([cyreneMember()], bare), kitsOf(standIn(CYRENE)))
    expect(resolved.teams[0]!.members[0]!.levels!.scanMissing).toBe(true)
    expect(warnings).toEqual([expect.objectContaining({ severity: 'info', code: 'levels-scan-missing', team: 'team', member: 'cyrene' })])
  })

  it('a partial scan (traces but no skills) counts as missing, not as guessed', () => {
    const half = scan([{ id: CYRENE, eidolon: 0, ability_version: 0, traces: traces() }])
    const { resolved } = plan(scenario([cyreneMember()], half), kitsOf(standIn(CYRENE)))
    expect(resolved.teams[0]!.members[0]!.levels!.scanMissing).toBe(true)
  })
})

describe('levels the kit does not follow warn instead of silently running full', () => {
  const warnings = (kit: RegisteredKit, account = scan([cyreneScan()])) =>
    plan(scenario([cyreneMember()], account), kitsOf(kit)).warnings.filter((w) => w.code === 'levels-not-modelled')

  it('a kit that models nothing: every ability below its maximum is named, with the level and the maximum', () => {
    const [w] = warnings(standIn(CYRENE))
    expect(w).toMatchObject({ severity: 'warning', code: 'levels-not-modelled', team: 'team', member: 'cyrene' })
    expect(w!.message).toContain('basic level 1 of 6')
    expect(w!.message).toContain('ult level 1 of 10')
    expect(w!.message).toContain('memo_talent level 1 of 6')
    expect(w!.message).not.toContain('skill level') // at maximum
    expect(w!.message).not.toContain('minor trace') // the kernel follows those
  })

  it('a kit that models some abilities names only the rest', () => {
    const [w] = warnings(standIn(CYRENE, { abilities: ['basic', 'ult'], majorTraces: [] }))
    expect(w!.message).toContain('memo_talent level 1 of 6')
    expect(w!.message).not.toContain('basic level')
    expect(w!.message).not.toContain('ult level')
  })

  it('no warning when the kit models everything that is below maximum', () => {
    expect(warnings(standIn(CYRENE, { abilities: ['basic', 'ult', 'memo_talent'], majorTraces: [] }))).toEqual([])
  })

  it('a locked major trace warns unless the kit models it', () => {
    const locked = scan([cyreneScan({ skills: { basic: 6, skill: 10, ult: 10, talent: 10 }, memosprite: { skill: 6, talent: 6 }, traces: traces(['ability_3', 'stat_8', 'stat_9', 'stat_10']) })])
    const unmodelled = warnings(standIn(CYRENE, { abilities: [], majorTraces: [1, 2] }), locked)
    expect(unmodelled).toHaveLength(1)
    expect(unmodelled[0]!.message).toContain('major trace B3 locked')
    expect(warnings(standIn(CYRENE, { abilities: [], majorTraces: [1, 2, 3] }), locked)).toEqual([])
  })

  it('a fully built member never warns', () => {
    const full = scan([cyreneScan({ skills: { basic: 6, skill: 10, ult: 10, talent: 10 }, memosprite: { skill: 6, talent: 6 }, traces: traces() })])
    expect(warnings(standIn(CYRENE), full)).toEqual([])
  })

  it('the warning reaches the member of the right team only', () => {
    const file = scenario([cyreneMember(), { key: 'acheron', character: ACHERON, relics: 'standard' }], scan([cyreneScan(), acheronScan()]))
    const p = plan(file, kitsOf(standIn(CYRENE), standIn(ACHERON)))
    expect(p.warnings.filter((w) => w.code === 'levels-not-modelled').map((w) => w.member)).toEqual(['cyrene'])
  })
})

describe('the level tables and views', () => {
  const cyrene = loadLevelTable(CYRENE, 0)!

  it('legal maxima follow the eidolon: Cyrene E3 gets Ultimate +2 and Memosprite Skill +1, E5 Skill +2', () => {
    expect(maxAbilityLevel(cyrene, 'ult', 0)).toBe(10)
    expect(maxAbilityLevel(cyrene, 'ult', 3)).toBe(12)
    expect(maxAbilityLevel(cyrene, 'memo_skill', 3)).toBe(7)
    expect(maxAbilityLevel(cyrene, 'skill', 3)).toBe(10)
    expect(maxAbilityLevel(cyrene, 'skill', 5)).toBe(12)
  })

  it('ratio and delta are value(level) over / minus value(max), and 1 / 0 at the maximum', () => {
    const levels = maxLevels(cyrene, 0)
    levels.abilities.skill = 1
    const view = new LevelView(cyrene, levels, 0)
    // Zone True DMG: 12% at level 1, 24% at level 10 (the table's parameter 0 of skill 141502).
    expect(view.ratio('skill', '141502', 0)).toBeCloseTo(0.5, 12)
    expect(view.delta('skill', '141502', 0)).toBeCloseTo(-0.12, 12)
    expect(view.ratio('ult', '141503', 2)).toBe(1)
    expect(view.delta('ult', '141503', 2)).toBe(0)
  })

  it('describeBelowMax and lockedMinorPoints agree with the flags', () => {
    const levels = maxLevels(cyrene, 0)
    levels.abilities.basic = 2
    levels.majorTraces[1] = false
    levels.minorTraces[0] = false
    levels.minorTraces[9] = false
    expect(describeBelowMax(cyrene, levels, 0)).toEqual(['basic level 2 of 6', 'major trace B2 locked', 'minor traces S1, S10 locked'])
    expect(lockedMinorPoints(cyrene, levels)).toEqual(['1415201', '1415210'])
  })

  it('every roster table is found by id and version', () => {
    expect(loadLevelTable('1006', 1)!.abilities.skill!.skills['1100602']).toBeDefined()
    expect(loadLevelTable('1006', undefined)!.ability_version).toBe(1)
    expect(loadLevelTable('1415', 7)).toBeUndefined()
    expect(loadLevelTable('9999', undefined)).toBeUndefined()
  })
})

describe('the ability version the levels were checked against must be the one the run uses', () => {
  it('a kernel that resolves another version stops the run with a clear problem', () => {
    const { kernel } = fakeKernel()
    const resolved = parseScenario(scenario([{ key: 'sw', character: '1006', relics: 'standard', light_cone: { id: '20000', superimposition: 1 } }], scan([{ id: '1006', eidolon: 0, ability_version: 1, skills: { basic: 1, skill: 3, ult: 8, talent: 8 }, traces: traces() }])))
    expect(resolved.teams[0]!.members[0]!.levels!.abilityVersion).toBe(1)
    const swKernel: ScenarioKernel = { ...kernel, characterId: (id) => id } // resolves version 0
    expect(() => buildBattleSetup(resolved, 'team', 1, { kernel: swKernel, kits: kitsOf(standIn('1006')), equipment, standardBuild: () => build })).toThrow(/checked against ability version 1.*uses version 0/)
  })
})
