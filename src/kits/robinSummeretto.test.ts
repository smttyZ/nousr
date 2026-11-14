import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { BattleSetup, MemberSetup } from '../battle/battle'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Rule } from '../scenario/types'
import type { Kit } from './kit'
import {
  CHORD_BRANCH_ATK,
  CHORD_BRANCH_CD,
  CHORD_MODIFIER,
  countdownId,
  GUEST_MODIFIER,
  robinSummerettoScalings,
  RobinSummeretto,
  songbirdsId,
  TECHNIQUE_MODIFIER,
} from './robinSummeretto'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

const ROBIN_HP = 5000
const ROBIN_ATK = 1600
const ATK_BY_ID: Record<string, number> = { hi: 2500, lo: 900 }

/** Per 100% of the multiple: Basic 1,000, Memosprite Skill 2,000. The multiple the kernel used follows the eidolon, as Fribbels'. */
function makeKernel(requests: DamageRequest[] = []): DamageKernel {
  return {
    actionDamage(request) {
      requests.push(request)
      const id = request.attacker.characterId
      const stats = { ATK: ATK_BY_ID[id] ?? ROBIN_ATK, DEF: 0, HP: ROBIN_HP, SPD: 140, CR: 0, CD: 0, EHR: 0, RES: 0, BE: 0, ERR: 0, OHB: 0 }
      if (id !== '1512') return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] }, stats)
      const s = robinSummerettoScalings(request.attacker.eidolon)
      return fakeResult(
        { BASIC: [{ damage: 1000 * s.basic, scaling: s.basic }], MEMO_SKILL: [{ damage: 2000 * s.memoSkill, scaling: s.memoSkill }] },
        stats,
      )
    },
  }
}

const allyKit = (id: 'hi' | 'lo', maxEnergy = 0): Kit => ({
  characterId: id,
  path: 'Hunt',
  element: 'Lightning',
  maxEnergy,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'basic', 'basic', () =>
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] }),
          ),
      },
      // A stand-in for an ally that advances Robin (Sunday's Skill / Ultimate).
      push: {
        kind: 'skill',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'push', 'skill', () => {
            battle.timeline.advance('robin', 0.3)
          }),
      },
      heal: {
        kind: 'skill',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'heal', 'skill', () => {
            battle.party.heal('robin', 10, self.key)
          }),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
})

const robinSetup = (eidolon: number, baseSpd = 100): MemberSetup => ({
  key: 'robin',
  kit: RobinSummeretto,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: 1e6, def: 1000, baseSpd },
  kernel: { unit: { characterId: '1512', lightConeId: '24005', eidolon, superimposition: 1 }, build: noBuild },
})
const allySetup = (key: string, id: 'hi' | 'lo', baseSpd: number, maxEnergy = 0): MemberSetup => ({
  key,
  kit: allyKit(id, maxEnergy),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1e6, def: 1000, baseSpd },
  kernel: { unit: { characterId: id, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
})

interface Options {
  policy?: Rule[]
  techniques?: boolean
  cycles?: number
  enemies?: number
  members?: MemberSetup[]
}

function setup(eidolon = 0, options: Options = {}) {
  const requests: DamageRequest[] = []
  const members = options.members ?? [robinSetup(eidolon), allySetup('hi', 'hi', 90, 100), allySetup('lo', 'lo', 80)]
  const setupArg: BattleSetup = {
    members,
    policy: options.policy ?? members.map((m) => ({ unit: m.key, use: 'basic', when: [] })),
    profile,
    enemyCount: options.enemies ?? 1,
    weaknesses: 'all',
    cycles: options.cycles ?? 1,
    start: { energy: 0, skillPoints: 5, techniques: options.techniques ?? false },
    kernel: makeKernel(requests),
  }
  const battle = new Battle(setupArg)
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (d) => dealt.push(d))
  const actions: EngineEvents['actionUsed'][] = []
  battle.timeline.bus.on('actionUsed', (a) => actions.push(a))
  const robin = battle.member('robin').instance
  robin.onBattleStart!({ techniques: options.techniques ?? false })
  const q = (name: string) => robin.quantities![name]!()
  return { battle, requests, dealt, actions, robin, q }
}
type Setup = ReturnType<typeof setup>

const use = (battle: Battle, who: string, action: string, target?: string) => battle.member(who).instance.actions[action]!.use(target)

/** Gets Robin to 3 members and Fever: the Skill, then ally attacks. */
function toFever(t: Setup, eidolon = 0) {
  use(t.battle, 'robin', 'skill')
  const attacks = 14
  for (let i = 0; i < attacks && !t.q('fever'); i++) use(t.battle, 'hi', 'basic')
  expect(t.q('fever')).toBe(true)
}

