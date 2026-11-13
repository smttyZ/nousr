import { describe, expect, it } from 'vitest'
import { Timeline } from '../engine'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile, parseEnemyProfile } from '../enemy/profile'
import type { EnemyProfile } from '../enemy/profile'
import { Enemies } from './enemies'
import { Party, removeDownedFromTimeline } from './party'

const generic = loadEnemyProfile('generic-moc')

/** A profile that only ever uses one attack, for testing that attack on its own. */
function only(attack: Record<string, unknown>): EnemyProfile {
  return parseEnemyProfile({
    format: 'nousr-enemy-profile',
    version: 1,
    id: 'test',
    level: 95,
    atk: 625.5,
    spd: 158.4,
    toughness: 360,
    res: 0.2,
    attacks: [{ id: 'x', energy: 10, ...attack }],
    pattern: ['x'],
  })
}

// Tank 6, destruction 5, support 4, hunt 3: shares 6/18, 5/18, 4/18, 3/18.
const AGGRO = { tank: 6, bruiser: 5, support: 4, hunter: 3 }
const SHARE = { tank: 6 / 18, bruiser: 5 / 18, support: 4 / 18, hunter: 3 / 18 }

function setup(profile: EnemyProfile, count = 1) {
  const timeline = new Timeline()
  const party = new Party(timeline.bus, () => timeline.now)
  Object.entries(AGGRO).forEach(([id, baseAggro], position) => {
    party.add({ id, position, baseAggro, maxHp: 100_000, def: 1000, maxEnergy: 1000 })
  })
  const enemies = new Enemies(timeline, party, profile, count)
  const hits: EngineEvents['allyHit'][] = []
  timeline.bus.on('allyHit', (e) => hits.push(e))
  const run = (cycles: number) =>
    timeline.run({ cycles, takeTurn: (turn) => { if (enemies.has(turn.unit)) enemies.takeTurn(turn) } })
  return { timeline, party, enemies, hits, run }
}

/** Share of enemy damage that gets past 1,000 DEF at enemy level 95. */
const DEF_1000 = 1 - 1000 / (1000 + 200 + 950)

describe('the generic enemy on the timeline', () => {
  it('acts every 10,000 / 158.4 AV: twice in cycle 1 and 8 times in 5 cycles', () => {
    const { run } = setup(generic)
    const turns = run(5).filter((s) => s.kind === 'turn')
    expect(turns).toHaveLength(8)
    expect(turns[0]!.at).toBeCloseTo(10_000 / 158.4, 9)
    expect(turns.filter((s) => s.cycle === 1)).toHaveLength(2)
  })

  it('uses single, single, AoE and starts over', () => {
    const { timeline, run } = setup(generic)
    const used: string[] = []
    timeline.bus.on('enemyAttack', (e) => used.push(e.attack))
    run(5)
    expect(used).toEqual(['strike', 'strike', 'sweep', 'strike', 'strike', 'sweep', 'strike', 'strike'])
  })

  it('with 3 enemies, each takes its own turns, in order, in step with the others', () => {
    const { timeline, enemies, run } = setup(generic, 3)
    const log: string[] = []
    timeline.bus.on('enemyAttack', (e) => log.push(`${e.enemy} ${e.attack}`))
    run(1)
    expect(enemies.ids).toEqual(['enemy1', 'enemy2', 'enemy3'])
    expect(log).toEqual([
      'enemy1 strike', 'enemy2 strike', 'enemy3 strike',
      'enemy1 strike', 'enemy2 strike', 'enemy3 strike',
    ])
  })
})

