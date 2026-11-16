import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { BLANK_MODIFIER, ThisLoveForever, VERSE_MODIFIER } from './thisLoveForever'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/** A wearer with a memosprite (no SPD) whose Memosprite Skill is either an attack or a buff on an ally, and one whose action is not a skill. */
const wearerKit: Kit = {
  characterId: 'wearer',
  path: 'Remembrance',
  element: 'Ice',
  maxEnergy: 0,
  create: (battle, self) => {
    const memo = `${self.key}.memo`
    const ensure = () => {
      if (!battle.isMemosprite(memo)) battle.addMemosprite({ id: memo, owner: self.key, name: 'x', maxHp: 1000, baseAggro: 4, takeTurn: () => {} })
    }
    const hit = () => battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
    return {
      actions: {
        basic: { kind: 'basic', canUse: () => true, use: () => battle.performAction(self.key, 'basic', 'basic', hit) },
        attackSkill: { kind: 'skill', canUse: () => true, use: () => { ensure(); battle.performAction(memo, 'attack', 'skill', hit) } },
        buffSkill: { kind: 'skill', canUse: () => true, use: () => { ensure(); battle.performAction(memo, 'buff', 'skill', () => {}) } },
        sweep: { kind: 'skill', canUse: () => true, use: () => { ensure(); battle.performAction(memo, 'sweep', 'followUp', hit) } },
        remove: { kind: 'skill', canUse: () => true, use: () => battle.removeMemosprite(memo) },
        ownBuff: { kind: 'skill', canUse: () => true, use: () => battle.performAction(self.key, 'own', 'skill', () => {}) },
      },
      attackerState: () => ({}),
      teammateState: () => ({}),
    }
  },
}
const mateKit: Kit = {
  characterId: 'mate',
  path: 'Hunt',
  element: 'Fire',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () => battle.performAction(self.key, 'basic', 'basic', () => battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
}

function setup(superimposition = 1) {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = {
    actionDamage(request) {
      requests.push(request)
      return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] })
    },
  }
  const wearer: MemberSetup = {
    key: 'w',
    kit: wearerKit,
    eidolon: 0,
    affinitiveEidolon: false,
    stats: { maxHp: 1000, def: 1000, baseSpd: 100 },
    kernel: { unit: { characterId: 'wearer', lightConeId: '23052', eidolon: 0, superimposition }, build: noBuild },
    equipment: { lightCone: ThisLoveForever, sets: [] },
  }
  const mate: MemberSetup = {
    key: 'm',
    kit: mateKit,
    eidolon: 0,
    affinitiveEidolon: false,
    stats: { maxHp: 1000, def: 1000, baseSpd: 90 },
    kernel: { unit: { characterId: 'mate', lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
  }
  const battle = new Battle({
    members: [wearer, mate],
    policy: [{ unit: 'w', use: 'basic', when: [] }, { unit: 'm', use: 'basic', when: [] }],
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0, skillPoints: 3, techniques: false },
    kernel,
  })
  const act = (who: string, action: string) => battle.member(who).instance.actions[action]!.use()
  /** What the module gives the wearer's own request and a teammate's request right now. */
  const state = () => {
    const module = battle.member('w').equipmentInstances[0]!
    const enemy = battle.primary
    return {
      own: module.attackerState!(enemy).lightConeConditionals,
      team: module.teammateState!(battle.member('m'), enemy).lightConeConditionals,
    }
  }
  /** The same through a real request, so the switches are known to reach the kernel. */
  const requested = () => {
    requests.length = 0
    act('m', 'basic')
    return requests.at(-1)!.teammates.find((x) => x.characterId === 'wearer')!.lightConeConditionals
  }
  return { battle, act, state, requested }
}

describe('This Love, Forever', () => {
  it('starts with neither effect', () => {
    const { state } = setup()
    expect(state()).toEqual({ own: { vulnerability: false, cdBoost: false }, team: { vulnerability: false, cdBoost: false } })
  })
  it('Blank: the memosprite uses a Memosprite Skill on an ally (it hits no enemy)', () => {
    const { act, state } = setup()
    act('w', 'buffSkill')
    expect(state()).toEqual({ own: { vulnerability: true, cdBoost: false }, team: { vulnerability: true, cdBoost: false } })
  })
  it('Verse: the memosprite uses a Memosprite Skill on enemies', () => {
    const { act, state } = setup()
    act('w', 'attackSkill')
    expect(state()).toEqual({ own: { vulnerability: false, cdBoost: true }, team: { vulnerability: false, cdBoost: true } })
  })
  it('both together are both switches on (Fribbels raises them by the "both" share itself)', () => {
    const { act, state } = setup()
    act('w', 'buffSkill')
    act('w', 'attackSkill')
    expect(state().own).toEqual({ vulnerability: true, cdBoost: true })
  })
  it("neither the wearer's own skill, nor a memosprite's follow-up, nor another unit's action gives anything", () => {
    const { act, state } = setup()
    act('w', 'ownBuff')
    act('w', 'sweep')
    act('m', 'basic')
    expect(state().own).toEqual({ vulnerability: false, cdBoost: false })
  })
  it('lasts while the memosprite is on the field and goes with it', () => {
    const { battle, act, state } = setup()
    act('w', 'buffSkill')
    act('w', 'attackSkill')
    expect(battle.timeline.modifiers.has('w.memo', BLANK_MODIFIER)).toBe(true)
    expect(battle.timeline.modifiers.has('w.memo', VERSE_MODIFIER)).toBe(true)
    act('w', 'remove')
    expect(state().own).toEqual({ vulnerability: false, cdBoost: false })
  })
  it('reaches a teammate request as the kernel sees it', () => {
    const { act, requested } = setup()
    act('w', 'attackSkill')
    expect(requested()).toEqual({ vulnerability: false, cdBoost: true })
  })
  it('refuses a superimposition outside 1 to 5', () => {
    expect(() => setup(6)).toThrow(/superimposition must be 1 to 5/)
  })
})