const robinMate = (r: DamageRequest) => r.teammates.find((m) => m.characterId === '1512')!.characterConditionals!

describe('Skill and Summer Songbirds', () => {
  it('Skill costs a Skill Point, gives 30 energy and summons Bessie, an untargetable memosprite with 70% of her HP and SPD 180%', () => {
    const t = setup()
    const sp = t.battle.skillPoints
    use(t.battle, 'robin', 'skill')
    expect(t.battle.skillPoints).toBe(sp - 1)
    expect(t.q('songbirds')).toBe(1)
    const id = songbirdsId('robin')
    expect(t.battle.isMemosprite(id)).toBe(true)
    expect(t.battle.ownerOf(id)).toBe('robin')
    const body = t.battle.party.get(id)
    expect(body.maxHp).toBeCloseTo(0.7 * ROBIN_HP, 9)
    expect(body.targetable).toBe(false)
    expect(t.battle.timeline.spd(id)).toBeCloseTo(1.8 * 100, 9)
    // 30 (Skill) + 20 (summoned).
    expect(t.battle.party.get('robin').energy).toBeCloseTo(50, 9)
  })

  it('the Songbirds take no turn before Fever', () => {
    const t = setup(0, { cycles: 3 })
    use(t.battle, 'robin', 'skill')
    t.battle.run()
    expect(t.actions.some((a) => a.actor === songbirdsId('robin'))).toBe(false)
  })

  it('another Skill with Songbirds out gives 6 Vibes and summons no new unit', () => {
    const t = setup()
    use(t.battle, 'robin', 'skill')
    use(t.battle, 'robin', 'skill')
    expect(t.q('vibes')).toBe(6)
    expect(t.q('songbirds')).toBe(2)
    expect(t.battle.memospritesOf('robin')).toHaveLength(1)
  })

  it('the Technique gives 6 Vibes, a 20% advance and a 2-turn DMG buff to every ally, and the Skill then calls Drummie at once', () => {
    const t = setup(0, { techniques: true })
    expect(t.q('vibes')).toBe(6)
    expect(t.battle.timeline.gauge('robin')).toBeCloseTo(8000, 9)
    for (const key of ['robin', 'hi', 'lo']) expect(t.battle.timeline.modifiers.get(key, TECHNIQUE_MODIFIER)!.turnsLeft).toBe(2)
    use(t.battle, 'robin', 'skill')
    expect(t.q('songbirds')).toBe(2)
  })
})

describe('Vibes', () => {
  it("an ally attack gives 1 Vibe, her own Basic ATK too; a Skill that hits nothing gives none", () => {
    const t = setup()
    use(t.battle, 'hi', 'basic')
    expect(t.q('vibes')).toBe(1)
    use(t.battle, 'robin', 'basic')
    expect(t.q('vibes')).toBe(2)
    use(t.battle, 'robin', 'skill')
    expect(t.q('vibes')).toBe(2)
  })

  it('are capped at 50, at 70 from E2', () => {
    const t0 = setup(0)
    for (let i = 0; i < 60; i++) use(t0.battle, 'hi', 'basic')
    expect(t0.q('vibes')).toBeLessThanOrEqual(50)
    const t2 = setup(2)
    for (let i = 0; i < 80; i++) use(t2.battle, 'hi', 'basic')
    expect(t2.q('vibes')).toBe(70)
  })

  it('a healing ally gives 1 Vibe, the first of each source in a turn', () => {
    const t = setup()
    use(t.battle, 'lo', 'heal')
    expect(t.q('vibes')).toBe(1)
    t.battle.party.heal('robin', 5, 'lo')
    expect(t.q('vibes')).toBe(1)
  })

  it('E2: the first gain in a turn gives 2 more', () => {
    const t = setup(2)
    use(t.battle, 'hi', 'basic')
    expect(t.q('vibes')).toBe(3)
    // Outside any turn every gain shares one bucket, so there is no second bonus.
    use(t.battle, 'hi', 'basic')
    expect(t.q('vibes')).toBe(4)
  })

  it('Drummie at 6 Vibes and Paddie at 12 need Bessie on the field', () => {
    const t = setup()
    for (let i = 0; i < 13; i++) use(t.battle, 'hi', 'basic')
    expect(t.q('vibes')).toBe(13)
    expect(t.q('songbirds')).toBe(0)
    expect(t.q('fever')).toBe(false)
    use(t.battle, 'robin', 'skill')
    expect(t.q('songbirds')).toBe(3)
    expect(t.q('fever')).toBe(true)
  })
})

