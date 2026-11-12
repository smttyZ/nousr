// Prints one character's in-game kit text: abilities, traces, eidolons and Affinitive Eidolon.
// Usage: node tools/gamedata/kit-text.mjs <characterId> [dataDir]     e.g. 1308 for Acheron
import { fill, open, v } from './lib.mjs'

const avatarId = Number(process.argv[2])
if (!avatarId) throw new Error('usage: node tools/gamedata/kit-text.mjs <characterId> [dataDir]')
const { load, t } = open(process.argv[3])

const avatar = load('AvatarConfig').find((a) => a.AvatarID === avatarId)
if (!avatar) throw new Error(`no character ${avatarId} in AvatarConfig`)
console.log(`# ${t(avatar.AvatarName)} (${avatarId})  path ${avatar.AvatarBaseType}  element ${avatar.DamageType}  max energy ${v(avatar.SPNeed)}`)

// Levels worth showing: Basic ATK 6 (7 with eidolons); everything else 10 (12 with eidolons).
console.log('\n## Abilities')
const skillRows = load('AvatarSkillConfig')
for (const [index, skillId] of avatar.SkillList.entries()) {
  const rows = skillRows.filter((s) => s.SkillID === skillId)
  if (rows.length === 0) continue
  const head = rows[0]
  const levels = head.MaxLevel <= 1 ? [1] : index === 0 ? [6, 7] : [10, 12]
  console.log(`\n### ${t(head.SkillName)} [${t(head.SkillTypeDesc)} | ${t(head.SkillTag)}] id ${skillId}`)
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

console.log('\n## Traces')
for (const node of load('AvatarSkillTreeConfig').filter((s) => s.AvatarID === avatarId && s.Level === 1)) {
  const stats = (node.StatusAddList ?? []).map((s) => `${s.PropertyType} +${+v(s.Value).toFixed(4)}`).join(', ')
  if (stats) console.log(`- stat: ${stats}`)
  else if (node.PointName) console.log(`- ${t(node.PointName)}: ${fill(t(node.PointDesc), (node.ParamList ?? []).map(v))}`)
}

console.log('\n## Eidolons')
const ranks = load('AvatarRankConfig')
for (const rankId of avatar.RankIDList) {
  const r = ranks.find((x) => x.RankID === rankId)
  if (r) console.log(`- E${r.Rank} ${t(r.Name)}: ${fill(t(r.Desc), (r.Param ?? []).map(v))}`)
}

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
