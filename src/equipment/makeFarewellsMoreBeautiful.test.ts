import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { ADVANCE_BY_SUPERIMPOSITION, DEATH_FLOWER_MODIFIER, DEF_IGNORE_BY_SUPERIMPOSITION, MakeFarewellsMoreBeautiful } from './makeFarewellsMoreBeautiful'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const MEMO = 'wearer.memo'

/** A wearer whose Basic ATK attacks, whose Skill costs 100 HP and whose Ultimate does nothing; it can summon a memosprite that costs itself 10 HP on its turn. */
const wearerKit: Kit = {
  characterId: 'wearer',
  path: 'Remembrance',
  element: 'Quantum',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () => battle.performAction(self.key, 'basic', 'basic', () => battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })),
      },
      skill: {
        kind: 'skill',
        canUse: () => true,
        use: () => battle.performAction(self.key, 'skill', 'skill', () => battle.party.consumeHp(self.key, 100, self.key)),
      },
      summon: {
        kind: 'skill',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'summon', 'skill', () =>
            battle.addMemosprite({
              id: MEMO, owner: self.key, name: 'x', maxHp: 1000, baseAggro: 4, baseSpd: 100,
              takeTurn: () => battle.performAction(MEMO, 'memo', 'skill', () => battle.party.consumeHp(MEMO, 10, MEMO)),
            }),
          ),
      },
      ultimate: { kind: 'ultimate', canUse: () => true, use: () => battle.performAction(self.key, 'ultimate', 'ultimate', () => {}) },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
}

function setup(superimposition = 1) {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = { actionDamage: (r) => (requests.push(r), fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] })) }
  const members: MemberSetup[] = [{
    key: 'wearer', kit: wearerKit, eidolon: 0, affinitiveEidolon: false,
    stats: { maxHp: 50_000_000, def: 1000, baseSpd: 100 },
    kernel: { unit: { characterId: 'wearer', lightConeId: '23040', eidolon: 0, superimposition }, build: noBuild },
    equipment: { lightCone: MakeFarewellsMoreBeautiful, sets: [] },
  }]
  const battle = new Battle({
    members, policy: [{ unit: 'wearer', use: 'basic', when: [] }], profile, enemyCount: 1, weaknesses: 'all',
    cycles: 5, start: { energy: 0, skillPoints: 3, techniques: false }, kernel,
  })
  const switchNow = () => {
    battle.member('wearer').instance.actions.basic!.use()
    return requests.at(-1)!.attacker.lightConeConditionals!.deathFlower
  }
  return { battle, requests, switchNow }
}
const use = (battle: Battle, action: string) => battle.member('wearer').instance.actions[action]!.use()

describe('Make Farewells More Beautiful', () => {
  it('is off until the wearer loses HP in its own turn', () => {
    const t = setup()
    expect(t.switchNow()).toBe(false)
    // HP lost outside a turn (an Ultimate window, a bare call) is not "during their own turn".
    t.battle.party.consumeHp('wearer', 10, 'wearer')
    expect(t.switchNow()).toBe(false)
  })

  it('HP the wearer spends in its own turn gives Death Flower at once, for 2 of its next turns', () => {
    const t = setup()
    const seen: boolean[] = []
    let inTurn: boolean | undefined
    t.battle.timeline.bus.on('turnStart', (turn) => {
      if (turn.unit !== 'wearer') return
      seen.push(t.battle.timeline.modifiers.has('wearer', DEATH_FLOWER_MODIFIER))
      if (turn.index === 1) {
        use(t.battle, 'skill')
        inTurn = t.battle.timeline.modifiers.has('wearer', DEATH_FLOWER_MODIFIER)
      }
    })
    t.battle.run()
    expect(inTurn).toBe(true)
    // Turn starts 2 and 3 have it, turn 4 does not.
    expect(seen.slice(0, 4)).toEqual([false, true, true, false])
  })

  it('the memosprite losing HP in its own turn gives it, and the wearer\'s priced hits carry it', () => {
    const t = setup()
    use(t.battle, 'summon')
    t.battle.run()
    // The memosprite paid 10 HP in its own turn: the wearer holds Death Flower from then on (at least for a turn's pricing).
    const flowers = t.requests.map((r) => r.attacker.lightConeConditionals!.deathFlower)
    expect(flowers).toContain(true)
  })

  it('advances the wearer 12% when its memosprite disappears, once, until the wearer uses its Ultimate', () => {
    const t = setup()
    use(t.battle, 'summon')
    const gauge = t.battle.timeline.gauge('wearer')
    t.battle.removeMemosprite(MEMO)
    expect(t.battle.timeline.gauge('wearer')).toBeCloseTo(Math.max(0, gauge - 1200), 9)
    use(t.battle, 'summon')
    const after = t.battle.timeline.gauge('wearer')
    t.battle.removeMemosprite(MEMO)
    expect(t.battle.timeline.gauge('wearer')).toBe(after)
    use(t.battle, 'ultimate')
    use(t.battle, 'summon')
    t.battle.removeMemosprite(MEMO)
    expect(t.battle.timeline.gauge('wearer')).toBeCloseTo(Math.max(0, after - 1200), 9)
  })

  it('has the text\'s numbers by superimposition and refuses a superimposition outside 1 to 5', () => {
    expect([...DEF_IGNORE_BY_SUPERIMPOSITION]).toEqual([0.3, 0.35, 0.4, 0.45, 0.5])
    expect([...ADVANCE_BY_SUPERIMPOSITION]).toEqual([0.12, 0.15, 0.18, 0.21, 0.24])
    const t = setup(5)
    use(t.battle, 'summon')
    const gauge = t.battle.timeline.gauge('wearer')
    t.battle.removeMemosprite(MEMO)
    expect(t.battle.timeline.gauge('wearer')).toBeCloseTo(Math.max(0, gauge - 2400), 9)
    expect(() => setup(6)).toThrow(/superimposition/)
  })
})
