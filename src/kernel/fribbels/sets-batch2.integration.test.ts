import { describe, expect, it } from 'vitest'
import { SACERDOS_RELIVED_ORDEAL_1_STACK, SACERDOS_RELIVED_ORDEAL_2_STACK, Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { Battle } from '../../battle/battle'
import type { MemberSetup } from '../../battle/battle'
import { loadEnemyProfile } from '../../enemy/profile'
import type { Kit } from '../../kits/kit'
import { lightConeWithoutBehaviour } from '../../equipment/equipment'
import type { MemberEquipment } from '../../equipment/equipment'
import { BrokenKeel } from '../../equipment/brokenKeel'
import { LushakaTheSunkenSeas } from '../../equipment/lushakaTheSunkenSeas'
import { SacerdosRelivedOrdeal } from '../../equipment/sacerdosRelivedOrdeal'
import { SelfEnshroudedRecluse } from '../../equipment/selfEnshroudedRecluse'
import { WarriorGoddessOfSunAndThunder } from '../../equipment/warriorGoddessOfSunAndThunder'
import type { Rule } from '../../scenario/types'
import type { DamageKernel, DamageRequest, KernelBuild, KernelTeammate, KernelUnit } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * The second batch of set modules against the real Fribbels kernel (DESIGN.md, K4). For each set with a conditional:
 * Fribbels' default is what the module must replace, the module's live value moves Fribbels' damage the way the
 * in-game text says, and a battle sends the module's value to the kernel. Broken Keel's test shows the Fribbels
 * mechanism that makes its module refuse at create().
 */

const WG = Sets.WarriorGoddessOfSunAndThunder
const LUSHAKA = Sets.LushakaTheSunkenSeas
const RECLUSE = Sets.SelfEnshroudedRecluse
const SACERDOS = Sets.SacerdosRelivedOrdeal
const KEEL = Sets.BrokenKeel

const base: KernelBuild = {
  relicSet1: '',
  relicSet2: '',
  ornamentSet: '',
  body: Stats.CD,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const unit: KernelUnit = { characterId: '1308', eidolon: 0, lightConeId: '21018', superimposition: 1 }
const teammate = (overrides: Partial<KernelTeammate>): KernelTeammate => ({ ...unit, ...overrides })

const kernel = new FribbelsKernel()
const price = (build: KernelBuild, overrides: Partial<DamageRequest> = {}) => kernel.actionDamage({ attacker: unit, teammates: [], build, ...overrides })

describe('Warrior Goddess of Sun and Thunder against Fribbels', () => {
  const fourPiece: KernelBuild = { ...base, relicSet1: WG, relicSet2: WG }

  it('its switch on the wearer\'s own attacks: on is more damage than off, and Fribbels\' default is off', () => {
    const off = price(fourPiece, { setConditionals: { [WG]: false } })
    const on = price(fourPiece, { setConditionals: { [WG]: true } })
    expect(on.damage.BASIC!).toBeGreaterThan(off.damage.BASIC!)
    expect(price(fourPiece).damage.BASIC).toBe(off.damage.BASIC)
  })

  it('as a teammate: the team effect on the attacker raises its damage, and the attacker is unaffected without it', () => {
    expect(price(base, { teammates: [teammate({ teamRelicSet: WG })] }).damage.BASIC!).toBeGreaterThan(price(base).damage.BASIC!)
  })
})

describe('Lushaka, the Sunken Seas against Fribbels', () => {
  const lushaka: KernelBuild = { ...base, ornamentSet: LUSHAKA }

  it('its own-attack switch: the default is on, and the module passes off. In this kernel the switch does not move the wearer\'s damage', () => {
    // Recorded behaviour, not the text: Fribbels routes the own-side 12% through an ATK_P output boost, and neither the
    // BASIC damage nor the ATK stat moves between on and off. If this starts failing, Fribbels has changed; re-check the
    // module's false and the own-side route (see the report).
    const def = price(lushaka)
    const on = price(lushaka, { setConditionals: { [LUSHAKA]: true } })
    const off = price(lushaka, { setConditionals: { [LUSHAKA]: false } })
    expect(def.damage.BASIC).toBe(on.damage.BASIC)
    expect(off.damage.BASIC).toBe(on.damage.BASIC)
    expect(off.stats.ATK).toBe(on.stats.ATK)
  })

  it('as the first character, a teammate team effect raises the attacker\'s damage', () => {
    expect(price(base, { teammates: [teammate({ teamOrnamentSet: LUSHAKA })] }).damage.BASIC!).toBeGreaterThan(price(base).damage.BASIC!)
  })
})

describe('Self-Enshrouded Recluse against Fribbels', () => {
  const fourPiece: KernelBuild = { ...base, relicSet1: RECLUSE, relicSet2: RECLUSE }

  it('its CRIT DMG switch is on by default, which is the trap the module refuses on', () => {
    const def = price(fourPiece)
    const on = price(fourPiece, { setConditionals: { [RECLUSE]: true } })
    const off = price(fourPiece, { setConditionals: { [RECLUSE]: false } })
    expect(def.damage.BASIC).toBe(on.damage.BASIC)
    expect(off.damage.BASIC!).toBeLessThan(on.damage.BASIC!)
  })

  it('as a teammate, the team CRIT DMG raises the attacker\'s damage', () => {
    expect(price(base, { teammates: [teammate({ teamRelicSet: RECLUSE })] }).damage.BASIC!).toBeGreaterThan(price(base).damage.BASIC!)
  })
})

describe('Sacerdos\' Relived Ordeal against Fribbels', () => {
  it('its own-side value defaults to no incoming stacks, and the teammate 1x and 2x stacks each raise damage', () => {
    expect(price(base).damage.BASIC).toBe(price(base, { setConditionals: { [SACERDOS]: 0 } }).damage.BASIC)
    const none = price(base).damage.BASIC!
    const one = price(base, { teammates: [teammate({ teamRelicSet: SACERDOS_RELIVED_ORDEAL_1_STACK })] }).damage.BASIC!
    const two = price(base, { teammates: [teammate({ teamRelicSet: SACERDOS_RELIVED_ORDEAL_2_STACK })] }).damage.BASIC!
    expect(one).toBeGreaterThan(none)
    expect(two).toBeGreaterThan(one)
  })
})

describe('Broken Keel against Fribbels: why the module refuses', () => {
  const keel: KernelBuild = { ...base, ornamentSet: KEEL }

  it('the wearer\'s Effect RES stays under 30% in this build, so Fribbels\' own check does not switch the team effect on', () => {
    expect(price(keel).stats.RES).toBeGreaterThan(0)
    expect(price(keel).stats.RES).toBeLessThan(0.3)
  })

  it('but the team flag raises an ally\'s damage anyway: Fribbels applies it with no Effect RES check', () => {
    expect(price(base, { teammates: [teammate({ teamOrnamentSet: KEEL })] }).damage.BASIC!).toBeGreaterThan(price(base).damage.BASIC!)
  })
})

describe('the battle sends the module\'s value to the kernel, not Fribbels\' default', () => {
  const noCone = lightConeWithoutBehaviour({ id: '21018', name: 'Dance! Dance! Dance!', reason: 'no conditionals in Fribbels' })

  /** A Basic-only kit; the wearer heals `heal` in its first Basic ATK, before the attack. */
  const basicKit = (heal?: string): Kit => ({
    characterId: 'basic',
    path: 'Harmony',
    element: 'Fire',
    maxEnergy: 0,
    create: (battle, self) => {
      let n = 0
      return {
        actions: {
          basic: {
            kind: 'basic',
            canUse: () => true,
            use: () => {
              n += 1
              battle.performAction(self.key, 'basic', 'basic', () => {
                if (heal !== undefined && n === 1) battle.party.heal(heal, 100, self.key)
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

  const member = (key: string, build: KernelBuild, equipment: MemberEquipment | undefined, kit: Kit, baseSpd: number): MemberSetup => ({
    key,
    kit,
    eidolon: 0,
    affinitiveEidolon: false,
    stats: { maxHp: 1_000_000, def: 1000, baseSpd },
    kernel: { unit, build },
    ...(equipment && { equipment }),
  })

  /** Runs one battle through a spying kernel that forwards to the real one. Returns what it was asked, and the damage dealt. */
  const run = (members: MemberSetup[]) => {
    const seen: DamageRequest[] = []
    const spy: DamageKernel = {
      actionDamage(request) {
        seen.push(request)
        return kernel.actionDamage(request)
      },
    }
    const battle = new Battle({
      members,
      policy: members.map((m): Rule => ({ unit: m.key, use: 'basic', when: [] })),
      profile: loadEnemyProfile('generic-moc'),
      enemyCount: 1,
      weaknesses: 'all',
      cycles: 1,
      start: { energy: 0.5, skillPoints: 3, techniques: false },
      kernel: spy,
    })
    const dealt: { attacker: string, damage: number }[] = []
    battle.timeline.bus.on('damageDealt', (d) => dealt.push({ attacker: d.attacker, damage: d.damage }))
    battle.run()
    return { seen, dealt }
  }

  it('Warrior Goddess: the wearer\'s attacks, after it heals an ally, are priced with the switch on', () => {
    const wearerBuild: KernelBuild = { ...base, relicSet1: WG, relicSet2: WG }
    const { seen, dealt } = run([
      member('w', wearerBuild, { lightCone: noCone, sets: [{ module: WarriorGoddessOfSunAndThunder, pieces: 4 }] }, basicKit('f'), 200),
      member('f', base, undefined, basicKit(), 50),
    ])
    const mine = seen.find((r) => r.build === wearerBuild)!
    expect(mine.setConditionals![WG]).toBe(true)
    const wearerDamage = dealt.find((d) => d.attacker === 'w')!.damage
    expect(wearerDamage).toBeCloseTo(kernel.actionDamage(mine).damage.BASIC!, 6)
    // The same request with only the switch changed: on is more damage than off.
    const off = kernel.actionDamage({ ...mine, setConditionals: { [WG]: false } }).damage.BASIC!
    expect(wearerDamage).toBeGreaterThan(off)
  })

  it('Lushaka: the wearer\'s attack is priced with the module\'s false, and the first character gets the team effect', () => {
    const lushakaBuild: KernelBuild = { ...base, ornamentSet: LUSHAKA }
    const { seen, dealt } = run([
      member('f', base, undefined, basicKit(), 100),
      member('w', lushakaBuild, { lightCone: noCone, sets: [{ module: LushakaTheSunkenSeas, pieces: 2 }] }, basicKit(), 90),
    ])
    const mine = seen.find((r) => r.build === lushakaBuild)!
    expect(mine.setConditionals![LUSHAKA]).toBe(false)
    const wearerDamage = dealt.find((d) => d.attacker === 'w')!.damage
    expect(wearerDamage).toBeCloseTo(kernel.actionDamage(mine).damage.BASIC!, 6)

    const first = seen.find((r) => r.build === base)!
    expect(first.teammates[0]!.teamOrnamentSet).toBe(LUSHAKA)
    const firstDamage = dealt.find((d) => d.attacker === 'f')!.damage
    expect(firstDamage).toBeCloseTo(kernel.actionDamage(first).damage.BASIC!, 6)
    // The same request without the team effect: the first character's damage is lower without it.
    const withoutTeamEffect = { ...first, teammates: first.teammates.map((t) => ({ ...t, teamOrnamentSet: undefined })) }
    expect(firstDamage).toBeGreaterThan(kernel.actionDamage(withoutTeamEffect).damage.BASIC!)
  })

  it('Broken Keel: its module refuses at create() because the team flag ignores the wearer\'s Effect RES', () => {
    const keelBuild: KernelBuild = { ...base, ornamentSet: KEEL }
    const build = () =>
      run([member('w', keelBuild, { lightCone: noCone, sets: [{ module: BrokenKeel, pieces: 2 }] }, basicKit(), 100), member('f', base, undefined, basicKit(), 50)])
    expect(build).toThrow(/Effect RES/)
  })
})

describe('the modules name what Fribbels names', () => {
  it.each([
    [WarriorGoddessOfSunAndThunder.name, WG],
    [LushakaTheSunkenSeas.name, LUSHAKA],
    [SelfEnshroudedRecluse.name, RECLUSE],
    [SacerdosRelivedOrdeal.name, SACERDOS],
    [BrokenKeel.name, KEEL],
  ])('module %s', (name, fribbels) => expect(name).toBe(fribbels))
})
