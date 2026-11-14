import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { BattleSetup, MemberSetup } from '../battle/battle'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Rule } from '../scenario/types'
import { DanHengPT, danHengPTScalings, shieldAmount, SOULDRAGON_SPD, TOUGHNESS_FOLLOW_UP } from './danHengPT'
import type { Kit } from './kit'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const DRAGON = 'dhpt.souldragon'
const ATK = 3000

/** A teammate with a Basic ATK of 100% and nothing else. */
const Ally: Kit = {
  characterId: 'ally',
  path: 'Hunt',
  element: 'Lightning',
  maxEnergy: 0,
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
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
}

/** The Bondmate's price per 100% of his ATK for an extra Additional hit: not the 1,000 of the ordinary hits, so the two cannot be mixed up. */
const EXTRA_PRICE = 500

/** 1,000 damage per 100%; his stats carry ATK 3000. The Souldragon's Follow-Up and the Ultimate each have a shield hit after the damage. */
function makeKernel(requests: DamageRequest[] = []): DamageKernel {
  return {
    actionDamage(request) {
      requests.push(request)
      if (request.attacker.characterId !== '1414') {
        return fakeResult({
          BASIC: [{ damage: 1000, scaling: 1 }],
          ...(request.extraHits && { EXTRA: request.extraHits.map((h) => ({ damage: EXTRA_PRICE * h.multiple, scaling: h.multiple })) }),
        })
      }
      const s = danHengPTScalings(request.attacker.eidolon)
      const hit = (scaling: number) => [{ damage: 1000 * scaling, scaling }, { damage: 0 }]
      return fakeResult(
        { BASIC: hit(s.basic).slice(0, 1), ULT: hit(s.ult), FUA: hit(s.followUp) },
        { ATK, DEF: 0, HP: 0, SPD: 0, CR: 0, CD: 0, EHR: 0, RES: 0, BE: 0, ERR: 0, OHB: 0 },
      )
    },
  }
}

const dhpt = (eidolon = 0, baseSpd = 100): MemberSetup => ({
  key: 'dhpt',
  kit: DanHengPT,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
  kernel: { unit: { characterId: '1414', lightConeId: '24002', eidolon, superimposition: 5 }, build: noBuild },
})

