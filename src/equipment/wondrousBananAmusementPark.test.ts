import { describe, expect, it } from 'vitest'
import { Battle, type BattleSetup, type MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit, KitAction } from '../kits/kit'
import type { Rule } from '../scenario/types'
import type { MemberEquipment } from './equipment'
import { lightConeWithoutBehaviour } from './equipment'
import { TheWondrousBananAmusementPark } from './wondrousBananAmusementPark'

const SET = 'The Wondrous BananAmusement Park'
const profile = loadEnemyProfile('generic-moc')
const noBuild: KernelBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

/** Prices every hit at 1000, plus 10 when the module's flag is on, so a damage event reads back the flag. */
function encodingKernel(): { kernel: DamageKernel, requests: DamageRequest[] } {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = {
    actionDamage(request) {
      requests.push(request)
      const hit = [{ damage: request.setConditionals?.[SET] === true ? 1010 : 1000, scaling: 1 }]
      return fakeResult({ BASIC: hit, SKILL: hit, ULT: hit, FUA: hit })
    },
  }
  return { kernel, requests }
}

/**
 * A made-up wearer that summons a Lightning-Lord-like unit (`<key>.lightning_lord`, the id convention) at the start
 * of the battle. Its `dismiss` step removes that summon, and its `basic` attacks read the flag.
 */
function summoner(key: string, script: ('basic' | 'dismiss')[], withSummon = true): Kit {
  return {
    characterId: key,
    path: 'Hunt',
    element: 'Fire',
    maxEnergy: 0,
    create: (battle: Battle) => {
      const summon = `${key}.lightning_lord`
      let step = 0
      const actions: Record<string, KitAction> = {}
      actions.basic = {
        kind: 'basic',
        canUse: () => true,
        use: () => {
          step += 1
          battle.performAction(key, 'basic', 'basic', () => {
            battle.attack({ attacker: key, ability: 'BASIC', parts: [{ shape: 'aoe', scaling: 1, hit: 0 }] })
          })
        },
      }
      actions.dismiss = {
        kind: 'basic',
        canUse: () => true,
        use: () => {
          step += 1
          battle.removeSummon(summon)
        },
      }
      return {
        actions,
        quantities: { step: () => step },
        onBattleStart: () => {
          if (withSummon) battle.addSummon({ id: summon, owner: key, baseSpd: 60, takeTurn: () => {} })
        },
        attackerState: () => ({}),
        teammateState: () => ({}),
      }
    },
  }
}

function policyOf(key: string, script: ('basic' | 'dismiss')[]): Rule[] {
  return [
    ...script.map((use, i): Rule => ({ unit: key, use, when: [{ what: `${key}.step`, min: i, max: i }] })),
    { unit: key, use: 'basic', when: [] },
  ]
}

const member = (key: string, kit: Kit): MemberSetup => ({
  key,
  kit,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000_000, def: 1000, baseSpd: 1000 },
  kernel: { unit: { characterId: key, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
  equipment: {
    lightCone: lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' }),
    sets: [{ module: TheWondrousBananAmusementPark, pieces: 2 }],
  } satisfies MemberEquipment,
})

function battleOf(members: MemberSetup[], policy: Rule[], kernel: DamageKernel, overrides: Partial<BattleSetup> = {}): Battle {
  return new Battle({
    members,
    policy,
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0.5, skillPoints: 3, techniques: false },
    kernel,
    ...overrides,
  })
}

/** The flag the kernel was given on each of `who`'s damage events, in order. */
function flags(battle: Battle, who: string): boolean[] {
  const seen: boolean[] = []
  battle.timeline.bus.on('damageDealt', (dealt) => {
    if (dealt.attacker === who) seen.push((dealt.damage - 1000) / 10 === 1)
  })
  return seen
}

describe('The Wondrous BananAmusement Park', () => {
  it('is on while a summon the wearer made is on the field, and off once it is gone', () => {
    const { kernel } = encodingKernel()
    const script: ('basic' | 'dismiss')[] = ['basic', 'dismiss', 'basic']
    const battle = battleOf([member('wearer', summoner('wearer', script))], policyOf('wearer', script), kernel)
    const seen = flags(battle, 'wearer')
    battle.run()
    expect(seen.slice(0, 2)).toEqual([true, false])
  })

  it('is off while only another member\'s summon is on the field: "summoned by the wearer" reads the owner in the id', () => {
    const { kernel } = encodingKernel()
    const wearerScript: ('basic' | 'dismiss')[] = ['basic']
    const otherScript: ('basic' | 'dismiss')[] = []
    const battle = battleOf(
      [member('wearer', summoner('wearer', wearerScript, false)), member('other', summoner('other', otherScript, true))],
      [...policyOf('wearer', wearerScript), ...policyOf('other', otherScript)],
      kernel,
    )
    const seen = flags(battle, 'wearer')
    battle.run()
    expect(seen[0]).toBe(false)
  })

  it("reads the summon from its owner, not from the id: a summon whose id does not start with the wearer's key counts", () => {
    const { kernel } = encodingKernel()
    const odd: Kit = {
      characterId: 'wearer',
      path: 'Hunt',
      element: 'Fire',
      maxEnergy: 0,
      create: (battle: Battle) => ({
        actions: {
          basic: {
            kind: 'basic',
            canUse: () => true,
            use: () => battle.performAction('wearer', 'basic', 'basic', () => {
              battle.attack({ attacker: 'wearer', ability: 'BASIC', parts: [{ shape: 'aoe', scaling: 1, hit: 0 }] })
            }),
          },
        },
        onBattleStart: () => battle.addSummon({ id: 'a_totally_different_id', owner: 'wearer', baseSpd: 60, takeTurn: () => {} }),
        attackerState: () => ({}),
        teammateState: () => ({}),
      }),
    }
    const battle = battleOf([member('wearer', odd)], [{ unit: 'wearer', use: 'basic', when: [] }], kernel)
    const seen = flags(battle, 'wearer')
    battle.run()
    expect(seen[0]).toBe(true)
  })

  it('refuses a memosprite wearer at create (Castorice 1407, and the buffed id 1407b1)', () => {
    const { kernel } = encodingKernel()
    for (const id of ['1407', '1407b1']) {
      const wearer = member('c', summoner('c', [], false))
      wearer.kernel.unit.characterId = id
      expect(() => battleOf([wearer], policyOf('c', []), kernel)).toThrow(/BananAmusement Park on c.*NOT MODELLED.*memosprite/)
    }
  })

  it('is off when the wearer has no summon at all', () => {
    const { kernel, requests } = encodingKernel()
    const script: ('basic' | 'dismiss')[] = []
    battleOf([member('wearer', summoner('wearer', script, false))], policyOf('wearer', script), kernel, { cycles: 1 }).run()
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((r) => r.setConditionals?.[SET] === false)).toBe(true)
  })

  it('supplies a yes/no value to Fribbels: the value rides on every request, not Fribbels\' default', () => {
    const { kernel, requests } = encodingKernel()
    const script: ('basic' | 'dismiss')[] = ['basic']
    battleOf([member('wearer', summoner('wearer', script))], policyOf('wearer', script), kernel).run()
    expect(requests.every((r) => typeof r.setConditionals?.[SET] === 'boolean')).toBe(true)
  })
})
