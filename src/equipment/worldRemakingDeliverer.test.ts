import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { BattleSetup, MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult, ZERO_STATS } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit } from '../kits/kit'
import type { Rule } from '../scenario/types'
import { lightConeWithoutBehaviour } from './equipment'
import type { MemberEquipment } from './equipment'
import { MEMOSPRITE_CHARACTERS, WorldRemakingDeliverer, hasMemosprite } from './worldRemakingDeliverer'

const profile = loadEnemyProfile('generic-moc')
const noBuild: KernelBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const NAME = 'World-Remaking Deliverer'
const ACHERON = '1308'
const CASTORICE = '1407'
const ROBIN = '1512'
const BASE_HP = 1000

/**
 * A kernel that tells the two switches apart in its damage (the battle caches identical requests, so counting requests would miss
 * repeats): 1000, plus 100 when the attacker's switch is on, plus 10 when a teammate gives the team flag. Like Fribbels, the wearer's
 * stats' HP is 24% higher with the switch on (1000, or 1240).
 */
function recordingKernel() {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = {
    actionDamage(request) {
      requests.push(request)
      const on = request.setConditionals?.[NAME] === true
      const flag = request.teammates.some((t) => t.teamRelicSet === NAME)
      const hit = [{ damage: 1000 + (on ? 100 : 0) + (flag ? 10 : 0), scaling: 1 }]
      return fakeResult({ BASIC: hit, SKILL: hit, ULT: hit, FUA: hit }, { ...ZERO_STATS, HP: on ? BASE_HP * 1.24 : BASE_HP })
    },
  }
  return { kernel, requests }
}

/**
 * A kit with a Basic ATK, a Skill that summons a memosprite (when `memo` and none is on the field), an Ultimate and a way to
 * remove the memosprite. The memosprite's own Skill is an action of the memosprite (actor = its id, owner = the kit).
 */
const testKit = (characterId: string, memo: boolean): Kit => ({
  characterId,
  path: 'Remembrance',
  element: 'Fire',
  maxEnergy: 0,
  create: (battle, self) => {
    const memoId = `${self.key}.memo`
    const hit = () => battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
    return {
      actions: {
        basic: { kind: 'basic', canUse: () => true, use: () => battle.performAction(self.key, 'basic', 'basic', hit) },
        skill: {
          kind: 'skill',
          canUse: () => true,
          use: () =>
            battle.performAction(self.key, 'skill', 'skill', () => {
              if (memo && battle.memospritesOf(self.key).length === 0) {
                battle.addMemosprite({ id: memoId, owner: self.key, name: 'x', maxHp: 500, baseAggro: 4, baseSpd: 100, takeTurn: () => {} })
              }
            }),
        },
        ultimate: { kind: 'ultimate', canUse: () => true, use: () => battle.performAction(self.key, 'ult', 'ultimate', hit) },
      },
      attackerState: () => ({}),
      teammateState: () => ({}),
    }
  },
})

const wornBy = (pieces: 2 | 4): MemberEquipment => ({
  lightCone: lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' }),
  sets: [{ module: WorldRemakingDeliverer, pieces }],
})

const member = (key: string, characterId: string, equipment: MemberEquipment | undefined, memo = false): MemberSetup => ({
  key,
  kit: testKit(characterId, memo),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: BASE_HP, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
  ...(equipment && { equipment }),
})

const rule = (unit: string): Rule => ({ unit, use: 'basic', when: [] })

function battleOf(members: MemberSetup[], kernel: DamageKernel, overrides: Partial<BattleSetup> = {}) {
  return new Battle({
    members,
    policy: members.map((m) => rule(m.key)),
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0.5, skillPoints: 3, techniques: false },
    kernel,
    ...overrides,
  })
}

/** A wearer 'w' (a memosprite character that summons one with its Skill) and an ally 'a' with nothing. */
function setup(options: { pieces?: 2 | 4, memo?: boolean, wearerId?: string } = {}) {
  const { kernel } = recordingKernel()
  const battle = battleOf(
    [member('w', options.wearerId ?? CASTORICE, wornBy(options.pieces ?? 4), options.memo ?? true), member('a', ACHERON, undefined)],
    kernel,
  )
  const damages: { attacker: string, damage: number }[] = []
  battle.timeline.bus.on('damageDealt', (e) => damages.push({ attacker: e.attacker, damage: e.damage }))
  const use = (who: string, action: 'basic' | 'skill' | 'ultimate') => battle.member(who).instance.actions[action]!.use()
  const last = (who: string) => damages.filter((d) => d.attacker === who).at(-1)!.damage
  /** The wearer's switch in each of its attacks so far. */
  const switches = () => damages.filter((d) => d.attacker === 'w').map((d) => Math.floor((d.damage - 1000) / 100) === 1)
  /** The switch the kernel was given in the wearer's last attack. */
  const wearerSwitch = () => last('w') >= 1100
  /** Whether the kernel was given the wearer's team flag in the ally's last attack. */
  const teamFlag = () => (last('a') - 1000) % 100 === 10
  return { battle, use, switches, wearerSwitch, teamFlag }
}

