import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { BattleSetup, MemberSetup } from '../battle/battle'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Rule } from '../scenario/types'
import { Acheron } from './acheron'
import { JingYuan, jingYuanScalings, lightningLordVulnerableWeights } from './jingYuan'
import type { Kit } from './kit'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const LORD = 'jy.lightning_lord'

/**
 * 1,000 damage per 100% ATK; the Affinitive Eidolon's enhanced state multiplies by 3.4 (1 + 2.4) and each E6 stack by
 * 1.12-ish (1 + 0.12 stacks), for Follow-Up only, as Fribbels does. The Follow-Up is one hit whose multiple is the
 * talent's multiple times the hit count.
 */
function makeKernel(requests: DamageRequest[] = []): DamageKernel {
  return {
    actionDamage(request) {
      requests.push(request)
      const c = request.attacker.characterConditionals ?? {}
      const s = jingYuanScalings(request.attacker.eidolon)
      const boost = c.ex1EnhancedState === true && request.attacker.ex === 1 ? 3.4 : 1
      const hit = (scaling: number, vulnerability = 1) => [{ damage: 1000 * scaling * boost * vulnerability, scaling }]
      return fakeResult({
        BASIC: hit(s.basic),
        SKILL: hit(s.skill),
        ULT: hit(s.ult),
        FUA: hit(s.lordHit * Number(c.talentAttacks), 1 + 0.12 * Number(c.e6FuaVulnerabilityStacks ?? 0)),
      })
    },
  }
}

const jingYuan = (eidolon = 0, affinitiveEidolon = false, baseSpd = 100): MemberSetup => ({
  key: 'jy',
  kit: JingYuan,
  eidolon,
  affinitiveEidolon,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
  kernel: { unit: { characterId: '1204', lightConeId: '24004', eidolon, superimposition: 1, ex: affinitiveEidolon ? 1 : 0 }, build: noBuild },
})

const rules = (...uses: [string, ...unknown[]][]): Rule[] => uses.map(([use]) => ({ unit: 'jy', use: use as Rule['use'], when: [] }))

