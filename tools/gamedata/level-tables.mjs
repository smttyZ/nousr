// Writes the committed level tables (DESIGN.md K20): per character, the numbers behind ability levels
// and traces, read from the game data in .gamedata/ (fetch.mjs). Numbers and ids only, no game text.
//
//   node tools/gamedata/level-tables.mjs                  the v1 roster -> data/levels/
//   node tools/gamedata/level-tables.mjs --all            every character and buffed version
//   node tools/gamedata/level-tables.mjs 1415 1006:1      just these (id, or id:ability_version)
//   options: --out <dir> (default data/levels), --data <dir> (default .gamedata)
//
// File names: `<id>.json` for the original kit, `<id>_v1.json` for buffed (ability_version 1) kits. One
// file holds one (character, ability_version), as the standard builds do, so a buffed kit's different
// skill ids and trace ids never mix with the original's. The output is deterministic: sorted, fixed key
// order, no timestamps; two runs give identical bytes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { DEFAULT_DIR, open, v } from './lib.mjs'

/** The v1 roster (DESIGN.md build order step 6): [character id, ability_version]. */
export const ROSTER = [
  [1308, 0], [1204, 0], [1006, 1], [1004, 1], [1414, 0], [1208, 0], [1313, 0],
  [1403, 0], [1512, 0], [1407, 0], [1415, 0], [1409, 0], [1401, 0], [1405, 0],
]

// The tree's anchor slot says which ability a node levels. Basic/Skill/Ult/Talent are the 4 leveled
// nodes (Point05, the Technique, has one level and is left out); Point19/20 are the memosprite's
// skill and talent; Point22 is the Elation skill (the README of HSR-Scanner calls the scan key `elation`).
const ABILITY_KIND = {
  Point01: 'basic', Point02: 'skill', Point03: 'ult', Point04: 'talent',
  Point19: 'memo_skill', Point20: 'memo_talent', Point22: 'elation',
}
const KIND_ORDER = ['basic', 'skill', 'ult', 'talent', 'memo_skill', 'memo_talent', 'elation']
// Slots Point06..08 are the 3 major traces, Point09..18 the 10 minor traces.
const MAJOR_KEY = { Point06: 'B1', Point07: 'B2', Point08: 'B3' }
const MINOR_KEY = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`Point${String(i + 9).padStart(2, '0')}`, `S${i + 1}`]))

const byNumber = (a, b) => a - b

/** Builds the table object for one character and ability version, or null if it has no skill tree. */
export function buildTable(db, avatarId, version, warn = () => {}) {
  const { avatars, enhanced, tree, ranks, skillRows, servantRows, meta } = db
  const avatar = avatars.find((a) => a.AvatarID === avatarId)
  if (!avatar) throw new Error(`no character ${avatarId} in AvatarConfig`)
  const kit = version === 0 ? avatar : enhanced.find((e) => e.AvatarID === avatarId && e.EnhancedID === version)
  if (!kit) throw new Error(`character ${avatarId} has no buffed version ${version}`)
  const nodes = tree.filter((n) => n.AvatarID === avatarId && (n.EnhancedID ?? 0) === version && n.Level === 1)
  if (nodes.length === 0) return null

  // A level row set per skill id: the ParamList of each level, 1..N with no gaps.
  const paramRows = (skillId) => {
    const rows = skillRows.get(skillId) ?? servantRows.get(skillId)
    if (!rows) return null
    rows.sort((a, b) => a.Level - b.Level)
    rows.forEach((r, i) => {
      if (r.Level !== i + 1) throw new Error(`skill ${skillId}: level rows are not 1..N`)
    })
    return rows.map((r) => (r.ParamList ?? []).map(v))
  }

  // Extra levels from eidolons, per skill id, over this kit's own eidolon list.
  const kitRanks = kit.RankIDList.map((id) => ranks.find((r) => r.RankID === id)).filter(Boolean)
  const addedAt = (skillId) =>
    kitRanks.map((r) => [r.Rank, r.SkillAddLevelList?.[skillId] ?? 0]).filter(([, n]) => n > 0)

  const abilities = {}
  for (const node of nodes) {
    const kind = ABILITY_KIND[node.AnchorType]
    if (!kind || (node.PointType !== 2 && node.PointType !== 4)) continue
    if (node.MaxLevel <= 1) continue
    const ids = node.LevelUpSkillID ?? []
    const skills = {}
    const bonuses = new Map() // eidolon -> levels, taken across the node's skill ids
    for (const id of ids) {
      const levels = paramRows(id)
      if (!levels) {
        warn(`${avatarId}${version ? ` v${version}` : ''} ${kind}: skill ${id} has no level rows in AvatarSkillConfig or AvatarServantSkillConfig; left out`)
        continue
      }
      skills[id] = { levels }
      for (const [eidolon, n] of addedAt(id)) {
        if (bonuses.has(eidolon) && bonuses.get(eidolon) !== n) {
          warn(`${avatarId} ${kind}: skill ${id} gets +${n} at E${eidolon} but another skill of the same node gets +${bonuses.get(eidolon)}; kept the larger`)
        }
        bonuses.set(eidolon, Math.max(n, bonuses.get(eidolon) ?? 0))
      }
    }
    if (Object.keys(skills).length === 0) continue
    // A skill id that the node lists but an eidolon does not raise is worth knowing about.
    for (const [eidolon, n] of bonuses) {
      const missed = ids.filter((id) => skills[id] && !addedAt(id).some(([e, m]) => e === eidolon && m === n))
      if (missed.length > 0) warn(`${avatarId}${version ? ` v${version}` : ''} ${kind}: E${eidolon} +${n} does not list skill id(s) ${missed.join(', ')}`)
    }
    abilities[kind] = {
      point: node.PointID,
      tree_max_level: node.MaxLevel,
      eidolon_levels: [...bonuses].sort(([a], [b]) => a - b).map(([eidolon, levels]) => ({ eidolon, levels })),
      skills,
    }
  }
  const orderedAbilities = Object.fromEntries(KIND_ORDER.filter((k) => abilities[k]).map((k) => [k, abilities[k]]))

  const traceNode = (n) => ({ point: n.PointID, requires: [...(n.PrePoint ?? [])].sort(byNumber) })
  const major = nodes
    .filter((n) => n.PointType === 3 && MAJOR_KEY[n.AnchorType])
    .sort((a, b) => a.PointID - b.PointID)
    .map((n) => ({ key: MAJOR_KEY[n.AnchorType], ...traceNode(n) }))
  const minor = nodes
    .filter((n) => n.PointType === 1 && MINOR_KEY[n.AnchorType])
    .sort((a, b) => a.PointID - b.PointID)
    .map((n) => {
      const stats = n.StatusAddList ?? []
      if (stats.length !== 1) throw new Error(`minor trace ${n.PointID} has ${stats.length} stats, expected 1`)
      return { key: MINOR_KEY[n.AnchorType], ...traceNode(n), stat: stats[0].PropertyType, value: v(stats[0].Value) }
    })

  return {
    format: 'nousr-level-table',
    version: 1,
    game_version: meta.gameVersion,
    game_data_commit: meta.commit,
    character: String(avatarId),
    ability_version: version,
    abilities: orderedAbilities,
    major_traces: major,
    minor_traces: minor,
  }
}