describe('Ultimate and Special Guest', () => {
  it('advances the ally 100%, gives it 20% of its Max Energy (21.6% at E5), costs 140 and gives 5 back', () => {
    for (const [eidolon, share] of [[0, 0.2], [5, 0.216]] as const) {
      const t = setup(eidolon)
      t.battle.party.setEnergy('robin', 140)
      use(t.battle, 'robin', 'ultimate', 'hi')
      expect(t.battle.timeline.gauge('hi')).toBe(0)
      expect(t.battle.party.get('hi').energy).toBeCloseTo(share * 100, 9)
      expect(t.battle.party.get('robin').energy).toBeCloseTo(5, 9)
      expect(t.battle.timeline.modifiers.has('hi', GUEST_MODIFIER)).toBe(true)
    }
  })

  it("the guest's attack gives 2 more Vibes than another ally's; Robin cannot be the target", () => {
    const t = setup()
    t.battle.party.setEnergy('robin', 140)
    use(t.battle, 'robin', 'ultimate', 'hi')
    use(t.battle, 'lo', 'basic')
    expect(t.q('vibes')).toBe(1)
    use(t.battle, 'hi', 'basic')
    expect(t.q('vibes')).toBe(4)
    t.battle.party.setEnergy('robin', 140)
    expect(() => use(t.battle, 'robin', 'ultimate', 'robin')).toThrow(/herself/)
    expect(() => use(t.battle, 'robin', 'ultimate')).toThrow(/needs a target/)
  })
})

