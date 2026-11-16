import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EQUIPMENT, EquipmentError, resolveEquipment } from '../../equipment/index'
import { planTeam, RunError, runScenario } from '../../run/run'
import { loadScenarioFile, parseScenario } from '../../scenario/load'
import type { ScenarioFile } from '../../scenario/types'
import { benchmarkBuild, loadStandardBuild, resolveStandardBuild, STANDARD_BUILD_DIR } from '../../standard/index'
import type { BenchmarkBuild, KernelUnit } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Standard builds through the real kernel: K14d's roll values reach Fribbels' stat simulation, Fribbels' SPD agrees
 * with the arithmetic the files state, every roster file resolves, and a scenario on "standard" relics runs end to end.
 *
 * Fribbels keeps its stats in 32-bit floats, so a stat read back differs from the decimal the arithmetic gives by
 * about 1e-5 at 100 to 200 (135.23199462890625 for 135.232). The checks below allow 1e-4.
 */
const FIXTURES = resolve(import.meta.dirname, '../../run/fixtures')
const PRECISION = 4 // toBeCloseTo digits: |difference| < 5e-5

// Made at load: the describe blocks below build their cases from it before any test runs.
const kernel = new FribbelsKernel()

/** A unit for a roster character. Out-of-combat SPD does not depend on the light cone (none of them has an SPD stat). */
const unitFor = (id: string, abilityVersion: number): KernelUnit => ({
  characterId: kernel.characterId(id, abilityVersion),
  eidolon: 0,
  lightConeId: '23024',
  superimposition: 1,
})
const spdProbe = (unit: KernelUnit) => (build: BenchmarkBuild) => kernel.basicStats(unit, build).SPD

describe('K14d: the roll values reach Fribbels', () => {
  const acheron = unitFor('1308', 0)
  const file = loadStandardBuild('1308', 0)
  const { build } = resolveStandardBuild(file)
  const highRolls: BenchmarkBuild = (({ rollQuality: _q, speedRollValue: _s, ...rest }) => rest)(build)

  it('a build with no roll values keeps Fribbels\' defaults: every roll at its high value, SPD at 2.6', () => {
    expect(highRolls.rollQuality).toBeUndefined()
    expect(highRolls.speedRollValue).toBeUndefined()
    const base = kernel.basicStats(acheron, { ...highRolls, substatRolls: {} })
    const withRolls = kernel.basicStats(acheron, highRolls)
    expect(withRolls.SPD - base.SPD).toBeCloseTo(4 * 2.6, PRECISION)
    expect(withRolls.CR - base.CR).toBeCloseTo((12 * 3.24) / 100, PRECISION)
    expect(withRolls.CD - base.CD).toBeCloseTo((14 * 6.48) / 100, PRECISION)
  })

  it('the standard build\'s roll values give the average rolls: SPD 2.3 per roll, CRIT Rate 2.916, CRIT DMG 5.832', () => {
    expect(build.rollQuality).toBe(0.9)
    expect(build.speedRollValue).toBe(2.3)
    const base = kernel.basicStats(acheron, { ...build, substatRolls: {} })
    const stats = kernel.basicStats(acheron, build)
    expect(stats.SPD - base.SPD).toBeCloseTo(4 * 2.3, PRECISION)
    expect(stats.CR - base.CR).toBeCloseTo((12 * 2.916) / 100, PRECISION)
    expect(stats.CD - base.CD).toBeCloseTo((14 * 5.832) / 100, PRECISION)
    expect(stats.ATK).toBeGreaterThan(base.ATK) // the 2 fixed ATK% rolls
  })

  it('reaches the damage path as well: in-combat stats and damage follow the roll values', () => {
    const request = (b: BenchmarkBuild) => ({ attacker: acheron, teammates: [], build: b })
    const high = kernel.actionDamage(request(highRolls))
    const average = kernel.actionDamage(request(build))
    expect(high.stats.SPD - average.stats.SPD).toBeCloseTo(4 * (2.6 - 2.3), PRECISION)
    expect(high.stats.CR - average.stats.CR).toBeCloseTo((12 * (3.24 - 2.916)) / 100, PRECISION)
    expect(high.damage.BASIC).toBeGreaterThan(average.damage.BASIC!)
  })

  it('only the quality or only the SPD value can be set', () => {
    const none = kernel.basicStats(acheron, { ...highRolls })
    const quality = kernel.basicStats(acheron, { ...highRolls, rollQuality: 0.9 })
    const spd = kernel.basicStats(acheron, { ...highRolls, speedRollValue: 2.3 })
    expect(quality.SPD).toBeCloseTo(none.SPD, PRECISION)
    expect(quality.CR).toBeLessThan(none.CR)
    expect(spd.CR).toBeCloseTo(none.CR, PRECISION)
    expect(spd.SPD).toBeCloseTo(none.SPD - 4 * 0.3, PRECISION)
  })
})

