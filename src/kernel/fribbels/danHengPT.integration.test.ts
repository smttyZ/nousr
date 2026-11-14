import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { Battle } from '../../battle/battle'
import type { BattleSetup, MemberSetup } from '../../battle/battle'
import type { EngineEvents } from '../../engine'
import { loadEnemyProfile } from '../../enemy/profile'
import { TextureOfMemories } from '../../equipment/textureOfMemories'
import { DanHengPT, danHengPTScalings, TOUGHNESS_FOLLOW_UP } from '../../kits/danHengPT'
import { JingYuan } from '../../kits/jingYuan'
import type { Rule } from '../../scenario/types'
import type { DamageRequest, ExtraHit, InjectedBuff, KernelBuild } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Dan Heng • Permansor Terrae through the real kernel. What these pin, per hit (K11):
 * - His Basic ATK, Ultimate and the Souldragon's Follow-Up are Fribbels' own hits for the same state, at several
 *   eidolons and enemy counts, with the multiples the kit text gives (and E6's Vulnerability, which Fribbels leaves out
 *   of his own hits, injected as the text says).
 * - What a teammate is told about him: the Bondmate gets Fribbels' buffs with live values (his ATK, E1's RES PEN, E6),
 *   and everyone else gets none of the Bondmate's.
 * - The Bondmate's Additional DMG (K23): each instance the kit deals equals Fribbels' price of an extra Additional hit of that
 *   multiple in the Bondmate's own request (his ATK, crits, element and the buffs the kit tells the kernel about).
 */

const dhptBuild: KernelBuild = {
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.InertSalsotto,
  body: Stats.ATK_P,
  feet: Stats.SPD,
  planarSphere: Stats.Physical_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.ATK]: 5, [Stats.SPD]: 10, [Stats.CR]: 5, [Stats.CD]: 5 },
}
const jyBuild: KernelBuild = {
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.InertSalsotto,
  body: Stats.CD,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const profile = loadEnemyProfile('generic-moc')
const TEXTURE = '24002'
const TODAY = '21034'

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

const dhpt = (eidolon: number): MemberSetup => ({
  key: 'dhpt',
  kit: DanHengPT,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: '1414', lightConeId: TEXTURE, eidolon, superimposition: 5 }, build: dhptBuild },
  equipment: { lightCone: TextureOfMemories, sets: [] },
})
const jy = (key: string): MemberSetup => ({
  key,
  kit: JingYuan,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: '1204', lightConeId: TODAY, eidolon: 0, superimposition: 4 }, build: jyBuild },
})

function setup(eidolon: number, options: { enemies?: number, policy?: Rule[], cycles?: number } = {}) {
  const members = [dhpt(eidolon), jy('jy'), jy('jy2')]
  const setupOptions: BattleSetup = {
    members,
    policy: options.policy ?? members.map((m) => ({ unit: m.key, use: 'basic' as const, when: [] })),
    profile,
    enemyCount: options.enemies ?? 1,
    weaknesses: 'all',
    cycles: options.cycles ?? 3,
    start: { energy: 0, skillPoints: 5, techniques: false },
    kernel,
  }
  const battle = new Battle(setupOptions)
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  return { battle, members, dealt, act: battle.member('dhpt').instance.actions }
}

/** The request the runner sends for `attacker` against one enemy, when the enemy is not broken. */
function requestFor(
  members: MemberSetup[],
  attacker: string,
  options: {
    characterConditionals?: Record<string, number | boolean>
    lightConeConditionals?: Record<string, number | boolean>
    teammateConditionals?: Record<string, Record<string, number | boolean>>
    injectedBuffs?: InjectedBuff[]
    extraHits?: ExtraHit[]
    enemies?: number
  } = {},
): DamageRequest {
  const me = members.find((m) => m.key === attacker)!
  return {
    attacker: {
      ...me.kernel.unit,
      ...(options.characterConditionals && { characterConditionals: options.characterConditionals }),
      ...(options.lightConeConditionals && { lightConeConditionals: options.lightConeConditionals }),
    },
    teammates: members
      .filter((m) => m.key !== attacker)
      .map((m) => ({ ...m.kernel.unit, ...(options.teammateConditionals?.[m.key] && { characterConditionals: options.teammateConditionals[m.key] }) })),
    build: me.kernel.build,
    ...(options.injectedBuffs && { injectedBuffs: options.injectedBuffs }),
    ...(options.extraHits && { extraHits: options.extraHits }),
    enemy: { count: options.enemies ?? 1, level: profile.level, maxToughness: profile.toughness, resistance: profile.res, elementalWeak: true, weaknessBroken: false },
  }
}

