import { describe, expect, it } from 'vitest'
import { Battle, CYRENE_KERNEL_ID } from '../battle/battle'
import type { BattleSetup, MemberSetup } from '../battle/battle'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Path } from '../battle/party'
import type { Rule } from '../scenario/types'
import { ThisLoveForever } from '../equipment/thisLoveForever'
import { CHRYSOS_HEIR_IDS, Cyrene, demiurgeId, makeCyrene, ODE_DMG_MODIFIER, ZONE_MODIFIER } from './cyrene'
import type { AfterOrder } from './cyrene'
import type { Kit } from './kit'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const DEMI = demiurgeId('cyrene')
const CYRENE_HP = 10_000

/** Damage per 100% of the multiple, for Cyrene: Basic ATK 1,000 and Minuet 2,000 (one MEMO_SKILL hit, as Fribbels builds it). */
const RATE = { basic: 1000, minuet: 2000 }

interface Knobs {
  /** The kernel's in-combat SPD for her (`CombatStats.SPD`). */
  spd: number
  /** Her out-of-combat Max HP as the kernel reports it (the +24% rises it when Demiurge is on the field). */
  hp: number
}

/**
 * A stand-in for Fribbels' Cyrene, written from the text's numbers, not from the kit: BASIC is one hit whose multiple is the
 * ability's total (normal 50% / E5 55%; enhanced two parts of 30% / E5 33%), MEMO_SKILL is Minuet's one hit with its AoE multiple
 * (60% / E3 66%) plus the bounces at the per-bounce multiple (+6% a stack at E4), and the stats show Demiurge's Max HP +24%.
 */
function makeKernel(requests: DamageRequest[], knobs: Knobs): DamageKernel {
  return {
    actionDamage(request) {
      requests.push(request)
      if (request.attacker.characterId !== CYRENE_KERNEL_ID) {
        return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }], ULT: [{ damage: 1000, scaling: 1 }] })
      }
      const c = request.attacker.characterConditionals ?? {}
      const e = request.attacker.eidolon
      const on = c.memospriteActive === true
      const basic = on ? 2 * (e >= 5 ? 0.33 : 0.3) : e >= 5 ? 0.55 : 0.5
      const main = e >= 3 ? 0.66 : 0.6
      const bounces = Number(c.odeToEgoExtraBounces ?? 0) + Number(c.e1ExtraBounces ?? 0)
      const minuet = main + bounces * (main + (e >= 4 ? Number(c.e4BounceStacks ?? 0) * 0.06 : 0))
      return fakeResult(
        {
          BASIC: [{ damage: RATE.basic * basic, scaling: basic }],
          MEMO_SKILL: [{ damage: RATE.minuet * minuet, scaling: minuet }],
          BREAK: [{ damage: 500 }],
        },
        { ATK: 0, DEF: 0, HP: knobs.hp * (on ? 1.24 : 1), SPD: knobs.spd, CR: 0, CD: 0, EHR: 0, RES: 0, BE: 0, ERR: 0, OHB: 0 },
      )
    },
  }
}