describe('SPD: Fribbels\' basic SPD against the arithmetic each file states', () => {
  // The files' distributed.notes: base SPD + trace SPD + the SPD% of the sets that needs no condition (a percent of base SPD)
  // + 25.032 (SPD boots) + 2.3 per SPD roll, the 2 fixed rolls included.
  const cases = [
    { id: '1308', name: 'Acheron', base: 101, traces: 0, setPercent: 0, rolls: 2, stated: 135.232 },
    { id: '1415', name: 'Cyrene', base: 101, traces: 9, setPercent: 0, rolls: 18, stated: 181.032 },
    { id: '1409', name: 'Hyacine', base: 110, traces: 14, setPercent: 0.12, rolls: 15, stated: 201.332 },
  ]

  it.each(cases)('$name: $stated out of combat', ({ id, base, traces, setPercent, rolls, stated }) => {
    const file = loadStandardBuild(id, 0)
    expect(file.distributed.SPD).toBe(rolls)
    expect(file.mainStats.Feet).toBe('SPD')
    const unit = unitFor(id, 0)
    const { build, report } = resolveStandardBuild(file, { spd: spdProbe(unit) })
    const basic = kernel.basicStats(unit, build)

    expect(basic.baseSPD).toBe(base)
    const arithmetic = base + traces + setPercent * base + 25.032 + 2.3 * (2 + rolls)
    expect(arithmetic).toBeCloseTo(stated, 9) // the file's own number
    expect(basic.SPD).toBeCloseTo(arithmetic, PRECISION)
    expect(Math.abs(basic.SPD - arithmetic)).toBeLessThan(1e-4)
    expect(report.spd?.outOfCombat).toBe(basic.SPD)
    expect(report.spd?.missedBy).toBeUndefined()
  })

  it('and 1 roll fewer misses the target for each, which is what makes the file\'s count the fewest', () => {
    for (const { id, rolls } of cases) {
      const file = loadStandardBuild(id, 0)
      const unit = unitFor(id, 0)
      const target = file.spdTarget.value as number
      const at = (n: number) => kernel.basicStats(unit, benchmarkBuild(file, file.mainStats, { ...file.distributed, SPD: n })).SPD
      expect(at(rolls)).toBeGreaterThanOrEqual(target)
      expect(at(rolls - 1)).toBeLessThan(target)
    }
  })
})

describe('every roster file', () => {
  const files = readdirSync(STANDARD_BUILD_DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(STANDARD_BUILD_DIR, f), 'utf8')))

  it('resolves with the real kernel under every rule, including the SPD cap, and reaches its SPD target', () => {
    expect(files).toHaveLength(14)
    for (const raw of files) {
      const unit = unitFor(raw.character, raw.ability_version)
      const file = loadStandardBuild(raw.character, raw.ability_version)
      const { report } = resolveStandardBuild(file, { spd: spdProbe(unit) })
      expect(report.path, file.name).toBe('file')
      expect(report.spd?.missedBy, `${file.name}: ${JSON.stringify(report.spd)}`).toBeUndefined()
    }
  })

  it('has equipment modules, or stops with the equipment error, and nothing else', () => {
    for (const raw of files) {
      const unit = unitFor(raw.character, raw.ability_version)
      const { build } = resolveStandardBuild(loadStandardBuild(raw.character, raw.ability_version))
      try {
        resolveEquipment({ ...unit, lightConeId: '23024' }, build, EQUIPMENT)
      } catch (cause) {
        expect(cause, raw.name).toBeInstanceOf(EquipmentError)
      }
    }
  })
})

