import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { SubStatValues } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { rollCounter } from '../../../vendor/hsr-optimizer/src/lib/importer/characterConverter'
import { ReliquaryArchiverParser } from '../../../vendor/hsr-optimizer/src/lib/importer/importConfig'
import { generateContext } from '../../../vendor/hsr-optimizer/src/lib/optimization/context/calculateContext'
import { BasicKey } from '../../../vendor/hsr-optimizer/src/lib/optimization/basicStatsArray'
import { RelicFilters } from '../../../vendor/hsr-optimizer/src/lib/relics/relicFilters'
import { simulateBuild } from '../../../vendor/hsr-optimizer/src/lib/simulations/simulateBuild'
import type { SimulationRelicByPart } from '../../../vendor/hsr-optimizer/src/lib/simulations/statSimulationTypes'
import { getGameMetadata } from '../../../vendor/hsr-optimizer/src/lib/state/gameMetadata'
import { normalizeForm } from '../../../vendor/hsr-optimizer/src/lib/stores/optimizerForm/optimizerFormConversions'
import type { Character } from '../../../vendor/hsr-optimizer/src/types/character'
import { buildBattleSetup, planTeam } from '../../run/run'
import { parseScenario } from '../../scenario/load'
import type { ScenarioFile } from '../../scenario/types'
import type { BasicStats, KernelUnit, ScannedBuild, ScannedRelic } from '../types'
import { FribbelsKernel } from './fribbelsKernel'
import { scannedRelicsByPart } from './scannedRelics'

const fixture = (name: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, '../../run/fixtures', name), 'utf8'))
const hsrScanner = fixture('scan-hsr-scanner.json') as { source: string, relics: ScannedRelic[] }
const archiver = fixture('scan-reliquary-archiver.json') as { source: string, relics: ScannedRelic[] }

const ACHERON = '1308'
const ALONG_THE_PASSING_SHORE = '23024'
const unit: KernelUnit = { characterId: ACHERON, eidolon: 0, lightConeId: ALONG_THE_PASSING_SHORE, superimposition: 1 }

const equipped = (scan: typeof archiver): ScannedBuild => ({
  source: scan.source,
  relics: scan.relics.filter((r) => r.location === ACHERON),
})
const uid = (scan: typeof archiver, id: string) => scan.relics.find((r) => r._uid === id)!

/** Fribbels' main stat at +15 for a 5-star relic: relic_main_affixes metadata, base + step * level. */
function mainValue(part: number, property: string): number {
  const affixes = Object.values(getGameMetadata().relics.relicMainAffixes[`5${part}`]!.affixes)
  const affix = affixes.find((a) => a.property === property)!
  return affix.base + affix.step * 15
}

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

describe('SPD from scanned relics (K5)', () => {
  // Head: one SPD substat, count 2, step 3 (Reliquary Archiver) or the rounded-down 4 (HSR-Scanner).
  // Feet: SPD main stat. Four Musketeer of Wild Wheat pieces: 4-piece gives +6% SPD.
  const feetMain = () => mainValue(4, 'SpeedDelta')

  it('count 2 and step 3 on a 5-star SPD substat is one high and one mid roll: 2.6 + 2.3 = 4.9', () => {
    // Fribbels' step is the sum of the roll tiers (0 low, 1 mid, 2 high) and its roll table is SubStatValues.
    expect(rollCounter(2, 3).rolls).toEqual({ high: 1, mid: 1, low: 0 })
    const spd = SubStatValues.SPD[5]
    expect(spd).toEqual({ high: 2.6, mid: 2.3, low: 2.0 })
    expect(spd.high + spd.mid).toBeCloseTo(4.9, 10)
    expect(uid(archiver, '1').substats[0]).toEqual({ key: 'SPD', value: 4.9, count: 2, step: 3 })
  })

  it('a Reliquary Archiver file gives exact SPD: base, 6% from the 4-piece, SPD boots main stat, 4.9', () => {
    const stats = kernel.basicStats(unit, equipped(archiver))
    expect(stats.SPD).toBeCloseTo(stats.baseSPD * 1.06 + feetMain() + 4.9, 3)
  })

  it('an HSR-Scanner file gives the rounded-down 4, as it is written', () => {
    const stats = kernel.basicStats(unit, equipped(hsrScanner))
    expect(stats.SPD).toBeCloseTo(stats.baseSPD * 1.06 + feetMain() + 4, 3)
    const exact = kernel.basicStats(unit, equipped(archiver)).SPD
    expect(exact - stats.SPD).toBeCloseTo(0.9, 3)
  })

  it('Fribbels does not rebuild SPD from count and step: the value in the file is the one used', () => {
    const lie = equipped(archiver)
    const head = { ...lie.relics[0]!, substats: [{ key: 'SPD', value: 3.6, count: 2, step: 3 }, ...lie.relics[0]!.substats.slice(1)] }
    const stats = kernel.basicStats(unit, { source: lie.source, relics: [head, ...lie.relics.slice(1)] })
    expect(stats.SPD).toBeCloseTo(stats.baseSPD * 1.06 + feetMain() + 3.6, 3)
  })

  it('scan sources report whether Fribbels trusts their SPD, and an unknown source is an error', () => {
    expect(kernel.scanSource('HSR-Scanner')).toEqual({ speedVerified: false })
    expect(kernel.scanSource('reliquary_archiver')).toEqual({ speedVerified: true })
    expect(() => kernel.scanSource('nope')).toThrow(/no reader for scan source "nope".*HSR-Scanner/)
  })
})