const sum = (dealt: EngineEvents['damageDealt'][], ability: string, attacker?: string) =>
  dealt.filter((d) => d.ability === ability && (attacker === undefined || d.attacker === attacker)).reduce((total, d) => total + d.damage, 0)

const E6_VULN = (target: 'self' | 'team'): InjectedBuff => ({ stat: 'VULNERABILITY', value: 0.2, target, label: 'Dan Heng PT E6' })

describe('his own hits, priced as Fribbels prices them', () => {
  it('Basic ATK and Ultimate equal the kernel number for the same state, at E0, E3, E5 and E6, on 1, 3 and 5 enemies', () => {
    for (const eidolon of [0, 3, 5, 6]) {
      for (const enemies of [1, 3, 5]) {
        const { battle, members, dealt, act } = setup(eidolon, { enemies })
        const s = danHengPTScalings(eidolon)
        // Before any Skill: no Bondmate, no E6 Vulnerability, no Shield on him.
        act.basic!.use()
        const plain = kernel.actionDamage(requestFor(members, 'dhpt', { lightConeConditionals: { activeShieldDmgDecrease: false }, enemies }))
        expect(sum(dealt, 'BASIC'), `basic E${eidolon} x${enemies}`).toBeCloseTo(plain.damage.BASIC!, 6)
        expect(plain.hits.BASIC![0]!.scaling).toBeCloseTo(s.basic, 12)

        act.skill!.use('jy')
        battle.party.setEnergy('dhpt', 135)
        act.ultimate!.use()
        // After the Skill: a Bondmate is on the field, so from E6 his own hits carry the +20% Vulnerability (injected).
        const withBondmate = kernel.actionDamage(
          requestFor(members, 'dhpt', {
            lightConeConditionals: { activeShieldDmgDecrease: true },
            ...(eidolon >= 6 && { injectedBuffs: [E6_VULN('self')] }),
            enemies,
          }),
        )
        expect(sum(dealt, 'ULT'), `ult E${eidolon} x${enemies}`).toBeCloseTo(withBondmate.damage.ULT! * enemies, 6)
        expect(withBondmate.hits.ULT![0]!.scaling).toBeCloseTo(s.ult, 12)
      }
    }
  })

  it('Fribbels leaves the E6 Vulnerability out of his own hits: E6 and E5 price the same without the injection', () => {
    const e5 = setup(5)
    const e6 = setup(6)
    const price = (s: ReturnType<typeof setup>) => kernel.actionDamage(requestFor(s.members, 'dhpt', { lightConeConditionals: { activeShieldDmgDecrease: true } })).damage
    expect(price(e6).BASIC).toBeCloseTo(price(e5).BASIC!, 6)
    expect(price(e6).ULT).toBeCloseTo(price(e5).ULT!, 6)
    // ... and the kit adds it once a Bondmate is on the field.
    e6.act.skill!.use('jy')
    e6.act.basic!.use()
    const priced = e6.dealt.filter((d) => d.ability === 'BASIC')[0]!.damage
    expect(priced).toBeGreaterThan(price(e6).BASIC! * 1.1)
  })

  it("the Souldragon's Follow-Up is Fribbels' FUA hit 0 (80% ATK, 88% at E3) on every enemy, once per enhanced action", () => {
    for (const [eidolon, enemies] of [[0, 1], [3, 3], [6, 5]] as const) {
      const { battle, members, dealt, act } = setup(eidolon, { enemies, cycles: 2 })
      act.skill!.use('jy')
      battle.party.setEnergy('dhpt', 135)
      act.ultimate!.use()
      battle.run()
      const fua = dealt.filter((d) => d.ability === 'FUA' && d.attacker === 'dhpt')
      const actions = new Set(fua.map((d) => d.at))
      expect(actions.size, `E${eidolon}`).toBe(eidolon >= 2 ? 4 : 2)
      // Shield (and Sublimity) never reach the kernel; the damage hit is hit 0 of the kernel's FUA.
      const expected = kernel.actionDamage(
        requestFor(members, 'dhpt', {
          lightConeConditionals: { activeShieldDmgDecrease: true },
          ...(eidolon >= 6 && { injectedBuffs: [E6_VULN('self')] }),
          enemies,
        }),
      )
      expect(expected.hits.FUA![0]!.scaling).toBeCloseTo(danHengPTScalings(eidolon).followUp, 12)
      const [first] = [...actions]
      const firstAction = fua.filter((d) => d.at === first)
      expect(firstAction.reduce((t, d) => t + d.damage, 0), `E${eidolon} x${enemies}`).toBeCloseTo(expected.hits.FUA![0]!.damage * enemies, 6)
    }
  })

  it('hits of the kernel that have no ATK multiple (the shields) are never priced', () => {
    const { members } = setup(0)
    const result = kernel.actionDamage(requestFor(members, 'dhpt'))
    expect(result.hits.ULT).toHaveLength(2)
    expect(result.hits.FUA).toHaveLength(2)
    expect(result.hits.ULT![1]!.scaling).toBeUndefined()
    expect(result.hits.FUA![1]!.scaling).toBeUndefined()
  })
})

