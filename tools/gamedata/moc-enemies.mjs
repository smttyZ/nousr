// What Memory of Chaos enemies look like in the game data: the numbers behind data/enemies/generic-moc.json
// and the aggro table in src/battle/party.ts.
// Usage: node tools/gamedata/moc-enemies.mjs [dataDir]
import { open, v } from './lib.mjs'

const { load, t } = open(process.argv[2])

const groups = load('ChallengeGroupConfig').filter((g) => g.ChallengeGroupType === 'Memory')
const mazes = load('ChallengeMazeConfig')
const stageById = new Map(load('StageConfig').map((s) => [s.StageID, s]))
const monsters = new Map(load('MonsterConfig').map((m) => [m.MonsterID, m]))
const templates = new Map(load('MonsterTemplateConfig').map((m) => [m.MonsterTemplateID, m]))
const skills = new Map(load('MonsterSkillConfig').map((s) => [s.SkillID, s]))
const elite = new Map(load('EliteGroup').map((e) => [e.EliteGroup, e]))
const hard = new Map(load('HardLevelGroup').map((h) => [`${h.HardLevelGroup}:${h.Level}`, h]))

/** An enemy stat = template base x per-enemy ratio x the stage's elite-group ratio x its level ratio. */
function statLine(monsterId, stage) {
  const m = monsters.get(monsterId)
  const tp = m && templates.get(m.MonsterTemplateID)
  const eg = elite.get(stage.EliteGroup)
  const hl = hard.get(`${stage.HardLevelGroup}:${stage.Level}`)
  if (!m || !tp || !eg || !hl) return undefined
  const stat = (name) => v(tp[`${name}Base`]) * v(m[`${name}ModifyRatio`]) * v(eg[`${name}Ratio`]) * v(hl[`${name}Ratio`])
  return {
    name: t(m.MonsterName),
    rank: tp.Rank,
    atk: stat('Attack'),
    def: stat('Defence'),
    spd: stat('Speed'),
    hp: stat('HP'),
    toughness: stat('Stance'),
    skills: m.SkillList,
  }
}

function* enemiesOf(group, minFloor) {
  for (const maze of mazes.filter((z) => z.GroupID === group.GroupID && z.Floor >= minFloor)) {
    for (const [half, events] of [[1, maze.EventIDList1], [2, maze.EventIDList2]]) {
      for (const eventId of events ?? []) {
        const stage = stageById.get(eventId)
        if (!stage) continue
        for (const [wave, list] of stage.MonsterList.entries()) {
          for (const id of Object.values(list).filter((x) => typeof x === 'number' && x > 0)) {
            const s = statLine(id, stage)
            if (s) yield { floor: maze.Floor, half, wave: wave + 1, level: stage.Level, ...s }
          }
        }
      }
    }
  }
}

const tally = (xs) => {
  const m = new Map()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  return [...m].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}×${n}`).join('  ')
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

// ---- aggro
console.log('== character BaseAggro by path (25 = 1 aggro point)')
const promo = load('AvatarPromotionConfig')
const byPath = new Map()
for (const a of load('AvatarConfig')) {
  const p = promo.find((x) => x.AvatarID === a.AvatarID)
  if (p) byPath.set(a.AvatarBaseType, (byPath.get(a.AvatarBaseType) ?? new Set()).add(v(p.BaseAggro)))
}
for (const [path, set] of byPath) console.log(`  ${path.padEnd(10)} ${[...set].join(', ')}`)
console.log('== memosprite Aggro')
for (const s of load('AvatarServantConfig')) console.log(`  ${String(v(s.Aggro)).padEnd(5)} ${t(s.ServantName)}`)

// ---- level ratios
console.log('== level ratios used by Memory of Chaos stages (HardLevelGroup 3)')
for (const level of [90, 92, 95]) {
  const h = hard.get(`3:${level}`)
  console.log(`  lv${level} ATK x${v(h.AttackRatio)}  DEF x${v(h.DefenceRatio)}  SPD x${v(h.SpeedRatio)}`)
}

// ---- the newest released-or-upcoming periods, floor 12
const recent = groups.slice(-9)
console.log('== floor 12 enemies, last 9 periods in the data (E = elite, B = boss; ATK then SPD)')
const spdByRank = new Map()
const hpByRank = new Map()
const toughByRank = new Map()
const energyByTag = new Map()
const paramsByTag = new Map()
for (const g of recent) {
  const rows = []
  for (const e of enemiesOf(g, 12)) {
    rows.push(`${e.rank === 'Elite' ? 'E' : 'B'} ${e.atk.toFixed(1)}/${e.spd.toFixed(0)}`)
    spdByRank.set(e.rank, [...(spdByRank.get(e.rank) ?? []), Math.round(e.spd)])
    hpByRank.set(e.rank, [...(hpByRank.get(e.rank) ?? []), Math.round(e.hp)])
    toughByRank.set(e.rank, [...(toughByRank.get(e.rank) ?? []), Math.round(e.toughness)])
    for (const skillId of e.skills) {
      const k = skills.get(skillId)
      if (!k || v(k.SPHitBase) === undefined) continue
      const tag = t(k.SkillTag)
      energyByTag.set(tag, [...(energyByTag.get(tag) ?? []), v(k.SPHitBase)])
      paramsByTag.set(tag, [...(paramsByTag.get(tag) ?? []), `${t(k.SkillName)}: [${k.ParamList.map((x) => +v(x).toFixed(3)).join(', ')}]`])
    }
  }
  console.log(`  ${g.GroupID} ${t(g.GroupName).padEnd(26)} ${rows.join(' | ')}`)
}
console.log('== SPD by rank over those periods')
for (const [rank, xs] of spdByRank) console.log(`  ${rank.padEnd(10)} n=${xs.length} median ${median(xs)}  ${tally(xs)}`)
console.log('== max HP by rank over those periods (one wave, one enemy; every copy of an enemy counted)')
for (const [rank, xs] of hpByRank) {
  const s = [...xs].sort((a, b) => a - b)
  console.log(`  ${rank.padEnd(10)} n=${xs.length} median ${median(xs)}  min ${s[0]}  max ${s[s.length - 1]}`)
}
console.log('== toughness by rank over those periods (internal units; displayed = /3)')
for (const [rank, all] of toughByRank) {
  // A few bosses have no single toughness value in these tables (NaN); they are counted, not used.
  const xs = all.filter(Number.isFinite)
  const missing = all.length - xs.length
  console.log(`  ${rank.padEnd(10)} n=${xs.length} median ${median(xs)}  ${tally(xs)}${missing ? `  (${missing} without a value)` : ''}`)
}
console.log('== energy given to the target, by skill tag')
for (const [tag, xs] of energyByTag) console.log(`  ${tag.padEnd(14)} n=${xs.length}  ${tally(xs)}`)
console.log('== raw skill parameters by tag (the first is read as the ATK multiplier)')
for (const tag of ['Single Target', 'Blast', 'AoE ATK', 'Bounce', 'Sweep']) {
  console.log(`  -- ${tag}`)
  for (const row of [...new Set(paramsByTag.get(tag) ?? [])].slice(0, 14)) console.log(`     ${row}`)
}