function setup(overrides: Partial<BattleSetup> = {}) {
  const requests: DamageRequest[] = []
  const battle = new Battle({
    members: [jingYuan()],
    policy: rules(['basic']),
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 3,
    start: { energy: 0, skillPoints: 3, techniques: false },
    kernel: makeKernel(requests),
    ...overrides,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  const turns: EngineEvents['turnStart'][] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  battle.timeline.bus.on('turnStart', (t) => turns.push(t))
  const read = (name: string) => battle.member('jy').instance.quantities![name]!()
  return { battle, dealt, turns, requests, read }
}

describe('Jing Yuan: Lightning-Lord as a summon', () => {
  it('is a timeline unit with 60 SPD, not in the party, and acts at AV 166.7 without a policy rule', () => {
    const { battle, turns, dealt } = setup()
    expect(battle.timeline.has(LORD)).toBe(true)
    expect(battle.isSummon(LORD)).toBe(true)
    expect(battle.party.has(LORD)).toBe(false)
    expect(battle.timeline.spd(LORD)).toBe(60)
    battle.run()
    const first = turns.find((t) => t.unit === LORD)!
    expect(first.at).toBeCloseTo(10_000 / 60, 9)
    // The policy names only 'jy' basic; the summon's turn needed no rule.
    expect(dealt.some((d) => d.ability === 'FUA')).toBe(true)
  })

  it('the technique adds 3 hits for the first turn: 6 hits, 90 SPD', () => {
    const { battle, turns, requests } = setup({ start: { energy: 0, skillPoints: 3, techniques: true } })
    battle.run()
    expect(turns.find((t) => t.unit === LORD)!.at).toBeCloseTo(10_000 / 90, 9)
    expect(requests.some((r) => r.attacker.characterConditionals?.talentAttacks === 6)).toBe(true)
    // ... and only the first turn: afterwards it is back to 3.
    expect(turns.filter((t) => t.unit === LORD)[1]!.at - turns.find((t) => t.unit === LORD)!.at).toBeCloseTo(10_000 / 60, 9)
  })

  it('a Skill adds 2 hits and 20 SPD in the middle of its gauge: the rest of the wait shrinks', () => {
    const { battle, turns, dealt } = setup({ policy: rules(['skill'], ['basic']) })
    battle.run()
    // Jing Yuan acts at AV 100. By then the Lord has 4,000 gauge left. 5 hits is 80 SPD: 50 more AV.
    const first = turns.find((t) => t.unit === LORD)!
    expect(first.at).toBeCloseTo(150, 9)
    const fua = dealt.filter((d) => d.ability === 'FUA')[0]!
    expect(fua.scaling).toBeCloseTo(0.66 * 5, 9)
  })

  it('returns to 3 hits and 60 SPD after acting', () => {
    const { battle, turns } = setup({ policy: rules(['skill'], ['basic']) })
    battle.run()
    const lordTurns = turns.filter((t) => t.unit === LORD)
    expect(lordTurns.length).toBeGreaterThan(1)
    // First action at AV 150 with 5 hits, then back to 60 SPD (166.7 AV for a full gauge). JY's Skill at AV 200 gives it 5 hits
    // again with 7,000 of 10,000 left at 80 SPD: 87.5 AV later, at 287.5.
    expect(lordTurns[0]!.at).toBeCloseTo(150, 9)
    expect(lordTurns[1]!.at).toBeCloseTo(287.5, 9)
  })

  it('an Ultimate adds 3 hits and the Ultimate window still opens right after the Lord acts', () => {
    // E4: 2 energy per hit, 3 hits = 6. 90 + 15 at the start + 2 enemy attacks of 10 before AV 166.7 = 125; the Lord's action makes it 131.
    const { battle } = setup({
      members: [jingYuan(4, false, 30)],
      policy: [{ unit: 'jy', use: 'ultimate', when: [] }, { unit: 'jy', use: 'basic', when: [] }],
      start: { energy: 90 / 130, skillPoints: 3, techniques: false },
    })
    const result = battle.run()
    const names = result.actions.map((a) => a.action)
    expect(names.slice(0, 2)).toEqual(['lightning_lord', 'ultimate'])
  })

  it('credits the action and the damage to Jing Yuan, as a follow-up', () => {
    const { battle, dealt } = setup()
    const result = battle.run()
    const action = result.actions.find((a) => a.action === 'lightning_lord')!
    expect(action.actor).toBe('jy')
    expect(action.kind).toBe('followUp')
    expect(action.enemiesHit).toHaveLength(1)
    const fua = dealt.filter((d) => d.ability === 'FUA')
    expect(fua.every((d) => d.attacker === 'jy')).toBe(true)
    expect(result.damageByMember.jy).toBeCloseTo(dealt.reduce((sum, d) => sum + d.damage, 0), 6)
    expect(Object.keys(result.damageByMember)).toEqual(['jy'])
  })

  it('cannot be targeted: no enemy hit lands on it, it is not a party member and not an ally', () => {
    const { battle } = setup({ enemyCount: 3 })
    const hits: EngineEvents['allyHit'][] = []
    battle.timeline.bus.on('allyHit', (h) => hits.push(h))
    battle.run()
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h.unit === 'jy')).toBe(true)
    expect(battle.isAlly(LORD)).toBe(false)
    expect(battle.enemies.ids).not.toContain(LORD)
  })

  it('disappears when Jing Yuan is downed, and no Lord action happens after that', () => {
    const { battle } = setup()
    battle.party.takeDamage('jy', 1e12, battle.enemies.ids[0]!)
    expect(battle.party.get('jy').downed).toBe(true)
    expect(battle.timeline.has(LORD)).toBe(false)
    expect(battle.isSummon(LORD)).toBe(false)
  })

  it('what an ally attack listener sees: the Lord attack is Jing Yuan follow-up, so an Acheron talent that waits for a teammate attack fires', () => {
    // Acheron's Affinitive Eidolon waits for a teammate to attack an enemy with a Crimson Knot.
    const acheron: MemberSetup = {
      key: 'acheron',
      kit: Acheron,
      eidolon: 0,
      affinitiveEidolon: true,
      stats: { maxHp: 1_000_000, def: 1000, baseSpd: 90 },
      kernel: { unit: { characterId: '1308', lightConeId: '23024', eidolon: 0, superimposition: 1, ex: 1 }, build: noBuild },
    }
    const kernel: DamageKernel = {
      actionDamage(request) {
        if (request.attacker.characterId === '1308') return fakeResult({ BASIC: [{ damage: 1, scaling: 1 }], SKILL: [{ damage: 1, scaling: 1 }], ULT: [{ damage: 1, scaling: 1 }], FUA: [{ damage: 1, scaling: 1 }] })
        return makeKernel().actionDamage(request)
      },
    }
    const { battle } = setup({
      members: [jingYuan(0, false, 30), acheron],
      policy: [...rules(['basic']), { unit: 'acheron', use: 'basic', when: [] }],
      kernel,
    })
    const result = battle.run()
    const names = result.actions.map((a) => `${a.actor}:${a.action}`)
    const lordIndex = names.indexOf('jy:lightning_lord')
    expect(lordIndex).toBeGreaterThanOrEqual(0)
    expect(names.slice(0, lordIndex + 2)).toEqual(['acheron:basic', 'jy:lightning_lord', 'acheron:affinitive_follow_up'])
  })
})

