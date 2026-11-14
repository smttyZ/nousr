import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { Battle } from '../../battle/battle'
import type { MemberSetup } from '../../battle/battle'
import type { EngineEvents } from '../../engine'
import { loadEnemyProfile } from '../../enemy/profile'
import { MemorysCurtainNeverFalls } from '../../equipment/memorysCurtainNeverFalls'
import type { Kit } from '../../kits/kit'
import { CHORD_BRANCH_ATK, CHORD_BRANCH_CD, countdownId, RobinSummeretto, robinSummerettoScalings, songbirdsId } from '../../kits/robinSummeretto'
import type { ConditionalValues, DamageRequest, KernelBuild, KernelTeammate } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Robin Summeretto through the real kernel. What these pin:
 * - Her Basic ATK is Fribbels' BASIC hit 0 and the Songbirds' Memosprite Skill its MEMO_SKILL hit 0 (priced per hit, on the
 *   Songbirds' Max HP as Fribbels does: memosprite HP 70% of hers), for the same live state, at E0, E2, E4, E5 and E6.
 *   The multiples the kit asks for are the kernel's own.
 * - Every buff she gives a teammate reaches that teammate's price with its live value: the request the battle really sends is
 *   compared with an explicit request written from the text's numbers (no Songbirds, Fever, a higher-ATK and a lower-ATK
 *   holder of Deviated Chords, the Technique, and her light cone's buff).
 */

const robinBuild: KernelBuild = {
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.InertSalsotto,
  body: Stats.CD,
  feet: Stats.SPD,
  planarSphere: Stats.Wind_DMG,
  linkRope: Stats.HP_P,
  substatRolls: { [Stats.HP_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const acheronBuild: KernelBuild = {
  relicSet1: Sets.PioneerDiverOfDeadWaters,
  relicSet2: Sets.PioneerDiverOfDeadWaters,
  ornamentSet: Sets.IzumoGenseiAndTakamaDivineRealm,
  body: Stats.CR,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 12, [Stats.CD]: 8 },
}
const fuXuanBuild: KernelBuild = {
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.InertSalsotto,
  body: Stats.HP_P,
  feet: Stats.SPD,
  planarSphere: Stats.HP_P,
  linkRope: Stats.HP_P,
  substatRolls: { [Stats.HP_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const profile = loadEnemyProfile('generic-moc')
const ENEMY = { count: 1, level: profile.level, maxToughness: profile.toughness, resistance: profile.res, elementalWeak: true, weaknessBroken: false }
const CURTAIN = '24005'

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

/** A teammate whose Basic ATK is the kernel's BASIC hit 0, as the battle's attack would price it. */
const basicKit = (characterId: string, path: 'Hunt' | 'Abundance', scaling = 1): Kit => ({
  characterId,
  path,
  element: 'Lightning',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'basic', 'basic', () =>
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling, hit: 0 }] }),
          ),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
})

const robin = (eidolon: number): MemberSetup => ({
  key: 'robin',
  kit: RobinSummeretto,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: 1e6, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: '1512', lightConeId: CURTAIN, eidolon, superimposition: 1 }, build: robinBuild },
  equipment: { lightCone: MemorysCurtainNeverFalls, sets: [] },
})
const acheronUnit = { characterId: '1308', lightConeId: '23024', eidolon: 0, superimposition: 1 }
const acheron = (): MemberSetup => ({
  key: 'acheron',
  kit: basicKit('1308', 'Abundance'),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1e6, def: 1000, baseSpd: 90 },
  kernel: { unit: acheronUnit, build: acheronBuild },
})
const fuXuanUnit = { characterId: '1208', lightConeId: '23024', eidolon: 0, superimposition: 1 }
const fuXuan = (): MemberSetup => ({
  key: 'fu',
  kit: basicKit('1208', 'Abundance', 0.5),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1e6, def: 1000, baseSpd: 80 },
  kernel: { unit: fuXuanUnit, build: fuXuanBuild },
})

