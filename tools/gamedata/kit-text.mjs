// Prints one character's in-game kit text: abilities, memosprite, traces, eidolons and Affinitive Eidolon.
// Usage: node tools/gamedata/kit-text.mjs <characterId> [dataDir] [--version N]     e.g. 1308 for Acheron
// --version picks a buffed ("Nova Flare") kit: `ability_version` in a scan, `EnhancedID` in the tables,
// the `b1` in Fribbels' 1006b1. The default, 0, is the original kit.
import { parseArgs } from 'node:util'
import { fill, open, v } from './lib.mjs'

const USAGE = 'usage: node tools/gamedata/kit-text.mjs <characterId> [dataDir] [--version N]'
const { values, positionals } = parseArgs({ allowPositionals: true, options: { version: { type: 'string', default: '0' } } })
const avatarId = Number(positionals[0])
const version = Number(values.version)
if (!avatarId || !Number.isInteger(version) || version < 0) throw new Error(USAGE)
const { load, t } = open(positionals[1])

const avatars = load('AvatarConfig')
const avatar = avatars.find((a) => a.AvatarID === avatarId)
if (!avatar) throw new Error(`no character ${avatarId} in AvatarConfig`)

// A buffed kit is a row that replaces the original's max energy, ability list and eidolon list. Its
// traces sit beside the original's in the trace table, marked with the same EnhancedID.
const buffed = load('AvatarConfigEnhanced').filter((e) => e.AvatarID === avatarId)
const kit = version === 0 ? avatar : buffed.find((e) => e.EnhancedID === version)
if (!kit) {
  const has = buffed.map((e) => e.EnhancedID).join(', ') || 'none'
  throw new Error(`character ${avatarId} has no buffed version ${version} in AvatarConfigEnhanced (buffed versions: ${has})`)
}
// Characters with only one kit keep the plain header.
const versionNote =
  buffed.length === 0
    ? ''
    : version === 0
      ? `, original version; buffed: --version ${buffed.map((e) => e.EnhancedID).join(' or ')}`
      : `, buffed version ${version}`
console.log(
  `# ${t(avatar.AvatarName)} (${avatarId}${versionNote})  path ${avatar.AvatarBaseType}  element ${avatar.DamageType}  max energy ${v(kit.SPNeed) ?? 'none'}`,
)

const tree = load('AvatarSkillTreeConfig').filter(
  (s) => s.AvatarID === avatarId && s.Level === 1 && (s.EnhancedID ?? 0) === version,
)
const ranks = load('AvatarRankConfig')
const kitRanks = kit.RankIDList.map((rankId) => ranks.find((x) => x.RankID === rankId)).filter(Boolean)

function printSkill(rows, levels, note = '') {
  const head = rows[0]
  console.log(`\n### ${t(head.SkillName)} [${t(head.SkillTypeDesc)} | ${t(head.SkillTag)}] id ${head.SkillID}${note}`)
  for (const level of levels) {
    const row = rows.find((s) => s.Level === level)
    if (!row) continue
    const meta = [
      `energy +${v(row.SPBase) ?? 0}`,
      v(row.BPNeed) > 0 ? `skill points -${v(row.BPNeed)}` : '',
      v(row.BPAdd) > 0 ? `skill points +${v(row.BPAdd)}` : '',
      row.SPNeed ? `costs ${v(row.SPNeed)} energy` : '',
      `toughness ${(row.ShowStanceList ?? []).map(v).join('/')}`,
    ]
      .filter(Boolean)
      .join(', ')
    console.log(`  Lv${level} (${meta}): ${fill(t(row.SkillDesc), row.ParamList.map(v))}`)
  }
}

// Levels worth showing: the maximum of the trace node that levels the ability, then that plus what this kit's
// eidolons add. An enhanced form (Cyrene's "To Love and Tomorrow") sits under its base ability's node, so it
// gets that node's levels. Abilities no node levels fall back to Basic ATK 6/7 and everything else 10/12.
console.log('\n## Abilities')
const skillRows = load('AvatarSkillConfig')
const nodeMax = new Map(tree.flatMap((n) => (n.LevelUpSkillID ?? []).map((id) => [id, n.MaxLevel])))
const eidolonAdds = (skillId) => kitRanks.reduce((sum, r) => sum + (r.SkillAddLevelList?.[skillId] ?? 0), 0)
const shownLevels = (skillId, head) => {
  if (head.MaxLevel <= 1) return [1]
  const base = nodeMax.get(skillId)
  if (base === undefined) return skillId === kit.SkillList[0] ? [6, 7] : [10, 12]
  const added = eidolonAdds(skillId)
  return added > 0 ? [base, base + added] : [base]
}
for (const skillId of kit.SkillList) {
  const rows = skillRows.filter((s) => s.SkillID === skillId)
  if (rows.length > 0) printSkill(rows, shownLevels(skillId, rows[0]))
}

