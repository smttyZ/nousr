import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { lightConeWithoutBehaviour } from './equipment'
import type { MemberEquipment } from './equipment'
import { SACERDOS_ONE_STACK, SACERDOS_TWO_STACKS, SacerdosRelivedOrdeal, sacerdosModifierId } from './sacerdosRelivedOrdeal'

const profile = loadEnemyProfile('generic-moc')
const noBuild: KernelBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const noCone = lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' })
const NAME = "Sacerdos' Relived Ordeal"
const STACK_ID = sacerdosModifierId('w')

function recordingKernel() {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = {
    actionDamage(request) {
      requests.push(request)
      return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] })
    },
  }
  return { kernel, requests }
}

/** What a stub ability does to the field, given the battle, its user and the policy's target. */
type Effect = (battle: Battle, me: string, target: string | undefined) => void

/** Puts a plain buff `id` from `me` on `unit`. */
const buff = (battle: Battle, me: string, unit: string, id = 'skill.buff') =>
  battle.timeline.modifiers.apply({ id, target: unit, source: me, duration: { turns: 2, tick: 'turnEnd' } })

/** The default ability: buffs its target, the way Sunday's Skill and Robin Summeretto's Ultimate do. */
const buffTarget: Effect = (battle, me, target) => buff(battle, me, target!)

/** A kit whose Basic ATK hits, and whose Basic, Skill and Ultimate each run `effects[kind]` inside the action. */
const stubKit = (effects: Partial<Record<'basic' | 'skill' | 'ultimate', Effect>>): Kit => ({
  characterId: 'stub',
  path: 'Harmony',
  element: 'Fire',
  maxEnergy: 0,
  create: (battle, self) => {
    const action = (kind: 'basic' | 'skill' | 'ultimate') => ({
      kind,
      canUse: () => true,
      use: (target?: string) =>
        battle.performAction(self.key, kind, kind, () => {
          if (kind === 'basic') battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
          effects[kind]?.(battle, self.key, target)
        }),
    })
    return {
      actions: { basic: action('basic'), skill: action('skill'), ultimate: action('ultimate') },
      attackerState: () => ({}),
      teammateState: () => ({}),
    }
  },
})

const member = (key: string, pieces?: 2 | 4, effects: Partial<Record<'basic' | 'skill' | 'ultimate', Effect>> = {}): MemberSetup => ({
  key,
  kit: stubKit(effects),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: key, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
  ...(pieces !== undefined && { equipment: { lightCone: noCone, sets: [{ module: SacerdosRelivedOrdeal, pieces }] } as MemberEquipment }),
})

const battleOf = (members: MemberSetup[], kernel: DamageKernel) =>
  new Battle({
    members,
    policy: members.map((m) => ({ unit: m.key, use: 'basic', when: [] })),
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0.5, skillPoints: 3, techniques: false },
    kernel,
  })

/** Wearer 'w' (4 pieces unless said) with the given abilities, and plain allies 'a' and 'b'. */
function setup(effects: Partial<Record<'basic' | 'skill' | 'ultimate', Effect>> = { skill: buffTarget, ultimate: buffTarget }, pieces: 2 | 4 = 4) {
  const { kernel, requests } = recordingKernel()
  const battle = battleOf([member('w', pieces, effects), member('a'), member('b')], kernel)
  const use = (who: string, kind: 'basic' | 'skill' | 'ultimate', target?: string) => battle.member(who).instance.actions[kind]!.use(target)
  const stacks = (unit: string) => battle.timeline.modifiers.get(unit, STACK_ID)?.stacks ?? 0
  /** The team flag 'w' gave in `who`'s last attack. */
  const flag = (who: string) => {
    use(who, 'basic')
    const last = requests.filter((r) => r.attacker.characterId === who).at(-1)!
    return last.teammates.find((t) => t.characterId === 'w')?.teamRelicSet
  }
  return { battle, requests, use, stacks, flag }
}

describe("Sacerdos' Relived Ordeal: the module", () => {
  it('is the set the kernel calls by name, with its set id', () => {
    expect(SacerdosRelivedOrdeal.name).toBe(NAME)
    expect(SacerdosRelivedOrdeal.setId).toBe('121')
    expect(SacerdosRelivedOrdeal.type).toBe('relic')
  })

  it('at 2 pieces (always-on SPD only) passes no conditionals and no team flags, and gives no stacks', () => {
    const { requests, use, stacks, flag } = setup(undefined, 2)
    use('w', 'skill', 'a')
    expect(stacks('a')).toBe(0)
    expect(flag('a')).toBeUndefined()
    use('w', 'basic')
    for (const r of requests) {
      expect(r.setConditionals).toBeUndefined()
      expect(r.teammates.every((t) => t.teamRelicSet === undefined)).toBe(true)
    }
  })
})

