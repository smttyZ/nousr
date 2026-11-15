import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { BattleSetup, MemberSetup } from '../battle/battle'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Rule } from '../scenario/types'
import { FuXuan, fuXuanScalings, MATRIX_MODIFIER } from './fuXuan'
import type { Kit } from './kit'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
/** Her Max HP as the fake kernel reports it, before her own Knowledge; with it, 6% (or 6.6% at E3) more. */
const HP = 8000
const FX_MAX_HP = 10_000
const ALLY_MAX_HP = 5000

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

/** 1,000 damage per 100% on Fu Xuan's hits; her in-combat Max HP is 8000, and 6% more while her own Knowledge is on. */
function makeKernel(requests: DamageRequest[] = []): DamageKernel {
  return {
    actionDamage(request) {
      requests.push(request)
      if (request.attacker.characterId !== '1208') return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] })
      const s = fuXuanScalings(request.attacker.eidolon)
      const knowledge = request.attacker.characterConditionals?.skillActive === true
      const e6 = request.attacker.eidolon >= 6 ? 2 * Number(request.attacker.characterConditionals?.e6TeamHpLostPercent ?? 1.2) : 0
      return fakeResult(
        { BASIC: [{ damage: 1000 * s.basic, scaling: s.basic }], ULT: [{ damage: 1000 * (s.ult + e6), scaling: s.ult + e6 }] },
        { ATK: 0, DEF: 0, HP: knowledge ? HP * (1 + s.knowledgeHp) : HP, SPD: 0, CR: 0, CD: 0, EHR: 0, RES: 0, BE: 0, ERR: 0, OHB: 0 },
      )
    },
  }
}

const fx = (eidolon = 0, baseSpd = 100): MemberSetup => ({
  key: 'fx',
  kit: FuXuan,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: FX_MAX_HP, def: 1000, baseSpd },
  kernel: { unit: { characterId: '1208', lightConeId: '21016', eidolon, superimposition: 1 }, build: noBuild },
})

