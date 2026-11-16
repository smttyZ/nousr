import { describe, expect, it } from 'vitest'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { Tribbie } from '../kits/tribbie'
import type { Rule } from '../scenario/types'
import { Battle, UNTARGETABLE_MEMOSPRITES } from './battle'
import type { BattleSetup, MemberSetup, MemospriteSpec } from './battle'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/** 1,000 per 100% of a Basic ATK, 500 per 100% of a memosprite skill, 1,000 per 100% of an Ultimate. */
const kernel: DamageKernel = {
  actionDamage: () =>
    fakeResult({
      BASIC: [{ damage: 1000, scaling: 1 }],
      MEMO_SKILL: [{ damage: 500, scaling: 1 }],
      ULT: [{ damage: 1000, scaling: 1 }],
      UNIQUE: [],
    }),
}

interface OwnerOptions {
  /** The memosprite the kit puts on the field at battle start. Its `takeTurn` is filled in by the kit. */
  memo?: Omit<MemospriteSpec, 'id' | 'owner' | 'takeTurn'>
  /** Runs inside the owner's Basic ATK, after its attack. */
  onBasic?: (battle: Battle, self: string) => void
  /** Runs inside the memosprite's turn, after its attack. */
  onMemoTurn?: (battle: Battle, self: string) => void
}

const memoId = (owner: string) => `${owner}.memo`

