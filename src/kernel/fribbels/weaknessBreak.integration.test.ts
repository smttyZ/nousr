import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { generateContext } from '../../../vendor/hsr-optimizer/src/lib/optimization/context/calculateContext'
import { generateFullDefaultForm } from '../../../vendor/hsr-optimizer/src/lib/simulations/utils/benchmarkForm'
import type { CharacterId } from '../../../vendor/hsr-optimizer/src/types/character'
import type { LightConeId } from '../../../vendor/hsr-optimizer/src/types/lightCone'
import { Battle } from '../../battle/battle'
import type { MemberSetup } from '../../battle/battle'
import { loadEnemyProfile } from '../../enemy/profile'
import type { EnemyProfile } from '../../enemy/profile'
import { EQUIPMENT, resolveEquipment } from '../../equipment/index'
import { Acheron } from '../../kits/acheron'
import { Tribbie } from '../../kits/tribbie'
import type { DamageRequest, DamageResult, KernelBuild } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Weakness break through the real kernel (DESIGN.md, K7). What these pin:
 * - The Break DMG the runner deals is Fribbels' own BREAK number for the same request with the enemy broken.
 * - A broken enemy takes 1 / 0.9 of what an unbroken one does from the same hit.
 * - The toughness the kits declare (internal units, from the game data) is Fribbels' `toughnessDmg` times 3
 *   for the same ability, so the two sources agree and the unit conversion is right.
 */

const acheronBuild: KernelBuild = {
  relicSet1: Sets.PioneerDiverOfDeadWaters,
  relicSet2: Sets.PioneerDiverOfDeadWaters,
  ornamentSet: Sets.IzumoGenseiAndTakamaDivineRealm,
  body: Stats.CD,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10, [Stats.BE]: 4 },
}
const tribbieBuild: KernelBuild = { ...acheronBuild, feet: Stats.HP_P, planarSphere: Stats.Quantum_DMG, linkRope: Stats.HP_P, substatRolls: { [Stats.HP_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 } }

const gear = (lightConeId: string, build: KernelBuild, eidolon: number) =>
  resolveEquipment({ characterId: 'x', lightConeId, eidolon, superimposition: 1 }, build, EQUIPMENT)

const acheron = (eidolon: number, ex: boolean): MemberSetup => ({
  equipment: gear('23024', acheronBuild, eidolon),
  key: 'acheron',
  kit: Acheron,
  eidolon,
  affinitiveEidolon: ex,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 101 },
  kernel: { unit: { characterId: '1308', lightConeId: '23024', eidolon, superimposition: 1, ex: ex ? 1 : 0 }, build: acheronBuild },
})
const tribbie = (): MemberSetup => ({
  equipment: gear('21018', tribbieBuild, 0),
  key: 'tribbie',
  kit: Tribbie,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 120 },
  kernel: { unit: { characterId: '1403', lightConeId: '21018', eidolon: 0, superimposition: 1 }, build: tribbieBuild },
})

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

/** The kernel, remembering every request and what it answered. */
function recording() {
  const calls: { request: DamageRequest, result: DamageResult }[] = []
  return {
    calls,
    actionDamage(request: DamageRequest) {
      const result = kernel.actionDamage(request)
      calls.push({ request, result })
      return result
    },
  }
}

const profileWithBar = (toughness: number): EnemyProfile => ({ ...loadEnemyProfile('generic-moc'), toughness })

function battleOf(members: MemberSetup[], toughness: number, enemyCount = 1, k: { actionDamage: (r: DamageRequest) => DamageResult } = kernel) {
  return new Battle({
    members,
    policy: [],
    profile: profileWithBar(toughness),
    enemyCount,
    weaknesses: 'all',
    cycles: 5,
    start: { energy: 0.5, skillPoints: 3, techniques: false },
    kernel: k,
  })
}