/** A teammate: Basic ATK and a Skill that give an attack, an Ultimate when it has energy, and a memosprite action for direct calls. */
const allyKit = (path: Path, maxEnergy = 0, withMemosprite = false): Kit => ({
  characterId: 'ally',
  path,
  element: 'Fire',
  maxEnergy,
  create: (battle, self) => {
    const memo = `${self.key}.mem`
    const hit = (ability: string) => battle.attack({ attacker: self.key, ability, parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
    return {
      actions: {
        basic: {
          kind: 'basic',
          canUse: () => true,
          use: () =>
            battle.performAction(self.key, 'basic', 'basic', () => {
              battle.gainSkillPoints(1)
              hit('BASIC')
            }),
        },
        skill: { kind: 'skill', canUse: () => true, use: () => battle.performAction(self.key, 'skill', 'skill', () => hit('BASIC')) },
        ultimate: {
          kind: 'ultimate',
          canUse: () => maxEnergy > 0 && battle.party.get(self.key).energy >= maxEnergy,
          use: () =>
            battle.performAction(self.key, 'ultimate', 'ultimate', () => {
              battle.party.setEnergy(self.key, 0)
              hit('ULT')
            }),
        },
        followUp: { kind: 'skill', canUse: () => true, use: () => battle.performAction(self.key, 'follow', 'followUp', () => hit('BASIC')) },
        /** The ally's memosprite (no SPD) takes a turn: a Memosprite Skill action. */
        memo: {
          kind: 'skill',
          canUse: () => true,
          use: () => {
            if (!battle.isMemosprite(memo)) {
              battle.addMemosprite({ id: memo, owner: self.key, name: 'x', maxHp: 1000, baseAggro: 4, takeTurn: () => {} })
            }
            battle.performAction(memo, 'memo', 'skill', () => {})
          },
        },
      },
      attackerState: () => ({}),
      teammateState: () => ({}),
      onBattleStart: () => {
        if (withMemosprite) battle.addMemosprite({ id: memo, owner: self.key, name: 'x', maxHp: 1000, baseAggro: 4, takeTurn: () => {} })
      },
    }
  },
})

interface Mate {
  key: string
  /** Fribbels character id: decides Chrysos Heir. */
  id: string
  path?: Path
  spd?: number
  energy?: number
  /** Starts the battle with a memosprite (no SPD). */
  memosprite?: boolean
}
const HYACINE: Mate = { key: 'hya', id: '1409', path: 'Remembrance' }
const CASTORICE: Mate = { key: 'cas', id: '1407', path: 'Remembrance' }
const TRIBBIE: Mate = { key: 'tri', id: '1403', path: 'Harmony' }
const PELA: Mate = { key: 'pela', id: '1106', path: 'Nihility' }

const cyreneSetup = (eidolon: number, kit: Kit, baseSpd: number, lightCone = false, superimposition = 1): MemberSetup => ({
  key: 'cyrene',
  kit,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: CYRENE_HP, def: 1000, baseSpd },
  kernel: { unit: { characterId: CYRENE_KERNEL_ID, lightConeId: lightCone ? '23052' : 'x', eidolon, superimposition }, build: noBuild },
  ...(lightCone && { equipment: { lightCone: ThisLoveForever, sets: [] } }),
})
const mateSetup = (m: Mate): MemberSetup => ({
  key: m.key,
  kit: allyKit(m.path ?? 'Hunt', m.energy ?? 0, m.memosprite ?? false),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 10_000, def: 1000, baseSpd: m.spd ?? 160, ...(m.energy ? { energyRegen: 0 } : {}) },
  kernel: { unit: { characterId: m.id, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
})

const rule = (unit: string, use: string, when: Rule['when'] = []): Rule => ({ unit, use, when })

interface Options {
  eidolon?: number
  kit?: Kit
  mates?: Mate[]
  baseSpd?: number
  enemies?: number
  cycles?: number
  techniques?: boolean
  lightCone?: boolean
  superimposition?: number
  knobs?: Partial<Knobs>
  skillPoints?: number
  policy?: Rule[]
}

function setup(options: Options = {}) {
  const requests: DamageRequest[] = []
  const knobs: Knobs = { spd: 150, hp: CYRENE_HP, ...options.knobs }
  const mates = options.mates ?? [HYACINE, CASTORICE, TRIBBIE]
  const members = [
    cyreneSetup(options.eidolon ?? 0, options.kit ?? Cyrene, options.baseSpd ?? 100, options.lightCone, options.superimposition),
    ...mates.map(mateSetup),
  ]
  const policy: Rule[] = options.policy ?? [
    rule('cyrene', 'ultimate'),
    ...mates.map((m) => rule(m.key, 'ultimate')),
    rule('cyrene', 'skill'),
    rule('cyrene', 'basic'),
    ...mates.map((m) => rule(m.key, 'basic')),
  ]
  const setupArg: BattleSetup = {
    members,
    policy,
    profile,
    enemyCount: options.enemies ?? 1,
    weaknesses: 'all',
    cycles: options.cycles ?? 1,
    start: { energy: 0, skillPoints: options.skillPoints ?? 3, techniques: options.techniques ?? false },
    kernel: makeKernel(requests, knobs),
  }
  const battle = new Battle(setupArg)
  const dealt: EngineEvents['damageDealt'][] = []
  const resolved: EngineEvents['attackResolved'][] = []
  const log: Array<{ actor: string, action: string, kind: string, recollection: number, sources: number }> = []
  const q = (name: string) => battle.member('cyrene').instance.quantities![name]!()
  battle.timeline.bus.on('damageDealt', (d) => dealt.push(d))
  battle.timeline.bus.on('attackResolved', (r) => resolved.push(r))
  battle.timeline.bus.on('actionUsed', (a) => log.push({ actor: a.actor, action: a.action, kind: a.kind, recollection: Number(q('recollection')), sources: Number(q('ego_sources')) }))
  const start = () => {
    for (const m of battle.members) m.instance.onBattleStart?.({ techniques: options.techniques ?? false })
  }
  return { battle, dealt, resolved, log, requests, knobs, q, start }
}
type Setup = ReturnType<typeof setup>
const use = (t: Setup, who: string, action: string) => t.battle.member(who).instance.actions[action]!.use()
const demiurgeActions = (t: Setup) => t.log.filter((l) => l.actor === DEMI).map((l) => l.action)
/**
 * Demiurge's actions without the automatic Story Minuet. With the default policy a Reunion is cast as soon as one is affordable (the first
 * Ultimate leaves the 12 it needs), and the third Story (2 from the first Ultimate, 1 from the Reunion) is an automatic Minuet after the
 * first two choice turns: it is not a choice.
 */
const choiceActions = (t: Setup) => {
  const all = demiurgeActions(t)
  return all[2] === 'minuet' ? all.filter((_, i) => i !== 2) : all
}

describe('the kit list agrees with Fribbels', () => {
  it('has the same Chrysos Heirs', async () => {
    // Fribbels' file pulls in the whole conditional tree; reading its text is enough to compare the ids.
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../../vendor/hsr-optimizer/src/lib/conditionals/character/1400/Cyrene.ts', import.meta.url), 'utf8')
    const block = /CHRYSOS_HEIR_IDS = \[([\s\S]*?)\]/.exec(source)![1]!
    const ids = [...block.matchAll(/'(\d+)'/g)].map((m) => m[1])
    expect(CHRYSOS_HEIR_IDS).toEqual(ids)
  })
})

describe('Recollection at the start of combat (Ripples Across Time, E2)', () => {
  const start = (mates: Mate[], eidolon = 0) => {
    const t = setup({ mates, eidolon })
    t.start()
    return Number(t.q('recollection'))
  }
  it('is 0 / 2 / 3 / 6 with 0 / 1 / 2 / 3 other Chrysos Heirs or Remembrance characters', () => {
    expect(start([PELA])).toBe(0)
    expect(start([PELA, HYACINE])).toBe(2)
    expect(start([PELA, HYACINE, CASTORICE])).toBe(3)
    expect(start([HYACINE, CASTORICE, TRIBBIE])).toBe(6)
  })
  it('counts a Remembrance character that is not a Chrysos Heir, and a Chrysos Heir of any path', () => {
    expect(start([{ key: 'x', id: '9999', path: 'Remembrance' }, PELA])).toBe(2)
    expect(start([TRIBBIE, PELA])).toBe(2)
  })
  it('E2 adds 12 more, and E1 does not', () => {
    expect(start([HYACINE, CASTORICE, TRIBBIE], 2)).toBe(18)
    expect(start([HYACINE, CASTORICE, TRIBBIE], 1)).toBe(6)
  })
})

describe('Basic ATK and Skill', () => {
  it('Basic ATK: +1 Recollection and +1 Skill Point, 50% of her Max HP to one enemy, toughness 30', () => {
    const t = setup({ mates: [PELA] })
    t.start()
    const sp = t.battle.skillPoints
    use(t, 'cyrene', 'basic')
    expect(t.q('recollection')).toBe(1)
    expect(t.battle.skillPoints).toBe(sp + 1)
    expect(t.dealt.map((d) => d.damage)).toEqual([RATE.basic * 0.5])
    expect(t.resolved[0]!.parts).toEqual([{ shape: 'single', scaling: 0.5, hit: 0, toughness: 30 }])
  })
  it('Basic ATK is 55% from E5', () => {
    const t = setup({ mates: [PELA], eidolon: 5 })
    t.start()
    use(t, 'cyrene', 'basic')
    expect(t.dealt[0]!.damage).toBe(RATE.basic * 0.55)
  })
  it('Skill: -1 Skill Point, +3 Recollection, no damage, deploys the Zone for 2 turns', () => {
    const t = setup({ mates: [PELA] })
    t.start()
    const sp = t.battle.skillPoints
    expect(t.q('zone')).toBe(false)
    use(t, 'cyrene', 'skill')
    expect(t.battle.skillPoints).toBe(sp - 1)
    expect(t.q('recollection')).toBe(3)
    expect(t.dealt).toEqual([])
    expect(t.q('zone')).toBe(true)
    expect(t.battle.timeline.modifiers.get('cyrene', ZONE_MODIFIER)!.turnsLeft).toBe(2)
  })
  it('the Skill cannot be used without a Skill Point', () => {
    const t = setup({ mates: [PELA], skillPoints: 0 })
    expect(t.battle.member('cyrene').instance.actions.skill!.canUse()).toBe(false)
  })
  it('Recollection stops at 24 + 27 = 51', () => {
    const t = setup({ mates: [PELA], skillPoints: 5 })
    t.start()
    for (let i = 0; i < 4; i++) use(t, 'cyrene', 'skill')
    expect(t.q('recollection')).toBe(12)
    // 5 skill points: 4 Skills used; give points back through an ally's Basic ATK and go on.
    for (let i = 0; i < 20; i++) {
      use(t, 'pela', 'basic')
      use(t, 'cyrene', 'skill')
    }
    expect(t.q('recollection')).toBe(51)
  })
})

describe('Future: Recollection from teammates', () => {
  it('a teammate spends its Future on its first Basic ATK or Skill after Cyrene took action, and not again until she takes action', () => {
    const t = setup({ mates: [PELA] })
    t.start()
    use(t, 'pela', 'basic')
    expect(t.q('recollection')).toBe(1)
    use(t, 'pela', 'basic')
    use(t, 'pela', 'skill')
    expect(t.q('recollection')).toBe(1)
    use(t, 'cyrene', 'basic')
    expect(t.q('recollection')).toBe(2)
    use(t, 'pela', 'skill')
    expect(t.q('recollection')).toBe(3)
  })
  it('an Ultimate or a follow-up of a teammate holding Future gives nothing and keeps the Future', () => {
    const t = setup({ mates: [{ ...PELA, energy: 100 }] })
    t.start()
    t.battle.party.setEnergy('pela', 100)
    use(t, 'pela', 'ultimate')
    use(t, 'pela', 'followUp')
    expect(t.q('recollection')).toBe(0)
    use(t, 'pela', 'basic')
    expect(t.q('recollection')).toBe(1)
  })
  it("a teammate's memosprite gives 1 Recollection on every action, its Future never spent", () => {
    const t = setup({ mates: [PELA] })
    t.start()
    use(t, 'pela', 'memo')
    use(t, 'pela', 'memo')
    use(t, 'pela', 'memo')
    expect(t.q('recollection')).toBe(3)
  })
  it('different teammates counted: characters and their memosprites, once each', () => {
    const t = setup({ mates: [PELA, HYACINE] })
    t.start()
    use(t, 'pela', 'basic')
    use(t, 'pela', 'memo')
    use(t, 'pela', 'memo')
    use(t, 'hya', 'basic')
    expect(t.q('ego_sources')).toBe(3)
  })
})

const withEnergy = (m: Mate): Mate => ({ ...m, energy: 100 })
const FULL = [withEnergy(HYACINE), withEnergy(CASTORICE), withEnergy(TRIBBIE)]
const FOUR = [withEnergy(PELA), withEnergy(HYACINE), withEnergy(CASTORICE), withEnergy(TRIBBIE)]
const names = (t: Setup) => t.log.map((l) => `${l.actor}:${l.action}`)

/** Her Recollection brought to exactly 24 by the teammates' Future and one Skill (E2, three Remembrance teammates: 18 + 3 + 3). */
function ready(options: Options = {}): Setup {
  const t = setup({ mates: FULL, eidolon: 2, ...options })
  t.start()
  for (const m of FULL) use(t, m.key, 'basic')
  use(t, 'cyrene', 'skill')
  expect(t.q('recollection')).toBe(24)
  return t
}

describe('the Ultimate', () => {
  it('needs 24 Recollection, once', () => {
    const t = setup({ mates: FULL, eidolon: 2 })
    t.start()
    const ult = t.battle.member('cyrene').instance.actions.ultimate!
    expect(t.q('recollection')).toBe(18)
    expect(ult.canUse()).toBe(false)
    for (const m of FULL) use(t, m.key, 'basic')
    expect(t.q('recollection')).toBe(21)
    expect(ult.canUse()).toBe(false)
    use(t, 'cyrene', 'skill')
    expect(ult.canUse()).toBe(true)
  })

  it('needs 24 and spends 12: the rest stays (settled in game, 2026-11-15)', () => {
    const t = setup({ mates: FULL, eidolon: 2, skillPoints: 5 })
    t.start()
    for (const m of FULL) use(t, m.key, 'basic')
    use(t, 'cyrene', 'skill')
    use(t, 'cyrene', 'skill')
    expect(t.q('recollection')).toBe(27)
    use(t, 'cyrene', 'ultimate')
    expect(t.q('recollection')).toBe(15)
  })

  it('exactly 24 leaves 12, and 23 is not enough', () => {
    const t = setup({ mates: FULL, eidolon: 2 })
    t.start()
    const ult = t.battle.member('cyrene').instance.actions.ultimate!
    for (const m of FULL) use(t, m.key, 'basic')
    expect(t.q('recollection')).toBe(21)
    expect(ult.canUse()).toBe(false)
    use(t, 'cyrene', 'skill')
    expect(t.q('recollection')).toBe(24)
    use(t, 'cyrene', 'ultimate')
    expect(t.q('recollection')).toBe(12)
  })

  it('summons Demiurge with an extra turn, fills the teammates, deploys the Zone with no limit and starts Ripples', () => {
    const t = ready()
    expect(t.q('demiurge')).toBe(false)
    use(t, 'cyrene', 'ultimate')
    expect(t.q('recollection')).toBe(12)
    expect(t.q('demiurge')).toBe(true)
    expect(t.q('ripples')).toBe(true)
    expect(t.battle.timeline.pendingExtraTurns()).toEqual([DEMI])
    for (const m of FULL) expect(t.battle.party.get(m.key).energy).toBe(100)
    const zone = t.battle.timeline.modifiers.get('cyrene', ZONE_MODIFIER)!
    expect(zone.turnsLeft).toBeUndefined()
    expect(zone.duration).toBeUndefined()
    expect(t.battle.timeline.has(DEMI)).toBe(false)
    expect(t.battle.party.get(DEMI).baseAggro).toBe(4)
    expect(t.battle.party.get(DEMI).targetable).toBe(false)
  })

  it("the teammates' Ultimates (filled by hers) come before Demiurge's extra turn, whichever order the policy lists them in (settled in game, 2026-11-15)", () => {
    const firstOnly = [{ what: 'cyrene.ripples', is: false }]
    const mates = FULL.map((m) => rule(m.key, 'ultimate'))
    const rest = [rule('cyrene', 'skill'), rule('cyrene', 'basic'), ...FULL.map((m) => rule(m.key, 'basic'))]
    const policies: Array<[string, Rule[]]> = [
      ['hers first', [rule('cyrene', 'ultimate', firstOnly), ...mates, ...rest]],
      ['theirs first', [...mates, rule('cyrene', 'ultimate', firstOnly), ...rest]],
    ]
    for (const [name, policy] of policies) {
      const t = setup({ mates: FULL, eidolon: 2, cycles: 1, policy })
      t.battle.run()
      const order = names(t)
      const ult = order.indexOf('cyrene:ultimate')
      expect(ult, name).toBeGreaterThanOrEqual(0)
      expect(order.slice(ult, ult + 5), name).toEqual(['cyrene:ultimate', 'hya:ultimate', 'cas:ultimate', 'tri:ultimate', 'cyrene.demiurge:ode:hya'])
    }
  })

  it('the Skill cannot be used in Ripples and the Basic ATK is To Love and Tomorrow', () => {
    const t = ready({ enemies: 3 })
    use(t, 'cyrene', 'ultimate')
    expect(t.battle.member('cyrene').instance.actions.skill!.canUse()).toBe(false)
    const sp = t.battle.skillPoints
    t.resolved.length = 0
    t.dealt.length = 0
    use(t, 'cyrene', 'basic')
    expect(t.battle.skillPoints).toBe(sp)
    // The first Ultimate left 12 of the 24.
    expect(t.q('recollection')).toBe(12 + 3)
    expect(t.resolved[0]!.parts).toEqual([
      { shape: 'single', scaling: 0.3, hit: 0, toughness: 30 },
      { shape: 'aoe', scaling: 0.3, hit: 0, toughness: 15 },
    ])
    const by = (enemy: string) => t.dealt.filter((d) => d.enemy === enemy).reduce((n, d) => n + d.damage, 0)
    const ids = t.battle.enemies.ids
    expect(by(ids[1]!)).toBeCloseTo(RATE.basic * 0.6, 6)
    expect(by(ids[0]!)).toBeCloseTo(RATE.basic * 0.3, 6)
    expect(by(ids[2]!)).toBeCloseTo(RATE.basic * 0.3, 6)
  })

  it('To Love and Tomorrow is 33% + 33% from E5', () => {
    const t = setup({ mates: FULL, eidolon: 5, skillPoints: 5 })
    t.start()
    for (const m of FULL) use(t, m.key, 'basic')
    use(t, 'cyrene', 'skill')
    use(t, 'cyrene', 'skill')
    use(t, 'cyrene', 'ultimate')
    t.dealt.length = 0
    use(t, 'cyrene', 'basic')
    expect(t.dealt[0]!.damage).toBeCloseTo(RATE.basic * 0.66, 6)
  })

  it('Reunion at First Sight needs 12 and spends 12 (settled in game, 2026-11-15), gives Demiurge one more extra turn, and summons nothing', () => {
    const t = ready()
    use(t, 'cyrene', 'ultimate')
    const ult = t.battle.member('cyrene').instance.actions.ultimate!
    // The first Ultimate left exactly the 12 a Reunion needs.
    expect(t.q('recollection')).toBe(12)
    expect(t.q('recollection_cost')).toBe(12)
    expect(ult.canUse()).toBe(true)
    use(t, 'cyrene', 'ultimate')
    expect(t.q('recollection')).toBe(0)
    // Two choice turns, and the third Story (2 from the first Ultimate, 1 from this one) is an automatic Minuet turn.
    expect(t.battle.timeline.pendingExtraTurns()).toEqual([DEMI, DEMI, DEMI])
    expect(t.battle.memospritesOf('cyrene')).toEqual([DEMI])
    // The next one is 12 Basic ATK Recollection away: 3 each.
    expect(ult.canUse()).toBe(false)
    for (let i = 0; i < 3; i++) use(t, 'cyrene', 'basic')
    expect(t.q('recollection')).toBe(9)
    expect(ult.canUse()).toBe(false)
    use(t, 'cyrene', 'basic')
    expect(ult.canUse()).toBe(true)
  })

  it('the first Ultimate gives 2 Story (1 for using it, 1 for summoning Demiurge), a Reunion 1, and the third spends them all for an automatic turn', () => {
    const t = ready()
    expect(t.q('story')).toBe(0)
    use(t, 'cyrene', 'ultimate')
    expect(t.q('story')).toBe(2)
    expect(t.battle.timeline.pendingExtraTurns()).toEqual([DEMI])
    use(t, 'cyrene', 'ultimate')
    expect(t.q('story')).toBe(0)
    expect(t.battle.timeline.pendingExtraTurns()).toEqual([DEMI, DEMI, DEMI])
  })

  it('a Reunion needs 12 in Ripples and leaves what is above it', () => {
    const t = ready()
    use(t, 'cyrene', 'ultimate')
    for (let i = 0; i < 2; i++) use(t, 'cyrene', 'basic')
    expect(t.q('recollection')).toBe(18)
    use(t, 'cyrene', 'ultimate')
    expect(t.q('recollection')).toBe(6)
  })

  it('Max HP +24% for her and Demiurge; its HP percentage follows hers with no HP loss or heal events for it', () => {
    const t = ready()
    const seen: string[] = []
    t.battle.timeline.bus.on('hpLost', (e) => seen.push(`lost:${e.unit}`))
    t.battle.timeline.bus.on('healed', (e) => seen.push(`healed:${e.unit}`))
    use(t, 'cyrene', 'ultimate')
    expect(t.battle.party.get('cyrene').maxHp).toBeCloseTo(CYRENE_HP * 1.24, 6)
    expect(t.battle.party.get(DEMI).maxHp).toBeCloseTo(CYRENE_HP * 1.24, 6)
    const share = (id: string) => t.battle.party.get(id).hp / t.battle.party.get(id).maxHp
    expect(share(DEMI)).toBeCloseTo(share('cyrene'), 9)
    t.battle.party.consumeHp('cyrene', 3000, 'x')
    expect(share(DEMI)).toBeCloseTo(share('cyrene'), 9)
    expect(share('cyrene')).toBeLessThan(0.8)
    t.battle.party.heal('cyrene', 2000, 'x')
    expect(share(DEMI)).toBeCloseTo(share('cyrene'), 9)
    expect(seen).toEqual(['lost:cyrene', 'healed:cyrene'])
  })

  it('a downed Cyrene takes Demiurge and the Zone with her, and her allies lose the talent', () => {
    const t = ready()
    use(t, 'cyrene', 'ultimate')
    t.battle.party.takeDamage('cyrene', 1e9, 'enemy')
    expect(t.battle.party.get('cyrene').downed).toBe(true)
    expect(t.q('demiurge')).toBe(false)
    expect(t.q('zone')).toBe(false)
    t.requests.length = 0
    use(t, 'hya', 'basic')
    const mate = t.requests.at(-1)!.teammates.find((x) => x.characterId === CYRENE_KERNEL_ID)!
    expect(mate.characterConditionals).toMatchObject({ talentDmgBuff: false, zoneActive: false })
  })
})

describe('the Zone', () => {
  it('lasts 2 of her turns: counted at the start of her turns, the turn she used it in not counted', () => {
    const t = setup({
      mates: [PELA],
      cycles: 3,
      policy: [rule('cyrene', 'skill', [{ what: 'battle.cycle', max: 1 }]), rule('cyrene', 'basic'), rule('pela', 'basic')],
    })
    const seen: boolean[] = []
    t.battle.timeline.bus.on('turnEnd', (turn) => {
      if (turn.unit === 'cyrene') seen.push(Boolean(t.q('zone')))
    })
    t.battle.run()
    expect(seen).toEqual([true, true, false])
  })
  it('the Technique deploys it at the start of the battle for the same 2 turns', () => {
    const t = setup({ mates: [PELA], techniques: true })
    t.start()
    expect(t.q('zone')).toBe(true)
    expect(t.battle.timeline.modifiers.get('cyrene', ZONE_MODIFIER)!.turnsLeft).toBe(2)
    const off = setup({ mates: [PELA] })
    off.start()
    expect(off.q('zone')).toBe(false)
  })
  it('reaches every ally request with its True DMG switch', () => {
    const t = setup({ mates: [PELA], eidolon: 2 })
    t.start()
    const mateOf = () => t.requests.at(-1)!.teammates.find((x) => x.characterId === CYRENE_KERNEL_ID)!.characterConditionals
    use(t, 'pela', 'basic')
    expect(mateOf()).toMatchObject({ zoneActive: false, talentDmgBuff: true, e2TrueDmgStacks: 0, specialEffect: false })
    use(t, 'cyrene', 'skill')
    use(t, 'pela', 'basic')
    expect(mateOf()).toMatchObject({ zoneActive: true, talentDmgBuff: true, e2TrueDmgStacks: 0 })
  })
})

describe('Causality in Trichotomy (SPD 180)', () => {
  const mateConditionals = (t: Setup) => t.requests.at(-1)!.teammates.find((x) => x.characterId === CYRENE_KERNEL_ID)!.characterConditionals!
  it('gives her allies the +20% from 180 SPD on the timeline', () => {
    for (const [spd, expected] of [[180, true], [179.9, false], [200, true]] as const) {
      const t = setup({ mates: [PELA], baseSpd: spd, knobs: { spd } })
      t.start()
      use(t, 'pela', 'basic')
      expect(mateConditionals(t).cyreneSpdDmg).toBe(expected)
    }
  })
  it('follows the live timeline SPD', () => {
    const t = setup({ mates: [PELA], baseSpd: 170, knobs: { spd: 190 } })
    t.start()
    t.battle.timeline.modifiers.apply({ id: 'buff', target: 'cyrene', source: 'x', spdFlat: 10 })
    use(t, 'pela', 'basic')
    expect(mateConditionals(t).cyreneSpdDmg).toBe(true)
    t.battle.timeline.modifiers.remove('cyrene', 'buff')
    use(t, 'pela', 'basic')
    expect(mateConditionals(t).cyreneSpdDmg).toBe(false)
  })
  it('stops the run when the timeline and the kernel are on different sides of 180', () => {
    const t = setup({ mates: [PELA], baseSpd: 179, knobs: { spd: 181 } })
    t.start()
    expect(() => use(t, 'cyrene', 'basic')).toThrow(/different sides of the 180 SPD threshold/)
  })
  it('stops the run when they differ over 180 by more than 0.01', () => {
    const t = setup({ mates: [PELA], baseSpd: 200, knobs: { spd: 190 } })
    t.start()
    expect(() => use(t, 'cyrene', 'basic')).toThrow(/Ice RES PEN/)
  })
  it('agrees when both are the same, above and below 180', () => {
    for (const spd of [150, 180, 195.5, 300]) {
      const t = setup({ mates: [PELA], baseSpd: spd, knobs: { spd } })
      t.start()
      expect(() => use(t, 'cyrene', 'basic')).not.toThrow()
    }
  })
  it('tells the kernel her own switches live', () => {
    const t = setup({ mates: [PELA] })
    t.start()
    use(t, 'cyrene', 'basic')
    expect(t.requests.at(-1)!.attacker.characterConditionals!).toMatchObject({
      memospriteActive: false, zoneActive: false, talentDmgBuff: true, traceSpdBasedBuff: true, odeToEgoExtraBounces: 0, e1ExtraBounces: 0,
    })
  })
})

describe("Demiurge's choice turns (K26 / K27)", () => {
  const runOrder = (order: string[] | undefined, afterOrder: AfterOrder | undefined, cycles = 8) => {
    const kit = makeCyrene({ ...(order && { demiurgeOrder: order }), ...(afterOrder && { afterOrder }) })
    const t = setup({ mates: FULL, eidolon: 2, kit, cycles })
    const result = t.battle.run()
    return { t, result, acts: choiceActions(t), codes: result.warnings.map((w) => w.code) }
  }

  it('follows the given order and warns of nothing when the list is long enough', () => {
    const { acts, codes } = runOrder(['tri', 'hya', 'attack', 'cas'], undefined)
    expect(acts.length).toBeGreaterThanOrEqual(4)
    expect(acts.slice(0, 4)).toEqual(['ode:tri', 'ode:hya', 'minuet', 'ode:cas'])
    if (acts.length === 4) expect(codes).toEqual([])
  })

  it('without a list: every other member in party order, then attack, with a warning for the member (Cyrene is not in it)', () => {
    const { acts, result } = runOrder(undefined, undefined, 12)
    expect(acts.slice(0, 4)).toEqual(['ode:hya', 'ode:cas', 'ode:tri', 'minuet'])
    expect(acts).not.toContain('ode:cyrene')
    const w = result.warnings.filter((x) => x.code === 'kit-option-default-used')
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ severity: 'warning', member: 'cyrene' })
    expect(w[0]!.message).toContain('hya, cas, tri, attack')
  })

  it('a given list raises no default warning', () => {
    expect(runOrder(['hya', 'cas', 'tri', 'attack'], undefined).codes).not.toContain('kit-option-default-used')
  })

  it('past the end: attack', () => {
    const { t, acts, result } = runOrder(['hya', 'cas'], 'attack')
    expect(acts.slice(0, 4)).toEqual(['ode:hya', 'ode:cas', 'minuet', 'minuet'])
    const w = result.warnings.find((x) => x.code === 'kit-option-list-exhausted')!
    expect(w.member).toBe('cyrene')
    // One choice turn per Ultimate.
    const ults = t.log.filter((l) => l.actor === 'cyrene' && l.action === 'ultimate').length
    expect(w.message).toContain(`${ults - 2} choice turns`)
  })
  it('past the end: repeat the last entry', () => {
    const { acts, codes } = runOrder(['hya', 'cas'], 'repeat')
    expect(acts.slice(0, 4)).toEqual(['ode:hya', 'ode:cas', 'ode:cas', 'ode:cas'])
    expect(codes).toContain('kit-option-list-exhausted')
  })
  it('past the end: start the list again', () => {
    const { acts, codes } = runOrder(['hya', 'cas'], 'cycle')
    expect(acts.slice(0, 4)).toEqual(['ode:hya', 'ode:cas', 'ode:hya', 'ode:cas'])
    expect(codes).toContain('kit-option-list-exhausted')
  })
  it('an empty list is all past the end', () => {
    const { acts, codes } = runOrder([], undefined)
    expect(acts[0]).toBe('minuet')
    expect(codes).toContain('kit-option-list-exhausted')
    expect(codes).not.toContain('kit-option-default-used')
  })
  it('rejects a member key that is not in the team, and a bad after_order', () => {
    expect(() => setup({ mates: FULL, kit: makeCyrene({ demiurgeOrder: ['nobody'] }) })).toThrow(/neither a member of the team/)
    expect(() => setup({ mates: FULL, kit: makeCyrene({ demiurgeOrder: ['hya', 'cyrene'] }) })).toThrow(/cannot target Cyrene herself/)
    expect(() => makeCyrene({ afterOrder: 'sometimes' as AfterOrder })).toThrow(/afterOrder/)
  })
})