describe('Fever', () => {
  it('starts with the third member: Robin leaves the order, the Songbirds enter it with a full gauge, the countdown has SPD 140', () => {
    const t = setup()
    toFever(t)
    const tl = t.battle.timeline
    // Robin is suspended with her gauge as it was (full: no time has passed); the Songbirds are in the order.
    expect(tl.isSuspended('robin')).toBe(true)
    expect(tl.gauge('robin')).toBe(10_000)
    expect(tl.order().map((o) => o.unit)).not.toContain('robin')
    expect(tl.isSuspended(songbirdsId('robin'))).toBe(false)
    expect(tl.gauge(songbirdsId('robin'))).toBe(10_000)
    expect(tl.spd(countdownId('robin'))).toBe(140)
    expect(t.battle.isSummon(countdownId('robin'))).toBe(true)
  })

  it("E4: +12 Vibes on entering, and the Songbirds' SPD +20% + 0.5% per Vibe (after those 12)", () => {
    const t = setup(4)
    use(t.battle, 'robin', 'skill')
    for (let i = 0; i < 12 && !t.q('fever'); i++) use(t.battle, 'hi', 'basic')
    expect(t.q('fever')).toBe(true)
    const vibes = t.q('vibes') as number
    expect(vibes).toBe(12 + 12)
    expect(t.battle.timeline.spd(songbirdsId('robin'))).toBeCloseTo(180 * (1 + 0.2 + 0.005 * vibes), 9)
  })

  it('E6: 140 energy, fixed, on entering Fever', () => {
    const t = setup(6)
    t.battle.party.setEnergy('robin', 0)
    toFever(t, 6)
    // 30 (Skill) + 20 (the summon) before Fever, the fixed 140 on entering it: it fits under the 280 cap, which a cap of 140 would have cut.
    expect(t.battle.party.get('robin').energy).toBe(30 + 20 + 140)
  })

  it("a Songbirds turn is the Memosprite Skill: all enemies, the kernel's MEMO_SKILL hit, credited to Robin with the Songbirds as actor", () => {
    const t = setup(0, { enemies: 3 })
    toFever(t)
    t.battle.party.setEnergy('robin', 0)
    t.dealt.length = 0
    t.battle.run()
    const memo = t.actions.filter((a) => a.actor === songbirdsId('robin'))
    expect(memo.length).toBeGreaterThan(0)
    expect(memo[0]!.owner).toBe('robin')
    expect(memo[0]!.enemiesHit).toHaveLength(3)
    const dealt = t.dealt.filter((d) => d.ability === 'MEMO_SKILL')
    expect(dealt.length).toBeGreaterThan(0)
    expect(dealt[0]!.attacker).toBe('robin')
    // 1.5 x 2,000 per enemy.
    expect(dealt[0]!.damage).toBeCloseTo(3000, 9)
    // +20 energy for her from each.
    expect(t.battle.party.get('robin').energy).toBeGreaterThan(0)
  })

  it('the multiples: 50% Basic ATK (55% at E5), 150% Memosprite Skill (165% at E5, doubled at E6)', () => {
    expect(robinSummerettoScalings(0).memoSkill).toBeCloseTo(1.5, 12)
    expect(robinSummerettoScalings(5).memoSkill).toBeCloseTo(1.65, 12)
    expect(robinSummerettoScalings(6).memoSkill).toBeCloseTo(3.3, 12)
    expect(robinSummerettoScalings(0).basic).toBe(0.5)
    expect(robinSummerettoScalings(5).basic).toBe(0.55)
    expect(robinSummerettoScalings(1).vibesCap).toBe(50)
    expect(robinSummerettoScalings(2).vibesCap).toBe(70)
  })

  it('the countdown takes half the Vibes, at least 12; at 0 the Songbirds disappear, Fever ends and Robin is back', () => {
    const t = setup(0, { cycles: 4 })
    toFever(t)
    expect(t.q('vibes')).toBe(12)
    t.battle.run()
    expect(t.q('fever')).toBe(false)
    expect(t.q('songbirds')).toBe(0)
    expect(t.q('vibes')).toBeLessThan(12)
    expect(t.battle.memospritesOf('robin')).toHaveLength(0)
    expect(t.battle.isSummon(countdownId('robin'))).toBe(false)
  })

  it('with 40 Vibes the countdown turns take 20, then 12 (half, at least 12), and the one that reaches 0 ends Fever', () => {
    const t = setup(2, { cycles: 6 })
    use(t.battle, 'robin', 'skill')
    for (let i = 0; i < 40; i++) use(t.battle, 'hi', 'basic')
    const start = t.q('vibes') as number
    expect(start).toBeGreaterThanOrEqual(40)
    expect(t.q('fever')).toBe(true)
    const seen: Array<[number, number]> = []
    let before = 0
    t.battle.timeline.bus.on('turnStart', (turn) => {
      if (turn.unit === countdownId('robin')) before = t.q('vibes') as number
    })
    t.battle.timeline.bus.on('turnEnd', (turn) => {
      if (turn.unit === countdownId('robin')) seen.push([before, t.q('vibes') as number])
    })
    t.battle.run()
    expect(seen.length).toBeGreaterThanOrEqual(3)
    for (const [b, a] of seen) {
      if (a > 0) expect(b - a).toBeCloseTo(Math.max(12, b * 0.5), 9)
      else expect(b).toBeLessThanOrEqual(12 + 1e-9)
    }
    expect(t.q('fever')).toBe(false)
  })

  it("Robin's gauge is back to what it was, then 50% advanced, when the Songbirds disappear", () => {
    const t = setup(0)
    use(t.battle, 'robin', 'skill')
    const g0 = t.battle.timeline.gauge('robin')
    for (let i = 0; i < 14 && !t.q('fever'); i++) use(t.battle, 'hi', 'basic')
    t.battle.removeMemosprite(songbirdsId('robin'))
    expect(t.q('fever')).toBe(false)
    expect(t.battle.timeline.gauge('robin')).toBeCloseTo(g0 - 5000, 6)
  })

  it('Robin takes no turn while Fever lasts, and acts again after it', () => {
    const t = setup(0, { cycles: 4 })
    toFever(t)
    const robinTurns = () => t.actions.filter((a) => a.actor === 'robin' && a.action === 'basic').length
    const before = robinTurns()
    t.battle.run()
    expect(t.q('fever')).toBe(false)
    expect(robinTurns()).toBeGreaterThan(before)
  })

  it('knocking Robin down ends Fever and removes the countdown', () => {
    const t = setup(0)
    toFever(t)
    t.battle.party.takeDamage('robin', 1e9, 'x')
    expect(t.battle.memospritesOf('robin')).toHaveLength(0)
    expect(t.battle.isSummon(countdownId('robin'))).toBe(false)
    expect(t.q('fever')).toBe(false)
  })
})

