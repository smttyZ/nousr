import { describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import type { MemberSetup } from '../../battle/battle'
import {
  EagleOfTwilightLine,
  EQUIPMENT,
  FleetOfTheAgeless,
  GuardOfWutheringSnow,
  LongevousDisciple,
  MessengerTraversingHackerspace,
  PanCosmicCommercialEnterprise,
  WatchmakerMasterOfDreamMachinations,
} from '../../equipment/index'
import type { SetModule, SetPieces } from '../../equipment/equipment'
import { noCone, battleOf, idle, policyOf, scriptedKit, type Step } from '../../equipment/setTestKit'
import type { DamageRequest, KernelBuild, KernelUnit } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * The release-sprint equipment modules against the real Fribbels kernel (DESIGN.md, K4): for each set, a member that wears it is priced
 * with the module's conditional off and on, and the difference is the in-game text's. Then through a real battle, so what the module gives
 * the kernel and what it does to the timeline are seen to agree.
 *
 * Constants Fribbels uses (its own tables): Acheron's base SPD is 101.
 */

const kernel = new FribbelsKernel()
const ACHERON_BASE_SPD = 101

const acheron: KernelUnit = { characterId: '1308', eidolon: 0, lightConeId: '23024', superimposition: 1 }
const fuXuan = { characterId: '1208', eidolon: 0, lightConeId: '23024', superimposition: 1 }

const base: KernelBuild = {
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.IzumoGenseiAndTakamaDivineRealm,
  body: Stats.CD,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const fourPiece = (name: string): KernelBuild => ({ ...base, relicSet1: name, relicSet2: name })
const price = (build: KernelBuild, overrides: Partial<DamageRequest> = {}) => kernel.actionDamage({ attacker: acheron, teammates: [], build, ...overrides })
const withTeammate = (teammate: Partial<DamageRequest['teammates'][number]>) => ({ teammates: [{ ...fuXuan, ...teammate }] })

describe('the modules name the sets Fribbels names, and are registered by game id', () => {
  it.each([
    [GuardOfWutheringSnow, Sets.GuardOfWutheringSnow, '106'],
    [EagleOfTwilightLine, Sets.EagleOfTwilightLine, '110'],
    [LongevousDisciple, Sets.LongevousDisciple, '113'],
    [MessengerTraversingHackerspace, Sets.MessengerTraversingHackerspace, '114'],
    [WatchmakerMasterOfDreamMachinations, Sets.WatchmakerMasterOfDreamMachinations, '118'],
    [FleetOfTheAgeless, Sets.FleetOfTheAgeless, '302'],
    [PanCosmicCommercialEnterprise, Sets.PanCosmicCommercialEnterprise, '303'],
  ])('%#', (module, fribbels, id) => {
    expect(module.name).toBe(fribbels)
    expect(module.setId).toBe(id)
    expect(EQUIPMENT.setsById.get(id)).toBe(module)
    expect(EQUIPMENT.setsByName.get(fribbels)).toBe(module)
  })
})

describe('Messenger Traversing Hackerspace: the switch and the team form are the same +12% SPD, counted once', () => {
  const wearer = fourPiece(Sets.MessengerTraversingHackerspace)
  const off = price(wearer, { setConditionals: { [Sets.MessengerTraversingHackerspace]: false } })

  it("its switch off adds nothing, and on adds 12% of the character's base SPD", () => {
    const on = price(wearer, { setConditionals: { [Sets.MessengerTraversingHackerspace]: true } })
    expect(on.stats.SPD - off.stats.SPD).toBeCloseTo(0.12 * ACHERON_BASE_SPD, 3)
  })

  it("a teammate's team form gives the same +12% to a wearer of nothing", () => {
    const plain = price(base)
    const given = price(base, withTeammate({ teamRelicSet: Sets.MessengerTraversingHackerspace }))
    expect(given.stats.SPD - plain.stats.SPD).toBeCloseTo(0.12 * ACHERON_BASE_SPD, 3)
  })

  it('both at once is counted once, the kernel form of "cannot be stacked"', () => {
    const both = price(wearer, { setConditionals: { [Sets.MessengerTraversingHackerspace]: true }, ...withTeammate({ teamRelicSet: Sets.MessengerTraversingHackerspace }) })
    const one = price(wearer, { setConditionals: { [Sets.MessengerTraversingHackerspace]: true } })
    expect(both.stats.SPD).toBeCloseTo(one.stats.SPD, 6)
  })
})

describe("Watchmaker, Master of Dream Machinations: the switch and the team form are the same +30% Break Effect, counted once", () => {
  const NAME = Sets.WatchmakerMasterOfDreamMachinations
  const wearer = fourPiece(NAME)
  const off = price(wearer, { setConditionals: { [NAME]: false } })

  it('its switch off adds nothing, and on adds 30 points of Break Effect', () => {
    const on = price(wearer, { setConditionals: { [NAME]: true } })
    expect(on.stats.BE - off.stats.BE).toBeCloseTo(0.3, 5)
  })

  it("a teammate's team form gives +30 points to a wearer of nothing", () => {
    const plain = price(base)
    const given = price(base, withTeammate({ teamRelicSet: NAME }))
    expect(given.stats.BE - plain.stats.BE).toBeCloseTo(0.3, 5)
  })

  it('both at once is counted once', () => {
    const both = price(wearer, { setConditionals: { [NAME]: true }, ...withTeammate({ teamRelicSet: NAME }) })
    const one = price(wearer, { setConditionals: { [NAME]: true } })
    expect(both.stats.BE).toBeCloseTo(one.stats.BE, 6)
  })
})

describe('Longevous Disciple: CRIT Rate +8% per stack, and a fractional stack count is the expected CRIT Rate', () => {
  const NAME = Sets.LongevousDisciple
  const at = (stacks: number) => price(fourPiece(NAME), { setConditionals: { [NAME]: stacks } })

  it.each([[1], [2], [0.5], [1.375]])('%s stacks add 8 points each over 0 stacks', (stacks) => {
    expect(at(stacks).stats.CR - at(0).stats.CR).toBeCloseTo(0.08 * stacks, 5)
  })

  it("Fribbels' default is 2 stacks, which is why the module always gives its live value", () => {
    expect(price(fourPiece(NAME)).stats.CR).toBeCloseTo(at(2).stats.CR, 6)
  })
})

describe('Fleet of the Ageless: its team form is a flat +8% ATK, and the wearer reads its own SPD', () => {
  const fleet: KernelBuild = { ...base, ornamentSet: Sets.FleetOfTheAgeless }

  it("a teammate's team form raises the attacker's ATK by 8% of its base ATK", () => {
    const plain = price(base)
    const given = price(base, withTeammate({ teamOrnamentSet: Sets.FleetOfTheAgeless }))
    expect(given.stats.ATK).toBeGreaterThan(plain.stats.ATK)
  })

  it("the wearer's own +8% ATK follows its in-combat SPD over 120, which a team SPD buff can provide", () => {
    const rolled: KernelBuild = { ...fleet, substatRolls: { ...fleet.substatRolls, [Stats.SPD]: 4 } }
    const without = price(rolled)
    const lifted = price(rolled, withTeammate({ teamRelicSet: Sets.MessengerTraversingHackerspace }))
    expect(without.stats.SPD).toBeLessThan(120)
    expect(lifted.stats.SPD).toBeGreaterThanOrEqual(120)
    // Same wearer, same set; the only difference is the SPD, and the ATK is higher by the same 8% of base ATK the team form gives.
    const teamForm = price(base, withTeammate({ teamOrnamentSet: Sets.FleetOfTheAgeless })).stats.ATK - price(base).stats.ATK
    expect(lifted.stats.ATK - without.stats.ATK).toBeCloseTo(teamForm, 3)
  })
})

describe('Pan-Cosmic Commercial Enterprise: ATK follows the wearer\'s Effect Hit Rate, and Fribbels does it on its own', () => {
  const pan = (rolls: number): KernelBuild => ({ ...base, ornamentSet: Sets.PanCosmicCommercialEnterprise, substatRolls: { ...base.substatRolls, [Stats.EHR]: rolls } })
  const izumo = (rolls: number): KernelBuild => ({ ...base, substatRolls: { ...base.substatRolls, [Stats.EHR]: rolls } })

  it('more Effect Hit Rate gives more ATK with the set and the same ATK without it', () => {
    expect(price(pan(8)).stats.ATK).toBeGreaterThan(price(pan(0)).stats.ATK)
    expect(price(izumo(8)).stats.ATK).toBeCloseTo(price(izumo(0)).stats.ATK, 6)
  })

  it('gives +10 points of Effect Hit Rate always', () => {
    expect(price(pan(0)).stats.EHR - price(izumo(0)).stats.EHR).toBeCloseTo(0.1, 5)
  })

  it('has a switch in the form that its conditional never reads, so there is nothing for the module to give', () => {
    expect(() => price(pan(0), { setConditionals: { [Sets.PanCosmicCommercialEnterprise]: false } })).not.toThrow()
  })
})

describe('Guard of Wuthering Snow and Eagle of Twilight Line: priced as builds, nothing conditional for the kernel', () => {
  it('the kernel prices a 4-piece of each', () => {
    expect(price(fourPiece(Sets.GuardOfWutheringSnow)).damage.BASIC).toBeGreaterThan(0)
    expect(price(fourPiece(Sets.EagleOfTwilightLine)).damage.BASIC).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------- through a battle

/** A member with the kernel's real unit and build, its timeline SPD built from the kernel's own base and flat SPD. */
function realMember(key: string, unit: KernelUnit, build: KernelBuild, kit: ReturnType<typeof scriptedKit>, set?: { module: SetModule, pieces: SetPieces }): MemberSetup {
  const stats = kernel.basicStats(unit, build)
  return {
    key,
    kit,
    eidolon: 0,
    affinitiveEidolon: false,
    stats: { maxHp: 1_000_000_000, def: 1000, baseSpd: stats.baseSPD, spdFlat: stats.SPD - stats.baseSPD },
    kernel: { unit, build },
    equipment: { lightCone: noCone, sets: set ? [set] : [] },
  }
}

const ultOnAlly = (target: string): Step => ({
  use: 'ultimate',
  attack: false,
  effect: (b, self) => void b.timeline.modifiers.apply({ id: 'buff', target, source: self, duration: { turns: 2, tick: 'turnEnd' } }),
})

describe('through a battle with the real kernel', () => {
  it('Messenger: after an Ultimate on an ally, the kernel and the timeline have the same +12% on the wearer and on the ally', () => {
    const script = [ultOnAlly('a')]
    const battle = battleOf(
      [
        realMember('w', acheron, fourPiece(Sets.MessengerTraversingHackerspace), scriptedKit('w', script, 0), { module: MessengerTraversingHackerspace, pieces: 4 }),
        realMember('a', fuXuan, base, scriptedKit('a', [], 0)),
      ],
      [...policyOf('w', script), idle('a')],
      kernel,
    )
    const readings: Record<string, number>[] = []
    const read = () => ({
      kernelW: battle.combatStats('w').SPD,
      kernelA: battle.combatStats('a').SPD,
      timelineW: battle.timeline.spd('w'),
      timelineA: battle.timeline.spd('a'),
    })
    const before = read()
    // Right after the Ultimate has resolved and the module has run.
    battle.timeline.bus.on('actionUsed', () => readings.push(read()), { priority: -1000 })
    battle.run()
    const after = readings[0]!
    expect(after.kernelW! - before.kernelW!).toBeCloseTo(0.12 * ACHERON_BASE_SPD, 3)
    expect(after.timelineW! - before.timelineW!).toBeCloseTo(after.kernelW! - before.kernelW!, 3)
    expect(after.kernelA! - before.kernelA!).toBeGreaterThan(0)
    expect(after.timelineA! - before.timelineA!).toBeCloseTo(after.kernelA! - before.kernelA!, 3)
    // Before the Ultimate the kernel is not priced with the set's default (off): the wearer's own switch is false.
    expect(before.timelineW).toBeCloseTo(before.kernelW!, 3)
  })

  it("Watchmaker: after an Ultimate on an ally, the wearer's and the ally's Break Effect are 30 points higher in the kernel, and not before", () => {
    const script = [ultOnAlly('a')]
    const battle = battleOf(
      [
        realMember('w', acheron, fourPiece(Sets.WatchmakerMasterOfDreamMachinations), scriptedKit('w', script, 0), { module: WatchmakerMasterOfDreamMachinations, pieces: 4 }),
        realMember('a', fuXuan, base, scriptedKit('a', [], 0)),
      ],
      [...policyOf('w', script), idle('a')],
      kernel,
    )
    const read = () => ({ w: battle.combatStats('w').BE, a: battle.combatStats('a').BE })
    const before = read()
    const readings: ReturnType<typeof read>[] = []
    battle.timeline.bus.on('actionUsed', () => readings.push(read()), { priority: -1000 })
    battle.run()
    expect(readings[0]!.w - before.w).toBeCloseTo(0.3, 5)
    expect(readings[0]!.a - before.a).toBeCloseTo(0.3, 5)
  })

  it("Longevous Disciple: each hit on the wearer raises its CRIT Rate by 8 points for the kernel, up to 2 stacks", () => {
    const battle = battleOf(
      [realMember('w', acheron, fourPiece(Sets.LongevousDisciple), scriptedKit('w', [], 0), { module: LongevousDisciple, pieces: 4 })],
      [idle('w')],
      kernel,
    )
    const hit = () => battle.timeline.bus.emit('allyHit', { unit: 'w', enemy: battle.primary, attack: 'strike', hits: 1, damage: 0 })
    const base0 = battle.combatStats('w').CR
    const gained = (): number => Math.round((battle.combatStats('w').CR - base0) * 1e4) / 1e4
    // Not Fribbels' default of 2 stacks: with no hit yet the wearer has none.
    expect(gained()).toBe(0)
    hit()
    expect(gained()).toBe(0.08)
    hit()
    expect(gained()).toBe(0.16)
    hit()
    expect(gained()).toBe(0.16)
  })

  it("Fleet: a Messenger Ultimate lifts the wearer over 120 SPD, the kernel's own check and the team's flag agree, and an ally's ATK rises", () => {
    const rolled: KernelBuild = { ...base, ornamentSet: Sets.FleetOfTheAgeless, substatRolls: { ...base.substatRolls, [Stats.SPD]: 4 } }
    const script = [ultOnAlly('w')]
    const battle = battleOf(
      [
        realMember('w', acheron, rolled, scriptedKit('w', [], 0), { module: FleetOfTheAgeless, pieces: 2 }),
        realMember('m', fuXuan, fourPiece(Sets.MessengerTraversingHackerspace), scriptedKit('m', script, 0), { module: MessengerTraversingHackerspace, pieces: 4 }),
      ],
      [...policyOf('m', script), idle('w')],
      kernel,
    )
    const before = { wearerSpd: battle.combatStats('w').SPD, wearerAtk: battle.combatStats('w').ATK, friendAtk: battle.combatStats('m').ATK }
    expect(before.wearerSpd).toBeLessThan(120)
    const after: typeof before[] = []
    battle.timeline.bus.on('actionUsed', () => after.push({ wearerSpd: battle.combatStats('w').SPD, wearerAtk: battle.combatStats('w').ATK, friendAtk: battle.combatStats('m').ATK }), { priority: -1000 })
    expect(() => battle.run()).not.toThrow()
    expect(after[0]!.wearerSpd).toBeGreaterThanOrEqual(120)
    expect(after[0]!.wearerAtk).toBeGreaterThan(before.wearerAtk) // Fribbels' own conditional, on its own SPD
    expect(after[0]!.friendAtk).toBeGreaterThan(before.friendAtk) // the team form, decided by the module on the timeline's SPD
  })
})