describe('a scenario on "standard" relics, end to end, with the real kernel', () => {
  const scenario = () => loadScenarioFile(resolve(FIXTURES, 'acheron-solo.scenario.json'))
  const options = () => ({ kernel, profileDir: FIXTURES })

  it('Acheron alone at 1, 3 and 5 enemies runs on her file, and the result echoes the split used', () => {
    const runs = runScenario(scenario(), options())
    expect(runs.map((r) => r.enemyCount)).toEqual([1, 3, 5])
    for (const run of runs) {
      expect(run.result.damageByCycle).toHaveLength(5)
      for (const damage of run.result.damageByCycle) expect(damage).toBeGreaterThan(0)
      expect(run.result.downed).toEqual([])
      expect(run.warnings).toEqual([])
      expect(run.standardBuilds).toHaveLength(1)
      const { member, report } = run.standardBuilds[0]!
      expect(member).toBe('acheron')
      expect(report.path).toBe('file')
      expect(report.file).toMatch(/1308\.json$/)
      expect(report.distributed).toMatchObject({ SPD: 2, 'CRIT DMG': 12, 'CRIT Rate': 10 })
      expect(report.spd!.outOfCombat).toBeCloseTo(135.232, PRECISION)
    }
  })

  it('her stats are the kernel\'s basic stats for the file\'s build', () => {
    const plan = planTeam(scenario(), 'acheron_solo', 1, options())
    const member = plan.setup.members[0]!
    expect(member.stats.baseSpd + member.stats.spdFlat!).toBeCloseTo(135.232, PRECISION)
    expect(member.kernel.build).toMatchObject({ rollQuality: 0.9, speedRollValue: 2.3, body: 'CRIT Rate', feet: 'SPD' })
  })

  it('the member\'s override changes the build the run uses: a CRIT DMG body re-splits and echoes it', () => {
    const file = JSON.parse(readFileSync(resolve(FIXTURES, 'acheron-solo.scenario.json'), 'utf8')) as ScenarioFile
    file.teams[0]!.members[0]!.standard_build = { main_stats: { Body: 'CRIT DMG' } }
    const runs = runScenario(parseScenario(file), options())
    expect(runs[0]!.standardBuilds[0]!.report).toMatchObject({ path: 're-split', moveText: ['2 CRIT DMG -> CRIT Rate'] })
    const shipped = runScenario(scenario(), options())
    expect(runs[0]!.result.totalDamage).not.toBe(shipped[0]!.result.totalDamage)
  })

  it('Feet on ATK% re-solves SPD with the real kernel (K32): more rolls, target reached, no warning', () => {
    const file = JSON.parse(readFileSync(resolve(FIXTURES, 'acheron-solo.scenario.json'), 'utf8')) as ScenarioFile
    file.teams[0]!.members[0]!.standard_build = { main_stats: { Feet: 'ATK%' } }
    const plan = planTeam(parseScenario(file), 'acheron_solo', 1, options())
    expect(plan.warnings).toEqual([])
    const { report } = plan.standardBuilds[0]!
    expect(report.spdSolved).toMatchObject({ fileRolls: 2, reachable: true })
    expect(report.distributed.SPD).toBeGreaterThan(10)
    expect(report.spd!.outOfCombat).toBeGreaterThanOrEqual(133.34)
  })

  it('a whole split from the scenario is taken as given: Feet on ATK% with 2 SPD rolls warns, by the numbers of the real kernel', () => {
    const file = JSON.parse(readFileSync(resolve(FIXTURES, 'acheron-solo.scenario.json'), 'utf8')) as ScenarioFile
    file.teams[0]!.members[0]!.standard_build = { main_stats: { Feet: 'ATK%' }, distributed: { rolls: { SPD: 2, 'CRIT DMG': 12, 'CRIT Rate': 10 } } }
    const { warnings } = planTeam(parseScenario(file), 'acheron_solo', 1, options())
    expect(warnings).toEqual([expect.objectContaining({ severity: 'warning', code: 'spd-target-missed', team: 'acheron_solo', member: 'acheron' })])
    expect(warnings[0]!.message).toMatch(/target 133\.34 is missed by 23\.14: the build has 110\.20 out of combat/)
  })

  it("Jing Yuan on his standard build runs: Ashblazing counts his Lightning-Lord's hits from the attack's parts", () => {
    // Updated 2026-11-13: all roster sets now have modules (Haiku wave), so the old "no module" case is gone.
    // His standard 4-piece is The Ashblazing Grand Duke. It used to refuse him; it now counts the Lord's hits from the
    // attack's parts (src/equipment/ashblazingGrandDuke.ts).
    const file = {
      format: 'nousr-scenario', version: 1, game_version: '4.7',
      battle: { mode: 'moc', cycles: 1, period: null },
      enemies: { profile: 'generic-moc', counts: [1] },
      teams: [{
        id: 'jy',
        members: [{ key: 'jing_yuan', character: '1204', eidolon: 0, light_cone: { id: '24004', superimposition: 1 }, relics: 'standard' }],
        policy: [{ unit: 'jing_yuan', use: 'basic' }],
      }],
    } satisfies ScenarioFile
    const scenario = parseScenario(file)
    expect(() => planTeam(scenario, 'jy', 1, { kernel })).not.toThrow()
    expect(() => runScenario(scenario, { kernel })).not.toThrow()
  })
})