describe("Sacerdos' Relived Ordeal 4-piece: the ability target is the ally the wearer's Skill or Ultimate buffed", () => {
  it('a Skill on one ally gives that ally one stack, and its attacks get the team form "1x"', () => {
    const { use, stacks, flag } = setup()
    expect(flag('a')).toBeUndefined()
    use('w', 'skill', 'a')
    expect(stacks('a')).toBe(1)
    expect(stacks('b')).toBe(0)
    expect(flag('a')).toBe(SACERDOS_ONE_STACK)
    expect(flag('b')).toBeUndefined()
  })

  it('an Ultimate counts too, and stacks cap at 2 ("2x")', () => {
    const { use, stacks, flag } = setup()
    use('w', 'ultimate', 'a')
    use('w', 'skill', 'a')
    expect(stacks('a')).toBe(2)
    expect(flag('a')).toBe(SACERDOS_TWO_STACKS)
    use('w', 'skill', 'a')
    expect(stacks('a')).toBe(2)
  })

  it('lasts 2 of the holder\'s turns, counted at their end, and a new stack renews it (IN-GAME CHECKs)', () => {
    const { battle, use } = setup()
    use('w', 'skill', 'a')
    const first = battle.timeline.modifiers.get('a', STACK_ID)!
    expect(first.duration).toMatchObject({ turns: 2, tick: 'turnEnd', clock: 'a' })
    expect(first.source).toBe('w')
    use('w', 'skill', 'a')
    expect(battle.timeline.modifiers.get('a', STACK_ID)!.turnsLeft).toBe(2)
  })

  it("the wearer's own pricing passes 0 stacks, and the wearer gives itself no team flag", () => {
    const { requests, use } = setup()
    use('w', 'skill', 'a')
    use('w', 'basic')
    const mine = requests.filter((r) => r.attacker.characterId === 'w')
    expect(mine.length).toBeGreaterThan(0)
    for (const r of mine) expect(r.setConditionals?.[NAME]).toBe(0)
  })

  it('a Basic ATK that buffs an ally gives no stack (only Skill and Ultimate count)', () => {
    const { use, stacks } = setup({ basic: (battle, me) => buff(battle, me, 'a') })
    use('w', 'basic')
    expect(stacks('a')).toBe(0)
  })

  it("another ally's Skill buffing someone gives no stack", () => {
    const { kernel } = recordingKernel()
    const battle = battleOf([member('w', 4), member('a', undefined, { skill: buffTarget }), member('b')], kernel)
    battle.member('a').instance.actions.skill!.use('b')
    expect(battle.timeline.modifiers.has('b', STACK_ID)).toBe(false)
  })

  it('buffs on the wearer itself, on enemies and on memosprites do not make a second candidate', () => {
    const { battle, use, stacks } = setup({
      skill: (b, me, target) => {
        buff(b, me, target!)
        buff(b, me, me, 'self.buff')
        b.timeline.modifiers.apply({ id: 'enemy.debuff', target: b.primary, source: me, debuff: true })
        b.addMemosprite({ id: 'b.memo', owner: 'b', name: 'x', maxHp: 500, baseAggro: 4, baseSpd: 100, takeTurn: () => {} })
        buff(b, me, 'b.memo')
      },
    })
    use('w', 'skill', 'a')
    expect(stacks('a')).toBe(1)
    expect(stacks('w')).toBe(0)
    expect(battle.timeline.modifiers.has('b.memo', STACK_ID)).toBe(false)
  })

  it('a buff the same ability puts on every ally (team-wide) is not single-target: the one-ally buff decides', () => {
    const { use, stacks } = setup({
      skill: (b, me, target) => {
        for (const ally of ['a', 'b']) buff(b, me, ally, 'team.buff')
        buff(b, me, target!)
      },
    })
    use('w', 'skill', 'b')
    expect(stacks('b')).toBe(1)
    expect(stacks('a')).toBe(0)
  })

  it('an ability that only buffs the whole team gives no stack', () => {
    const { use, stacks } = setup({ skill: (b, me) => { for (const ally of ['a', 'b']) buff(b, me, ally, 'team.buff') } })
    use('w', 'skill')
    expect(stacks('a') + stacks('b')).toBe(0)
  })

  it('stops with an error when two allies each get a single-ally buff: the target cannot be told', () => {
    const { use } = setup({ skill: (b, me) => { buff(b, me, 'a', 'one'); buff(b, me, 'b', 'two') } })
    expect(() => use('w', 'skill')).toThrow(/cannot be told/)
  })

  it("a buff another unit gives during the wearer's Skill is not the wearer's, so it makes no second candidate", () => {
    const { use, stacks } = setup({ skill: (b, me, target) => { buff(b, me, target!); buff(b, 'b', 'b', 'b.own') } })
    use('w', 'skill', 'a')
    expect(stacks('a')).toBe(1)
    expect(stacks('b')).toBe(0)
  })

  it('a buff the wearer gives after the action has resolved (from an actionUsed listener) is not counted', () => {
    const { battle, use, stacks } = setup({ skill: () => {} })
    battle.timeline.bus.on('actionUsed', (a) => {
      if (a.actor === 'w') buff(battle, 'w', 'a', 'later.buff')
    })
    use('w', 'skill', 'a')
    expect(stacks('a')).toBe(0)
  })

  it('a downed target gets no stack', () => {
    const { battle, use, stacks } = setup()
    battle.party.takeDamage('a', 10_000_000, 'enemy')
    expect(battle.party.get('a').downed).toBe(true)
    use('w', 'skill', 'a')
    expect(stacks('a')).toBe(0)
  })
})