const ally = (key: string, baseSpd = 100): MemberSetup => ({
  key,
  kit: Ally,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: ALLY_MAX_HP, def: 1000, baseSpd },
  kernel: { unit: { characterId: 'ally', lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
})

const basicPolicy: Rule[] = [
  { unit: 'fx', use: 'basic', when: [] },
  { unit: 'dps', use: 'basic', when: [] },
  { unit: 'sup', use: 'basic', when: [] },
]

function setup(overrides: Partial<BattleSetup> & { eidolon?: number } = {}) {
  const { eidolon, ...rest } = overrides
  const requests: DamageRequest[] = []
  const battle = new Battle({
    members: [ally('dps'), fx(eidolon ?? 0), ally('sup')],
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
  const healed: EngineEvents['healed'][] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  battle.timeline.bus.on('healed', (e) => healed.push(e))
  const act = battle.member('fx').instance.actions
  const read = (name: string) => battle.member('fx').instance.quantities![name]!()
  const matrix = () => battle.timeline.modifiers.has('fx', MATRIX_MODIFIER)
  return { battle, dealt, healed, requests, act, read, matrix }
}

describe('Fu Xuan: ability numbers from the kit text', () => {
  it('multiples and Skill and Talent values by eidolon', () => {
    const e0 = fuXuanScalings(0)
    expect([e0.basic, e0.ult, e0.knowledgeHp, e0.knowledgeCritRate, e0.damageReduction, e0.restoreShare]).toEqual([0.5, 1.0, 0.06, 0.12, 0.18, 0.9])
    // E3: Skill and Talent +2 (Lv12). The Ultimate and Basic ATK are still Lv10 and Lv6.
    const e3 = fuXuanScalings(3)
    expect([e3.basic, e3.ult, e3.knowledgeHp, e3.knowledgeCritRate, e3.damageReduction, e3.restoreShare]).toEqual([0.5, 1.0, 0.066, 0.132, 0.196, 0.92])
    // E5: Ultimate +2 (108%) and Basic ATK +1 (55%).
    const e5 = fuXuanScalings(5)
    expect([e5.basic, e5.ult]).toEqual([0.55, 1.08])
  })

  it('declares the ability version it is written for (K13)', () => {
    expect(FuXuan.abilityVersions).toEqual([0])
  })
})

describe('Basic ATK and Ultimate', () => {
  it('Basic ATK: +20 energy, +1 Skill Point, 50% of her Max HP at hit 0, 30 toughness on the target', () => {
    const { battle, dealt, act } = setup()
    battle.spendSkillPoints(2)
    act.basic!.use()
    expect(battle.skillPoints).toBe(4)
    expect(battle.party.get('fx').energy).toBe(20)
    expect(dealt).toHaveLength(1)
    expect(dealt[0]!.scaling).toBeCloseTo(0.5, 12)
    expect(dealt[0]!.damage).toBeCloseTo(500, 9)
    expect(battle.enemies.toughness(battle.primary)).toBe(profile.toughness - 30)
  })

  it('E5 raises Basic ATK to 55% and the Ultimate to 108%', () => {
    const { battle, dealt, act } = setup({ eidolon: 5 })
    act.basic!.use()
    battle.party.setEnergy('fx', 135)
    act.ultimate!.use()
    expect(dealt.map((d) => d.scaling)).toEqual([0.55, 1.08])
  })

  it('Ultimate: costs 135, gives 5 energy back, hits every enemy for 100% with 60 toughness each, and needs full energy', () => {
    const { battle, dealt, act } = setup({ enemyCount: 3 })
    expect(act.ultimate!.canUse()).toBe(false)
    battle.party.setEnergy('fx', 135)
    expect(act.ultimate!.canUse()).toBe(true)
    act.ultimate!.use()
    expect(battle.party.get('fx').energy).toBe(5)
    expect(dealt.filter((d) => d.ability === 'ULT')).toHaveLength(3)
    for (const d of dealt) expect(d.scaling).toBeCloseTo(1, 12)
    for (const id of battle.enemies.ids) expect(battle.enemies.toughness(id)).toBe(profile.toughness - 60)
  })
})

describe('Skill and the Matrix of Prescience', () => {
  it('costs 1 Skill Point, gives 30 energy the first time and 50 (Taiyi) while the Matrix is up, and activates the Matrix', () => {
    const { battle, act, matrix } = setup()
    expect(matrix()).toBe(false)
    act.skill!.use()
    expect(battle.skillPoints).toBe(4)
    expect(battle.party.get('fx').energy).toBe(30)
    expect(matrix()).toBe(true)
    act.skill!.use()
    expect(battle.skillPoints).toBe(3)
    expect(battle.party.get('fx').energy).toBe(80)
  })

  it('lasts 3 turns of hers, counted at the start of each: up for the two turns after the cast, and she recasts on the third', () => {
    const { battle, matrix } = setup({
      policy: [{ unit: 'fx', use: 'skill', when: [{ what: 'fx.matrix', is: false }] }, ...basicPolicy],
      cycles: 8,
    })
    const log: string[] = []
    battle.timeline.bus.on('actionUsed', (a) => {
      if (a.actor === 'fx') log.push(`${a.action}:${matrix() ? 'up' : 'down'}`)
    })
    battle.run()
    expect(log.slice(0, 7)).toEqual(['skill:up', 'basic:up', 'basic:up', 'skill:up', 'basic:up', 'basic:up', 'skill:up'])
  })

  it('recasting while it is up refreshes it to 3 turns', () => {
    const { act, read } = setup()
    act.skill!.use()
    expect(read('matrix_turns_left')).toBe(3)
    act.skill!.use()
    expect(read('matrix_turns_left')).toBe(3)
  })

  it('the Technique starts the battle with the Matrix for 2 turns: up for her first turn, gone at the start of her second', () => {
    const { battle, matrix, read } = setup({ start: { energy: 0, skillPoints: 3, techniques: true }, cycles: 4 })
    const seen: Array<[boolean, number]> = []
    battle.timeline.bus.on('actionUsed', (a) => {
      if (a.actor === 'fx') seen.push([matrix(), read('matrix_turns_left') as number])
    })
    battle.run()
    expect(seen.slice(0, 2)).toEqual([[true, 1], [false, 0]])
  })
})

describe('the redirection and the Knowledge effect', () => {
  it('65% of the DMG an ally takes goes to her while the Matrix is up, and nothing before and after', () => {
    const { battle, act } = setup()
    battle.party.takeDamage('dps', 1000, 'enemy1')
    expect(battle.party.get('fx').hp).toBe(FX_MAX_HP)
    act.skill!.use()
    battle.party.takeDamage('dps', 1000, 'enemy1')
    expect(battle.party.get('fx').hp).toBeCloseTo(FX_MAX_HP - 650, 6)
    expect(battle.party.get('dps').hp).toBeCloseTo(ALLY_MAX_HP - 1000 - 350, 6)
    battle.timeline.modifiers.remove('fx', MATRIX_MODIFIER)
    const before = battle.party.get('fx').hp
    battle.party.takeDamage('dps', 1000, 'enemy1')
    expect(battle.party.get('fx').hp).toBe(before)
  })

  it('Knowledge raises every character\'s Max HP by 6% of her Max HP before her own Knowledge (6.6% at E3), herself included, and takes it off again', () => {
    for (const [eidolon, share] of [[0, 0.06], [3, 0.066]] as const) {
      const { battle, act } = setup({ eidolon })
      act.skill!.use()
      for (const key of ['dps', 'sup']) expect(battle.party.get(key).maxHp, `E${eidolon} ${key}`).toBeCloseTo(ALLY_MAX_HP + share * HP, 9)
      expect(battle.party.get('fx').maxHp).toBeCloseTo(FX_MAX_HP + share * HP, 9)
      battle.timeline.modifiers.remove('fx', MATRIX_MODIFIER)
      expect(battle.party.get('dps').maxHp).toBe(ALLY_MAX_HP)
      expect(battle.party.get('fx').maxHp).toBe(FX_MAX_HP)
    }
  })

  it('tells the kernel the live Matrix state: an ally gets skillActive and her Max HP, herself the switch only', () => {
    const { battle, requests, act } = setup()
    const price = (who: string) => {
      requests.length = 0
      battle.member(who).instance.actions.basic!.use()
      return requests.at(-1)!
    }
    const idle = price('dps').teammates.find((t) => t.characterId === '1208')!
    expect(idle.characterConditionals).toEqual({ skillActive: false, talentActive: true, teammateHPValue: 0 })
    act.skill!.use()
    const up = price('dps').teammates.find((t) => t.characterId === '1208')!
    expect(up.characterConditionals).toEqual({ skillActive: true, talentActive: true, teammateHPValue: HP })
    act.basic!.use()
    expect(requests.at(-1)!.attacker.characterConditionals).toMatchObject({ skillActive: true })
    // Recasting with the Matrix up still reads her Max HP with her own Knowledge switched off (8000, not 8480): the bonus stays 6% of 8000.
    act.skill!.use()
    expect(battle.party.get('dps').maxHp).toBeCloseTo(ALLY_MAX_HP + 0.06 * HP, 9)
  })

  it('is dispelled when she is knocked down, and so is the redirection and the Talent\'s reduction', () => {
    const { battle, act, matrix } = setup()
    act.skill!.use()
    expect(battle.party.damageTakenMultiplier('dps')).toBeCloseTo(0.82, 12)
    battle.party.takeDamage('fx', 1e9, 'enemy1')
    expect(battle.party.get('fx').downed).toBe(true)
    expect(matrix()).toBe(false)
    expect(battle.party.damageTakenMultiplier('dps')).toBe(1)
    expect(battle.party.damageTakenMultiplier('sup')).toBe(1)
    const hp = battle.party.get('dps').hp
    battle.party.takeDamage('dps', 100, 'enemy1')
    expect(battle.party.get('dps').hp).toBe(hp - 100)
    // The Max HP she gave is gone with the Matrix.
    expect(battle.party.get('dps').maxHp).toBe(ALLY_MAX_HP)
  })

})

describe('E2: a killing blow while the Matrix is up', () => {
  const prevented = (battle: Battle) => {
    const log: EngineEvents['knockdownPrevented'][] = []
    battle.timeline.bus.on('knockdownPrevented', (e) => log.push(e))
    return log
  }

  it('does not down the ally and restores it to 70% of its Max HP (Knowledge included), once per battle', () => {
    const { battle, act } = setup({ eidolon: 2 })
    act.skill!.use()
    // Without the redirect, so the blow lands on the ally itself (the redirect has its own test below).
    battle.party.removeRedirect('fuxuan.matrix')
    const log = prevented(battle)
    battle.party.takeDamage('dps', 1e9, 'enemy1')
    const dps = battle.party.get('dps')
    expect(dps.downed).toBe(false)
    expect(dps.maxHp).toBeCloseTo(ALLY_MAX_HP + 0.06 * HP, 9)
    expect(dps.hp).toBeCloseTo(0.7 * dps.maxHp, 9)
    expect(log).toEqual([{ unit: 'dps', hp: dps.hp, by: 'fuxuan.e2', source: 'enemy1' }])
    // The one charge is spent: the next killing blow (a later action) downs.
    battle.party.takeDamage('dps', 1e9, 'enemy1')
    expect(battle.party.get('dps').downed).toBe(true)
    expect(log).toHaveLength(1)
  })

  it('does nothing without the Matrix, and below E2', () => {
    const noMatrix = setup({ eidolon: 2 })
    noMatrix.battle.party.takeDamage('dps', 1e9, 'enemy1')
    expect(noMatrix.battle.party.get('dps').downed).toBe(true)
    const e1 = setup({ eidolon: 1 })
    e1.act.skill!.use()
    e1.battle.party.takeDamage('dps', 1e9, 'enemy1')
    expect(e1.battle.party.get('dps').downed).toBe(true)
  })

  it('a blow while the Matrix is down does not use the charge', () => {
    const { battle, act, matrix } = setup({ eidolon: 2 })
    act.skill!.use()
    battle.timeline.modifiers.remove('fx', MATRIX_MODIFIER)
    expect(matrix()).toBe(false)
    battle.party.takeDamage('dps', 1e9, 'enemy1')
    expect(battle.party.get('dps').downed).toBe(true)
    act.skill!.use()
    battle.party.removeRedirect('fuxuan.matrix')
    battle.party.takeDamage('sup', 1e9, 'enemy1')
    expect(battle.party.get('sup').downed).toBe(false)
  })

  it('saves every ally struck by a killing blow in the same action (one turn), and only that action', () => {
    const { battle, act } = setup({ eidolon: 2 })
    act.skill!.use()
    battle.timeline.step(() => {
      battle.party.takeDamage('dps', 1e9, 'enemy1')
      battle.party.takeDamage('sup', 1e9, 'enemy1')
    })
    expect(battle.party.get('dps').downed).toBe(false)
    expect(battle.party.get('sup').downed).toBe(false)
    expect(battle.party.get('sup').hp).toBeCloseTo(0.7 * battle.party.get('sup').maxHp, 9)
    battle.timeline.step(() => {
      battle.party.takeDamage('dps', 1e9, 'enemy1')
    })
    expect(battle.party.get('dps').downed).toBe(true)
  })

  it("the redirected share can strike Fu Xuan too: she and the ally are both saved in one action, and the Matrix stays up", () => {
    const { battle, act, matrix } = setup({ eidolon: 2 })
    act.skill!.use()
    battle.timeline.step(() => {
      battle.party.takeDamage('dps', 1e9, 'enemy1')
    })
    const fxState = battle.party.get('fx')
    expect(fxState.downed).toBe(false)
    expect(fxState.hp).toBeCloseTo(0.7 * fxState.maxHp, 9)
    expect(battle.party.get('dps').downed).toBe(false)
    expect(matrix()).toBe(true)
  })

  it('composes with the backup rule: a covered ally is held at 1 HP without using the charge; the backup is saved when its own HP runs out', () => {
    const { battle, act } = setup({ eidolon: 2 })
    act.skill!.use()
    // Turn the redirect off for this check so the blow reaches the covered ally itself.
    battle.party.removeRedirect('fuxuan.matrix')
    battle.addMemosprite({ id: 'dps.nw', owner: 'dps', name: 'netherwing', maxHp: 1000, baseAggro: 4, takeTurn: () => undefined })
    battle.party.addBackup({ id: 'netherwing', by: 'dps.nw', multiplier: 5 })
    const log = prevented(battle)
    battle.timeline.step(() => {
      battle.party.takeDamage('dps', 1e9, 'enemy1')
    })
    expect(battle.party.get('dps').hp).toBe(1)
    expect(battle.party.get('dps').downed).toBe(false)
    // The backup was asked for 5 x the excess and lost it all: the guard saved it, and that was the one charge.
    expect(log.map((l) => l.unit)).toEqual(['dps.nw'])
    expect(battle.party.get('dps.nw').downed).toBe(false)
    expect(battle.party.get('dps.nw').hp).toBeGreaterThan(0)
  })
})

describe('Misfortune Avoidance', () => {
  it('every ally, herself included, takes 18% less DMG from the start (19.6% at E3), with or without the Matrix', () => {
    for (const [eidolon, reduction] of [[0, 0.18], [3, 0.196]] as const) {
      const { battle } = setup({ eidolon })
      for (const key of ['dps', 'fx', 'sup']) expect(battle.party.damageTakenMultiplier(key), `E${eidolon} ${key}`).toBeCloseTo(1 - reduction, 12)
    }
  })

  it('a memosprite that joins later is covered too, and loses it when she is knocked down', () => {
    const { battle } = setup()
    battle.addMemosprite({ id: 'dps.m', owner: 'dps', name: 'test', maxHp: 1000, baseAggro: 4, takeTurn: () => undefined })
    expect(battle.party.damageTakenMultiplier('dps.m')).toBeCloseTo(0.82, 12)
    battle.party.takeDamage('fx', 1e9, 'enemy1')
    expect(battle.party.damageTakenMultiplier('dps.m')).toBe(1)
  })
})

describe('HP Restore', () => {
  it('at 50% or less she heals 90% of the HP she is missing (92% at E3), once per trigger count', () => {
    for (const [eidolon, share] of [[0, 0.9], [3, 0.92]] as const) {
      const { battle, healed } = setup({ eidolon })
      battle.party.takeDamage('fx', 4000, 'enemy1')
      expect(battle.party.get('fx').hp, `E${eidolon} above 50%`).toBe(6000)
      expect(healed).toHaveLength(0)
      battle.party.takeDamage('fx', 1000, 'enemy1')
      // 5000 left is exactly 50%: it triggers. Missing 5000, restores share of it.
      expect(healed).toHaveLength(1)
      expect(healed[0]).toMatchObject({ unit: 'fx', source: 'fx' })
      expect(healed[0]!.amount).toBeCloseTo(share * 5000, 9)
      expect(battle.party.get('fx').hp).toBeCloseTo(5000 + share * 5000, 9)
      // The one count is spent: dropping under 50% again does nothing.
      battle.party.takeDamage('fx', 9000, 'enemy1')
      expect(healed).toHaveLength(1)
    }
  })

  it('the Ultimate adds a trigger count, up to 2', () => {
    const { battle, act, healed, read } = setup()
    expect(read('restore_counts')).toBe(1)
    battle.party.setEnergy('fx', 135)
    act.ultimate!.use()
    expect(read('restore_counts')).toBe(2)
    battle.party.setEnergy('fx', 135)
    act.ultimate!.use()
    expect(read('restore_counts')).toBe(2)
    battle.party.takeDamage('fx', 5500, 'enemy1')
    expect(healed.filter((h) => h.unit === 'fx')).toHaveLength(1)
    expect(read('restore_counts')).toBe(1)
    battle.party.takeDamage('fx', 4500, 'enemy1')
    expect(healed.filter((h) => h.unit === 'fx')).toHaveLength(2)
    expect(read('restore_counts')).toBe(0)
  })

  it('does not trigger on a killing blow', () => {
    const { battle, healed } = setup()
    battle.party.takeDamage('fx', 1e9, 'enemy1')
    expect(battle.party.get('fx').downed).toBe(true)
    expect(healed).toHaveLength(0)
  })

  it('a count gained from the Ultimate while she is already under 50% waits for her next loss of HP', () => {
    const { battle, act, healed } = setup()
    battle.party.takeDamage('fx', 5500, 'enemy1')
    expect(healed).toHaveLength(1)
    battle.party.takeDamage('fx', 9000, 'enemy1')
    expect(battle.party.get('fx').hp).toBeLessThan(5000)
    battle.party.setEnergy('fx', 135)
    act.ultimate!.use()
    const hpAfterUlt = battle.party.get('fx').hp
    expect(healed.filter((h) => h.unit === 'fx')).toHaveLength(1)
    battle.party.takeDamage('fx', 100, 'enemy1')
    expect(healed.filter((h) => h.unit === 'fx')).toHaveLength(2)
    expect(battle.party.get('fx').hp).toBeGreaterThan(hpAfterUlt)
  })
})

describe('Dunjia: the Ultimate heals every other ally', () => {
  it('5% of her Max HP + 133 to each other ally, none to herself, credited to her (so a Warrior Goddess set sees it)', () => {
    const { battle, act, healed } = setup()
    battle.party.takeDamage('dps', 3000, 'enemy1')
    battle.party.takeDamage('sup', 100, 'enemy1')
    battle.party.setEnergy('fx', 135)
    act.ultimate!.use()
    const amount = 0.05 * HP + 133
    expect(healed.map((h) => h.unit).sort()).toEqual(['dps', 'sup'])
    for (const h of healed) {
      expect(h.source).toBe('fx')
      expect(h.amount + h.overheal).toBeCloseTo(amount, 9)
    }
    expect(healed.find((h) => h.unit === 'sup')!.amount).toBeCloseTo(100, 9)
    expect(battle.party.get('dps').hp).toBeCloseTo(ALLY_MAX_HP - 3000 + amount, 9)
  })
})

describe('E4: energy when another ally is attacked', () => {
  const hit = (battle: Battle, unit: string, hits: number) =>
    battle.timeline.bus.emit('allyHit', { unit, enemy: 'enemy1', attack: 'strike', hits, damage: 100 })

  it('5 energy per attack on another ally while the Matrix is up, from E4 only', () => {
    const e4 = setup({ eidolon: 4 })
    hit(e4.battle, 'dps', 1)
    expect(e4.battle.party.get('fx').energy).toBe(0)
    e4.act.skill!.use()
    const before = e4.battle.party.get('fx').energy
    hit(e4.battle, 'dps', 1)
    hit(e4.battle, 'sup', 0.5)
    hit(e4.battle, 'fx', 1)
    expect(e4.battle.party.get('fx').energy - before).toBeCloseTo(7.5, 9)

    const e3 = setup({ eidolon: 3 })
    e3.act.skill!.use()
    const base = e3.battle.party.get('fx').energy
    hit(e3.battle, 'dps', 1)
    expect(e3.battle.party.get('fx').energy).toBe(base)
  })
})

describe('E6: the tally of HP lost', () => {
  it('starts when the Matrix is first activated, and the Ultimate adds 200% of it as a share of her Max HP, capped at 120%', () => {
    const { battle, act, dealt, requests } = setup({ eidolon: 6 })
    // Before the Matrix: nothing counts.
    battle.party.takeDamage('dps', 1000, 'enemy1')
    act.skill!.use()
    expect(battle.member('fx').instance.quantities!.e6_tally_share!()).toBe(0)
    battle.party.takeDamage('dps', 1000, 'enemy1')
    // dps loses 350 after the redirection and the Talent's reduction is not in this direct call; fx loses 650.
    const lost = 350 + 650
    const share = lost / battle.party.get('fx').maxHp
    expect(battle.member('fx').instance.quantities!.e6_tally_share!()).toBeCloseTo(share, 9)
    battle.party.setEnergy('fx', 135)
    act.ultimate!.use()
    const ult = dealt.filter((d) => d.ability === 'ULT')[0]!
    // E6 is above E5, so the base is 108%.
    expect(ult.scaling).toBeCloseTo(1.08 + 2 * share, 9)
    expect(requests.some((r) => r.attacker.characterConditionals?.e6TeamHpLostPercent !== undefined)).toBe(true)
    // It resets after the Ultimate.
    expect(battle.member('fx').instance.quantities!.e6_tally_share!()).toBe(0)

    // Two big hits: the team loses more than 120% of her Max HP, and the tally stops at the cap.
    battle.party.takeDamage('dps', 7000, 'enemy1')
    battle.party.takeDamage('sup', 7000, 'enemy1')
    expect(battle.party.get('fx').downed).toBe(false)
    expect(battle.member('fx').instance.quantities!.e6_tally_share!()).toBeCloseTo(1.2, 9)
  })

  it('counts HP an ally spends and the HP she loses herself, and is not kept below E6', () => {
    const e6 = setup({ eidolon: 6 })
    e6.act.skill!.use()
    e6.battle.party.consumeHp('sup', 500)
    e6.battle.party.takeDamage('fx', 400, 'enemy1')
    const maxHp = e6.battle.party.get('fx').maxHp
    expect(e6.battle.member('fx').instance.quantities!.e6_tally_share!()).toBeCloseTo((500 + 400) / maxHp, 9)

    const e5 = setup({ eidolon: 5 })
    e5.act.skill!.use()
    e5.battle.party.takeDamage('fx', 400, 'enemy1')
    expect(e5.battle.member('fx').instance.quantities!.e6_tally_share!()).toBe(0)
  })
})

describe('what her kit tells the kernel about her own attacks', () => {
  it('her Basic ATK is priced with her own Knowledge only while the Matrix is up', () => {
    const { requests, act } = setup()
    act.basic!.use()
    expect(requests.at(-1)!.attacker.characterConditionals).toEqual({ skillActive: false, talentActive: true })
    act.skill!.use()
    requests.length = 0
    act.basic!.use()
    expect(requests.at(-1)!.attacker.characterConditionals).toEqual({ skillActive: true, talentActive: true })
  })
})