describe('Jing Yuan: abilities', () => {
  it('multiples follow the eidolons', () => {
    expect(jingYuanScalings(0)).toMatchObject({ basic: 1, skill: 1, ult: 2, lordHit: 0.66, adjacent: 0.25 })
    expect(jingYuanScalings(1).adjacent).toBe(0.5)
    expect(jingYuanScalings(3)).toMatchObject({ basic: 1.1, ult: 2.16, skill: 1, lordHit: 0.66 })
    expect(jingYuanScalings(5)).toMatchObject({ skill: 1.1, lordHit: 0.726 })
  })

  it('energy: basic 20, skill 30, ultimate costs 130 and gives 5, +15 at the start; E4 gives 2 per Lord hit', () => {
    const { battle } = setup({ start: { energy: 0, skillPoints: 3, techniques: false } })
    const energy = () => battle.party.get('jy').energy
    battle.member('jy').instance.onBattleStart!({ techniques: false })
    expect(energy()).toBe(15)
    battle.member('jy').instance.actions.basic!.use()
    expect(energy()).toBe(35)
    battle.member('jy').instance.actions.skill!.use()
    expect(energy()).toBe(65)
    expect(battle.skillPoints).toBe(3)
    battle.party.setEnergy('jy', 130)
    battle.member('jy').instance.actions.ultimate!.use()
    expect(energy()).toBe(5)
  })

  it('E4: a Lord action gives Jing Yuan 2 energy per hit; below E4 it gives none', () => {
    for (const [eidolon, perHit] of [[3, 0], [4, 2]] as const) {
      const { battle } = setup({ members: [jingYuan(eidolon)] })
      const energy = () => battle.party.get('jy').energy
      let before: number | undefined
      let gained: number | undefined
      battle.timeline.bus.on('turnStart', (t) => { if (t.unit === LORD && before === undefined) before = energy() })
      battle.timeline.bus.on('actionUsed', (a) => {
        if (a.action === 'lightning_lord' && gained === undefined) gained = energy() - before!
      })
      battle.run()
      // The first Lord action has the base 3 hits (the policy only uses Basic ATK).
      expect(gained, `E${eidolon}`).toBeCloseTo(perHit * 3, 9)
    }
  })

  it('the Skill buffs CRIT Rate after it is used, not for itself, and the kernel is told', () => {
    const { battle, requests, read } = setup()
    battle.member('jy').instance.actions.skill!.use()
    const skillRequest = requests.find((r) => r.attacker.characterConditionals?.skillCritBuff === false)
    expect(skillRequest).toBeDefined()
    expect(read('war_marshal')).toBe(true)
  })

  it('E2: after the Lord acts, Basic, Skill and Ultimate deal 20% more for 2 turns', () => {
    const { battle, requests, read } = setup({ members: [jingYuan(2)] })
    battle.run()
    const flags = requests.map((r) => r.attacker.characterConditionals?.e2DmgBuff)
    expect(flags).toContain(true)
    expect(flags[0]).toBe(false)
    expect(read('war_marshal')).toBe(false)
  })

  it('E1 and the base 25%: the adjacent enemies take a quarter (E0) or half (E1) of the target multiple', () => {
    const total = (eidolon: number) => {
      const { battle, dealt } = setup({ members: [jingYuan(eidolon)], enemyCount: 3 })
      battle.run()
      return dealt.filter((d) => d.ability === 'FUA').slice(0, 3).reduce((sum, d) => sum + d.scaling, 0)
    }
    // 3 hits at 66% (E0) over 3 enemies in a row: the middle enemy has two neighbours, the others one.
    // Each hit's target is uniform, so the total multiple is 3 x 0.66 x (1 + a x 4/3) for neighbour share a.
    expect(total(0)).toBeCloseTo(3 * 0.66 * (1 + 0.25 * (4 / 3)), 9)
    // E1 raises a to 0.5; E5 not on, so still 0.66 per hit.
    expect(total(1)).toBeCloseTo(3 * 0.66 * (1 + 0.5 * (4 / 3)), 9)
  })

  it('E6: the stacks a hit sees are the earlier hits on the same enemy (expected value)', () => {
    expect(lightningLordVulnerableWeights(5, 1)).toEqual([1, 1, 1, 2])
    const w = lightningLordVulnerableWeights(10, 3)
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 12)
    expect(w[0]).toBeGreaterThan(w[1]!)
  })
})

