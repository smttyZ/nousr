import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit } from '../kits/kit'
import type { Rule } from '../scenario/types'
import { lightConeWithoutBehaviour } from './equipment'
import type { MemberEquipment } from './equipment'
import { WarriorGoddessOfSunAndThunder as Module } from './warriorGoddessOfSunAndThunder'

const SET = 'Warrior Goddess of Sun and Thunder'
const GENTLE_RAIN = 'set.125.gentleRain'
const profile = loadEnemyProfile('generic-moc')
const noBuild: KernelBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const noCone = lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' })

/** A kernel that records every request it is asked and prices each hit at 1,000 per 100%. */
function recordingKernel() {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = {
    actionDamage(request) {
      requests.push(request)
      const hit = [{ damage: 1000, scaling: 1 }]
      return fakeResult({ BASIC: hit, SKILL: hit, ULT: hit, FUA: hit })
    },
  }
  return { kernel, requests }
}

/**
 * A Basic-only kit. `beforeAttack(n, self, battle)` runs inside its nth Basic ATK, before the attack, so it can heal.
 * `summon`, when given, puts a summon with that id on the timeline (a memosprite stand-in for the heal source).
 */
const basicKit = (beforeAttack: (n: number, self: string, battle: Battle) => void = () => {}, summon?: string): Kit => ({
  characterId: 'basic',
  path: 'Harmony',
  element: 'Fire',
  maxEnergy: 0,
  create: (battle, self) => {
    let n = 0
    if (summon) battle.addSummon({ id: summon, owner: self.key, baseSpd: 50, takeTurn: () => {} })
    return {
      actions: {
        basic: {
          kind: 'basic',
          canUse: () => true,
          use: () => {
            n += 1
            battle.performAction(self.key, 'basic', 'basic', () => {
              beforeAttack(n, self.key, battle)
              battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'aoe', scaling: 1, hit: 0 }] })
            })
          },
        },
      },
      attackerState: () => ({}),
      teammateState: () => ({}),
    }
  },
})