/** A made-up memosprite owner: Basic ATK 100% single, an Ultimate at 100 energy, and one memosprite whose skill is a 100% AoE priced as MEMO_SKILL. */
function ownerKit(options: OwnerOptions = {}): Kit {
  return {
    characterId: 'owner',
    path: 'Remembrance',
    element: 'Quantum',
    maxEnergy: 100,
    create: (battle, self) => ({
      actions: {
        basic: {
          kind: 'basic',
          canUse: () => true,
          use: () =>
            battle.performAction(self.key, 'basic', 'basic', () => {
              battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
              options.onBasic?.(battle, self.key)
            }),
        },
        ultimate: {
          kind: 'ultimate',
          canUse: () => battle.party.get(self.key).energy >= 100,
          use: () =>
            battle.performAction(self.key, 'ultimate', 'ultimate', () => {
              battle.party.setEnergy(self.key, 0)
              battle.attack({ attacker: self.key, ability: 'ULT', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
            }),
        },
      },
      attackerState: () => ({}),
      teammateState: () => ({}),
      onBattleStart: () => {
        if (!options.memo) return
        battle.addMemosprite({
          ...options.memo,
          id: memoId(self.key),
          owner: self.key,
          takeTurn: () => {
            battle.performAction(memoId(self.key), 'memo_skill', 'skill', () => {
              battle.attack({ attacker: self.key, ability: 'MEMO_SKILL', parts: [{ shape: 'aoe', scaling: 1, hit: 0 }] })
              options.onMemoTurn?.(battle, self.key)
            })
          },
        })
      },
    }),
  }
}

const member = (key: string, kit: Kit, baseSpd: number): MemberSetup => ({
  key,
  kit,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
  kernel: { unit: { characterId: 'owner', lightConeId: 'none', eidolon: 0, superimposition: 1 }, build: noBuild },
})

const rule = (unit: string, use: string): Rule => ({ unit, use, when: [] })

function setup(overrides: Partial<BattleSetup> = {}) {
  const battle = new Battle({
    members: [member('a', ownerKit(), 100)],
    policy: [rule('a', 'basic')],
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0, skillPoints: 0, techniques: false },
    kernel,
    ...overrides,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  const events: string[] = []
  for (const type of ['memospriteAdded', 'memospriteDefeated', 'memospriteRemoved', 'unitDowned'] as const) {
    battle.timeline.bus.on(type, (e) => events.push(`${type}:${e.unit}${'reason' in e ? `:${e.reason}` : ''}`))
  }
  return { battle, dealt, events }
}

const NO_SPD_MEMO = { name: 'garmentmaker', maxHp: 1e9, baseAggro: 4 }

describe('a memosprite with SPD', () => {
  const withSpd = { name: 'netherwing', maxHp: 5000, baseAggro: 4, baseSpd: 200 }

  it('is a timeline unit that takes its own turns, run by the owner kit and never the policy', () => {
    const { battle } = setup({ members: [member('a', ownerKit({ memo: withSpd }), 100)] })
    const result = battle.run()
    // SPD 200 acts at AV 50, 100 and 150; the owner (SPD 100) acts at 100 and goes first on the tie (added to the timeline first).
    expect(result.actions.map((a) => `${a.actor}:${a.action}`)).toEqual(['a.memo:memo_skill', 'a:basic', 'a.memo:memo_skill', 'a.memo:memo_skill'])
    expect(battle.timeline.units()).toContain('a.memo')
  })

  it('logs the memosprite as the actor with the owner recorded, and credits the damage to the owner, priced as the owner ability', () => {
    const { battle, dealt } = setup({ members: [member('a', ownerKit({ memo: withSpd }), 100)] })
    const result = battle.run()
    const memoActions = result.actions.filter((a) => a.actor === 'a.memo')
    expect(memoActions).toHaveLength(3)
    expect(memoActions.every((a) => a.owner === 'a')).toBe(true)
    expect(result.actions.find((a) => a.actor === 'a')!.owner).toBeUndefined()
    expect(dealt.filter((d) => d.ability === 'MEMO_SKILL').every((d) => d.attacker === 'a')).toBe(true)
    expect(result.damageByMember.a).toBeCloseTo(3 * 500 + 1000, 9)
  })
})

describe('a memosprite with no SPD', () => {
  it('is not on the timeline and acts only on an extra turn its owner grants, right after the action', () => {
    const { battle } = setup({
      members: [member('a', ownerKit({ memo: NO_SPD_MEMO, onBasic: (b, me) => b.grantExtraTurn(memoId(me)) }), 100)],
    })
    const turns: Array<{ unit: string, extra: boolean, at: number }> = []
    battle.timeline.bus.on('turnStart', (t) => turns.push({ unit: t.unit, extra: t.extra === true, at: t.at }))
    expect(battle.timeline.units()).not.toContain('a.memo')
    const result = battle.run()
    expect(result.actions.map((a) => `${a.actor}:${a.action}`)).toEqual(['a:basic', 'a.memo:memo_skill'])
    const own = turns.filter((t) => t.unit === 'a' || t.unit === 'a.memo')
    expect(own).toEqual([
      { unit: 'a', extra: false, at: 100 },
      { unit: 'a.memo', extra: true, at: 100 },
    ])
    expect(battle.timeline.units()).not.toContain('a.memo')
  })

  it('never acts on its own: without a grant it stays idle however long the battle runs', () => {
    const { battle } = setup({ cycles: 4, members: [member('a', ownerKit({ memo: NO_SPD_MEMO }), 100)] })
    expect(battle.run().actions.every((a) => a.actor === 'a')).toBe(true)
  })

  it('opens the Ultimate window before and after its extra turn like any turn', () => {
    // b's Ultimate becomes ready inside a's Basic ATK (so it goes before the extra turn) and again inside the memosprite's turn (so it goes after).
    const { battle } = setup({
      members: [
        member('a', ownerKit({
          memo: NO_SPD_MEMO,
          onBasic: (bt, me) => {
            bt.party.setEnergy('b', 100)
            bt.grantExtraTurn(memoId(me))
          },
          onMemoTurn: (bt) => bt.party.setEnergy('b', 100),
        }), 100),
        member('b', ownerKit(), 90),
      ],
      policy: [rule('b', 'ultimate'), rule('a', 'basic'), rule('b', 'basic')],
    })
    const order = battle.run().actions.map((a) => `${a.actor}:${a.action}`)
    expect(order.slice(0, 4)).toEqual(['a:basic', 'b:ultimate', 'a.memo:memo_skill', 'b:ultimate'])
  })

  it('an extra turn queued for a memosprite that is removed first is not taken', () => {
    const { battle } = setup({
      members: [member('a', ownerKit({
        memo: NO_SPD_MEMO,
        onBasic: (b, me) => {
          b.grantExtraTurn(memoId(me))
          b.removeMemosprite(memoId(me))
        },
      }), 100)],
    })
    expect(battle.run().actions.map((a) => a.actor)).toEqual(['a'])
  })

  it('a unit that is not an ally, memosprite or summon cannot be given one', () => {
    const { battle } = setup()
    expect(() => battle.grantExtraTurn('enemy1')).toThrow(/not an ally/)
  })
})

describe('targetability and aggro shares', () => {
  it('the default is untargetable for the two named memosprites and targetable for the rest, Little Ica included (seen in game)', () => {
    expect([...UNTARGETABLE_MEMOSPRITES].sort()).toEqual(['demiurge', 'netherwing'])
    for (const [name, targetable] of [['netherwing', false], ['summer_songbirds', true], ['little_ica', true], ['demiurge', false], ['garmentmaker', true]] as const) {
      const { battle } = setup({ members: [member('a', ownerKit({ memo: { name, maxHp: 1000, baseAggro: 4 } }), 100)] })
      battle.run()
      expect(battle.party.get('a.memo').targetable, name).toBe(targetable)
    }
  })

  it('the owner kit can override the default with the flag, and the battle can switch it later', () => {
    const { battle } = setup({ members: [member('a', ownerKit({ memo: { name: 'netherwing', maxHp: 1000, baseAggro: 4, targetable: true } }), 100)] })
    battle.run()
    expect(battle.party.get('a.memo').targetable).toBe(true)
    battle.setMemospriteTargetable('a.memo', false)
    expect(battle.party.get('a.memo').targetable).toBe(false)
    expect(() => battle.setMemospriteTargetable('a', false)).toThrow(/not a memosprite/)
  })

  it('a targetable memosprite shares enemy attacks by aggro (4 against 4 is half each); an untargetable one takes none', () => {
    const targetable = setup({ cycles: 2, members: [member('a', ownerKit({ memo: NO_SPD_MEMO }), 100)] })
    const hits = new Map<string, number>()
    targetable.battle.timeline.bus.on('allyHit', (e) => hits.set(e.unit, (hits.get(e.unit) ?? 0) + e.hits))
    targetable.battle.run()
    // The generic enemy's pattern is single, single, AoE; its third turn (AV 190) falls in cycle 2.
    expect(hits.get('a')).toBeCloseTo(0.5 + 0.5 + 1, 9)
    expect(hits.get('a.memo')).toBeCloseTo(0.5 + 0.5 + 1, 9)
    expect(targetable.battle.party.get('a.memo').hp).toBeLessThan(1e9)

    const hidden = setup({ cycles: 2, members: [member('a', ownerKit({ memo: { ...NO_SPD_MEMO, name: 'netherwing' } }), 100)] })
    const hiddenHits = new Map<string, number>()
    hidden.battle.timeline.bus.on('allyHit', (e) => hiddenHits.set(e.unit, (hiddenHits.get(e.unit) ?? 0) + e.hits))
    hidden.battle.run()
    expect(hiddenHits.get('a')).toBeCloseTo(1 + 1 + 1, 9)
    expect(hiddenHits.has('a.memo')).toBe(false)
    expect(hidden.battle.party.get('a.memo').hp).toBe(1e9)
  })

  it('target shares follow the flag and exclude the untargetable', () => {
    const { battle } = setup({ members: [member('a', ownerKit({ memo: NO_SPD_MEMO }), 100)] })
    battle.run()
    expect(battle.party.targetShares().get('a.memo')).toBeCloseTo(0.5, 9)
    battle.setMemospriteTargetable('a.memo', false)
    expect([...battle.party.targetShares().keys()]).toEqual(['a'])
    expect(battle.party.alive()).toEqual(['a', 'a.memo'])
  })
})

describe('memosprite HP', () => {
  function withMemo(extra: Partial<MemospriteSpec> = {}) {
    const s = setup({ members: [member('a', ownerKit(), 100)] })
    s.battle.addMemosprite({ id: 'a.memo', owner: 'a', name: 'garmentmaker', maxHp: 1000, baseAggro: 4, takeTurn: () => {}, ...extra })
    return s
  }

  it('is a party member: damage reduction, shields, healing and HP spent work like for any ally', () => {
    const { battle } = withMemo()
    const { party } = battle
    party.setDamageReduction('a.memo', 'x', 0.5)
    expect(party.damageTakenMultiplier('a.memo')).toBe(0.5)
    party.setShield('a.memo', 's', 100)
    expect(party.takeDamage('a.memo', 300, 'enemy1')).toEqual({ absorbed: 100, lost: 200 })
    expect(party.get('a.memo').hp).toBe(800)
    expect(party.heal('a.memo', 500, 'a')).toBe(200)
    expect(party.consumeHp('a.memo', 5000)).toBe(999)
    expect(party.get('a.memo').hp).toBe(1)
  })

  it('at 0 HP it is removed and events fire, and it does not fail the no-downed-characters objective', () => {
    const { battle, events } = withMemo({ baseSpd: 100 })
    expect(battle.timeline.has('a.memo')).toBe(true)
    battle.party.takeDamage('a.memo', 5000, 'enemy1')
    expect(events).toEqual(['memospriteAdded:a.memo', 'memospriteDefeated:a.memo', 'memospriteRemoved:a.memo:hp'])
    expect(battle.party.has('a.memo')).toBe(false)
    expect(battle.timeline.has('a.memo')).toBe(false)
    expect(battle.isAlly('a.memo')).toBe(false)
    expect(battle.party.anyDowned()).toBe(false)
    expect(battle.run().downed).toEqual([])
  })

  it('leaves with its owner when the owner is downed', () => {
    const { battle, events } = withMemo({ baseSpd: 100 })
    battle.party.takeDamage('a', 1e9, 'enemy1')
    expect(events).toContain('memospriteRemoved:a.memo:ownerDowned')
    expect(battle.party.has('a.memo')).toBe(false)
    expect(battle.timeline.has('a.memo')).toBe(false)
  })

  it('removeMemosprite drops its modifiers and lets the same id be added again; adding twice is an error', () => {
    const { battle, events } = withMemo()
    battle.timeline.modifiers.apply({ id: 'm', target: 'a.memo', source: 'a' })
    expect(() => battle.addMemosprite({ id: 'a.memo', owner: 'a', name: 'garmentmaker', maxHp: 1, baseAggro: 4, takeTurn: () => {} })).toThrow(/already/)
    battle.removeMemosprite('a.memo')
    battle.removeMemosprite('a.memo')
    expect(battle.timeline.modifiers.has('a.memo', 'm')).toBe(false)
    expect(events.filter((e) => e.startsWith('memospriteRemoved'))).toEqual(['memospriteRemoved:a.memo:removed'])
    battle.addMemosprite({ id: 'a.memo', owner: 'a', name: 'garmentmaker', maxHp: 1, baseAggro: 4, takeTurn: () => {} })
    expect(battle.isMemosprite('a.memo')).toBe(true)
  })

  it('isAlly includes memosprites, isCharacter does not, summons are neither; ownerOf and memospritesOf read the owner', () => {
    const { battle } = withMemo()
    expect(battle.isAlly('a.memo')).toBe(true)
    expect(battle.isCharacter('a.memo')).toBe(false)
    expect(battle.isCharacter('a')).toBe(true)
    expect(battle.isAlly('enemy1')).toBe(false)
    expect(battle.ownerOf('a.memo')).toBe('a')
    expect(battle.ownerOf('a')).toBe('a')
    expect(battle.ownerOf('enemy1')).toBeUndefined()
    expect(battle.memospritesOf('a')).toEqual(['a.memo'])
  })
})

describe('an existing kit reacting to "after an ally attacks" with a memosprite as the actor', () => {
  const tribbie: MemberSetup = {
    key: 'tribbie',
    kit: Tribbie,
    eidolon: 0,
    affinitiveEidolon: false,
    stats: { maxHp: 1_000_000, def: 1000, baseSpd: 50 },
    kernel: { unit: { characterId: '1403', lightConeId: 'none', eidolon: 0, superimposition: 1 }, build: noBuild },
  }

  it("Tribbie's Pebble trace gives 1.5 energy per enemy hit when a memosprite attacks (the text says ally targets)", () => {
    const { battle } = setup({
      members: [tribbie, member('a', ownerKit({ memo: { name: 'netherwing', maxHp: 1000, baseAggro: 4, baseSpd: 200 } }), 100)],
      policy: [rule('tribbie', 'basic'), rule('a', 'basic')],
    })
    const gains: number[] = []
    battle.timeline.bus.on('energyGained', (e) => {
      if (e.unit === 'tribbie') gains.push(e.amount)
    })
    const result = battle.run()
    const memoFirst = result.actions[0]!
    expect(memoFirst.actor).toBe('a.memo')
    // Gains: 30 from the battle-start trace, then 1.5 for the one enemy the memosprite's AoE hit.
    expect(gains[0]).toBeCloseTo(30, 9)
    expect(gains[1]).toBeCloseTo(1.5, 9)
  })
})