describe('main stats and set bonuses from scanned relics', () => {
  it('main stat values are Fribbels\' metadata values at the relic\'s level', () => {
    const build = equipped(archiver)
    const byPart = scannedRelicsByPart(build) as unknown as Record<string, { condensedStats: [number, number][] }>
    const mainOf = (part: string) => byPart[part]!.condensedStats.at(-1)!
    expect(mainOf('Head')).toEqual([BasicKey.HP, expect.closeTo(mainValue(1, 'HPDelta'), 3)])
    expect(mainOf('Hands')).toEqual([BasicKey.ATK, expect.closeTo(mainValue(2, 'AttackDelta'), 3)])
    expect(mainOf('Feet')).toEqual([BasicKey.SPD, expect.closeTo(mainValue(4, 'SpeedDelta'), 3)])
    // Percent stats are fractions in the simulation.
    expect(mainOf('Body')).toEqual([BasicKey.CD, expect.closeTo(mainValue(3, 'CriticalDamageBase'), 6)])
    expect(mainOf('LinkRope')).toEqual([BasicKey.ATK_P, expect.closeTo(mainValue(6, 'AttackAddedRatio'), 6)])
    // Substats: SPD is the file's value. Fribbels replaces any other substat's rounded number with the
    // exact value of its rolls (relicRollFixer: 6.4 in the file is two high rolls of 3.24), and cannot
    // do that for SPD.
    expect(byPart.Head!.condensedStats[0]).toEqual([BasicKey.SPD, 4.9])
    expect(byPart.Head!.condensedStats[1]).toEqual([BasicKey.CR, expect.closeTo(0.0648, 6)])
  })

  /** The same relics with one piece moved to a set that gives nothing to these stats (Genius of Brilliant Stars). */
  function without(slot: string, build: ScannedBuild): ScannedBuild {
    return { ...build, relics: build.relics.map((r) => (r.slot === slot ? { ...r, set_id: '108' } : r)) }
  }
  const stats = (build: ScannedBuild): BasicStats => kernel.basicStats(unit, build)

  it('a 4-piece set applies its 4-piece effect: Musketeer SPD +6% of base SPD', () => {
    const full = stats(equipped(archiver))
    const threePieces = stats(without('Feet', equipped(archiver)))
    expect(full.SPD - threePieces.SPD).toBeCloseTo(0.06 * full.baseSPD, 3)
  })

  it('a 2-piece effect applies with two pieces and the 4-piece does not: Musketeer ATK +12% of base ATK', () => {
    const head = uid(archiver, '1')
    const hands = uid(archiver, '2')
    const spdOnlyBase = (set: string) => [{ ...head, set_id: set }, { ...hands, set_id: set }]
    const two = stats({ source: archiver.source, relics: spdOnlyBase('102') })
    const none = stats({ source: archiver.source, relics: spdOnlyBase('108') })
    const baseAtk = generateContext(normalizeForm(characterForm())).baseATK
    expect(two.ATK - none.ATK).toBeCloseTo(0.12 * baseAtk, 2)
    // No 4-piece SPD bonus with two pieces.
    expect(two.SPD).toBeCloseTo(none.SPD, 6)
  })

  it('a 2-piece ornament applies: Inert Salsotto CRIT Rate +8%', () => {
    const sphere = uid(archiver, '5')
    const rope = uid(archiver, '6')
    const noCr = (r: ScannedRelic, set: string): ScannedRelic => ({ ...r, set_id: set })
    const with2p = stats({ source: archiver.source, relics: [noCr(sphere, '306'), noCr(rope, '306')] })
    const without2p = stats({ source: archiver.source, relics: [noCr(sphere, '306'), noCr(rope, '301')] })
    expect(with2p.CR - without2p.CR).toBeCloseTo(0.08, 5)
  })
})