const member = (key: string, kit: Kit, pieces: number | undefined, baseSpd = 100): MemberSetup => ({
  key,
  kit,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
  kernel: { unit: { characterId: key, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
  ...(pieces !== undefined && { equipment: { lightCone: noCone, sets: [{ module: Module, pieces: pieces as 2 | 4 }] } as MemberEquipment }),
})

const basicRules = (...units: string[]): Rule[] => units.map((unit) => ({ unit, use: 'basic', when: [] }))

function battleOf(members: MemberSetup[], kernel: DamageKernel, cycles = 1) {
  return new Battle({
    members,
    policy: basicRules(...members.map((m) => m.key)),
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles,
    start: { energy: 0.5, skillPoints: 3, techniques: false },
    kernel,
  })
}

describe('Warrior Goddess of Sun and Thunder: the module', () => {
  it('is the set the kernel calls by name, with its set id', () => {
    expect(Module.name).toBe(SET)
    expect(Module.setId).toBe('125')
    expect(Module.type).toBe('relic')
  })

  it('is off until the wearer heals an ally, and the wearer\'s own attacks are then priced with it on', () => {
    const { kernel, requests } = recordingKernel()
    battleOf(
      [member('w', basicKit((n, self, battle) => { if (n === 1) battle.party.heal('f', 100, self) }), 4, 200), member('f', basicKit(), undefined, 50)],
      kernel,
    ).run()
    const mine = requests.filter((r) => r.attacker.characterId === 'w')
    // The first action heals before it attacks, so no request for the wearer is priced without Gentle Rain.
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((r) => r.setConditionals![SET] === true)).toBe(true)
  })

  it('is off on the wearer\'s attacks when nothing has been healed', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('w', basicKit(), 4, 100), member('f', basicKit(), undefined, 50)], kernel).run()
    const mine = requests.filter((r) => r.attacker.characterId === 'w')
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((r) => r.setConditionals![SET] === false)).toBe(true)
  })

  it('gives a teammate\'s attack the team effect while the wearer has Gentle Rain, and not before', () => {
    const { kernel, requests } = recordingKernel()
    battleOf(
      [member('w', basicKit((n, self, battle) => { if (n === 1) battle.party.heal('f', 100, self) }), 4, 100), member('f', basicKit(), undefined, 90)],
      kernel,
      2,
    ).run()
    // The wearer acts first (faster), so friend's first attack already sees the Gentle Rain.
    const friend = requests.filter((r) => r.attacker.characterId === 'f')
    expect(friend.length).toBeGreaterThan(0)
    for (const r of friend) expect(r.teammates[0]!.teamRelicSet).toBe(SET)
  })

  it('does not trigger on a heal to the wearer itself', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('w', basicKit((n, self, battle) => { battle.party.heal(self, 100, self) }), 4, 100), member('f', basicKit(), undefined, 50)], kernel).run()
    expect(requests.filter((r) => r.attacker.characterId === 'w').every((r) => r.setConditionals![SET] === false)).toBe(true)
  })

  it('does not trigger on a heal by someone other than the wearer or its memosprite', () => {
    const { kernel, requests } = recordingKernel()
    // Friend heals a third member; the wearer is not the source.
    battleOf(
      [
        member('w', basicKit(), 4, 100),
        member('f', basicKit((n, self, battle) => { battle.party.heal('g', 100, self) }), undefined, 90),
        member('g', basicKit(), undefined, 50),
      ],
      kernel,
    ).run()
    expect(requests.filter((r) => r.attacker.characterId === 'w').every((r) => r.setConditionals![SET] === false)).toBe(true)
  })

  it('does not trigger when the set is only two pieces, however the heal lands', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('w', basicKit((n, self, battle) => { if (n === 1) battle.party.heal('f', 100, self) }), 2, 100), member('f', basicKit(), undefined, 50)], kernel).run()
    expect(requests.filter((r) => r.attacker.characterId === 'w').every((r) => r.setConditionals![SET] === false)).toBe(true)
  })

  it('counts a heal from the wearer\'s memosprite (a summon named after the wearer)', () => {
    const { kernel, requests } = recordingKernel()
    battleOf(
      [member('w', basicKit((n, _self, battle) => { if (n === 1) battle.party.heal('f', 100, 'w.memo') }, 'w.memo'), 4, 100), member('f', basicKit(), undefined, 50)],
      kernel,
    ).run()
    expect(requests.filter((r) => r.attacker.characterId === 'w')[0]!.setConditionals![SET]).toBe(true)
  })

  it('does not count a heal from an ally\'s memosprite', () => {
    const { kernel, requests } = recordingKernel()
    battleOf(
      [
        member('w', basicKit(), 4, 100),
        member('f', basicKit((n, _self, battle) => { if (n === 1) battle.party.heal('g', 100, 'f.memo') }, 'f.memo'), undefined, 90),
        member('g', basicKit(), undefined, 50),
      ],
      kernel,
    ).run()
    expect(requests.filter((r) => r.attacker.characterId === 'w').every((r) => r.setConditionals![SET] === false)).toBe(true)
  })

  it('triggers once per turn: two heals in one action give one Gentle Rain, and a later turn can trigger again', () => {
    const { kernel } = recordingKernel()
    const battle = battleOf(
      [
        member('w', basicKit((n, self, b) => {
          if (n === 1) { b.party.heal('f', 100, self); b.party.heal('f', 100, self) }
          if (n === 2) b.party.heal('f', 100, self)
        }), 4, 200),
        member('f', basicKit(), undefined, 100),
      ],
      kernel,
      2,
    )
    let applied = 0
    battle.timeline.bus.on('modifierApplied', ({ modifier }) => {
      if (modifier.id === GENTLE_RAIN) applied += 1
    })
    battle.run()
    expect(applied).toBe(2)
  })

  it('lasts two of the wearer\'s turns, not counting the turn it was gained in, and it is +6% SPD while it lasts', () => {
    const { kernel } = recordingKernel()
    const battle = battleOf(
      [member('w', basicKit((n, self, battle) => { if (n === 1) battle.party.heal('f', 100, self) }), 4, 200), member('f', basicKit(), undefined, 100)],
      kernel,
      2,
    )
    const up: boolean[] = []
    let spdPct: number | undefined
    battle.timeline.bus.on('modifierApplied', ({ modifier }) => {
      if (modifier.id === GENTLE_RAIN) {
        spdPct = modifier.spdPct
        expect(modifier.turnsLeft).toBe(2)
      }
    })
    battle.timeline.bus.on('turnStart', (turn) => {
      if (turn.unit === 'w') up.push(battle.timeline.modifiers.has('w', GENTLE_RAIN))
    })
    battle.run()
    // Gained in the wearer's first turn: up at the start of turns 2 and 3, gone at turn 4.
    expect(up.slice(0, 4)).toEqual([false, true, true, false])
    expect(spdPct).toBe(0.06)
  })

  it('has no team effect on a teammate attack without Gentle Rain', () => {
    const { kernel, requests } = recordingKernel()
    battleOf([member('w', basicKit(), 4, 100), member('f', basicKit(), undefined, 90)], kernel, 2).run()
    const friend = requests.filter((r) => r.attacker.characterId === 'f')
    expect(friend.length).toBeGreaterThan(0)
    for (const r of friend) expect(r.teammates[0]!.teamRelicSet).toBeUndefined()
  })
})