function setup(eidolon: number, extra: MemberSetup[], options: { techniques?: boolean, enemies?: number } = {}) {
  const members = [robin(eidolon), ...extra]
  const battle = new Battle({
    members,
    policy: members.map((m) => ({ unit: m.key, use: 'basic', when: [] })),
    profile,
    enemyCount: options.enemies ?? 1,
    weaknesses: 'all',
    cycles: 3,
    start: { energy: 0, skillPoints: 5, techniques: options.techniques ?? false },
    kernel,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (d) => dealt.push(d))
  battle.member('robin').instance.onBattleStart!({ techniques: options.techniques ?? false })
  const q = (name: string) => battle.member('robin').instance.quantities![name]!()
  return { battle, dealt, q }
}
const use = (battle: Battle, who: string, action: string) => battle.member(who).instance.actions[action]!.use()
const sum = (dealt: EngineEvents['damageDealt'][], ability: string, attacker: string) =>
  dealt.filter((d) => d.ability === ability && d.attacker === attacker).reduce((total, d) => total + d.damage, 0)

/** Robin's own request, written from the text and Fribbels' switches. */
function robinRequest(eidolon: number, c: ConditionalValues, lcBoost: boolean, teammates: KernelTeammate[]): DamageRequest {
  return {
    attacker: {
      characterId: '1512',
      lightConeId: CURTAIN,
      eidolon,
      superimposition: 1,
      characterConditionals: c,
      lightConeConditionals: { teamDmgBoost: lcBoost },
    },
    teammates,
    build: robinBuild,
    enemy: ENEMY,
  }
}

/** Robin as another attacker's teammate, with the buffs the text gives that attacker. */
const robinAsMate = (eidolon: number, c: ConditionalValues, lcBoost: boolean): KernelTeammate => ({
  characterId: '1512',
  lightConeId: CURTAIN,
  eidolon,
  superimposition: 1,
  characterConditionals: c,
  lightConeConditionals: { teamDmgBoost: lcBoost },
})

const acheronAsMate: KernelTeammate = { ...acheronUnit }

/** An ally's request with Robin as a teammate. */
const allyRequest = (unit: typeof acheronUnit, build: KernelBuild, mates: KernelTeammate[]): DamageRequest => ({
  attacker: { ...unit },
  teammates: mates,
  build,
  enemy: ENEMY,
})

describe('Robin per action, priced as Fribbels prices it (one enemy)', () => {
  it('Basic ATK equals the kernel number for the same state, at E0 and E5, with the kernel\'s own multiple', () => {
    for (const eidolon of [0, 5]) {
      const t = setup(eidolon, [acheron()])
      use(t.battle, 'robin', 'basic')
      const direct = kernel.actionDamage(
        robinRequest(
          eidolon,
          { feverState: false, vibes: 0, songbirdCount: 0, deviatedChordCdBuff: true, e2ResPen: eidolon >= 2, e4MemoSpdBuff: false, e6MemoSkillBuff: eidolon >= 6, techniqueDmgBuff: false },
          false,
          [acheronAsMate],
        ),
      )
      expect(sum(t.dealt, 'BASIC', 'robin'), `E${eidolon}`).toBeCloseTo(direct.damage.BASIC!, 6)
      expect(direct.hits.BASIC![0]!.scaling).toBeCloseTo(robinSummerettoScalings(eidolon).basic, 12)
    }
  })

  it("the Songbirds' Memosprite Skill equals the kernel's MEMO_SKILL hit in Fever, with its own multiple, at E0, E2, E4, E5 and E6", () => {
    for (const eidolon of [0, 2, 4, 5, 6]) {
      const t = setup(eidolon, [acheron()])
      use(t.battle, 'robin', 'skill')
      for (let i = 0; i < 14 && !t.q('fever'); i++) use(t.battle, 'acheron', 'basic')
      expect(t.q('fever'), `E${eidolon} fever`).toBe(true)
      let vibes = 0
      t.battle.timeline.bus.on('turnStart', (turn) => {
        if (turn.unit === songbirdsId('robin') && vibes === 0) vibes = t.q('vibes') as number
      })
      t.dealt.length = 0
      t.battle.run()
      const first = t.dealt.find((d) => d.ability === 'MEMO_SKILL')!
      expect(first, `E${eidolon} a Songbirds action`).toBeDefined()
      const direct = kernel.actionDamage(
        robinRequest(
          eidolon,
          {
            feverState: true,
            vibes,
            songbirdCount: 3,
            deviatedChordCdBuff: true,
            e2ResPen: eidolon >= 2,
            e4MemoSpdBuff: eidolon >= 4,
            e6MemoSkillBuff: eidolon >= 6,
            techniqueDmgBuff: false,
          },
          // The Skill gave the buff to the Songbirds, which are still on their 3 turns at their first action.
          true,
          [acheronAsMate],
        ),
      )
      expect(first.damage, `E${eidolon}`).toBeCloseTo(direct.damage.MEMO_SKILL!, 6)
      expect(direct.hits.MEMO_SKILL![0]!.scaling).toBeCloseTo(robinSummerettoScalings(eidolon).memoSkill, 12)
      expect(direct.hits.MEMO_SKILL).toHaveLength(1)
    }
  })

  it('an attack on 3 enemies is the kernel number on each, summed (the Songbirds hit all)', () => {
    const t = setup(0, [acheron()], { enemies: 3 })
    use(t.battle, 'robin', 'skill')
    for (let i = 0; i < 14 && !t.q('fever'); i++) use(t.battle, 'acheron', 'basic')
    let vibes = -1
    t.battle.timeline.bus.on('turnStart', (turn) => {
      if (turn.unit === songbirdsId('robin') && vibes < 0) vibes = t.q('vibes') as number
    })
    t.dealt.length = 0
    t.battle.run()
    const at = t.dealt.find((d) => d.ability === 'MEMO_SKILL')!.at
    const hits = t.dealt.filter((d) => d.ability === 'MEMO_SKILL' && d.at === at)
    expect(hits).toHaveLength(3)
    const direct = kernel.actionDamage({
      ...robinRequest(0, { feverState: true, vibes, songbirdCount: 3, deviatedChordCdBuff: true }, true, [acheronAsMate]),
      enemy: { ...ENEMY, count: 3 },
    })
    for (const hit of hits) expect(hit.damage).toBeCloseTo(direct.damage.MEMO_SKILL!, 6)
  })
})

describe('what she gives a teammate, priced with its live value', () => {
  const mateState = (eidolon: number, c: Partial<Record<string, number | boolean>>): ConditionalValues => ({
    feverState: false,
    vibes: 0,
    songbirdCount: 0,
    teammateHPValue: 0,
    deviatedChordBranch: CHORD_BRANCH_ATK,
    techniqueDmgBuff: false,
    e2ResPen: eidolon >= 2,
    ...c,
  })

  it('no Songbirds: only an ATK Chord of her Max HP (the ally\'s own action gives it) and the live Vibes; no Vulnerability, no DEF PEN', () => {
    const t = setup(0, [acheron()])
    const robinHp = kernel.actionDamage(robinRequest(0, {}, false, [acheronAsMate])).stats.HP
    use(t.battle, 'acheron', 'basic')
    const direct = kernel.actionDamage(
      allyRequest(acheronUnit, acheronBuild, [robinAsMate(0, mateState(0, { teammateHPValue: robinHp, deviatedChordBranch: CHORD_BRANCH_ATK }), false)]),
    )
    expect(sum(t.dealt, 'BASIC', 'acheron')).toBeCloseTo(direct.damage.BASIC!, 6)
    // The Chord's value is real: with 0 HP the same hit is lower.
    const none = kernel.actionDamage(allyRequest(acheronUnit, acheronBuild, [robinAsMate(0, mateState(0, {}), false)]))
    expect(none.damage.BASIC!).toBeLessThan(direct.damage.BASIC!)
  })

  it('after her Skill: her light cone\'s buff, the Vulnerability of one member, and the Chord with the live Vibes', () => {
    const t = setup(0, [acheron()])
    const robinHp = kernel.actionDamage(robinRequest(0, {}, false, [acheronAsMate])).stats.HP
    use(t.battle, 'robin', 'skill')
    use(t.battle, 'acheron', 'basic')
    t.dealt.length = 0
    const vibes = t.q('vibes') as number
    expect(vibes).toBe(1)
    use(t.battle, 'acheron', 'basic')
    const direct = kernel.actionDamage(
      allyRequest(acheronUnit, acheronBuild, [
        robinAsMate(0, mateState(0, { teammateHPValue: robinHp, vibes, songbirdCount: 1 }), true),
      ]),
    )
    expect(sum(t.dealt, 'BASIC', 'acheron')).toBeCloseTo(direct.damage.BASIC!, 6)
    const noMember = kernel.actionDamage(
      allyRequest(acheronUnit, acheronBuild, [robinAsMate(0, mateState(0, { teammateHPValue: robinHp, vibes, songbirdCount: 0 }), true)]),
    )
    expect(noMember.damage.BASIC!).toBeLessThan(direct.damage.BASIC!)
  })

  it('in Fever: the Zone DEF PEN (15% + 0.5% per Vibe), 16% Vulnerability for 3 members, E2 RES PEN, with the live Vibes', () => {
    for (const eidolon of [0, 2, 3]) {
      const t = setup(eidolon, [acheron()])
      const robinHp = kernel.actionDamage(robinRequest(eidolon, {}, false, [acheronAsMate])).stats.HP
      use(t.battle, 'robin', 'skill')
      for (let i = 0; i < 14 && !t.q('fever'); i++) use(t.battle, 'acheron', 'basic')
      expect(t.q('fever')).toBe(true)
      t.dealt.length = 0
      const vibes = t.q('vibes') as number
      use(t.battle, 'acheron', 'basic')
      const direct = kernel.actionDamage(
        allyRequest(acheronUnit, acheronBuild, [
          robinAsMate(eidolon, mateState(eidolon, { feverState: true, vibes, songbirdCount: 3, teammateHPValue: robinHp }), true),
        ]),
      )
      expect(sum(t.dealt, 'BASIC', 'acheron'), `E${eidolon}`).toBeCloseTo(direct.damage.BASIC!, 6)
      const noFever = kernel.actionDamage(
        allyRequest(acheronUnit, acheronBuild, [
          robinAsMate(eidolon, mateState(eidolon, { feverState: false, vibes, songbirdCount: 3, teammateHPValue: robinHp }), true),
        ]),
      )
      expect(noFever.damage.BASIC!).toBeLessThan(direct.damage.BASIC!)
    }
  })

  it('a lower-ATK ally (Fu Xuan) holds the Chord as CRIT DMG, with the live Vibes, not as ATK', () => {
    const t = setup(0, [fuXuan()])
    use(t.battle, 'robin', 'skill')
    use(t.battle, 'fu', 'basic')
    t.dealt.length = 0
    const vibes = t.q('vibes') as number
    use(t.battle, 'fu', 'basic')
    const mate = (c: ConditionalValues) => [robinAsMate(0, c, true)]
    const cd = kernel.actionDamage(
      allyRequest(fuXuanUnit, fuXuanBuild, mate(mateState(0, { vibes, songbirdCount: 1, deviatedChordBranch: CHORD_BRANCH_CD }))),
    )
    const atk = kernel.actionDamage(
      allyRequest(fuXuanUnit, fuXuanBuild, mate(mateState(0, { vibes, songbirdCount: 1, teammateHPValue: 5000, deviatedChordBranch: CHORD_BRANCH_ATK }))),
    )
    expect(sum(t.dealt, 'BASIC', 'fu')).toBeCloseTo(cd.damage.BASIC!, 6)
    expect(Math.abs(cd.damage.BASIC! - atk.damage.BASIC!)).toBeGreaterThan(1)
  })

  it('the Technique\'s 30% reaches an ally\'s price while it holds it', () => {
    const t = setup(0, [acheron()], { techniques: true })
    const robinHp = kernel.actionDamage(robinRequest(0, {}, false, [acheronAsMate])).stats.HP
    expect(t.q('vibes')).toBe(6)
    use(t.battle, 'acheron', 'basic')
    const direct = kernel.actionDamage(
      allyRequest(acheronUnit, acheronBuild, [
        robinAsMate(0, mateState(0, { vibes: 6, techniqueDmgBuff: true, teammateHPValue: robinHp }), false),
      ]),
    )
    expect(sum(t.dealt, 'BASIC', 'acheron')).toBeCloseTo(direct.damage.BASIC!, 6)
  })
})

describe('Fever on the timeline, with the real kernel', () => {
  it('Fever starts and ends in a whole battle, the countdown goes, and Robin acts again', () => {
    const t = setup(0, [acheron()])
    use(t.battle, 'robin', 'skill')
    for (let i = 0; i < 14 && !t.q('fever'); i++) use(t.battle, 'acheron', 'basic')
    expect(t.q('fever')).toBe(true)
    expect(t.battle.isSummon(countdownId('robin'))).toBe(true)
    t.battle.run()
    expect(t.q('fever')).toBe(false)
    expect(t.dealt.some((d) => d.ability === 'MEMO_SKILL')).toBe(true)
  })

})
