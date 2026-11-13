// Downloads the game data tables the other scripts read, into .gamedata/ (git-ignored, about 110 MB).
// Needs the GitHub CLI (`gh`), signed in. Usage: node tools/gamedata/fetch.mjs [ref]
// `ref` is a commit of DimbreathBot/TurnBasedGameData; the numbers in DESIGN.md were read at fe15a954eb.
import { execFileSync } from 'node:child_process'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { DEFAULT_DIR } from './lib.mjs'

const REPO = 'DimbreathBot/TurnBasedGameData'
const ref = process.argv[2] ?? 'HEAD'

const TABLES = [
  // enemies and Memory of Chaos stages
  'HardLevelGroup', 'EliteGroup', 'MonsterConfig', 'MonsterTemplateConfig', 'MonsterSkillConfig',
  'StageConfig', 'ChallengeMazeConfig', 'ChallengeGroupConfig',
  // characters
  'AvatarConfig', 'AvatarPromotionConfig', 'AvatarSkillConfig',
  'AvatarSkillTreeConfig', 'AvatarRankConfig', 'AvatarExRankConfig',
  // buffed ("Nova Flare") kits: per character and version, the replacement ability and eidolon lists
  'AvatarConfigEnhanced',
  // memosprites: the unit, its abilities, and which teammate each teammate-specific ability belongs to
  'AvatarServantConfig', 'AvatarServantSkillConfig', 'AvatarServantSkillLink',
  // light cones and relic sets (tools/gamedata/lc-text.mjs)
  'EquipmentConfig', 'EquipmentSkillConfig', 'RelicSetConfig', 'RelicSetSkillConfig',
]

mkdirSync(DEFAULT_DIR, { recursive: true })
const get = (path) =>
  execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${REPO}/contents/${path}?ref=${ref}`], {
    maxBuffer: 256 * 1024 * 1024,
  })
// Write beside the target and rename over it, so a script reading the tables never sees half a file.
const put = (file, bytes) => {
  writeFileSync(`${DEFAULT_DIR}/${file}.part`, bytes)
  renameSync(`${DEFAULT_DIR}/${file}.part`, `${DEFAULT_DIR}/${file}`)
  console.log(`${file}  ${bytes.length} bytes`)
}

for (const name of TABLES) put(`${name}.json`, get(`ExcelOutput/${name}.json`))
put('TextMapEN.json', get('TextMap/TextMapEN.json'))

const commit = execFileSync('gh', ['api', `repos/${REPO}/commits/${ref}`, '--jq', '.sha + " " + (.commit.message | split("\\n")[0])'])
writeFileSync(`${DEFAULT_DIR}/SOURCE.txt`, commit)
console.log(`from ${commit.toString().trim()}`)