describe('what the Bondmate and the others are told', () => {
  const bondmateConditionals = (atk: number, over: Record<string, number | boolean> = {}) => ({
    bondmate: true,
    sourceAtk: atk,
    cyreneSpecialEffect: false,
    e1ResPen: false,
    e4DmgReduction: true,
    e6Buffs: false,
    ...over,
  })
  const offConditionals = { bondmate: false, sourceAtk: 0, cyreneSpecialEffect: false, e1ResPen: false, e4DmgReduction: false, e6Buffs: false }

  it("the Bondmate's price carries his ATK at the Skill, and is higher than without; the other ally's is unchanged", () => {
    const { battle, members, dealt, act } = setup(0)
    const atk = kernel.actionDamage(requestFor(members, 'dhpt', { lightConeConditionals: { activeShieldDmgDecrease: false } })).stats.ATK
    act.skill!.use('jy')
    battle.member('jy').instance.actions.basic!.use()
    battle.member('jy2').instance.actions.basic!.use()
    const jyState = battle.member('jy').instance.attackerState('enemy1').characterConditionals
    const jy2State = battle.member('jy2').instance.attackerState('enemy1').characterConditionals
    const bonded = kernel.actionDamage(requestFor(members, 'jy', { characterConditionals: jyState, teammateConditionals: { dhpt: bondmateConditionals(atk) } }))
    const bondedOff = kernel.actionDamage(requestFor(members, 'jy', { characterConditionals: jyState, teammateConditionals: { dhpt: offConditionals } }))
    expect(sum(dealt, 'BASIC', 'jy')).toBeCloseTo(bonded.damage.BASIC!, 6)
    expect(bonded.damage.BASIC!).toBeGreaterThan(bondedOff.damage.BASIC! * 1.05)
    const other = kernel.actionDamage(requestFor(members, 'jy2', { characterConditionals: jy2State, teammateConditionals: { dhpt: offConditionals } }))
    expect(sum(dealt, 'BASIC', 'jy2')).toBeCloseTo(other.damage.BASIC!, 6)
    // Fribbels' own default for the teammate is the Bondmate with 3000 ATK: not what the kit passes.
    const fribbelsDefault = kernel.actionDamage(requestFor(members, 'jy2', { characterConditionals: jy2State }))
    expect(fribbelsDefault.damage.BASIC!).toBeGreaterThan(other.damage.BASIC!)
  })

  it("E1: after his Ultimate the Bondmate's RES PEN switch is on, and only the Bondmate's", () => {
    const { battle, members, dealt, act } = setup(1)
    const atk = kernel.actionDamage(requestFor(members, 'dhpt', { lightConeConditionals: { activeShieldDmgDecrease: false } })).stats.ATK
    act.skill!.use('jy')
    battle.party.setEnergy('dhpt', 135)
    act.ultimate!.use()
    battle.member('jy').instance.actions.basic!.use()
    const jyState = battle.member('jy').instance.attackerState('enemy1').characterConditionals
    const withE1 = kernel.actionDamage(requestFor(members, 'jy', { characterConditionals: jyState, teammateConditionals: { dhpt: bondmateConditionals(atk, { e1ResPen: true }) } }))
    const withoutE1 = kernel.actionDamage(requestFor(members, 'jy', { characterConditionals: jyState, teammateConditionals: { dhpt: bondmateConditionals(atk) } }))
    expect(sum(dealt, 'BASIC', 'jy')).toBeCloseTo(withE1.damage.BASIC!, 6)
    expect(withE1.damage.BASIC!).toBeGreaterThan(withoutE1.damage.BASIC!)
  })

  it("E6: the Bondmate gets all of Fribbels' E6; others get the Vulnerability injected, equal to Fribbels' own switch minus its DEF ignore", () => {
    const { battle, members, dealt, act } = setup(6)
    const atk = kernel.actionDamage(requestFor(members, 'dhpt', { lightConeConditionals: { activeShieldDmgDecrease: false } })).stats.ATK
    act.skill!.use('jy')
    battle.member('jy').instance.actions.basic!.use()
    battle.member('jy2').instance.actions.basic!.use()
    const jyState = battle.member('jy').instance.attackerState('enemy1').characterConditionals
    const jy2State = battle.member('jy2').instance.attackerState('enemy1').characterConditionals
    const bonded = kernel.actionDamage(requestFor(members, 'jy', { characterConditionals: jyState, teammateConditionals: { dhpt: bondmateConditionals(atk, { e6Buffs: true }) } }))
    expect(sum(dealt, 'BASIC', 'jy')).toBeCloseTo(bonded.damage.BASIC!, 6)

    const injected = kernel.actionDamage(
      requestFor(members, 'jy2', { characterConditionals: jy2State, teammateConditionals: { dhpt: offConditionals }, injectedBuffs: [E6_VULN('team')] }),
    )
    expect(sum(dealt, 'BASIC', 'jy2')).toBeCloseTo(injected.damage.BASIC!, 6)

    // Fribbels' own switch on a non-Bondmate also gives a 12% DEF ignore. Injecting both reproduces it exactly, which shows
    // the injected Vulnerability is the same effect as Fribbels' own.
    const fribbelsOwn = kernel.actionDamage(requestFor(members, 'jy2', { characterConditionals: jy2State, teammateConditionals: { dhpt: { ...offConditionals, e6Buffs: true } } }))
    const bothInjected = kernel.actionDamage(
      requestFor(members, 'jy2', {
        characterConditionals: jy2State,
        teammateConditionals: { dhpt: offConditionals },
        injectedBuffs: [E6_VULN('team'), { stat: 'DEF_PEN', value: 0.12, target: 'self', label: 'check' }],
      }),
    )
    expect(bothInjected.damage.BASIC!).toBeCloseTo(fribbelsOwn.damage.BASIC!, 6)
    expect(fribbelsOwn.damage.BASIC!).toBeGreaterThan(injected.damage.BASIC!)
  })
})