describe('what the kernel is told', () => {
  const robinRequests = (requests: DamageRequest[]) => requests.filter((r) => r.attacker.characterId === '1512')

  it('her own request carries the live switches (no Fever, no Songbirds: all off)', () => {
    const t = setup()
    use(t.battle, 'robin', 'basic')
    const c = robinRequests(t.requests).at(-1)!.attacker.characterConditionals!
    expect(c).toMatchObject({ feverState: false, songbirdCount: 0, e2ResPen: false, e4MemoSpdBuff: false, e6MemoSkillBuff: false, techniqueDmgBuff: false })
  })

  it("in Fever the Songbirds' attack is priced with Fever, the live Vibes, the member count, E4, E6 and the Songbirds' own Chord", () => {
    const t = setup(6)
    toFever(t, 6)
    t.requests.length = 0
    t.battle.run()
    const cs = robinRequests(t.requests).map((r) => r.attacker.characterConditionals!)
    const memo = cs.find((c) => c.deviatedChordCdBuff === true)
    expect(memo).toMatchObject({ feverState: true, songbirdCount: 3, e4MemoSpdBuff: true, e6MemoSkillBuff: true, e2ResPen: true })
    expect(memo!.vibes).toBeGreaterThan(0)
  })

  it('a higher-ATK teammate gets the Chord as ATK with her Max HP, a lower-ATK one as CRIT DMG', () => {
    const t = setup()
    use(t.battle, 'hi', 'basic')
    t.requests.length = 0
    use(t.battle, 'hi', 'basic')
    const hi = t.requests.find((r) => r.attacker.characterId === 'hi')!
    expect(robinMate(hi)).toMatchObject({ teammateHPValue: ROBIN_HP, deviatedChordBranch: CHORD_BRANCH_ATK, vibes: 1 })
    use(t.battle, 'lo', 'basic')
    t.requests.length = 0
    use(t.battle, 'lo', 'basic')
    const lo = t.requests.find((r) => r.attacker.characterId === 'lo')!
    expect(robinMate(lo)).toMatchObject({ deviatedChordBranch: CHORD_BRANCH_CD })
    expect(t.battle.timeline.modifiers.has('lo', CHORD_MODIFIER)).toBe(true)
  })

  it('an ally without the Chord outside an action gets nothing from it (an ATK Chord of 0 HP)', () => {
    const t = setup()
    const idle = t.requests.find((r) => r.attacker.characterId === 'hi')!
    expect(robinMate(idle)).toMatchObject({ teammateHPValue: 0, deviatedChordBranch: CHORD_BRANCH_ATK })
  })

  it("the Chord reaches the ally's own first attack (the action in progress counts)", () => {
    const t = setup()
    use(t.battle, 'hi', 'basic')
    const first = t.requests.find((r) => r.attacker.characterId === 'hi' && robinMate(r).teammateHPValue === ROBIN_HP)
    expect(first).toBeDefined()
  })

  it("the team buffs are live: Fever, Vibes, the member count and E2 reach a teammate's request", () => {
    const t = setup(2)
    toFever(t, 2)
    t.requests.length = 0
    use(t.battle, 'lo', 'basic')
    const lo = t.requests.find((r) => r.attacker.characterId === 'lo')!
    expect(robinMate(lo)).toMatchObject({ feverState: true, songbirdCount: 3, e2ResPen: true, techniqueDmgBuff: false })
    expect(robinMate(lo).vibes).toBeGreaterThan(0)
  })

  it("the Technique's buff is on for the holder only while its modifier is", () => {
    const t = setup(0, { techniques: true })
    use(t.battle, 'lo', 'basic')
    const lo = t.requests.filter((r) => r.attacker.characterId === 'lo').at(-1)!
    expect(robinMate(lo).techniqueDmgBuff).toBe(true)
    t.battle.timeline.modifiers.remove('lo', TECHNIQUE_MODIFIER)
    t.requests.length = 0
    t.battle.combatStats('lo')
    expect(robinMate(t.requests.find((r) => r.attacker.characterId === 'lo')!).techniqueDmgBuff).toBe(false)
  })
})

describe('a whole battle', () => {
  it('runs 5 cycles on 3 enemies with Fever starting and ending, and Songbirds damage on the enemies', () => {
    const members = [robinSetup(0, 140), allySetup('hi', 'hi', 110), allySetup('lo', 'lo', 100)]
    const policy: Rule[] = [
      { unit: 'robin', use: 'skill', when: [{ what: 'robin.songbirds', max: 0 }] },
      { unit: 'robin', use: 'basic', when: [] },
      { unit: 'hi', use: 'basic', when: [] },
      { unit: 'lo', use: 'basic', when: [] },
    ]
    const t = setup(0, { members, policy, cycles: 5, enemies: 3, techniques: true })
    const result = t.battle.run()
    expect(result.downed).toEqual([])
    expect(t.dealt.some((d) => d.ability === 'MEMO_SKILL')).toBe(true)
    expect(result.damageByMember.robin).toBeGreaterThan(0)
  })
})