describe("Break DMG is Fribbels' BREAK number", () => {
  it("Acheron's Basic ATK on a 30 bar breaks it; the Break DMG dealt equals the kernel's BREAK for the same request, broken", () => {
    const rec = recording()
    const battle = battleOf([acheron(0, false)], 30, 1, rec)
    const dealt: { ability: string, damage: number }[] = []
    battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
    battle.member('acheron').instance.actions.basic!.use()

    const breakDealt = dealt.filter((d) => d.ability === 'BREAK')
    expect(breakDealt).toHaveLength(1)

    // Fribbels' own number: the request the runner sent for the Break DMG, answered by the kernel again with
    // nothing changed except what the runner set: the enemy broken.
    const brokenCall = rec.calls.find((c) => c.request.enemy?.weaknessBroken === true)!
    expect(brokenCall).toBeDefined()
    expect(breakDealt[0]!.damage).toBe(brokenCall.result.damage.BREAK)
    const again = kernel.actionDamage({ ...brokenCall.request, enemy: { ...brokenCall.request.enemy, weaknessBroken: true } })
    expect(breakDealt[0]!.damage).toBe(again.damage.BREAK)
    expect(breakDealt[0]!.damage).toBeGreaterThan(0)

    // The same request with the enemy not broken is 0.9 of it: this is the multiplier the runner chose.
    const unbroken = kernel.actionDamage({ ...brokenCall.request, enemy: { ...brokenCall.request.enemy, weaknessBroken: false } })
    expect(unbroken.damage.BREAK! / again.damage.BREAK!).toBeCloseTo(0.9, 12)
    // And the request carried the bar the profile has: Break DMG scales with (0.5 + bar / 120).
    expect(brokenCall.request.enemy?.maxToughness).toBe(30)
  })

  it("Tribbie (Quantum) is priced the same way, and scales with the enemy's bar", () => {
    const dealtFor = (bar: number) => {
      const battle = battleOf([tribbie()], bar)
      const dealt: { ability: string, damage: number }[] = []
      battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
      battle.member('tribbie').instance.actions.basic!.use()
      battle.member('tribbie').instance.actions.basic!.use()
      return dealt.filter((d) => d.ability === 'BREAK')
    }
    const small = dealtFor(30)
    const large = dealtFor(60)
    expect(small).toHaveLength(1)
    expect(large).toHaveLength(1)
    // Fribbels: x (0.5 + maxToughness / 120): (0.5 + 60 / 120) / (0.5 + 30 / 120) = 1 / 0.75.
    expect(large[0]!.damage / small[0]!.damage).toBeCloseTo(1 / 0.75, 9)
  })
})

describe('broken against not broken', () => {
  it('the same Basic ATK deals 1 / 0.9 as much to a broken enemy', () => {
    // No equipment modules: Along the Passing Shore would put a debuff on the enemy with the first hit and
    // change the second hit's state, which is not what this measures.
    const battle = battleOf([{ ...acheron(0, false), equipment: undefined }], 30)
    const dealt: { ability: string, damage: number }[] = []
    battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
    const basic = battle.member('acheron').instance.actions.basic!
    basic.use() // breaks the 30 bar: priced as not broken
    basic.use() // the enemy is broken now
    const hits = dealt.filter((d) => d.ability === 'BASIC')
    expect(hits).toHaveLength(2)
    expect(hits[1]!.damage / hits[0]!.damage).toBeCloseTo(1 / 0.9, 12)
  })
})

describe("the kits' toughness is Fribbels' toughnessDmg times 3", () => {
  /** Fribbels' toughnessDmg per default action kind, for its first hit. */
  function fribbelsToughness(characterId: string, lightConeId: string, eidolon: number, ex: number): Record<string, number> {
    const form = generateFullDefaultForm(characterId as CharacterId, lightConeId as LightConeId, eidolon, 1, false, ex)
    const context = generateContext(form)
    const out: Record<string, number> = {}
    for (const action of context.defaultActions) {
      const t = action.hits?.[0]?.toughnessDmg
      if (t !== undefined) out[action.actionType] = t
    }
    return out
  }

  it('Acheron: Basic 10, Skill 20, Ultimate 35, follow-up 10 on the primary target', () => {
    const f = fribbelsToughness('1308', '23024', 0, 1)
    expect(f).toMatchObject({ BASIC: 10, SKILL: 20, ULT: 35, FUA: 10 })
    const bar = (b: Battle) => b.enemies.toughness(b.primary)

    const basic = battleOf([acheron(0, true)], 480, 3)
    basic.member('acheron').instance.actions.basic!.use()
    expect(480 - bar(basic)).toBe(f.BASIC! * 3)

    const skill = battleOf([acheron(0, true)], 480, 3)
    skill.member('acheron').instance.actions.skill!.use()
    expect(480 - bar(skill)).toBe(f.SKILL! * 3)

    // Nine knots, so that all three Rainblades detonate: the in-game 15 + 15 per Rainblade and 15 for Stygian Resurge.
    const ult = battleOf([acheron(0, true)], 480, 3)
    ult.timeline.modifiers.apply({ id: 'acheron.crimson_knot', target: ult.primary, source: 'acheron', stacks: 9 })
    ult.member('acheron').instance.actions.ultimate!.use()
    expect(480 - bar(ult)).toBe(f.ULT! * 3)
  })

  it('Tribbie: Basic 10, Ultimate 20, follow-up 5 on the primary target', () => {
    const f = fribbelsToughness('1403', '21018', 0, 0)
    expect(f).toMatchObject({ BASIC: 10, ULT: 20, FUA: 5 })
    const bar = (b: Battle) => b.enemies.toughness(b.primary)

    const basic = battleOf([tribbie()], 480, 3)
    basic.member('tribbie').instance.actions.basic!.use()
    expect(480 - bar(basic)).toBe(f.BASIC! * 3)

    const ult = battleOf([tribbie()], 480, 3)
    ult.party.setEnergy('tribbie', 120)
    ult.member('tribbie').instance.actions.ultimate!.use()
    expect(480 - bar(ult)).toBe(f.ULT! * 3)
  })
})