// The character's type 4 trace nodes level up the memosprite's abilities; that is what ties the two together.
console.log('\n## Memosprite')
const traceMax = new Map(tree.filter((n) => n.PointType === 4).flatMap((n) => n.LevelUpSkillID.map((id) => [id, n.MaxLevel])))
const servants = load('AvatarServantConfig').filter((s) => s.SkillIDList.some((id) => traceMax.has(id)))
const servantSkillRows = load('AvatarServantSkillConfig')
const teammateLinks = load('AvatarServantSkillLink')
if (servants.length === 0) console.log('(none)')
for (const servant of servants) {
  console.log(`\n### ${t(servant.ServantName)}, memosprite id ${servant.ServantID}`)
  // Each stat is a literal number, or "#n": parameter n of one of the character's own abilities.
  const stat = (field, skillField) => {
    const value = String(servant[field] ?? '(not in table)')
    if (!value.startsWith('#')) return `${field} ${value}`
    const skillId = servant[skillField]
    const rows = skillRows.filter((s) => s.SkillID === skillId)
    const perLevel = (rows.length > 0 ? shownLevels(skillId, rows[0]) : [])
      .map((level) => [level, rows.find((s) => s.Level === level)?.ParamList[Number(value.slice(1)) - 1]])
      .filter(([, param]) => param !== undefined)
      .map(([level, param]) => `Lv${level} ${+v(param).toFixed(4)}`)
    return `${field} = parameter ${value} of ability ${skillId}: ${perLevel.join(', ') || '?'}`
  }
  // Both 0 can mean a real 0 (a memosprite that never acts) or a value the abilities set instead
  // (Netherwing's Max HP is given only in Castorice's Ultimate text).
  const bothZero = (a, b) => (String(servant[a]) === '0' && String(servant[b]) === '0' ? ' (both 0 in this table; check the abilities for a rule)' : '')
  console.log(`- SPD: ${stat('SpeedBase', 'SpeedSkill')}; ${stat('SpeedInherit', 'SpeedSkill')}${bothZero('SpeedBase', 'SpeedInherit')}`)
  console.log(`- HP: ${stat('HPBase', 'HPSkill')}; ${stat('HPInherit', 'HPSkill')}${bothZero('HPBase', 'HPInherit')}`)
  console.log(`- base aggro: ${v(servant.Aggro) ?? '(not in table)'}`)

  // Levels shown: the trace's maximum, then that plus what this kit's eidolons add.
  for (const skillId of servant.SkillIDList) {
    const rows = servantSkillRows.filter((s) => s.SkillID === skillId)
    if (rows.length === 0) continue
    const base = rows[0].MaxLevel <= 1 ? 1 : (traceMax.get(skillId) ?? 1)
    const added = kitRanks.reduce((sum, r) => sum + (r.SkillAddLevelList?.[skillId] ?? 0), 0)
    const link = teammateLinks.find((l) => l.SkillID === skillId)
    const teammate = link && avatars.find((a) => a.AvatarID === link.LinkToAvatarID)
    const note = link ? `, for teammate ${teammate ? t(teammate.AvatarName) : '?'} (${link.LinkToAvatarID})` : ''
    printSkill(rows, added > 0 ? [base, base + added] : [base], note)
  }
}

console.log('\n## Traces')
for (const node of tree) {
  const stats = (node.StatusAddList ?? []).map((s) => `${s.PropertyType} +${+v(s.Value).toFixed(4)}`).join(', ')
  if (stats) console.log(`- stat: ${stats}`)
  else if (node.PointName) console.log(`- ${t(node.PointName)}: ${fill(t(node.PointDesc), (node.ParamList ?? []).map(v))}`)
}

console.log('\n## Eidolons')
for (const r of kitRanks) console.log(`- E${r.Rank} ${t(r.Name)}: ${fill(t(r.Desc), (r.Param ?? []).map(v))}`)

// This table's field names are obfuscated, so find the fields by what they hold.
console.log('\n## Affinitive Eidolon')
const ex = load('AvatarExRankConfig').filter((row) => Object.values(row).includes(avatarId))
if (ex.length === 0) console.log('(none)')
for (const row of ex) {
  const strings = Object.values(row).filter((x) => typeof x === 'string')
  const name = strings.find((s) => s.startsWith('AvatarExRankName_'))
  const desc = strings.find((s) => s.startsWith('AvatarExRankDesc_'))
  const params = Object.values(row).find((x) => Array.isArray(x) && x.length > 0 && typeof x[0] === 'object' && 'Value' in x[0])
  console.log(`- ${t(name)}: ${fill(t(desc), (params ?? []).map(v))}`)
}