describe('a single-target attack', () => {
  it('is split across the allies by aggro, and the shares add up to one full hit', () => {
    const { enemies, hits, timeline } = setup(only({ target: 'single', multiplier: 2.5 }))
    timeline.step((turn) => enemies.takeTurn(turn))

    const full = 625.5 * 2.5 * DEF_1000
    expect(full).toBeCloseTo(836.4244186, 6)
    for (const hit of hits) {
      const share = SHARE[hit.unit as keyof typeof SHARE]
      expect(hit.hits).toBeCloseTo(share, 12)
      expect(hit.damage).toBeCloseTo(share * full, 9)
    }
    expect(hits.map((h) => h.unit)).toEqual(['tank', 'bruiser', 'support', 'hunter'])
    expect(hits.reduce((sum, h) => sum + h.damage, 0)).toBeCloseTo(full, 9)
  })

  it('takes the HP off and gives each ally its share of the energy', () => {
    const { enemies, party, timeline } = setup(only({ target: 'single', multiplier: 2.5 }))
    timeline.step((turn) => enemies.takeTurn(turn))
    expect(party.get('tank').hp).toBeCloseTo(100_000 - SHARE.tank * 625.5 * 2.5 * DEF_1000, 9)
    expect(party.get('tank').energy).toBeCloseTo(SHARE.tank * 10, 12)
    expect(party.get('hunter').energy).toBeCloseTo(SHARE.hunter * 10, 12)
  })

  it('uses each ally\'s own DEF, damage reduction and shield', () => {
    const { enemies, party, hits, timeline } = setup(only({ target: 'single', multiplier: 2.5 }))
    party.setStats('tank', { def: 3000 })
    party.setDamageReduction('bruiser', 'buff', 0.2)
    party.setShield('support', 'shield', 10_000)
    timeline.step((turn) => enemies.takeTurn(turn))

    const raw = 625.5 * 2.5
    const byUnit = Object.fromEntries(hits.map((h) => [h.unit, h.damage]))
    expect(byUnit.tank).toBeCloseTo(SHARE.tank * raw * (1 - 3000 / (3000 + 1150)), 9)
    expect(byUnit.bruiser).toBeCloseTo(SHARE.bruiser * raw * DEF_1000 * 0.8, 9)
    expect(party.get('support').hp).toBe(100_000) // absorbed
    expect(party.get('support').energy).toBeCloseTo(SHARE.support * 10, 12) // still hit
  })

  it('a taunt sends the whole hit to one ally', () => {
    const { enemies, hits, timeline } = setup(only({ target: 'single', multiplier: 2.5 }))
    enemies.setForcedTarget('enemy1', 'hunter')
    timeline.step((turn) => enemies.takeTurn(turn))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ unit: 'hunter', hits: 1 })
    expect(hits[0]!.damage).toBeCloseTo(625.5 * 2.5 * DEF_1000, 9)
  })

  it('energy from being hit is scaled by Energy Regeneration Rate', () => {
    const { enemies, party, timeline } = setup(only({ target: 'single', multiplier: 2.5 }))
    party.setStats('tank', { energyRegen: 0.194 })
    timeline.step((turn) => enemies.takeTurn(turn))
    expect(party.get('tank').energy).toBeCloseTo(SHARE.tank * 10 * 1.194, 12)
  })
})

describe('other attack shapes', () => {
  it('AoE hits every ally once', () => {
    const { enemies, party, hits, timeline } = setup(only({ target: 'aoe', multiplier: 3 }))
    timeline.step((turn) => enemies.takeTurn(turn))
    expect(hits.map((h) => h.hits)).toEqual([1, 1, 1, 1])
    for (const hit of hits) expect(hit.damage).toBeCloseTo(625.5 * 3 * DEF_1000, 9)
    expect(party.get('hunter').energy).toBe(10)
  })

  it('bounce is one share per hit', () => {
    const { enemies, hits, timeline } = setup(only({ target: 'bounce', multiplier: 0.6, hits: 5, energy: 5 }))
    timeline.step((turn) => enemies.takeTurn(turn))
    const tank = hits.find((h) => h.unit === 'tank')!
    expect(tank.hits).toBeCloseTo(5 * SHARE.tank, 12)
    expect(tank.damage).toBeCloseTo(5 * SHARE.tank * 625.5 * 0.6 * DEF_1000, 9)
    expect(hits.reduce((sum, h) => sum + h.hits, 0)).toBeCloseTo(5, 12)
  })

  it('blast: the main hit by own share, the adjacent hit by the neighbours\' shares', () => {
    const { enemies, hits, timeline } = setup(only({ target: 'blast', multiplier: 2.5, adjacent_multiplier: 1.8 }))
    timeline.step((turn) => enemies.takeTurn(turn))

    const perMultiplier = 625.5 * DEF_1000
    const expected = {
      // The end of the line has one neighbour, the middle has two.
      tank: SHARE.tank * 2.5 + SHARE.bruiser * 1.8,
      bruiser: SHARE.bruiser * 2.5 + (SHARE.tank + SHARE.support) * 1.8,
      support: SHARE.support * 2.5 + (SHARE.bruiser + SHARE.hunter) * 1.8,
      hunter: SHARE.hunter * 2.5 + SHARE.support * 1.8,
    }
    for (const hit of hits) {
      expect(hit.damage).toBeCloseTo(perMultiplier * expected[hit.unit as keyof typeof expected], 9)
    }
    // Exactly one main hit in total. Adjacent hits: 1 if an end was targeted, 2 if a middle was.
    const totalHits = hits.reduce((sum, h) => sum + h.hits, 0)
    expect(totalHits).toBeCloseTo(1 + (SHARE.tank + SHARE.hunter) * 1 + (SHARE.bruiser + SHARE.support) * 2, 12)
  })

  it('a memosprite standing between two characters is their neighbour', () => {
    const { enemies, party, hits, timeline } = setup(only({ target: 'blast', multiplier: 2, adjacent_multiplier: 1 }))
    party.add({ id: 'sprite', position: 0.5, baseAggro: 4, maxHp: 50_000, def: 1000 })
    enemies.setForcedTarget('enemy1', 'sprite')
    timeline.step((turn) => enemies.takeTurn(turn))
    expect(hits.map((h) => [h.unit, h.hits])).toEqual([['tank', 1], ['sprite', 1], ['bruiser', 1]])
  })
})

