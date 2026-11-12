// Downloads the game data tables the other scripts read, into .gamedata/ (git-ignored, about 110 MB).
// Needs the GitHub CLI (`gh`), signed in. Usage: node tools/gamedata/fetch.mjs [ref]
// `ref` is a commit of DimbreathBot/TurnBasedGameData; the numbers in DESIGN.md were read at fe15a954eb.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { DEFAULT_DIR } from './lib.mjs'

const REPO = 'DimbreathBot/TurnBasedGameData'
const ref = process.argv[2] ?? 'HEAD'

const TABLES = [
  // enemies and Memory of Chaos stages
  'HardLevelGroup', 'EliteGroup', 'MonsterConfig', 'MonsterTemplateConfig', 'MonsterSkillConfig',
  'StageConfig', 'ChallengeMazeConfig', 'ChallengeGroupConfig',
  // characters
  'AvatarConfig', 'AvatarPromotionConfig', 'AvatarServantConfig', 'AvatarSkillConfig',
  'AvatarSkillTreeConfig', 'AvatarRankConfig', 'AvatarExRankConfig',
]

mkdirSync(DEFAULT_DIR, { recursive: true })
const get = (path) =>
  execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${REPO}/contents/${path}?ref=${ref}`], {
    maxBuffer: 256 * 1024 * 1024,
  })

for (const name of TABLES) {
  const bytes = get(`ExcelOutput/${name}.json`)
  writeFileSync(`${DEFAULT_DIR}/${name}.json`, bytes)
  console.log(`${name}.json  ${bytes.length} bytes`)
}
const textMap = get('TextMap/TextMapEN.json')
writeFileSync(`${DEFAULT_DIR}/TextMapEN.json`, textMap)
console.log(`TextMapEN.json  ${textMap.length} bytes`)

const commit = execFileSync('gh', ['api', `repos/${REPO}/commits/${ref}`, '--jq', '.sha + " " + (.commit.message | split("\\n")[0])'])
writeFileSync(`${DEFAULT_DIR}/SOURCE.txt`, commit)
console.log(`from ${commit.toString().trim()}`)