describe('suspension in Fever', () => {
  it('an advance an ally gives Robin during Fever applies to her frozen gauge and survives to after Fever', () => {
    const t = setup(0)
    toFever(t)
    const tl = t.battle.timeline
    expect(tl.gauge('robin')).toBe(10_000)
    use(t.battle, 'lo', 'push')
    expect(tl.gauge('robin')).toBe(7000)
    expect(tl.isSuspended('robin')).toBe(true)
    t.battle.removeMemosprite(songbirdsId('robin'))
    expect(t.q('fever')).toBe(false)
    expect(tl.isSuspended('robin')).toBe(false)
    // 7,000 kept, then Astride Summer's Nightwind 50%.
    expect(tl.gauge('robin')).toBe(2000)
  })

  it('an advance to 0 in Fever does not give her a turn until Fever ends', () => {
    const t = setup(0, { cycles: 3 })
    toFever(t)
    t.battle.timeline.advance('robin', 1)
    expect(t.battle.timeline.gauge('robin')).toBe(0)
    expect(t.battle.timeline.order().map((o) => o.unit)).not.toContain('robin')
    const robinTurnsInFever: number[] = []
    t.battle.timeline.bus.on('turnStart', (turn) => {
      if (turn.unit === 'robin' && t.q('fever')) robinTurnsInFever.push(turn.serial)
    })
    t.battle.run()
    expect(robinTurnsInFever).toEqual([])
    expect(t.q('fever')).toBe(false)
  })

  it('the Songbirds are suspended from the Skill on, and an advance before Fever gives them no turn and is replaced by a full gauge at Fever', () => {
    const t = setup(0)
    const tl = t.battle.timeline
    use(t.battle, 'robin', 'skill')
    const id = songbirdsId('robin')
    expect(tl.isSuspended(id)).toBe(true)
    tl.advance(id, 1)
    expect(tl.gauge(id)).toBe(0)
    expect(tl.order().map((o) => o.unit)).not.toContain(id)
    // A whole cycle with Bessie alone on the field: no Songbirds turn.
    t.battle.run()
    expect(t.actions.filter((a) => a.actor === id)).toEqual([])
    expect(t.q('fever')).toBe(false)
    // Fever starts: they are in the order with a full gauge.
    for (let i = 0; i < 14 && !t.q('fever'); i++) use(t.battle, 'hi', 'basic')
    expect(t.q('fever')).toBe(true)
    expect(tl.isSuspended(id)).toBe(false)
    expect(tl.gauge(id)).toBe(10_000)
  })

  it('emits unitSuspended for the Songbirds when Bessie comes, and for Robin and unitResumed for the Songbirds when Fever starts', () => {
    const t = setup(0)
    const log: string[] = []
    t.battle.timeline.bus.on('unitSuspended', (e) => log.push(`suspended ${e.unit}`))
    t.battle.timeline.bus.on('unitResumed', (e) => log.push(`resumed ${e.unit} ${e.gauge}`))
    toFever(t)
    expect(log).toEqual([`suspended ${songbirdsId('robin')}`, 'suspended robin', `resumed ${songbirdsId('robin')} 10000`])
  })
})

describe('E4: the Songbirds SPD follows the live Vibes', () => {
  it('re-applies on every Vibes change in Fever, and the base SPD stays the snapshot from the summon', () => {
    const t = setup(4)
    use(t.battle, 'robin', 'skill')
    for (let i = 0; i < 12 && !t.q('fever'); i++) use(t.battle, 'hi', 'basic')
    const tl = t.battle.timeline
    const id = songbirdsId('robin')
    const spd = () => tl.spd(id)
    const base = 100 * 1.8
    expect(spd()).toBeCloseTo(base * (1 + 0.2 + 0.005 * (t.q('vibes') as number)), 9)
    const before = spd()
    use(t.battle, 'hi', 'basic')
    expect(spd()).toBeCloseTo(base * (1 + 0.2 + 0.005 * (t.q('vibes') as number)), 9)
    expect(spd()).toBeGreaterThan(before)
    // Her own SPD changing later does not change the "initial" base.
    tl.modifiers.apply({ id: 'buff', target: 'robin', source: 'hi', spdPct: 0.5 })
    expect(spd()).toBeCloseTo(base * (1 + 0.2 + 0.005 * (t.q('vibes') as number)), 9)
  })

  it('falls with the Vibes at each countdown turn', () => {
    const t = setup(4, { cycles: 6 })
    use(t.battle, 'robin', 'skill')
    for (let i = 0; i < 40 && !t.q('fever'); i++) use(t.battle, 'hi', 'basic')
    for (let i = 0; i < 20; i++) use(t.battle, 'hi', 'basic')
    const seen: Array<[number, number]> = []
    t.battle.timeline.bus.on('turnEnd', (turn) => {
      if (turn.unit !== countdownId('robin') || !t.battle.timeline.has(songbirdsId('robin'))) return
      seen.push([t.q('vibes') as number, t.battle.timeline.spd(songbirdsId('robin'))])
    })
    t.battle.run()
    expect(seen.length).toBeGreaterThanOrEqual(1)
    for (const [vibes, spd] of seen) expect(spd).toBeCloseTo(180 * (1.2 + 0.005 * vibes), 9)
  })

  it('without E4 there is no SPD bonus', () => {
    const t = setup(0)
    toFever(t)
    expect(t.battle.timeline.spd(songbirdsId('robin'))).toBeCloseTo(180, 9)
  })
})

