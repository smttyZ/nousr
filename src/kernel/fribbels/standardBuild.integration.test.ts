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

  it('Feet on ATK% warns that the SPD target was missed, by the real kernel\'s numbers', () => {
    const file = JSON.parse(readFileSync(resolve(FIXTURES, 'acheron-solo.scenario.json'), 'utf8')) as ScenarioFile
    file.teams[0]!.members[0]!.standard_build = { main_stats: { Feet: 'ATK%' } }
    const { warnings } = planTeam(parseScenario(file), 'acheron_solo', 1, options())
    expect(warnings).toEqual([expect.objectContaining({ severity: 'warning', code: 'spd-target-missed', team: 'acheron_solo', member: 'acheron' })])
    expect(warnings[0]!.message).toMatch(/target 133\.34 is missed by 23\.14: the build has 110\.20 out of combat/)
  })

  it('a standard file whose set has no equipment module stops the run with the existing equipment error', () => {
    // Jing Yuan: The Ashblazing Grand Duke and The Wondrous BananAmusement Park have no module yet.
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
    const attempt = () => planTeam(parseScenario(file), 'jy', 1, { kernel })
    expect(attempt).toThrow(RunError)
    expect(attempt).toThrow(/team "jy", member "jing_yuan": .*has no equipment module/)
  })
})