describe('Jing Yuan: the Affinitive Eidolon', () => {
  const ae = (affinitive: boolean) => setup({ members: [jingYuan(0, affinitive)], start: { energy: 1, skillPoints: 3, techniques: false } })

  it('the Skill adds 2 + 6 hits and the Ultimate 3 + 12', () => {
    const { battle, read } = ae(true)
    battle.member('jy').instance.actions.skill!.use()
    expect(read('lightning_lord_hits')).toBe(3 + 8)
    battle.party.setEnergy('jy', 130)
    battle.member('jy').instance.actions.ultimate!.use()
    expect(read('lightning_lord_hits')).toBe(26)
  })

  it('without it the cap is 10 and nothing happens at the cap', () => {
    const { battle, read } = ae(false)
    for (let i = 0; i < 3; i++) {
      battle.party.setEnergy('jy', 130)
      battle.member('jy').instance.actions.ultimate!.use()
    }
    expect(read('lightning_lord_hits')).toBe(10)
    expect(battle.timeline.gauge(LORD)).toBe(10_000)
  })

  it('at 30 hits the Lord acts at once (gauge 0) and runs at 60 + 10 x 27 SPD', () => {
    const { battle, read } = ae(true)
    battle.party.setEnergy('jy', 130)
    battle.member('jy').instance.actions.ultimate!.use()
    expect(read('lightning_lord_hits')).toBe(18)
    battle.party.setEnergy('jy', 130)
    battle.member('jy').instance.actions.ultimate!.use()
    expect(read('lightning_lord_hits')).toBe(30)
    expect(battle.timeline.spd(LORD)).toBe(330)
    expect(battle.timeline.gauge(LORD)).toBe(0)
    expect(battle.timeline.order()[0]!.unit).toBe(LORD)
  })

  it('tells the kernel about the enhanced state, from the start of battle, and prices 30 hits', () => {
    const { battle, requests, dealt, read } = ae(true)
    expect(read('enhanced')).toBe(false)
    battle.run()
    expect(requests.every((r) => r.attacker.characterConditionals?.ex1EnhancedState === true)).toBe(true)
    // The first Lord action had 3 hits (no technique, only basics): 66% x 3.
    const fua = dealt.find((d) => d.ability === 'FUA')!
    expect(fua.scaling).toBeCloseTo(0.66 * 3, 9)
    expect(fua.damage).toBeCloseTo(1000 * 0.66 * 3 * 3.4, 6)
  })

  it('off: the kernel is told it is not enhanced', () => {
    const { battle, requests } = ae(false)
    battle.run()
    expect(requests.every((r) => r.attacker.characterConditionals?.ex1EnhancedState === false)).toBe(true)
  })
})