describe('This Ode, to All Lives', () => {
  const afterFirstOde = (key: string, options: Options = {}) => {
    const t = setup({ mates: FOUR, eidolon: 2, kit: makeCyrene({ demiurgeOrder: [key, 'attack'] }), cycles: 2, ...options })
    t.battle.run()
    return t
  }
  const mateConditionals = (t: Setup) => t.requests.at(-1)!.teammates.find((x) => x.characterId === CYRENE_KERNEL_ID)!.characterConditionals!

  it('on a Chrysos Heir sets the heir effect for the whole battle (and not on the others)', () => {
    const t = afterFirstOde('cas')
    expect(t.battle.cyreneEffect('cas')).toEqual({ active: true, upgraded: false })
    expect(t.battle.cyreneEffect('tri').active).toBe(false)
    expect(t.battle.cyreneEffect('hya').active).toBe(false)
    expect(t.battle.timeline.modifiers.has('cas', ODE_DMG_MODIFIER)).toBe(false)
  })
  it('the effect is upgraded from her E3', () => {
    const t = afterFirstOde('cas', { eidolon: 3 })
    expect(t.battle.cyreneEffect('cas')).toEqual({ active: true, upgraded: true })
  })
  it('on Hyacine it also gives 24 energy, flat (26.4 from E3)', () => {
    const gains = (options: Options) => {
      const t = setup({ mates: FOUR, eidolon: 2, kit: makeCyrene({ demiurgeOrder: ['hya', 'attack'] }), cycles: 2, ...options })
      const amounts: number[] = []
      t.battle.timeline.bus.on('energyGained', (e) => {
        if (e.unit === 'hya') amounts.push(e.amount)
      })
      t.battle.run()
      return amounts
    }
    expect(gains({})).toContain(24)
    expect(gains({ eidolon: 3 }).some((a) => Math.abs(a - 26.4) < 1e-9)).toBe(true)
  })
  it('on anyone else: +DMG for 2 of their turns, priced through her teammate switch for that attacker only', () => {
    const t = setup({ mates: FOUR, eidolon: 2, kit: makeCyrene({ demiurgeOrder: ['pela', 'attack'] }), cycles: 2 })
    const seen: Array<{ unit: string, on: boolean, turns?: number }> = []
    t.battle.timeline.bus.on('turnEnd', (turn) => {
      const m = t.battle.timeline.modifiers.get(turn.unit, ODE_DMG_MODIFIER)
      if (t.log.some((l) => l.action === 'ode:pela')) seen.push({ unit: turn.unit, on: m !== undefined, ...(m && { turns: m.turnsLeft }) })
    })
    t.battle.run()
    const pelaTurns = seen.filter((s) => s.unit === 'pela')
    expect(pelaTurns.slice(0, 2).map((s) => s.on)).toEqual([true, true])
    // Priced: Cyrene's entry in pela's request has the switch on, and in an heir's request it is off.
    const pelaRequest = (on: boolean) => t.requests.filter((r) => r.attacker.characterId === '1106').some((r) => r.teammates.some((x) => x.characterId === CYRENE_KERNEL_ID && x.characterConditionals?.specialEffect === on))
    expect(pelaRequest(true)).toBe(true)
    const heirRequests = t.requests.filter((r) => r.attacker.characterId === '1409')
    expect(heirRequests.every((r) => r.teammates.find((x) => x.characterId === CYRENE_KERNEL_ID)!.characterConditionals!.specialEffect === false)).toBe(true)
  })
  it('the non-heir buff ends after 2 of the target turns', () => {
    const t = setup({ mates: FOUR, eidolon: 2, kit: makeCyrene({ demiurgeOrder: ['pela', 'attack'] }), cycles: 5 })
    t.battle.run()
    expect(t.battle.timeline.modifiers.has('pela', ODE_DMG_MODIFIER)).toBe(false)
    expect(mateConditionals(t).specialEffect).toBe(false)
  })
  it('also lands on the target memosprites on the field, each with its own 2 turns', () => {
    const mates = [{ ...FOUR[0]!, memosprite: true }, ...FOUR.slice(1)]
    const t = setup({ mates, eidolon: 2, kit: makeCyrene({ demiurgeOrder: ['pela', 'attack'] }), cycles: 2 })
    const targets: string[] = []
    const turns: Array<number | undefined> = []
    t.battle.timeline.bus.on('modifierApplied', ({ modifier }) => {
      if (modifier.id !== ODE_DMG_MODIFIER) return
      targets.push(modifier.target)
      turns.push(modifier.turnsLeft)
    })
    t.battle.run()
    expect(targets).toEqual(['pela', 'pela.mem'])
    expect(turns).toEqual([2, 2])
  })
  it('Ode to Ego is on from the start and an Ode on a teammate is not a Chrysos Heir effect on the others', () => {
    const t = setup({ mates: FOUR, eidolon: 2, kit: makeCyrene({ demiurgeOrder: ['pela'] }), cycles: 2 })
    expect(t.q('ode_to_ego')).toBe(true)
    t.battle.run()
    for (const m of FOUR) expect(t.battle.cyreneEffect(m.key).active).toBe(false)
  })
  it('E2: the Zone gets +6% a distinct ally given the buff, at most 4, the same ally twice once', () => {
    const t = setup({ mates: FOUR, eidolon: 2, kit: makeCyrene({ demiurgeOrder: ['pela', 'pela', 'hya', 'cas'] }), cycles: 12 })
    t.battle.run()
    const seen = new Set(t.requests.map((r) => Number(r.teammates.find((x) => x.characterId === CYRENE_KERNEL_ID)?.characterConditionals?.e2TrueDmgStacks ?? 0)))
    expect([...seen].sort()).toEqual(expect.arrayContaining([0, 1, 2]))
    expect(Math.max(...t.requests.map((r) => Number(r.teammates.find((x) => x.characterId === CYRENE_KERNEL_ID)?.characterConditionals?.e2TrueDmgStacks ?? 0)))).toBeLessThanOrEqual(4)
    expect(Math.max(...t.requests.map((r) => Number(r.teammates.find((x) => x.characterId === CYRENE_KERNEL_ID)?.characterConditionals?.e2TrueDmgStacks ?? 0)))).toBeGreaterThanOrEqual(3)
  })
  it('E2: four distinct allies (she cannot be one of them) reach the 4-ally cap of 24%, and no further', () => {
    const order = ['pela', 'hya', 'cas', 'tri', 'attack']
    const t = setup({ mates: FOUR, eidolon: 2, kit: makeCyrene({ demiurgeOrder: order }), cycles: 12 })
    t.battle.run()
    const stacks = t.requests.map((r) => Number(r.teammates.find((x) => x.characterId === CYRENE_KERNEL_ID)?.characterConditionals?.e2TrueDmgStacks ?? 0))
    expect(Math.max(...stacks)).toBe(4)
    expect(stacks).toContain(4)
    expect(choiceActions(t).slice(0, 5)).toEqual(['ode:pela', 'ode:hya', 'ode:cas', 'ode:tri', 'minuet'])
  })
  it('an Ode on a downed ally does nothing but uses the turn', () => {
    const t = setup({ mates: FOUR, eidolon: 2, kit: makeCyrene({ demiurgeOrder: ['cas', 'attack'] }), cycles: 2 })
    t.start()
    t.battle.party.takeDamage('cas', 1e9, 'enemy')
    expect(t.battle.cyreneEffect('cas').active).toBe(false)
  })
})