describe('a relic Fribbels cannot read stops the run, naming the relic', () => {
  const head = () => uid(archiver, '1')
  const build = (relic: ScannedRelic): ScannedBuild => ({ source: archiver.source, relics: [relic] })

  it('an unknown set_id', () => {
    expect(() => kernel.basicStats(unit, build({ ...head(), set_id: '99999' })))
      .toThrow(/relic "1" \(set_id 99999, Head\): .*unknown set_id "99999"/)
  })

  it('a main stat the importer does not know', () => {
    // Head and Hands main stats are fixed by the slot, so the importer never reads theirs; use a Body.
    expect(() => kernel.basicStats(unit, build({ ...uid(archiver, '3'), mainstat: 'Luck' })))
      .toThrow(/relic "3" \(set_id 102, Body\): .*mainstat "Luck"/)
  })

  it('an unknown slot', () => {
    expect(() => kernel.basicStats(unit, build({ ...head(), slot: 'Hat' })))
      .toThrow(/relic "1" \(set_id 102, Hat\): unknown slot "Hat"/)
  })

  it('two relics in one slot', () => {
    expect(() => kernel.basicStats(unit, { source: archiver.source, relics: [head(), { ...head(), _uid: '8' }] }))
      .toThrow(/relic "8" .*more than one relic in the Head slot/)
  })

  it('a scan source the importer does not read', () => {
    expect(() => kernel.basicStats(unit, { source: 'mystery', relics: [head()] })).toThrow(/no reader for scan source "mystery"/)
  })
})