describe('summon API', () => {
  const noop: Kit = {
    characterId: 'noop',
    path: 'Harmony',
    element: 'Ice',
    maxEnergy: 0,
    create: () => ({ actions: {}, attackerState: () => ({}), teammateState: () => ({}) }),
  }

  it('refuses a summon with a bad owner or a duplicate id, and a summon with no turn handler flow can be removed', () => {
    const { battle } = setup()
    expect(() => battle.addSummon({ id: 'x', owner: 'nobody', baseSpd: 10, takeTurn: () => {} })).toThrow(/no member/)
    expect(() => battle.addSummon({ id: LORD, owner: 'jy', baseSpd: 10, takeTurn: () => {} })).toThrow(/already/)
    battle.removeSummon(LORD)
    battle.removeSummon(LORD)
    expect(battle.timeline.has(LORD)).toBe(false)
    expect(noop.characterId).toBe('noop')
  })
})

describe("Lightning-Lord's hit chance per enemy (K17)", () => {
  const lordAction = (eidolon: number, enemies: number, overrides: Partial<BattleSetup> = {}) => {
    const { battle } = setup({ members: [jingYuan(eidolon)], enemyCount: enemies, ...overrides })
    return battle.run().actions.find((a) => a.action === 'lightning_lord')!
  }

  it('3 hits on 1 enemy: 1 enemy, for sure', () => {
    const action = lordAction(0, 1)
    expect(action.expectedEnemiesHit).toBe(1)
    expect(action.hitChance).toEqual({ enemy1: 1 })
  })

  it('3 hits on 5 enemies with the 25% splash: end enemies 2/5 per hit, inner ones 3/5', () => {
    const action = lordAction(0, 5)
    const ends = 1 - (3 / 5) ** 3
    const inner = 1 - (2 / 5) ** 3
    expect(action.enemiesHit).toHaveLength(5)
    expect(action.hitChance.enemy1).toBeCloseTo(ends, 12)
    expect(action.hitChance.enemy5).toBeCloseTo(ends, 12)
    for (const id of ['enemy2', 'enemy3', 'enemy4']) expect(action.hitChance[id]).toBeCloseTo(inner, 12)
    expect(action.expectedEnemiesHit).toBeCloseTo(2 * ends + 3 * inner, 12)
    expect(action.expectedEnemiesHit).toBeLessThan(5)
  })

  it('E1 changes the splash damage, not who it reaches', () => {
    expect(lordAction(1, 5).expectedEnemiesHit).toBeCloseTo(lordAction(0, 5).expectedEnemiesHit, 12)
  })

  it('E6 splits the hits by Vulnerable stacks into several attack calls, and the chance still is that of all the hits', () => {
    expect(lordAction(6, 5).expectedEnemiesHit).toBeCloseTo(lordAction(0, 5).expectedEnemiesHit, 12)
    expect(lordAction(6, 5).hitChance.enemy3).toBeCloseTo(1 - (2 / 5) ** 3, 12)
  })

  it('more hits reach more enemies: 6 hits (the technique) on 5 enemies', () => {
    const action = lordAction(0, 5, { start: { energy: 0, skillPoints: 3, techniques: true } })
    expect(action.hitChance.enemy3).toBeCloseTo(1 - (2 / 5) ** 6, 12)
    expect(action.hitChance.enemy1).toBeCloseTo(1 - (3 / 5) ** 6, 12)
  })

  it("the hit marker leaves Lightning-Lord's damage as it was: 3 hits of 66% spread over the enemies", () => {
    const { battle, dealt } = setup({ members: [jingYuan(0)], enemyCount: 5 })
    battle.run()
    const first = dealt.filter((d) => d.ability === 'FUA' && d.at === dealt.find((x) => x.ability === 'FUA')!.at)
    // Per enemy: the 1 / 5 share of 3 hits as the target, plus 25% of it from each neighbour.
    const share = 0.66 * 3 / 5
    const byEnemy = Object.fromEntries(first.map((d) => [d.enemy, d.scaling]))
    expect(byEnemy.enemy1).toBeCloseTo(share * (1 + 0.25), 12)
    expect(byEnemy.enemy3).toBeCloseTo(share * (1 + 0.5), 12)
  })
})
