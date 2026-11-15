import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit } from '../kits/kit'
import { lightConeWithoutBehaviour } from './equipment'
import type { MemberEquipment } from './equipment'
import { SelfEnshroudedRecluse } from './selfEnshroudedRecluse'

const profile = loadEnemyProfile('generic-moc')
const noBuild: KernelBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const noCone = lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' })

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

const basicKit = (): Kit => ({
  characterId: 'basic',
  path: 'Harmony',
  element: 'Fire',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () => battle.performAction(self.key, 'basic', 'basic', () => {
          battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'aoe', scaling: 1, hit: 0 }] })
        }),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
})

const member = (key: string, pieces?: 2 | 4): MemberSetup => ({
  key,
  kit: basicKit(),
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: key, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
  ...(pieces !== undefined && { equipment: { lightCone: noCone, sets: [{ module: SelfEnshroudedRecluse, pieces }] } as MemberEquipment }),
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

const NAME = 'Self-Enshrouded Recluse'

/** Wearer 'w' (4 pieces unless said) and plain allies 'a' and 'b'. */
function setup(pieces: 2 | 4 = 4) {
  const { kernel, requests } = recordingKernel()
  const battle = battleOf([member('w', pieces), member('a'), member('b')], kernel)
  const attack = (who: string) => {
    battle.member(who).instance.actions.basic!.use()
    return requests.filter((r) => r.attacker.characterId === who).at(-1)!
  }
  /** The team flag 'w' gave in `who`'s attack, made now. */
  const flag = (who: string) => attack(who).teammates.find((t) => t.characterId === 'w')?.teamRelicSet
  /** The wearer's own switch in an attack made now. */
  const own = () => attack('w').setConditionals?.[NAME]
  return { battle, requests, flag, own }
}

describe('Self-Enshrouded Recluse: the module', () => {
  it('is the set the kernel calls by name, with its set id', () => {
    expect(SelfEnshroudedRecluse.name).toBe(NAME)
    expect(SelfEnshroudedRecluse.setId).toBe('128')
    expect(SelfEnshroudedRecluse.type).toBe('relic')
  })

  it('at 2 pieces passes no conditionals and no team flag, even to a shielded ally (the Shield Effect is not modelled)', () => {
    const { battle, requests, flag } = setup(2)
    battle.party.setShield('a', 'w.shield', 500, 'w')
    battle.party.setShield('w', 'w.shield', 500, 'w')
    expect(flag('a')).toBeUndefined()
    battle.member('w').instance.actions.basic!.use()
    for (const r of requests) expect(r.setConditionals).toBeUndefined()
  })
})

describe('Self-Enshrouded Recluse 4-piece: CRIT DMG for allies holding a shield the wearer provided', () => {
  it("with no shields the switch is passed OFF (not left to Fribbels' default ON) and no ally gets the flag", () => {
    const { flag, own } = setup()
    expect(own()).toBe(false)
    expect(flag('a')).toBeUndefined()
  })

  it('an ally holding a shield from the wearer gets the team form; one without does not', () => {
    const { battle, flag } = setup()
    battle.party.setShield('a', 'w.shield', 500, 'w')
    expect(flag('a')).toBe(NAME)
    expect(flag('b')).toBeUndefined()
  })

  it('a shield from someone else, or one the ally provides itself, does not count', () => {
    const { battle, flag } = setup()
    battle.party.setShield('a', 'b.shield', 500, 'b')
    battle.party.setShield('a', 'own', 500)
    expect(flag('a')).toBeUndefined()
  })

  it("the wearer's own switch is on while it holds a shield it provided, and the wearer gives itself no team flag", () => {
    const { battle, requests, own } = setup()
    battle.party.setShield('w', 'b.shield', 500, 'b')
    expect(own()).toBe(false)
    battle.party.setShield('w', 'w.lc', 500)
    expect(own()).toBe(true)
    const last = requests.filter((r) => r.attacker.characterId === 'w').at(-1)!
    expect(last.teammates.every((t) => t.teamRelicSet === undefined)).toBe(true)
  })

  it('ends when the shield is worn away or removed', () => {
    const { battle, flag } = setup()
    battle.party.setShield('a', 'w.shield', 500, 'w')
    battle.party.takeDamage('a', 600, 'enemy')
    expect(flag('a')).toBeUndefined()
    battle.party.setShield('a', 'w.shield', 500, 'w')
    battle.party.setShield('a', 'w.shield', undefined)
    expect(flag('a')).toBeUndefined()
  })
})
