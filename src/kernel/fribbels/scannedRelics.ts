/**
 * Scanned relics for the Fribbels adapter (DESIGN.md, K5). No Fribbels logic is copied: the relic
 * objects of the scan file go to Fribbels' own importer for that scanner
 * (vendor/hsr-optimizer/src/lib/importer/importConfig.ts, kelzFormatParser.tsx `parseRelic`), and the
 * result is condensed into the stat list its simulation reads the same way its own character
 * preview does (relicFilters.ts `condenseRelicSubstatsForOptimizerSingle`, characterPreviewController
 * `getShowcaseStats`).
 *
 * What the importer does with SPD, read from its source and pinned by the tests: a substat's `value`
 * is always the number in the file. For a source with `speedVerified` (Reliquary Archiver) it also
 * keeps `count` and `step` to rebuild the roll split and checks the split against `value`; it does
 * not rebuild `value` from them. So SPD is exact because that scanner writes the exact value, and
 * understated for HSR-Scanner because that scanner writes the rounded-down value the game shows.
 */
import { Parts } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { ScannerSourceToParser } from '../../../vendor/hsr-optimizer/src/lib/importer/importConfig'
import type { V4ParserRelic } from '../../../vendor/hsr-optimizer/src/lib/importer/kelzFormatParser'
import { RelicFilters } from '../../../vendor/hsr-optimizer/src/lib/relics/relicFilters'
import type { SimulationRelic, SimulationRelicByPart } from '../../../vendor/hsr-optimizer/src/lib/simulations/statSimulationTypes'
import type { Relic } from '../../../vendor/hsr-optimizer/src/types/relic'
import type { ScannedBuild, ScannedRelic } from '../types'

function parserFor(source: string) {
  const parser = (ScannerSourceToParser as Record<string, (typeof ScannerSourceToParser)[string] | undefined>)[source]
  if (!parser) {
    throw new Error(
      `Fribbels' importer has no reader for scan source "${source}". Sources it reads: ${Object.keys(ScannerSourceToParser).join(', ')}`,
    )
  }
  return parser
}

/** Whether Fribbels trusts the SPD this scanner writes. Throws for a source it does not read. */
export function scanSourceInfo(source: string): { speedVerified: boolean } {
  return { speedVerified: parserFor(source).config.speedVerified }
}

const parsed = new WeakMap<ScannedBuild, SimulationRelicByPart>()

/**
 * Fribbels' relic objects for the build, condensed for its simulation. Throws, naming the relic's
 * `_uid` and the reason, for a relic its importer rejects. Cached per build object. The returned
 * object is a fresh container each call, because the simulation fills empty slots in it.
 */
export function scannedRelicsByPart(build: ScannedBuild): SimulationRelicByPart {
  let relics = parsed.get(build)
  if (!relics) {
    relics = parseBuild(build)
    parsed.set(build, relics)
  }
  return { ...relics }
}

function parseBuild(build: ScannedBuild): SimulationRelicByPart {
  const parser = parserFor(build.source)
  const byPart: Partial<Record<string, Relic>> = {}
  for (const scanned of build.relics) {
    const at = `relic "${scanned._uid ?? '(no _uid)'}" (set_id ${scanned.set_id}, ${scanned.slot})`
    const relic = parseOne(parser, scanned, at)
    if (byPart[relic.part]) throw new Error(`${at}: more than one relic in the ${scanned.slot} slot`)
    byPart[relic.part] = relic
  }

  const list = Object.values(byPart) as Relic[]
  RelicFilters.condenseRelicSubstatsForOptimizerSingle(list)
  const out: Record<string, SimulationRelic> = {}
  for (const part of Object.values(Parts)) {
    // An empty slot is filled in by the simulation itself; leave it out.
    if (byPart[part]) out[part] = byPart[part] as SimulationRelic
  }
  return out as unknown as SimulationRelicByPart
}

function parseOne(parser: ReturnType<typeof parserFor>, scanned: ScannedRelic, at: string): Relic {
  // The importer fills these in; a scan relic that lacks them fails below with a reason.
  const input = { location: '', lock: false, discard: false, _uid: '', name: '', ...scanned } as unknown as V4ParserRelic
  if (!Object.values(Parts).includes(input.slot.replace(/\s+/g, '') as never)) {
    throw new Error(`${at}: unknown slot "${scanned.slot}"`)
  }
  let relic: Relic | null
  try {
    relic = parser.parseRelic(input, {})
  } catch (cause) {
    // The importer's own message can be a bare translation key; add what it was asked to read.
    throw new Error(`${at}: Fribbels' importer rejected it (mainstat "${scanned.mainstat}"): ${(cause as Error).message}`)
  }
  if (!relic) {
    throw new Error(`${at}: Fribbels' importer rejected it (unknown set_id "${scanned.set_id}")`)
  }
  // `location` and `_uid` are the scan's; the simulation does not use them.
  return relic
}