describe('more enemies and falling allies', () => {
  it('3 enemies deal 3 times the damage of 1 over the same time', () => {
    const one = setup(generic, 1)
    const three = setup(generic, 3)
    one.run(5)
    three.run(5)
    const lost = (s: typeof one) => 100_000 - s.party.get('support').hp
    expect(lost(three)).toBeCloseTo(3 * lost(one), 6)
    expect(three.party.get('support').energy).toBeCloseTo(3 * one.party.get('support').energy, 9)
  })

  it('a downed ally leaves the turn order and the rest share its hits', () => {
    const { timeline, party, enemies, hits, run } = setup(only({ target: 'single', multiplier: 2.5 }))
    removeDownedFromTimeline(timeline)
    timeline.addUnit({ id: 'hunter', baseSpd: 100 })
    party.setStats('hunter', { maxHp: 100 }) // 100 HP: the first hit downs it
    const downed: string[] = []
    timeline.bus.on('unitDowned', (e) => downed.push(e.unit))

    run(1)
    expect(downed).toEqual(['hunter'])
    expect(party.anyDowned()).toBe(true)
    expect(timeline.has('hunter')).toBe(false)

    // First attack: four shares, computed before the hunter fell. Second: three shares.
    expect(hits.slice(0, 4).map((h) => h.unit)).toEqual(['tank', 'bruiser', 'support', 'hunter'])
    const second = hits.slice(4)
    expect(second.map((h) => h.unit)).toEqual(['tank', 'bruiser', 'support'])
    expect(second.find((h) => h.unit === 'tank')!.hits).toBeCloseTo(6 / 15, 12)
    expect(enemies.nextAttack('enemy1').id).toBe('x')
  })

  it('with nobody standing, the enemy\'s turn does nothing', () => {
    const { timeline, party, enemies, hits } = setup(only({ target: 'aoe', multiplier: 3 }))
    for (const id of party.standing()) party.takeDamage(id, 1e9, 'enemy1')
    timeline.step((turn) => enemies.takeTurn(turn))
    expect(hits).toEqual([])
  })

  it('rejects a bad enemy count and an id that is not an enemy', () => {
    const timeline = new Timeline()
    const party = new Party(timeline.bus)
    expect(() => new Enemies(timeline, party, generic, 0)).toThrow(/positive whole number/)
    const enemies = new Enemies(timeline, party, generic, 1)
    expect(() => enemies.nextAttack('tank')).toThrow(/not an enemy/)
  })
})

describe('enemy HP', () => {
  const withHp = (hp: number) => parseEnemyProfile({
    format: 'nousr-enemy-profile',
    version: 1,
    id: 'test',
    level: 95,
    atk: 625.5,
    spd: 158.4,
    hp,
    toughness: 480,
    res: 0.2,
    attacks: [{ id: 'x', energy: 10, target: 'single', multiplier: 2.5 }],
    pattern: ['x'],
  })

  it('every copy starts at the profile\'s HP, which is both its current and its max', () => {
    const { enemies } = setup(generic, 3)
    for (const id of enemies.ids) {
      expect(enemies.hp(id)).toBe(2_904_993)
      expect(enemies.maxHp(id)).toBe(2_904_993)
    }
  })

  it('damage lowers one enemy\'s current HP and leaves its max and the others alone', () => {
    const { enemies } = setup(withHp(10_000), 3)
    enemies.takeDamage('enemy2', 1_500)
    enemies.takeDamage('enemy2', 500)
    expect(enemies.hp('enemy2')).toBe(8_000)
    expect(enemies.maxHp('enemy2')).toBe(10_000)
    expect(enemies.hp('enemy1')).toBe(10_000)
    expect(enemies.hp('enemy3')).toBe(10_000)
  })

  it('goes below 0 and keeps taking its turns: enemies do not die', () => {
    const { enemies, hits, run } = setup(withHp(1_000))
    enemies.takeDamage('enemy1', 5_000)
    expect(enemies.hp('enemy1')).toBe(-4_000)
    run(1)
    expect(hits.length).toBeGreaterThan(0)
  })

  it('a profile without HP runs, ignores damage, and errors only when HP is asked for', () => {
    const { enemies } = setup(only({ target: 'single', multiplier: 2.5 }))
    expect(() => enemies.takeDamage('enemy1', 1_000)).not.toThrow()
    expect(() => enemies.hp('enemy1')).toThrow(/profile "test" has no "hp"/)
    expect(() => enemies.maxHp('enemy1')).toThrow(/profile "test" has no "hp"/)
  })

  it('asking about something that is not an enemy is an error', () => {
    const { enemies } = setup(generic)
    expect(() => enemies.hp('tank')).toThrow(/tank is not an enemy/)
    expect(() => enemies.takeDamage('tank', 1)).toThrow(/tank is not an enemy/)
  })
})