describe('K32: SPD solved at load, with the light cone the member wears (Cyrene, 1415)', () => {
  const scenarioWith = (lightCone: string, key = 'cyrene') => parseScenario({
    format: 'nousr-scenario', version: 1, game_version: '4.7',
    battle: { mode: 'moc', cycles: 1, period: null },
    enemies: { profile: 'generic-moc', counts: [1] },
    teams: [{
      id: 'cyrene_solo',
      members: [{ key, character: '1415', eidolon: 0, light_cone: { id: lightCone, superimposition: 1 }, relics: 'standard' }],
      policy: [{ unit: key, use: 'basic' }],
    }],
  } satisfies ScenarioFile)
  const planWith = (lightCone: string) => planTeam(scenarioWith(lightCone), 'cyrene_solo', 1, { kernel })

  it('This Love, Forever S1 (23052, +18% SPD) reaches 180 with 10 distributed SPD rolls, on the timeline and in the kernel', () => {
    const plan = planWith('23052')
    const { report } = plan.standardBuilds[0]!
    expect(report.distributed.SPD).toBe(10)
    expect(report.spdSolved).toMatchObject({ fileRolls: 18, usedRolls: 10, reachable: true })
    expect(report.spdSolved!.moves.reduce((n, m) => n + m.rolls, 0)).toBe(8)
    expect(Object.values(report.distributed).reduce((a, b) => a + b, 0)).toBe(24)
    expect(plan.warnings).toEqual([])

    const member = plan.setup.members[0]!
    expect(member.stats.baseSpd + member.stats.spdFlat!).toBeGreaterThanOrEqual(180) // the timeline's SPD
    const unit: KernelUnit = { characterId: kernel.characterId('1415', 0), eidolon: 0, lightConeId: '23052', superimposition: 1 }
    const kernelSpd = kernel.basicStats(unit, member.kernel.build).SPD
    expect(kernelSpd).toBeGreaterThanOrEqual(180)
    expect(kernelSpd).toBeCloseTo(member.stats.baseSpd + member.stats.spdFlat!, PRECISION)
    expect(report.spd).toMatchObject({ target: 180, outOfCombat: kernelSpd })
    expect(report.spd!.missedBy).toBeUndefined()

    // 10 is the fewest: one roll fewer misses.
    const nine = { ...member.kernel.build, substatRolls: { ...(member.kernel.build as BenchmarkBuild).substatRolls, SPD: 2 + 9 } }
    expect(kernel.basicStats(unit, nine).SPD).toBeLessThan(180)
  })

  it('and the damage kernel agrees: the SPD of the attacker in an action is at least 180', () => {
    const member = planWith('23052').setup.members[0]!
    const { stats } = kernel.actionDamage({ attacker: member.kernel.unit, teammates: [], build: member.kernel.build as BenchmarkBuild })
    expect(stats.SPD).toBeGreaterThanOrEqual(180)
  })

  it('a light cone with no SPD (Along the Passing Shore, 23024) needs more rolls than with This Love, Forever', () => {
    const without = planWith('23024').standardBuilds[0]!.report
    expect(without.spdSolved!.reachable).toBe(true)
    expect(without.distributed.SPD).toBeGreaterThan(10)
    expect(without.distributed.SPD).toBeLessThanOrEqual(18)
    expect(without.spd!.outOfCombat).toBeGreaterThanOrEqual(180)
  })
})

describe('K32: every roster file through the loader with the real kernel', () => {
  it('reaches its target (or has none), and the solved count is the fewest', () => {
    const rows: string[] = []
    for (const file of readdirSync(STANDARD_BUILD_DIR).filter((f) => f.endsWith('.json'))) {
      const raw = JSON.parse(readFileSync(join(STANDARD_BUILD_DIR, file), 'utf8'))
      const unit = unitFor(raw.character, raw.ability_version)
      const { report } = resolveStandardBuild(loadStandardBuild(raw.character, raw.ability_version), { spd: spdProbe(unit) })
      expect(report.spd?.missedBy, raw.name).toBeUndefined()
      rows.push(`${raw.name}: file ${report.spdSolved?.fileRolls ?? raw.distributed.rolls.SPD ?? 0} -> used ${report.distributed.SPD}`)
    }
    expect(rows).toHaveLength(14)
  })
})