describe('E6: storing the Ultimate twice in Fever', () => {
  it('the energy cap is 280 while Fever lasts, the Ultimate costs 140 of what she holds, and the cap is back at 140 afterwards', () => {
    const t = setup(6)
    const party = t.battle.party
    expect(party.get('robin').maxEnergy).toBe(140)
    toFever(t, 6)
    expect(party.get('robin').maxEnergy).toBe(280)
    party.setEnergy('robin', 280)
    expect(t.robin.actions.ultimate!.canUse()).toBe(true)
    use(t.battle, 'robin', 'ultimate', 'hi')
    // 280 - 140, then the Ultimate's own 5.
    expect(party.get('robin').energy).toBe(145)
    expect(t.robin.actions.ultimate!.canUse()).toBe(true)
    use(t.battle, 'robin', 'ultimate', 'hi')
    expect(party.get('robin').energy).toBe(10)
    party.setEnergy('robin', 280)
    t.battle.removeMemosprite(songbirdsId('robin'))
    expect(party.get('robin').maxEnergy).toBe(140)
    expect(party.get('robin').energy).toBe(140)
  })

  it('refills at a countdown turn (a fixed 140 on top of what she holds, up to the cap)', () => {
    const t = setup(6, { cycles: 3 })
    toFever(t, 6)
    t.battle.party.setEnergy('robin', 100)
    let seen: number | undefined
    t.battle.timeline.bus.on('turnEnd', (turn) => {
      if (turn.unit === countdownId('robin') && seen === undefined) seen = t.battle.party.get('robin').energy
    })
    t.battle.run()
    expect(seen).toBeGreaterThanOrEqual(240)
  })

  it('without E6 the cap stays 140 in Fever', () => {
    const t = setup(0)
    toFever(t)
    expect(t.battle.party.get('robin').maxEnergy).toBe(140)
  })
})

describe('E1: True DMG from the Songbirds tally', () => {
  it('the tally starts at Bessie and counts the non-True DMG allies deal, Robin included', () => {
    const t = setup(1)
    use(t.battle, 'hi', 'basic')
    expect(t.q('e1_tally')).toBe(0)
    use(t.battle, 'robin', 'skill')
    use(t.battle, 'hi', 'basic')
    use(t.battle, 'robin', 'basic')
    // hi 1,000, her Basic ATK 1,000 x 0.5.
    expect(t.q('e1_tally')).toBe(1500)
  })

  it('a Memosprite Skill deals (11% + 0.1% per Vibe) of the tally as True DMG to the enemy with the highest HP and clears half', () => {
    const t = setup(1, { enemies: 2, cycles: 3 })
    toFever(t, 1)
    const id = songbirdsId('robin')
    const [first, second] = t.battle.enemies.ids as [string, string]
    // Single hits go to the middle (second) enemy, so the first has the most HP left.
    expect(t.battle.enemyHp(first).current).toBeGreaterThan(t.battle.enemyHp(second).current)
    let tallyAtStart = -1
    let vibesAtStart = 0
    let tallyAtEnd = -1
    const skill: number[] = []
    t.battle.timeline.bus.on('turnStart', (turn) => {
      if (turn.unit !== id || tallyAtStart >= 0) return
      tallyAtStart = t.q('e1_tally') as number
      vibesAtStart = t.q('vibes') as number
    })
    t.battle.timeline.bus.on('damageDealt', (d) => {
      if (d.ability === 'MEMO_SKILL' && skill.length < 2) skill.push(d.damage)
    })
    t.battle.timeline.bus.on('turnEnd', (turn) => {
      if (turn.unit === id && tallyAtEnd < 0) tallyAtEnd = t.q('e1_tally') as number
    })
    t.dealt.length = 0
    t.battle.run()
    const trues = t.dealt.filter((d) => d.kind === 'TRUE')
    expect(trues.length).toBeGreaterThan(0)
    const skillTotal = skill.reduce((a, b) => a + b, 0)
    // Two enemies x 1.5 x 2,000.
    expect(skillTotal).toBeCloseTo(6000, 9)
    expect(trues[0]).toMatchObject({ attacker: 'robin', enemy: first, ability: 'E1_TRUE_DMG', scaling: 0, chance: 1 })
    expect(trues[0]!.damage).toBeCloseTo((0.11 + 0.001 * vibesAtStart) * (tallyAtStart + skillTotal), 6)
    // Half cleared; the True DMG itself is not added to the tally.
    expect(tallyAtEnd).toBeCloseTo((tallyAtStart + skillTotal) / 2, 6)
  })

  it('without E1 there is no True DMG', () => {
    const t = setup(0, { cycles: 3 })
    toFever(t)
    t.battle.run()
    expect(t.dealt.filter((d) => d.kind === 'TRUE')).toEqual([])
  })

  it('the tally is lost when the Songbirds disappear', () => {
    const t = setup(1)
    toFever(t, 1)
    expect(t.q('e1_tally')).toBeGreaterThan(0)
    t.battle.removeMemosprite(songbirdsId('robin'))
    expect(t.q('e1_tally')).toBe(0)
  })
})