/** JSON with 2-space indent, but arrays of plain numbers and the small trace objects on one line. */
export function stringify(value, indent = '') {
  const flat = (x) => Array.isArray(x) && x.every((e) => typeof e === 'number')
  const simple = (x) => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.values(x).every((e) => typeof e !== 'object' || flat(e))
  const inline = (o) => `{ ${Object.entries(o).map(([k, x]) => `${JSON.stringify(k)}: ${flat(x) ? stringify(x) : JSON.stringify(x)}`).join(', ')} }`
  if (flat(value)) return `[${value.map((n) => JSON.stringify(n)).join(', ')}]`
  const next = `${indent}  `
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[\n${value.map((e) => next + (simple(e) ? inline(e) : stringify(e, next))).join(',\n')}\n${indent}]`
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value)
    if (keys.length === 0) return '{}'
    return `{\n${keys.map((k) => `${next}${JSON.stringify(k)}: ${stringify(value[k], next)}`).join(',\n')}\n${indent}}`
  }
  return JSON.stringify(value)
}

export function fileName(avatarId, version) {
  return version === 0 ? `${avatarId}.json` : `${avatarId}_v${version}.json`
}

export function loadDb(dataDir = DEFAULT_DIR) {
  const { load } = open(dataDir)
  const group = (rows) => {
    const m = new Map()
    for (const r of rows) (m.get(r.SkillID) ?? m.set(r.SkillID, []).get(r.SkillID)).push(r)
    return m
  }
  const source = readFileSync(`${dataDir}/SOURCE.txt`, 'utf8').trim()
  const commit = source.match(/^[0-9a-f]{40}/)?.[0]
  const gameVersion = source.match(/Win(\d+\.\d+)\.\d+/)?.[1]
  if (!commit || !gameVersion) throw new Error(`cannot read the commit and game version from ${dataDir}/SOURCE.txt`)
  return {
    avatars: load('AvatarConfig'),
    enhanced: load('AvatarConfigEnhanced'),
    tree: load('AvatarSkillTreeConfig'),
    ranks: load('AvatarRankConfig'),
    skillRows: group(load('AvatarSkillConfig')),
    servantRows: group(load('AvatarServantSkillConfig')),
    meta: { commit, gameVersion },
  }
}

/** Every (character, version) pair that has a skill tree: the original kit and each buffed one. */
export function allTargets(db) {
  const out = []
  for (const a of [...db.avatars].sort((x, y) => x.AvatarID - y.AvatarID)) {
    out.push([a.AvatarID, 0])
    for (const e of db.enhanced.filter((x) => x.AvatarID === a.AvatarID).sort((x, y) => x.EnhancedID - y.EnhancedID)) {
      out.push([a.AvatarID, e.EnhancedID])
    }
  }
  return out
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      all: { type: 'boolean', default: false },
      out: { type: 'string', default: resolve(import.meta.dirname, '../../data/levels') },
      data: { type: 'string', default: DEFAULT_DIR },
    },
  })
  const db = loadDb(values.data)
  let targets = ROSTER
  if (values.all) targets = allTargets(db)
  else if (positionals.length > 0) {
    targets = positionals.map((p) => {
      const [id, ver = '0'] = p.split(':')
      return [Number(id), Number(ver)]
    })
  }
  mkdirSync(values.out, { recursive: true })
  let bytes = 0
  let written = 0
  for (const [id, version] of targets) {
    const table = buildTable(db, id, version, (m) => console.error(`warning: ${m}`))
    if (!table) {
      console.error(`skipped ${id}${version ? `:${version}` : ''}: no skill tree`)
      continue
    }
    const text = `${stringify(table)}\n`
    writeFileSync(resolve(values.out, fileName(id, version)), text)
    bytes += Buffer.byteLength(text)
    written++
  }
  console.log(`wrote ${written} files, ${bytes} bytes, to ${values.out}`)
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('level-tables.mjs')) main()