describe('the Bondmate\'s Additional DMG is priced as an extra hit in the Bondmate\'s own request (K23)', () => {
  const extra = (multiple: number): ExtraHit => ({ id: 'check', damageType: 'ADDITIONAL', scalingStat: 'ATK', multiple })
  const bondmateConditionals = (atk: number, over: Record<string, number | boolean> = {}) => ({
    bondmate: true,
    sourceAtk: atk,
    cyreneSpecialEffect: false,
    e1ResPen: false,
    e4DmgReduction: true,
    e6Buffs: false,
    ...over,
  })
  /** Fribbels' price of an extra Additional hit of `multiple` x ATK in Jing Yuan's request, with him as the Bondmate. */
  const priced = (s: ReturnType<typeof setup>, multiple: number, over: Record<string, number | boolean> = {}, enemies = 1) => {
    const atk = kernel.actionDamage(requestFor(s.members, 'dhpt', { lightConeConditionals: { activeShieldDmgDecrease: false }, enemies })).stats.ATK
    const jyState = s.battle.member('jy').instance.attackerState('enemy1').characterConditionals
    return kernel.actionDamage(
      requestFor(s.members, 'jy', {
        characterConditionals: jyState,
        teammateConditionals: { dhpt: bondmateConditionals(atk, over) },
        extraHits: [extra(multiple)],
        enemies,
      }),
    ).hits.EXTRA![0]!.damage
  }
  const extras = (s: ReturnType<typeof setup>) => s.dealt.filter((d) => d.ability === 'EXTRA')

  it('the enhanced Souldragon (E0: 80% of the Bondmate\'s ATK) on every enemy, and Sublimity (40%) on the highest-HP one, credited to him', () => {
    for (const enemies of [1, 3]) {
      const s = setup(0, { enemies, cycles: 2 })
      s.act.skill!.use('jy')
      s.battle.party.setEnergy('dhpt', 135)
      s.act.ultimate!.use()
      s.battle.run()
      const first = extras(s)[0]!.at
      const action = extras(s).filter((d) => d.at === first)
      expect(action.every((d) => d.attacker === 'jy')).toBe(true)
      const fullPart = action.filter((d) => d.scaling === 0.8)
      const sublimity = action.filter((d) => d.scaling === 0.4)
      expect(fullPart).toHaveLength(enemies)
      expect(sublimity).toHaveLength(1)
      const eighty = priced(s, 0.8, {}, enemies)
      const forty = priced(s, 0.4, {}, enemies)
      console.log(`E0 x${enemies}: Souldragon 80% ${fullPart[0]!.damage} vs Fribbels extra hit ${eighty}; Sublimity 40% ${sublimity[0]!.damage} vs ${forty}`)
      for (const d of fullPart) expect(d.damage).toBeCloseTo(eighty, 6)
      expect(sublimity[0]!.damage).toBeCloseTo(forty, 6)
      // Per 100% it is one number: the 40% is exactly half the 80%.
      expect(sublimity[0]!.damage * 2).toBeCloseTo(fullPart[0]!.damage, 6)
    }
  })

  it('E3 (88%, doubled by E2: 176%) and E6 (330% to all enemies with his Ultimate, with the E6 buffs on the Bondmate)', () => {
    const e3 = setup(3, { enemies: 3, cycles: 2 })
    e3.act.skill!.use('jy')
    e3.battle.party.setEnergy('dhpt', 135)
    e3.act.ultimate!.use()
    e3.battle.run()
    const hits = extras(e3).filter((d) => d.at === extras(e3)[0]!.at && d.scaling === 1.76)
    expect(hits).toHaveLength(3)
    // E3 has E1 too: after his Ultimate the Bondmate holds the +18% RES PEN, which the Souldragon's later actions get.
    const e3Price = priced(e3, 1.76, { e1ResPen: true }, 3)
    for (const d of hits) expect(d.damage).toBeCloseTo(e3Price, 6)

    const e6 = setup(6, { enemies: 3 })
    e6.act.skill!.use('jy')
    e6.battle.party.setEnergy('dhpt', 135)
    e6.act.ultimate!.use()
    const ult = extras(e6)
    expect(ult).toHaveLength(3)
    // The E6 Additional DMG is dealt inside the Ultimate, before E1's RES PEN is applied (IN-GAME CHECK in the kit).
    const e6Price = priced(e6, 3.3, { e6Buffs: true }, 3)
    console.log(`E6 330% on 3 enemies: ${ult[0]!.damage} vs Fribbels extra hit ${e6Price}`)
    for (const d of ult) {
      expect(d.scaling).toBe(3.3)
      expect(d.damage).toBeCloseTo(e6Price, 6)
    }
    // The E6 buffs (12% DEF ignore, +20% Vulnerability) are in the Bondmate's price: without them it is lower.
    expect(priced(e6, 3.3, { e6Buffs: false }, 3)).toBeLessThan(e6Price)
  })

  it('one Bondmate hit at E0 against 1 enemy, with the numbers', () => {
    const s = setup(0, { cycles: 2 })
    s.act.skill!.use('jy')
    s.battle.party.setEnergy('dhpt', 135)
    s.act.ultimate!.use()
    s.battle.run()
    const hit = extras(s).find((d) => d.scaling === 0.8)!
    const atk = kernel.actionDamage(requestFor(s.members, 'jy', { characterConditionals: s.battle.member('jy').instance.attackerState('enemy1').characterConditionals })).stats.ATK
    console.log(`Bondmate hit: Jing Yuan ATK as the attacker ${atk} (his own, without Empyreanity); 80% extra hit damage ${hit.damage}; per 100% ${hit.damage / 0.8}`)
    expect(hit.damage).toBeCloseTo(priced(s, 0.8), 6)
    expect(hit.attacker).toBe('jy')
  })
})

describe('the Souldragon\'s Follow-Up toughness: the kit follows the text, Fribbels differs', () => {
  // IN-GAME CHECK (src/kits/danHengPT.ts): the text puts 60 on the Talent's line; Fribbels has toughnessDmg(10), 30 here.
  it('pins Fribbels\' number (10, which is 30 internal) so a change on either side shows up', () => {
    const source = readFileSync('vendor/hsr-optimizer/src/lib/conditionals/character/1400/PermansorTerrae.ts', 'utf8')
    const fua = /\[AbilityKind\.FUA\]: \{[\s\S]*?\.toughnessDmg\((\d+)\)/.exec(source)
    expect(fua, 'the Follow-Up hit in Fribbels\' source').not.toBeNull()
    expect(Number(fua![1])).toBe(10)
    expect(Number(fua![1]) * 3).toBe(30)
    // The kit's number is the text's, and differs on purpose.
    expect(TOUGHNESS_FOLLOW_UP).toBe(60)
    expect(TOUGHNESS_FOLLOW_UP).not.toBe(Number(fua![1]) * 3)
  })
})