describe('Shields and Improvised Blues', () => {
  it("a Shield an ally provides gives 1 Vibe, sharing the 'first in a turn' count with its healing", () => {
    const t = setup()
    t.battle.party.setShield('hi', 'k', 100, 'lo')
    expect(t.q('vibes')).toBe(1)
    t.battle.party.heal('robin', 5, 'lo')
    expect(t.q('vibes')).toBe(1)
    t.battle.party.setShield('lo', 'k2', 100, 'hi')
    expect(t.q('vibes')).toBe(2)
  })

  it('a Shield with no provider counts as the shielded unit providing it; one that is not raised again gives nothing', () => {
    const t = setup()
    t.battle.party.setShield('lo', 'k', 100)
    expect(t.q('vibes')).toBe(1)
    t.battle.party.setShield('hi', 'k', 100, 'hi')
    t.battle.party.setShield('hi', 'k', 50, 'hi')
    expect(t.q('vibes')).toBe(2)
  })

  it('healing or a Shield she or the Songbirds receive from a teammate sets Groove to 12; her own do not', () => {
    const t = setup()
    expect(t.q('groove')).toBe(0)
    t.battle.party.setShield('robin', 'self', 100, 'robin')
    expect(t.q('groove')).toBe(0)
    t.battle.party.heal('robin', 5, 'lo')
    expect(t.q('groove')).toBeGreaterThan(0)
    const t2 = setup()
    use(t2.battle, 'robin', 'skill')
    t2.battle.party.setShield(songbirdsId('robin'), 'k', 50, 'hi')
    expect(t2.q('groove')).toBeGreaterThan(0)
  })

  it('the first Vibes gain in a turn spends one Groove for a fixed 3 energy; later gains in that turn do not', () => {
    const t = setup()
    const tl = t.battle.timeline
    const energy = () => t.battle.party.get('robin').energy
    tl.step(() => {
      // The heal gives her Groove (12), and its own Vibe is the turn's first gain: 11 left, 3 energy.
      t.battle.party.heal('robin', 5, 'lo')
      expect(t.q('groove')).toBe(11)
      expect(energy()).toBe(3)
      use(t.battle, 'hi', 'basic')
      expect(t.q('groove')).toBe(11)
      expect(energy()).toBe(3)
    })
    tl.step(() => {
      use(t.battle, 'hi', 'basic')
      expect(t.q('groove')).toBe(10)
      expect(energy()).toBe(6)
    })
  })

  it('the Groove energy is fixed: her Energy Regeneration Rate does not scale it', () => {
    const t = setup()
    t.battle.party.setStats('robin', { energyRegen: 0.5 })
    t.battle.timeline.step(() => {
      t.battle.party.heal('robin', 5, 'lo')
      expect(t.battle.party.get('robin').energy).toBe(3)
    })
  })

  it('with no Groove the first gain of a turn gives no energy, and still counts as that turn first', () => {
    const t = setup()
    t.battle.timeline.step(() => {
      use(t.battle, 'hi', 'basic')
      t.battle.party.heal('robin', 5, 'lo')
      // Groove arrived after this turn's first gain: nothing is spent until the next turn.
      expect(t.q('groove')).toBe(12)
      expect(t.battle.party.get('robin').energy).toBe(0)
    })
  })
})