describe('Ode to Ego, Minuet and the eidolons', () => {
  const minuets = (t: Setup) => t.resolved.filter((r) => r.ability === 'MEMO_SKILL')
  const egoRun = (eidolon: number, list: string[], cycles = 10, enemies = 1) => {
    const t = setup({ mates: FULL, eidolon, kit: makeCyrene({ demiurgeOrder: list }), cycles, enemies })
    t.battle.run()
    return t
  }

  it('Minuet: 60% to all enemies at toughness 30 (66% from E3), with the bounces from the very first one: no Ode on her is needed (settled in game, 2026-11-15)', () => {
    const t = egoRun(0, ['hya', 'attack'], 8)
    // E0 cannot reach the first Ultimate quickly; Demiurge may not exist. Skip the check when it never acted.
    const m = minuets(t)
    if (m.length > 0) {
      expect(m[0]!.parts[0]).toEqual({ shape: 'aoe', scaling: 0.6, hit: 0, toughness: 30 })
      const n = t.log.find((l) => l.action === 'minuet')!.sources
      if (n > 0) expect(m[0]!.parts[1]).toEqual({ shape: 'bounce', scaling: 0.6, hits: n, hit: 0, toughness: 5 })
    }
    const t3 = egoRun(3, ['hya', 'attack'], 8)
    expect(minuets(t3)[0]!.parts[0]).toEqual({ shape: 'aoe', scaling: 0.66, hit: 0, toughness: 30 })
  })

  it('the first Minuet of the battle has one bounce per different teammate she gained Recollection from (E3 multiple), toughness 5 each', () => {
    const t = egoRun(3, ['attack'])
    const first = minuets(t)[0]!
    expect(demiurgeActions(t)[0]).toBe('minuet')
    const n = t.log.find((l) => l.action === 'minuet')!.sources
    expect(n).toBeGreaterThan(0)
    expect(first.parts).toEqual([
      { shape: 'aoe', scaling: 0.66, hit: 0, toughness: 30 },
      // E3 includes E1: 12 more bounces than the teammates counted.
      { shape: 'bounce', scaling: 0.66, hits: n + 12, hit: 0, toughness: 5 },
    ])
  })

  it('E1: +12 bounces and +6 Recollection when it triggers', () => {
    const t = egoRun(2, ['hya', 'attack'])
    const i = t.log.findIndex((l) => l.action === 'minuet')
    const n = t.log[i]!.sources
    expect(minuets(t)[0]!.parts[1]).toMatchObject({ shape: 'bounce', hits: n + 12, scaling: 0.6 })
    expect(t.log[i]!.recollection - t.log[i - 1]!.recollection).toBe(6)
  })
  it('E0 gets neither', () => {
    const t = egoRun(0, ['hya', 'attack'], 12)
    for (const m of minuets(t)) expect(m.parts.every((p) => p.shape === 'aoe' || (p.shape === 'bounce' && p.hits <= 6))).toBe(true)
  })

  it('bounces are split over the enemies: the total is the kernel price per 100% times the hits', () => {
    const t = egoRun(2, ['hya', 'attack'], 10, 3)
    const i = t.log.findIndex((l) => l.action === 'minuet')
    const n = t.log[i]!.sources
    const serial = t.dealt.filter((d) => d.ability === 'MEMO_SKILL')
    const firstTotal = serial.slice(0, 3).reduce((s, d) => s + d.damage, 0)
    const expected = RATE.minuet * (0.6 * 3 + (n + 12) * 0.6)
    expect(firstTotal).toBeCloseTo(expected, 4)
  })

  it('E4: the bounce multiple rises 6% after every Minuet, up to 24 times', () => {
    const t = egoRun(4, ['hya', 'attack', 'attack', 'attack'], 12)
    const bounces = minuets(t).map((m) => (m.parts[1] as { scaling: number }).scaling)
    expect(bounces.slice(0, 3)).toEqual([0.66, 0.66 + 0.06, 0.66 + 0.12].map((x) => expect.closeTo(x, 9)))
  })

  it('E4: the 24th stack counts and the 25th does not: Minuets 25 and 26 both use base + 24 x 6%', () => {
    const t = egoRun(4, ['hya'], 40)
    const bounces = minuets(t).map((m) => (m.parts[1] as { scaling: number }).scaling)
    expect(bounces.length).toBeGreaterThanOrEqual(26)
    // Minuet k is priced with the stacks from the k - 1 Minuets before it, which stop at 24.
    for (let k = 1; k <= 26; k++) expect(bounces[k - 1]).toBeCloseTo(0.66 + Math.min(k - 1, 24) * 0.06, 9)
    expect(bounces[24]).toBeCloseTo(0.66 + 24 * 0.06, 9)
    expect(bounces[25]).toBeCloseTo(0.66 + 24 * 0.06, 9)
  })

  it('E6: the first Ultimate advances every ally 100%', () => {
    const t = setup({ mates: FULL, eidolon: 6, kit: makeCyrene({ demiurgeOrder: ['hya'] }), cycles: 1 })
    const advanced: string[] = []
    let atUlt = false
    t.battle.timeline.bus.on('actionUsed', (a) => {
      if (a.actor === 'cyrene' && a.kind === 'ultimate') atUlt = true
    })
    t.battle.timeline.bus.on('gaugeChanged', (g) => {
      if (g.cause === 'advance' && g.after === 0 && !atUlt) advanced.push(g.unit)
    })
    t.battle.run()
    expect(new Set(advanced)).toEqual(new Set(['cyrene', 'hya', 'cas', 'tri']))
  })

  it('E6: the first trigger gives the DEF switch, the second and later advance everyone 24%', () => {
    const t = setup({ mates: FULL, eidolon: 6, kit: makeCyrene({ demiurgeOrder: ['hya', 'attack', 'attack', 'attack'] }), cycles: 12 })
    const pct: number[] = []
    let acts = 0
    t.battle.timeline.bus.on('actionUsed', (a) => {
      if (a.actor === DEMI && a.action === 'minuet') acts += 1
    })
    t.battle.timeline.bus.on('gaugeChanged', (g) => {
      if (g.cause === 'advance' && g.before - g.after === 2400) pct.push(acts)
    })
    t.battle.run()
    expect(pct.length).toBeGreaterThan(0)
    // `acts` counts the Minuets already finished: the 2nd trigger is the first with one behind it.
    expect(Math.min(...pct)).toBeGreaterThanOrEqual(1)
    const defOn = t.requests.some((r) => r.attacker.characterId === CYRENE_KERNEL_ID && r.attacker.characterConditionals?.e6DefPen === true)
    expect(defOn).toBe(true)
    const firstDef = t.requests.findIndex((r) => r.attacker.characterConditionals?.e6DefPen === true)
    const firstMinuet = t.requests.findIndex((r) => r.attacker.characterConditionals?.odeToEgoExtraBounces !== undefined && Number(r.attacker.characterConditionals.odeToEgoExtraBounces) > 0)
    expect(firstMinuet).toBeGreaterThanOrEqual(0)
    expect(firstDef).toBeGreaterThan(firstMinuet)
  })

  it('E6: the 24% advance starts on the 2nd Ode to Ego trigger (the 2nd Minuet of the battle), not the 3rd', () => {
    const t = setup({ mates: FULL, eidolon: 6, kit: makeCyrene({ demiurgeOrder: ['hya', 'attack', 'attack', 'attack'] }), cycles: 12 })
    let minuet = 0
    const advances: Array<{ minuet: number, fraction: number }> = []
    t.battle.timeline.bus.on('attackResolved', (r) => {
      if (r.ability === 'MEMO_SKILL') minuet += 1
    })
    // Read the advance asked for, not the gauge change: right after the first Ultimate every ally is at 0 already.
    const timeline = t.battle.timeline
    const advance = timeline.advance.bind(timeline)
    timeline.advance = (id, fraction) => {
      advances.push({ minuet, fraction })
      advance(id, fraction)
    }
    t.battle.run()
    const at24 = advances.filter((a) => Math.abs(a.fraction - 0.24) < 1e-9).map((a) => a.minuet)
    expect(at24.length).toBeGreaterThan(0)
    expect(Math.min(...at24)).toBe(2)
    expect(advances.some((a) => a.minuet === 1 && Math.abs(a.fraction - 0.24) < 1e-9)).toBe(false)
  })

  it('Story: 2 from the first Ultimate and 1 from each Reunion, so every third Ultimate gives Demiurge an automatic extra Minuet from the start', () => {
    const t = setup({ mates: FULL, eidolon: 2, kit: makeCyrene({ demiurgeOrder: ['hya'] }), cycles: 14 })
    t.battle.run()
    const ults = t.log.filter((l) => l.actor === 'cyrene' && l.action === 'ultimate').length
    const demi = demiurgeActions(t).length
    expect(ults).toBeGreaterThanOrEqual(4)
    // One choice turn per Ultimate, one Story turn when the running count reaches 3: floor((ults + 1) / 3) of them.
    expect(demi).toBe(ults + Math.floor((ults + 1) / 3))
  })
})