describe('real Fribbels: a member on equipped relics', () => {
  /** The character as Fribbels' own importer reads the whole scan file. */
  const importedCharacter = (): Character['form'] => ReliquaryArchiverParser.parse(archiver as never).characters[0]!

  it('has the basic stats Fribbels computes for that character with those relics', () => {
    // Fribbels' own import of the whole file, then the calls its character preview makes
    // (characterPreviewController.getShowcaseStats): condense the relics and simulate the build.
    const parsed = ReliquaryArchiverParser.parse(archiver as never)
    const relics = parsed.relics.filter((r) => r.equippedBy === ACHERON)
    expect(relics).toHaveLength(6)
    RelicFilters.condenseRelicSubstatsForOptimizerSingle(relics)
    const byPart = Object.fromEntries(relics.map((r) => [r.part, r])) as unknown as SimulationRelicByPart
    const form = normalizeForm(importedCharacter() as never)
    const { x } = simulateBuild(byPart, generateContext(form), null)
    const expected = x.c.toBasicStatsObject()

    const scenarioFile: ScenarioFile = {
      format: 'nousr-scenario',
      version: 1,
      game_version: '4.7',
      account: archiver as never,
      battle: { mode: 'moc', cycles: 1, period: null },
      enemies: { profile: 'generic-moc', counts: [1] },
      teams: [{ id: 'solo', members: [{ key: 'acheron', character: ACHERON }], policy: [{ unit: 'acheron', use: 'basic' }] }],
    }
    const scenario = parseScenario(scenarioFile)
    const member = buildBattleSetup(scenario, 'solo', 1, { kernel, scanSource: archiver.source }).members[0]!

    const ours = kernel.basicStats(member.kernel.unit, member.kernel.build)
    expect(ours).toMatchObject({
      HP: expect.closeTo(expected.HP, 3),
      DEF: expect.closeTo(expected.DEF, 3),
      ATK: expect.closeTo(expected.ATK, 3),
      SPD: expect.closeTo(expected.SPD, 3),
      CR: expect.closeTo(expected['CRIT Rate'], 6),
      CD: expect.closeTo(expected['CRIT DMG'], 6),
      EHR: expect.closeTo(expected['Effect Hit Rate'], 6),
      RES: expect.closeTo(expected['Effect RES'], 6),
      BE: expect.closeTo(expected['Break Effect'], 6),
      ERR: expect.closeTo(expected['Energy Regeneration Rate'], 6),
    })
    // What the run hands to the timeline.
    expect(member.stats.maxHp).toBeCloseTo(expected.HP, 3)
    expect(member.stats.def).toBeCloseTo(expected.DEF, 3)
    expect(member.stats.baseSpd + (member.stats.spdFlat ?? 0)).toBeCloseTo(expected.SPD, 3)
    expect(member.stats.energyRegen).toBeCloseTo(expected['Energy Regeneration Rate'], 6)
  })

  it('the same character on the same scan with an explicit relic list and by uid gives the same stats', () => {
    const base = {
      format: 'nousr-scenario' as const,
      version: 1 as const,
      game_version: '4.7',
      account: archiver as never,
      battle: { mode: 'moc' as const, cycles: 1, period: null },
      enemies: { profile: 'generic-moc', counts: [1] },
    }
    const team = (relics: ScenarioFile['teams'][0]['members'][0]['relics']): ScenarioFile['teams'] => [
      { id: 'solo', members: [{ key: 'acheron', character: ACHERON, relics }], policy: [{ unit: 'acheron', use: 'basic' }] },
    ]
    const spdOf = (relics: ScenarioFile['teams'][0]['members'][0]['relics']) => {
      const scenario = parseScenario({ ...base, teams: team(relics) })
      const member = buildBattleSetup(scenario, 'solo', 1, { kernel, scanSource: archiver.source }).members[0]!
      return member.stats.baseSpd + (member.stats.spdFlat ?? 0)
    }
    const viaEquipped = spdOf('equipped')
    expect(spdOf(['1', '2', '3', '4', '5', '6'])).toBeCloseTo(viaEquipped, 6)
    // The spare (unequipped) head with 2.0 SPD instead of the equipped one's 4.9.
    expect(viaEquipped - spdOf(['7', '2', '3', '4', '5', '6'])).toBeCloseTo(2.9, 3)
  })

  it('the run warns for an HSR-Scanner file, naming the member, and not for a Reliquary Archiver file', () => {
    const plan = (scan: typeof archiver) => planTeam(
      parseScenario({
        format: 'nousr-scenario',
        version: 1,
        game_version: '4.7',
        account: scan as never,
        battle: { mode: 'moc', cycles: 1, period: null },
        enemies: { profile: 'generic-moc', counts: [1] },
        teams: [{ id: 'solo', members: [{ key: 'acheron', character: ACHERON }], policy: [{ unit: 'acheron', use: 'basic' }] }],
      } satisfies ScenarioFile),
      'solo',
      1,
      { kernel, scanSource: scan.source },
    ).warnings
    expect(plan(archiver)).toEqual([])
    expect(plan(hsrScanner)).toEqual([expect.stringMatching(/^team "solo", member "acheron": SPD may be understated by up to just under 1 /)])
  })

  it('damage for a scanned build comes through the same path: hits per ability and in-combat stats', () => {
    const build = equipped(archiver)
    const result = kernel.actionDamage({ attacker: unit, teammates: [], build })
    expect(result.damage.BASIC).toBeGreaterThan(0)
    expect(result.damage.ULT).toBeGreaterThan(0)
    expect(result.hits.ULT!.length).toBeGreaterThan(0)
    expect(result.stats.SPD).toBeGreaterThanOrEqual(kernel.basicStats(unit, build).SPD - 1e-6)
    // Same call twice, same numbers (the parsed relics are cached and not mutated).
    const again = kernel.actionDamage({ attacker: unit, teammates: [], build })
    expect(again.damage).toEqual(result.damage)
  })
})

// Fribbels' character form for the fixture character, for its base stats.
function characterForm(): Character['form'] {
  return ReliquaryArchiverParser.parse(archiver as never).characters[0]!
}
