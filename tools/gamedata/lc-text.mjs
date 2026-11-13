// Prints a light cone's or a relic set's in-game English text from the 4.7.0 game data.
// Usage: node tools/gamedata/lc-text.mjs <lightConeId> [dataDir]          e.g. 23024 for Along the Passing Shore
//        node tools/gamedata/lc-text.mjs --set <setId> [dataDir]          e.g. 117 for Pioneer Diver of Dead Waters
// A light cone prints its passive at every superimposition. A set prints its 2-piece and 4-piece text.
// Needs EquipmentConfig, EquipmentSkillConfig, RelicSetConfig and RelicSetSkillConfig in .gamedata/. When one is
// missing it is downloaded from the commit named in .gamedata/SOURCE.txt (needs `gh`, like fetch.mjs).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { DEFAULT_DIR, fill, open, v } from './lib.mjs'

const USAGE = 'usage: node tools/gamedata/lc-text.mjs [--set] <id> [dataDir]'
const { values, positionals } = parseArgs({ allowPositionals: true, options: { set: { type: 'boolean', default: false } } })
const id = Number(positionals[0])
if (!id) throw new Error(USAGE)
const dir = positionals[1] ?? DEFAULT_DIR

/** The tables this script reads, fetched at the same commit as the rest when they are not there yet. */
function ensure(name) {
  const file = `${dir}/${name}.json`
  if (existsSync(file)) return
  const ref = readFileSync(`${dir}/SOURCE.txt`, 'utf8').split(' ')[0]
  console.error(`${name}.json is not in ${dir}; downloading it from DimbreathBot/TurnBasedGameData at ${ref.slice(0, 10)}`)
  const bytes = execFileSync(
    'gh',
    ['api', '-H', 'Accept: application/vnd.github.raw', `repos/DimbreathBot/TurnBasedGameData/contents/ExcelOutput/${name}.json?ref=${ref}`],
    { maxBuffer: 256 * 1024 * 1024 },
  )
  writeFileSync(`${file}.part`, bytes)
  renameSync(`${file}.part`, file)
}

const tables = values.set ? ['RelicSetConfig', 'RelicSetSkillConfig'] : ['EquipmentConfig', 'EquipmentSkillConfig']
tables.forEach(ensure)
const { load, t } = open(dir)

if (values.set) {
  const set = load('RelicSetConfig').find((s) => s.SetID === id)
  if (!set) throw new Error(`no relic set ${id} in RelicSetConfig`)
  console.log(`# ${t(set.SetName)} (set ${id})`)
  for (const row of load('RelicSetSkillConfig').filter((s) => s.SetID === id)) {
    console.log(`  ${row.RequireNum}-piece: ${fill(t(row.SkillDesc), (row.AbilityParamList ?? []).map(v))}`)
  }
} else {
  const lc = load('EquipmentConfig').find((e) => e.EquipmentID === id)
  if (!lc) throw new Error(`no light cone ${id} in EquipmentConfig`)
  console.log(`# ${t(lc.EquipmentName)} (light cone ${id})  path ${lc.AvatarBaseType}  rarity ${lc.Rarity}`)
  for (const row of load('EquipmentSkillConfig').filter((s) => s.SkillID === lc.SkillID)) {
    console.log(`  S${row.Level} [${t(row.SkillName)}]: ${fill(t(row.SkillDesc), row.ParamList.map(v))}`)
  }
}