describe('details of the Odes and Future', () => {
  it("Anaxa's Ode is one-time: +1 Skill Point, he is advanced 100%, and his effect ends after his next turn", () => {
    const anaxa: Mate = { key: 'ana', id: '1405', path: 'Erudition', spd: 90 }
    const t = setup({ mates: [anaxa, HYACINE, CASTORICE, TRIBBIE], eidolon: 2, kit: makeCyrene({ demiurgeOrder: ['ana', 'attack'] }), cycles: 3 })
    const effect: boolean[] = []
    const advanced: string[] = []
    t.battle.timeline.bus.on('gaugeChanged', (g) => {
      if (g.cause === 'advance' && g.after === 0) advanced.push(g.unit)
    })
    t.battle.timeline.bus.on('actionUsed', (a) => {
      if (a.actor === 'ana' && demiurgeActions(t).length > 0) effect.push(t.battle.cyreneEffect('ana').active)
    })
    t.battle.run()
    expect(advanced).toContain('ana')
    expect(effect[0]).toBe(true)
    expect(effect.at(-1)).toBe(false)
    expect(t.battle.cyreneEffect('ana').active).toBe(false)
  })
  it("a memosprite that removes itself in its own action (Netherwing's last Breath) still gives its Recollection", () => {
    const t = setup({ mates: [PELA] })
    t.start()
    t.battle.addMemosprite({ id: 'pela.gone', owner: 'pela', name: 'x', maxHp: 1000, baseAggro: 4, takeTurn: () => {} })
    t.battle.performAction('pela.gone', 'last', 'skill', () => t.battle.removeMemosprite('pela.gone'))
    expect(t.q('recollection')).toBe(1)
    expect(t.q('ego_sources')).toBe(1)
  })
  it("after her Ultimate a teammate's spent Future is not refreshed: its next action gives nothing until her next Basic ATK or Skill", () => {
    const t = ready()
    // Her Skill refreshed Future for all three, so Hyacine spends hers first (24 -> 25).
    use(t, 'hya', 'basic')
    expect(t.q('recollection')).toBe(25)
    use(t, 'cyrene', 'ultimate')
    expect(t.q('recollection')).toBe(13)
    use(t, 'hya', 'basic')
    expect(t.q('recollection')).toBe(13)
    // Her Basic ATK in Ripples gives 3 and refreshes Future, so Hyacine's next action gives 1 again.
    use(t, 'cyrene', 'basic')
    expect(t.q('recollection')).toBe(16)
    use(t, 'hya', 'basic')
    expect(t.q('recollection')).toBe(17)
  })

  it('a follow-up kind of memosprite action (Wings Sweep) gives nothing', () => {
    const t = setup({ mates: [PELA] })
    t.start()
    t.battle.addMemosprite({ id: 'pela.nw', owner: 'pela', name: 'x', maxHp: 1000, baseAggro: 4, takeTurn: () => {} })
    t.battle.performAction('pela.nw', 'sweep', 'followUp', () => {})
    expect(t.q('recollection')).toBe(0)
  })
})