describe('World-Remaking Deliverer', () => {
  it('is a relic with the game id 127 and the name Fribbels uses', () => {
    expect(WorldRemakingDeliverer).toMatchObject({ kind: 'set', type: 'relic', name: NAME, setId: '127' })
  })

  describe('a wearer with no memosprite', () => {
    it('passes the switch OFF at 4 pieces, before and after Basic ATK and Skill, and gives the team nothing', () => {
      const { use, switches, teamFlag } = setup({ memo: false, wearerId: ACHERON })
      use('w', 'basic')
      use('w', 'skill')
      use('w', 'basic')
      use('a', 'basic')
      expect(switches()).toEqual([false, false])
      expect(teamFlag()).toBe(false)
    })

    it('leaves the party Max HP alone', () => {
      const { battle, use } = setup({ memo: false, wearerId: ACHERON })
      use('w', 'skill')
      expect(battle.party.get('w').maxHp).toBe(BASE_HP)
    })
  })

  describe('at 2 pieces', () => {
    it('keeps the switch OFF and gives no team flag, memosprite or not', () => {
      const { battle, use, wearerSwitch, teamFlag } = setup({ pieces: 2 })
      use('w', 'skill')
      use('w', 'basic')
      use('a', 'basic')
      expect(wearerSwitch()).toBe(false)
      expect(teamFlag()).toBe(false)
      expect(battle.party.get('w').maxHp).toBe(BASE_HP)
    })
  })

  describe('a wearer with a memosprite, 4 pieces', () => {
    it('is off before the wearer has used Basic ATK or Skill', () => {
      const { use, wearerSwitch, teamFlag } = setup()
      use('w', 'ultimate') // not a Basic ATK or Skill; the memosprite is not even on the field yet
      expect(wearerSwitch()).toBe(false)
      use('a', 'basic')
      expect(teamFlag()).toBe(false)
    })

    it('goes on after a Skill that summons the memosprite: its own Basic is priced on, and teammates get the DMG flag', () => {
      const { use, wearerSwitch, teamFlag } = setup()
      use('w', 'skill')
      use('w', 'basic')
      expect(wearerSwitch()).toBe(true)
      use('a', 'basic')
      expect(teamFlag()).toBe(true)
    })

    it('does not benefit the action that grants it: the Basic ATK that triggers it is priced with the switch off', () => {
      const { use, switches } = setup()
      use('w', 'skill') // memosprite on the field, effect granted after this
      use('w', 'basic') // priced on (granted by the Skill)
      expect(switches()).toEqual([true])
      // A wearer whose memosprite is on the field from the start: its first Basic ATK is priced off, the next on.
      const second = setup()
      second.battle.addMemosprite({ id: 'w.memo', owner: 'w', name: 'x', maxHp: 500, baseAggro: 4, baseSpd: 100, takeTurn: () => {} })
      second.use('w', 'basic')
      second.use('w', 'basic')
      expect(second.switches()).toEqual([false, true])
    })

    it('is re-evaluated at each Basic ATK: with the memosprite gone it is off again', () => {
      const { battle, use, wearerSwitch, teamFlag } = setup()
      use('w', 'skill')
      battle.removeMemosprite('w.memo')
      use('w', 'basic') // priced still on (it lasts until after the next Basic ATK) ...
      expect(wearerSwitch()).toBe(true)
      use('w', 'basic') // ... and that Basic ATK found no memosprite
      expect(wearerSwitch()).toBe(false)
      use('a', 'basic')
      expect(teamFlag()).toBe(false)
    })

    it('does not end early when the memosprite leaves: until the next Basic ATK or Skill it stays on', () => {
      const { battle, use, wearerSwitch, teamFlag } = setup()
      use('w', 'skill')
      battle.removeMemosprite('w.memo')
      use('a', 'basic')
      expect(teamFlag()).toBe(true)
      use('w', 'ultimate')
      expect(wearerSwitch()).toBe(true)
    })

    it('a Skill re-evaluates too: a Skill used with no memosprite on the field (and none summoned) ends it', () => {
      const { battle, use, teamFlag } = setup({ memo: false })
      battle.addMemosprite({ id: 'w.memo', owner: 'w', name: 'x', maxHp: 500, baseAggro: 4, baseSpd: 100, takeTurn: () => {} })
      use('w', 'basic')
      use('a', 'basic')
      expect(teamFlag()).toBe(true)
      battle.removeMemosprite('w.memo')
      use('w', 'skill')
      use('a', 'basic')
      expect(teamFlag()).toBe(false)
    })

    it("an Ultimate or follow-up of the wearer, and the memosprite's own actions, do not grant or end it", () => {
      const { battle, use, teamFlag } = setup({ memo: false })
      battle.addMemosprite({ id: 'w.memo', owner: 'w', name: 'x', maxHp: 500, baseAggro: 4, baseSpd: 100, takeTurn: () => {} })
      use('w', 'ultimate')
      battle.performAction('w', 'fua', 'followUp', () => {})
      battle.performAction('w.memo', 'memoSkill', 'skill', () => {})
      battle.performAction('w.memo', 'memoBasic', 'basic', () => {})
      use('a', 'basic')
      expect(teamFlag()).toBe(false)
      use('w', 'basic') // the wearer's own Basic ATK does
      use('a', 'basic')
      expect(teamFlag()).toBe(true)
    })

    it('a downed wearer ends the effect', () => {
      const { battle, use, teamFlag } = setup()
      use('w', 'skill')
      battle.party.takeDamage('w', 1e9, 'enemy')
      expect(battle.party.get('w').downed).toBe(true)
      use('a', 'basic')
      expect(teamFlag()).toBe(false)
    })

    it('works for the buffed kernel id of a memosprite character (1407b1)', () => {
      const { use, wearerSwitch } = setup({ wearerId: '1407b1' })
      use('w', 'skill')
      use('w', 'basic')
      expect(wearerSwitch()).toBe(true)
    })
  })

  describe("the party's Max HP", () => {
    it('rises by the kernel\'s 24% for the wearer and 24% of the memosprite\'s Max HP when the effect is granted', () => {
      const { battle, use } = setup()
      expect(battle.party.get('w').maxHp).toBe(BASE_HP)
      use('w', 'skill')
      expect(battle.party.get('w').maxHp).toBeCloseTo(BASE_HP * 1.24, 9)
      expect(battle.party.get('w.memo').maxHp).toBeCloseTo(500 * 1.24, 9)
      expect(battle.party.get('a').maxHp).toBe(BASE_HP)
    })

    it('does not stack when the effect is granted again, and composes with another buff on the party', () => {
      const { battle, use } = setup()
      use('w', 'skill')
      battle.party.setStats('w', { maxHp: battle.party.get('w').maxHp + 300 }) // someone else's +300
      use('w', 'basic') // granted again
      use('w', 'basic')
      expect(battle.party.get('w').maxHp).toBeCloseTo(BASE_HP * 1.24 + 300, 9)
      expect(battle.party.get('w.memo').maxHp).toBeCloseTo(500 * 1.24, 9)
    })

    it('is taken off again when the next Basic ATK finds no memosprite', () => {
      const { battle, use } = setup()
      use('w', 'skill')
      battle.removeMemosprite('w.memo')
      expect(battle.party.get('w').maxHp).toBeCloseTo(BASE_HP * 1.24, 9) // it does not end early
      use('w', 'basic')
      expect(battle.party.get('w').maxHp).toBeCloseTo(BASE_HP, 9)
    })

    it('a memosprite that joins after the grant does not get the Max HP', () => {
      const { battle, use } = setup({ memo: false })
      use('w', 'basic') // no memosprite: nothing granted
      battle.addMemosprite({ id: 'w.memo', owner: 'w', name: 'x', maxHp: 500, baseAggro: 4, baseSpd: 100, takeTurn: () => {} })
      expect(battle.party.get('w.memo').maxHp).toBe(500)
      use('w', 'basic') // granted now, to the memosprite on the field
      expect(battle.party.get('w.memo').maxHp).toBeCloseTo(500 * 1.24, 9)
    })

    it('a different memosprite that joins while the effect is up (the first one left) does not get it', () => {
      const { battle, use } = setup()
      use('w', 'skill')
      battle.removeMemosprite('w.memo')
      battle.addMemosprite({ id: 'w.memo2', owner: 'w', name: 'x', maxHp: 500, baseAggro: 4, baseSpd: 100, takeTurn: () => {} })
      expect(battle.party.get('w.memo2').maxHp).toBe(500)
      use('a', 'basic')
      expect(battle.party.get('w.memo2').maxHp).toBe(500)
    })

    it('is taken off the wearer when it is downed', () => {
      const { battle, use } = setup()
      use('w', 'skill')
      battle.party.takeDamage('w', 1e9, 'enemy')
      expect(battle.party.get('w').maxHp).toBeCloseTo(BASE_HP, 9)
    })
  })

  it('knows which characters have a memosprite, from Fribbels\' config', () => {
    expect(MEMOSPRITE_CHARACTERS.has(CASTORICE)).toBe(true)
    expect(MEMOSPRITE_CHARACTERS.has(ROBIN)).toBe(true)
    expect(hasMemosprite({ kernel: { unit: { characterId: CASTORICE } } } as never)).toBe(true)
    expect(hasMemosprite({ kernel: { unit: { characterId: '1407b1' } } } as never)).toBe(true)
    expect(hasMemosprite({ kernel: { unit: { characterId: '1308b1' } } } as never)).toBe(false)
    expect(hasMemosprite({ kernel: { unit: { characterId: ACHERON } } } as never)).toBe(false)
  })
})