const ally = (key: string, baseSpd = 100): MemberSetup => ({
  key,
  kit: Ally,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
  kernel: { unit: { characterId: 'ally', lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
})

const basicPolicy: Rule[] = [
  { unit: 'dhpt', use: 'basic', when: [] },
  { unit: 'dps', use: 'basic', when: [] },
  { unit: 'sup', use: 'basic', when: [] },
]

function setup(overrides: Partial<BattleSetup> & { eidolon?: number } = {}) {
  const { eidolon, ...rest } = overrides
  const requests: DamageRequest[] = []
  const battle = new Battle({
    members: [dhpt(eidolon ?? 0), ally('dps'), ally('sup')],
    policy: basicPolicy,
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 3,
    start: { energy: 0, skillPoints: 5, techniques: false },
    kernel: makeKernel(requests),
    ...rest,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  const turns: EngineEvents['turnStart'][] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  battle.timeline.bus.on('turnStart', (t) => turns.push(t))
  const act = battle.member('dhpt').instance.actions
  const read = (name: string) => battle.member('dhpt').instance.quantities![name]!()
  return { battle, dealt, turns, requests, act, read }
}

describe('Dan Heng PT: ability numbers from the kit text', () => {
  it('multiples and shield formulas by eidolon', () => {
    const e0 = danHengPTScalings(0)
    expect([e0.basic, e0.ult, e0.followUp]).toEqual([1.0, 3.0, 0.8])
    expect(e0.skillShield).toEqual({ atkShare: 0.2, flat: 400 })
    expect(e0.talentShield).toEqual({ atkShare: 0.1, flat: 200 })
    // E3: Ultimate +2 (330%, 88%, Ultimate shield 21.2% + 445) and Basic ATK +1 (110%); the Skill and talent are still Lv10.
    const e3 = danHengPTScalings(3)
    expect([e3.basic, e3.ult, e3.followUp]).toEqual([1.1, 3.3, 0.88])
    expect(e3.ultShield).toEqual({ atkShare: 0.212, flat: 445 })
    expect(e3.skillShield).toEqual({ atkShare: 0.2, flat: 400 })
    expect(e3.talentShield).toEqual({ atkShare: 0.1, flat: 200 })
    // E5: Skill +2 and Talent +2.
    const e5 = danHengPTScalings(5)
    expect(e5.skillShield).toEqual({ atkShare: 0.212, flat: 445 })
    expect(e5.talentShield).toEqual({ atkShare: 0.106, flat: 222.5 })
    expect(shieldAmount(e0.skillShield, ATK)).toBe(1000)
  })

  it('Basic ATK: +20 energy, +1 SP, 30 toughness, hit 0 of BASIC', () => {
    const { battle, dealt, act } = setup({ start: { energy: 0, skillPoints: 2, techniques: false } })
    act.basic!.use()
    expect(battle.skillPoints).toBe(3)
    expect(battle.party.get('dhpt').energy).toBe(20)
    expect(dealt).toHaveLength(1)
    expect(dealt[0]).toMatchObject({ ability: 'BASIC', scaling: 1, damage: 1000 })
    expect(battle.enemies.toughness(battle.primary)).toBe(profile.toughness - 30)
  })

  it('Ultimate: costs 135, +5, 300% to all enemies, 60 toughness each', () => {
    const { battle, dealt, act } = setup({ enemyCount: 3 })
    expect(act.ultimate!.canUse()).toBe(false)
    battle.party.setEnergy('dhpt', 135)
    expect(act.ultimate!.canUse()).toBe(true)
    act.ultimate!.use()
    expect(battle.party.get('dhpt').energy).toBe(5)
    expect(dealt.filter((d) => d.ability === 'ULT').map((d) => d.scaling)).toEqual([3, 3, 3])
    for (const enemy of battle.enemies.ids) expect(battle.enemies.toughness(enemy)).toBe(profile.toughness - 60)
  })
})

describe('Dan Heng PT: the Skill and the Bondmate', () => {
  it('costs 1 SP, gives 30 energy and shields every ally for 20% ATK + 400', () => {
    const { battle, act, read } = setup()
    act.skill!.use('dps')
    expect(battle.skillPoints).toBe(4)
    expect(battle.party.get('dhpt').energy).toBe(30)
    for (const key of ['dhpt', 'dps', 'sup']) expect(battle.party.shield(key)).toBe(1000)
    expect(read('has_bondmate')).toBe(true)
  })

  it('needs an ally target, never himself', () => {
    const { act } = setup()
    expect(() => act.skill!.use()).toThrow(/needs a target/)
    expect(() => act.skill!.use('enemy1')).toThrow(/not an ally/)
    expect(() => act.skill!.use('dhpt')).toThrow(/not modelled/)
  })

  it('the policy rule\'s target is the Bondmate, and E4 cuts only the Bondmate\'s damage taken by 20%', () => {
    const { battle, act } = setup({
      eidolon: 4,
      policy: [{ unit: 'dhpt', use: 'skill', target: 'sup', when: [{ what: 'dhpt.has_bondmate', is: false }] }, ...basicPolicy],
    })
    battle.run()
    expect(battle.party.damageTakenMultiplier('sup')).toBeCloseTo(0.8, 12)
    expect(battle.party.damageTakenMultiplier('dps')).toBe(1)
    // Naming another ally moves it.
    act.skill!.use('dps')
    expect(battle.party.damageTakenMultiplier('sup')).toBe(1)
    expect(battle.party.damageTakenMultiplier('dps')).toBeCloseTo(0.8, 12)
  })

  it('stacks Shield on Shield up to 300% of the Skill\'s, the cap following his current ATK', () => {
    const { battle, act } = setup()
    const seen: number[] = []
    for (let i = 0; i < 4; i++) {
      act.skill!.use('dps')
      seen.push(battle.party.shield('dps'))
    }
    expect(seen).toEqual([1000, 2000, 3000, 3000])
  })

  it('Shield lasts 3 turns of the holder and then goes', () => {
    const { battle, act } = setup()
    act.skill!.use('dps')
    battle.removeSummon(DRAGON) // so that no Souldragon action renews it
    const holderTurns: number[] = []
    battle.timeline.bus.on('turnEnd', (t) => {
      if (t.unit === 'dps') holderTurns.push(battle.party.shield('dps'))
    })
    battle.run()
    // Up through the end of its 3rd turn's countdown, then gone at the 3rd end (the enemy hits only reduce it).
    expect(holderTurns.length).toBeGreaterThanOrEqual(3)
    expect(holderTurns[0]).toBeGreaterThan(0)
    expect(holderTurns[2]).toBe(0)
  })
})

describe('Dan Heng PT: Souldragon as a summon', () => {
  it('is a timeline unit with 165 SPD and a full gauge, not in the party, appearing with the first Bondmate', () => {
    const { battle, act, read } = setup()
    expect(battle.timeline.has(DRAGON)).toBe(false)
    expect(read('souldragon')).toBe(false)
    act.skill!.use('dps')
    expect(battle.isSummon(DRAGON)).toBe(true)
    expect(battle.party.has(DRAGON)).toBe(false)
    expect(battle.timeline.spd(DRAGON)).toBe(SOULDRAGON_SPD)
    expect(battle.timeline.gauge(DRAGON)).toBe(10_000)
    // A second Skill (same or new Bondmate) does not add a second one.
    act.skill!.use('sup')
    expect(battle.summonsOf('dhpt')).toEqual([DRAGON])
  })

  it('an unenhanced action deals no damage and comes at AV 10000 / 165', () => {
    const { battle, act, dealt, turns } = setup()
    act.skill!.use('dps')
    battle.run()
    const first = turns.find((t) => t.unit === DRAGON)!
    expect(first.at).toBeCloseTo(10_000 / 165, 9)
    expect(dealt.filter((d) => d.ability === 'FUA')).toHaveLength(0)
  })

  it('shields from an action: the talent\'s to all and Sublimity\'s to the lowest', () => {
    const { battle, act } = setup()
    act.skill!.use('dps')
    const afterSkill = ['dhpt', 'dps', 'sup'].map((k) => battle.party.shield(k))
    expect(afterSkill).toEqual([1000, 1000, 1000])
    // Run just the Souldragon's turn: stop the battle at its first turnEnd.
    const seen: number[][] = []
    battle.timeline.bus.on('turnEnd', (t) => {
      if (t.unit === DRAGON && seen.length === 0) seen.push(['dhpt', 'dps', 'sup'].map((k) => battle.party.shield(k)))
    })
    battle.run()
    // 1000 + 500 each; the lowest before Sublimity is the first (all tied), +250.
    expect(seen[0]).toEqual([1750, 1500, 1500])
  })

  it('the Ultimate enhances it for 2 actions: the Follow-Up is 80% ATK to all enemies, 60 toughness, as a follow-up of his', () => {
    const { battle, act, dealt, read } = setup()
    act.skill!.use('dps')
    battle.party.setEnergy('dhpt', 135)
    act.ultimate!.use()
    expect(read('enhanced_actions')).toBe(2)
    const result = battle.run()
    const fua = dealt.filter((d) => d.ability === 'FUA')
    expect(fua).toHaveLength(2)
    expect(fua.every((d) => d.attacker === 'dhpt' && d.scaling === 0.8 && d.damage === 800)).toBe(true)
    const dragonActions = result.actions.filter((a) => a.action === 'souldragon')
    expect(dragonActions.length).toBeGreaterThan(2)
    expect(dragonActions.every((a) => a.actor === 'dhpt' && a.kind === 'followUp')).toBe(true)
    expect(dragonActions.slice(0, 2).every((a) => a.enemiesHit.length === 1)).toBe(true)
    expect(dragonActions.slice(2).every((a) => a.enemiesHit.length === 0)).toBe(true)
    expect(read('enhanced_actions')).toBe(0)
  })

  it('E3 raises the Follow-Up to 88%; E2 gives 4 actions and advances it 100% after the Ultimate', () => {
    const e3 = setup({ eidolon: 3 })
    e3.act.skill!.use('dps')
    e3.battle.party.setEnergy('dhpt', 135)
    e3.act.ultimate!.use()
    e3.battle.run()
    expect(e3.dealt.filter((d) => d.ability === 'FUA').every((d) => d.scaling === 0.88)).toBe(true)

    const e2 = setup({ eidolon: 2 })
    e2.act.skill!.use('dps')
    e2.battle.party.setEnergy('dhpt', 135)
    e2.act.ultimate!.use()
    expect(e2.read('enhanced_actions')).toBe(4)
    expect(e2.battle.timeline.gauge(DRAGON)).toBe(0)
    e2.battle.run()
    expect(e2.dealt.filter((d) => d.ability === 'FUA')).toHaveLength(4)
  })

  it('E2 doubles the Shields of an enhanced action', () => {
    const { battle, act } = setup({ eidolon: 2 })
    act.skill!.use('dps')
    battle.party.setEnergy('dhpt', 135)
    act.ultimate!.use()
    // After the Skill and Ultimate (E2 has the Lv10 Ultimate shield, 1000): 2000. The enhanced action adds 2 x 500 = 1000.
    expect(battle.party.shield('sup')).toBe(2000)
    const after: number[] = []
    battle.timeline.bus.on('turnEnd', (t) => {
      if (t.unit === DRAGON && after.length === 0) after.push(battle.party.shield('sup'))
    })
    battle.run()
    expect(after[0]).toBe(3000)
  })

  it('disappears when the Bondmate is knocked down, and the Bondmate buffs end', () => {
    const { battle, act, read, requests } = setup()
    act.skill!.use('dps')
    expect(read('souldragon')).toBe(true)
    battle.party.takeDamage('dps', 1e12, 'enemy1')
    expect(battle.timeline.has(DRAGON)).toBe(false)
    expect(read('has_bondmate')).toBe(false)
    requests.length = 0
    battle.member('sup').instance.actions.basic!.use()
    expect(requests.find((r) => r.attacker.characterId === 'ally')!.teammates[0]!.characterConditionals).toMatchObject({ bondmate: false })
  })

  it('disappears with him', () => {
    const { battle, act } = setup()
    act.skill!.use('dps')
    battle.party.takeDamage('dhpt', 1e12, 'enemy1')
    expect(battle.timeline.has(DRAGON)).toBe(false)
  })

  it('can be summoned again after it was lost', () => {
    const { battle, act } = setup()
    act.skill!.use('dps')
    battle.party.takeDamage('dps', 1e12, 'enemy1')
    act.skill!.use('sup')
    expect(battle.timeline.has(DRAGON)).toBe(true)
  })
})

describe('Dan Heng PT: Sylvanity', () => {
  it('advances him 40% at the start of combat', () => {
    const { battle, turns } = setup()
    battle.run()
    // 100 SPD: 100 AV for a full gauge; 40% advanced it is 60. The Skill's rule is not in this policy, so he basics.
    expect(turns.find((t) => t.unit === 'dhpt')!.at).toBeCloseTo(60, 9)
  })

  it('when the Bondmate attacks he gets 6 energy and the Souldragon advances 15%; a teammate\'s attack does nothing', () => {
    const { battle, act } = setup()
    act.skill!.use('dps')
    expect(battle.party.get('dhpt').energy).toBe(30)
    battle.member('sup').instance.actions.basic!.use()
    expect(battle.party.get('dhpt').energy).toBe(30)
    expect(battle.timeline.gauge(DRAGON)).toBe(10_000)
    battle.member('dps').instance.actions.basic!.use()
    expect(battle.party.get('dhpt').energy).toBe(36)
    expect(battle.timeline.gauge(DRAGON)).toBe(8_500)
  })
})

describe('Dan Heng PT: what the kernel is told', () => {
  const lastTeammateOf = (requests: DamageRequest[], attacker: string) => {
    const mine = requests.filter((r) => r.attacker.characterId === 'ally')
    expect(mine.length).toBeGreaterThan(0)
    void attacker
    return mine[mine.length - 1]!
  }

  it('the Bondmate gets the switch on and his ATK when the Skill was used; the others get it off', () => {
    const { battle, act, requests } = setup()
    act.skill!.use('dps')
    battle.member('dps').instance.actions.basic!.use()
    expect(lastTeammateOf(requests, 'dps').teammates[0]!.characterConditionals).toEqual({
      bondmate: true,
      sourceAtk: ATK,
      cyreneSpecialEffect: false,
      e1ResPen: false,
      e4DmgReduction: true,
      e6Buffs: false,
    })
    battle.member('sup').instance.actions.basic!.use()
    expect(lastTeammateOf(requests, 'sup').teammates[0]!.characterConditionals).toEqual({
      bondmate: false,
      sourceAtk: 0,
      cyreneSpecialEffect: false,
      e1ResPen: false,
      e4DmgReduction: false,
      e6Buffs: false,
    })
  })

  it('before any Skill nobody is the Bondmate', () => {
    const { battle, requests } = setup()
    battle.member('dps').instance.actions.basic!.use()
    expect(lastTeammateOf(requests, 'dps').teammates[0]!.characterConditionals).toMatchObject({ bondmate: false })
  })

  it('E1: +1 SP with the Ultimate, and the RES PEN switch is on for the Bondmate for 3 of its turns', () => {
    const { battle, act, requests } = setup({ eidolon: 1, start: { energy: 0, skillPoints: 2, techniques: false } })
    act.skill!.use('dps')
    battle.party.setEnergy('dhpt', 135)
    act.ultimate!.use()
    expect(battle.skillPoints).toBe(2) // 2 - 1 + 1
    const ask = (key: string) => {
      battle.member(key).instance.actions.basic!.use()
      return lastTeammateOf(requests, key).teammates[0]!.characterConditionals!.e1ResPen
    }
    expect(ask('dps')).toBe(true)
    expect(ask('sup')).toBe(false)
    // Counted on the Bondmate's own turns: let three of them pass.
    battle.run()
    expect(battle.timeline.modifiers.has('dps', 'dhpt.e1_res_pen')).toBe(false)
  })

  it('E6: the Bondmate gets e6Buffs; every other attacker gets the Vulnerability injected and no DEF ignore; he gets it too', () => {
    const { battle, act, requests } = setup({ eidolon: 6 })
    act.skill!.use('dps')
    battle.member('dps').instance.actions.basic!.use()
    let r = lastTeammateOf(requests, 'dps')
    expect(r.teammates[0]!.characterConditionals).toMatchObject({ bondmate: true, e6Buffs: true })
    expect(r.injectedBuffs).toBeUndefined()

    battle.member('sup').instance.actions.basic!.use()
    r = lastTeammateOf(requests, 'sup')
    expect(r.teammates[0]!.characterConditionals).toMatchObject({ bondmate: false, e6Buffs: false })
    expect(r.injectedBuffs).toEqual([expect.objectContaining({ stat: 'VULNERABILITY', value: 0.2, target: 'team' })])

    requests.length = 0
    act.basic!.use()
    expect(requests[0]!.injectedBuffs).toEqual([expect.objectContaining({ stat: 'VULNERABILITY', value: 0.2, target: 'self' })])
  })

  it('E6 buffs need a Bondmate on the field; below E6 nothing is injected', () => {
    const own = (requests: DamageRequest[]) => requests.filter((r) => r.attacker.characterId === '1414')
    const noE6 = setup({ eidolon: 5 })
    noE6.act.skill!.use('dps')
    noE6.act.basic!.use()
    expect(own(noE6.requests)).not.toHaveLength(0)
    expect(own(noE6.requests).every((r) => r.injectedBuffs === undefined)).toBe(true)

    const e6 = setup({ eidolon: 6 })
    e6.act.basic!.use()
    expect(own(e6.requests)).not.toHaveLength(0)
    expect(own(e6.requests).every((r) => r.injectedBuffs === undefined)).toBe(true)
  })
})

describe('Dan Heng PT: his shields are his own key (Party.shieldOf)', () => {
  it('stacks on his own shield only, up to 300% of the Skill\'s, and leaves another source\'s shield untouched', () => {
    const { battle, act } = setup()
    // A foreign shield of 2000 (Texture of Memories, say) and his own 1000 from a first Skill.
    act.skill!.use('dps')
    battle.party.setShield('dps', 'foreign', 2000)
    expect(battle.party.shieldOf('dps', 'dhpt.shield')).toBe(1000)
    // The second Skill: his own 1000 + 1000. If the foreign 2000 were counted it would be 3000 (the cap), then 3000 + 1000 capped.
    act.skill!.use('dps')
    expect(battle.party.shieldOf('dps', 'dhpt.shield')).toBe(2000)
    expect(battle.party.shieldOf('dps', 'foreign')).toBe(2000)
    act.skill!.use('dps')
    act.skill!.use('dps')
    expect(battle.party.shieldOf('dps', 'dhpt.shield')).toBe(3000) // the cap is 300% of the Skill's 1000, his own only
    expect(battle.party.shieldOf('dps', 'foreign')).toBe(2000)
    // What absorbs is still the largest of the two.
    expect(battle.party.shield('dps')).toBe(3000)
  })
})

describe('Dan Heng PT: ATK comes from Battle.combatStats', () => {
  it('sizes his shields from the kernel\'s ATK for him, the number the runner prices with', () => {
    const { battle, act, requests } = setup()
    expect(battle.combatStats('dhpt').ATK).toBe(ATK)
    act.skill!.use('dps')
    expect(battle.party.shield('dps')).toBe(shieldAmount(danHengPTScalings(0).skillShield, ATK))
    expect(requests.some((r) => r.attacker.characterId === '1414')).toBe(true)
  })
})

describe('Dan Heng PT: the Bondmate\'s Additional DMG (K23)', () => {
  const additional = (dealt: EngineEvents['damageDealt'][]) => dealt.filter((d) => d.ability === 'EXTRA')
  /** Skill on the Bondmate, then the Ultimate: the Souldragon is enhanced. */
  const enhance = (s: ReturnType<typeof setup>, bondmate = 'dps') => {
    s.act.skill!.use(bondmate)
    s.battle.party.setEnergy('dhpt', 135)
    s.act.ultimate!.use()
  }

  it('gives the Bondmate one extra Additional hit at 1.0 x ATK, and nobody else', () => {
    const { battle, act, requests } = setup()
    act.skill!.use('dps')
    battle.member('dps').instance.actions.basic!.use()
    battle.member('sup').instance.actions.basic!.use()
    const mine = requests.filter((r) => r.attacker.characterId === 'ally')
    expect(mine.at(-2)!.extraHits).toEqual([{ id: 'dhpt.bondmate_additional', damageType: 'ADDITIONAL', scalingStat: 'ATK', multiple: 1 }])
    expect(mine.at(-1)!.extraHits).toBeUndefined()
  })

  it('the enhanced Souldragon: 80% of the Bondmate\'s ATK to every enemy, credited to the Bondmate, twice for the 2 actions', () => {
    const s = setup({ enemyCount: 3 })
    enhance(s)
    s.battle.run()
    const extra = additional(s.dealt).filter((d) => d.scaling !== 0.4)
    expect(extra.every((d) => d.attacker === 'dps')).toBe(true)
    // 2 actions x 3 enemies at 0.8 x 500, plus E6's none (E0): the Souldragon's own parts.
    expect(extra.filter((d) => d.scaling === 0.8)).toHaveLength(6)
    expect(extra.filter((d) => d.scaling === 0.8).every((d) => d.damage === 0.8 * EXTRA_PRICE)).toBe(true)
  })

  it('E3: 88%; E2: doubled on top of its 4 actions (E3 has E2 too)', () => {
    // Eidolons add up: at E3 the Follow-Up is 88% and E2's doubling applies, 1.76 of the Bondmate's ATK, in 4 actions.
    const e3 = setup({ eidolon: 3 })
    enhance(e3)
    e3.battle.run()
    const e3Hits = additional(e3.dealt).filter((d) => d.scaling === 1.76)
    expect(e3Hits).toHaveLength(4)
    expect(e3Hits.every((d) => d.damage === 1.76 * EXTRA_PRICE)).toBe(true)

    const e2 = setup({ eidolon: 2 })
    enhance(e2)
    e2.battle.run()
    const doubled = additional(e2.dealt).filter((d) => d.scaling === 1.6)
    expect(doubled).toHaveLength(4)
    expect(doubled.every((d) => d.damage === 1.6 * EXTRA_PRICE)).toBe(true)
  })

  it('Sublimity: 40% of the Bondmate\'s ATK on the one enemy with the highest HP, doubled by E2', () => {
    const s = setup({ enemyCount: 3 })
    enhance(s)
    // The other two have already lost HP: the third has the most.
    const [first, second, third] = s.battle.enemies.ids
    s.battle.enemies.takeDamage(first!, 50_000)
    s.battle.enemies.takeDamage(second!, 80_000)
    s.battle.run()
    const sublimity = additional(s.dealt).filter((d) => d.scaling === 0.4)
    expect(sublimity).toHaveLength(2)
    expect(sublimity.every((d) => d.enemy === third && d.attacker === 'dps' && d.damage === 0.4 * EXTRA_PRICE)).toBe(true)

    const e2 = setup({ eidolon: 2, enemyCount: 3 })
    enhance(e2)
    e2.battle.run()
    const doubled = additional(e2.dealt).filter((d) => d.scaling === 0.8 && d.damage === 0.8 * EXTRA_PRICE)
    // 0.8 is also the Follow-Up's own multiple at E0 but at E2 that one is 1.6: every 0.8 here is Sublimity's, one enemy per action.
    expect(doubled).toHaveLength(4)
  })

  it('E6: 330% of the Bondmate\'s ATK to all enemies when he uses the Ultimate, not doubled by E2', () => {
    const e6 = setup({ eidolon: 6, enemyCount: 3 })
    e6.act.skill!.use('dps')
    e6.battle.party.setEnergy('dhpt', 135)
    e6.dealt.length = 0
    e6.act.ultimate!.use()
    const now = additional(e6.dealt)
    expect(now).toHaveLength(3)
    expect(now.every((d) => d.attacker === 'dps' && d.scaling === 3.3 && d.damage === 3.3 * EXTRA_PRICE)).toBe(true)

    const e5 = setup({ eidolon: 5, enemyCount: 3 })
    e5.act.skill!.use('dps')
    e5.battle.party.setEnergy('dhpt', 135)
    e5.act.ultimate!.use()
    expect(additional(e5.dealt)).toHaveLength(0)
  })

  it('goes to whoever is the Bondmate at the time, and nobody when there is none', () => {
    const s = setup({ enemyCount: 1 })
    enhance(s, 'dps')
    s.act.skill!.use('sup') // the Bondmate moves; the enhancement stays
    s.battle.run()
    const extra = additional(s.dealt)
    expect(extra.length).toBeGreaterThan(0)
    expect(extra.every((d) => d.attacker === 'sup')).toBe(true)

    // No Bondmate: the Souldragon never appears, so there is no enhanced action and no Additional DMG.
    const none = setup()
    none.battle.party.setEnergy('dhpt', 135)
    none.act.ultimate!.use()
    none.battle.run()
    expect(additional(none.dealt)).toHaveLength(0)
  })

  it('is not an attack of the Bondmate: no Sylvanity energy or advance, no action of his in the log', () => {
    const s = setup()
    enhance(s)
    const energyBefore = s.battle.party.get('dhpt').energy
    s.battle.removeSummon(DRAGON) // so the run does not move the gauge by itself
    s.battle.addSummon({
      id: DRAGON,
      owner: 'dhpt',
      baseSpd: 1,
      takeTurn: () => {},
    })
    const gaugeBefore = s.battle.timeline.gauge(DRAGON)
    const listener: string[] = []
    s.battle.timeline.bus.on('actionUsed', (a) => listener.push(a.actor))
    s.battle.attack({ attacker: 'dps', ability: 'EXTRA', parts: [{ shape: 'aoe', scaling: 0.8, hit: s.battle.extraHitIndex('dps', 'dhpt.bondmate_additional'), additional: true }] })
    expect(s.battle.party.get('dhpt').energy).toBe(energyBefore)
    expect(s.battle.timeline.gauge(DRAGON)).toBe(gaugeBefore)
    expect(listener).toEqual([])
  })
})

describe('Dan Heng PT: the Souldragon\'s Follow-Up toughness', () => {
  // IN-GAME CHECK: the text puts 60 on the Talent's line; Fribbels has toughnessDmg(10) on the Follow-Up, which is 30 here.
  it('is 60 per enemy as the text says (Fribbels\' own number would be 30)', () => {
    expect(TOUGHNESS_FOLLOW_UP).toBe(60)
    const s = setup({ enemyCount: 3 })
    s.act.skill!.use('dps')
    s.battle.party.setEnergy('dhpt', 135)
    s.act.ultimate!.use()
    const toughness = () => s.battle.enemies.ids.map((id) => s.battle.enemies.toughness(id))
    let before: number[] = []
    const after: number[][] = []
    s.battle.timeline.bus.on('turnStart', (turn) => {
      if (turn.unit === DRAGON && before.length === 0) before = toughness()
    })
    s.battle.timeline.bus.on('turnEnd', (turn) => {
      if (turn.unit === DRAGON && after.length === 0) after.push(toughness())
    })
    s.battle.run()
    // The first enhanced action takes 60 from every enemy.
    expect(after).toHaveLength(1)
    expect(before.map((v, i) => v - after[0]![i]!)).toEqual([60, 60, 60])
  })
})

describe('Dan Heng PT: E1 and a Bondmate who changes after the Ultimate', () => {
  it('the RES PEN switch is on only for the Bondmate that holds the buff', () => {
    const { battle, act } = setup({ eidolon: 1 })
    // What the kernel is told about him when `key` attacks (the request itself is cached, so ask the state the battle asks).
    const switchFor = (key: string) => battle.member('dhpt').instance.teammateState(battle.member(key), battle.primary).characterConditionals!
    act.skill!.use('dps')
    battle.party.setEnergy('dhpt', 135)
    act.ultimate!.use() // E1: the buff lands on the Bondmate, dps
    expect(battle.timeline.modifiers.has('dps', 'dhpt.e1_res_pen')).toBe(true)
    expect(switchFor('dps')).toMatchObject({ bondmate: true, e1ResPen: true })
    expect(switchFor('sup')).toMatchObject({ bondmate: false, e1ResPen: false })

    // The Bondmate changes to sup within the 3 turns: sup did not get the buff, and dps is no longer the Bondmate.
    act.skill!.use('sup')
    expect(battle.timeline.modifiers.has('sup', 'dhpt.e1_res_pen')).toBe(false)
    expect(switchFor('sup')).toMatchObject({ bondmate: true, e1ResPen: false })
    expect(switchFor('dps')).toMatchObject({ bondmate: false, e1ResPen: false })

    // Back to the holder while the buff lasts: it reaches him again.
    act.skill!.use('dps')
    expect(switchFor('dps')).toMatchObject({ bondmate: true, e1ResPen: true })
    expect(switchFor('sup')).toMatchObject({ bondmate: false, e1ResPen: false })
  })
})
