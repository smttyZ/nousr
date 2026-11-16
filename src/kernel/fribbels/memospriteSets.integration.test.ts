import { beforeAll, describe, expect, it } from 'vitest'
import { Battle } from '../../battle/battle'
import { planTeam, runScenario } from '../../run/run'
import { songbirdsId } from '../../kits/robinSummeretto'
import { parseScenario } from '../../scenario/load'
import type { ScenarioFile } from '../../scenario/types'
import type { DamageRequest, ScenarioKernel } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * The two memosprite relic sets through the real kernel, on Robin Summeretto's standard build (World-Remaking Deliverer 4-piece
 * and Amphoreus, The Eternal Land): the build runs, her switches reach Fribbels with their live values, and the timeline's SPD and the
 * party's Max HP follow them.
 */

const WRD = 'World-Remaking Deliverer'
const AMPHOREUS = 'Amphoreus, The Eternal Land'
const TOLERANCE = 1e-3 // Fribbels keeps its stats in 32-bit floats

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

const file = {
  format: 'nousr-scenario',
  version: 1,
  game_version: '4.7',
  battle: { mode: 'moc', cycles: 3, period: null },
  enemies: { profile: 'generic-moc', counts: [1, 3] },
  teams: [
    {
      id: 'robin_solo',
      members: [
        // Memory's Curtain Never Falls S1, on "standard" relics: World-Remaking Deliverer 4-piece and Amphoreus.
        { key: 'robin', character: '1512', eidolon: 0, light_cone: { id: '24005', superimposition: 1 }, relics: 'standard' },
      ],
      policy: [
        { unit: 'robin', use: 'skill', when: [{ what: 'team.skill_points', min: 1 }] },
        { unit: 'robin', use: 'basic' },
      ],
    },
  ],
} satisfies ScenarioFile
const scenario = () => parseScenario(file)
/** The same Robin with Basic ATKs only: she never summons the Songbirds, and acts before the enemies can down her. */
const basicOnly = () => parseScenario({ ...file, teams: [{ ...file.teams[0], policy: [{ unit: 'robin', use: 'basic' }] }] })

/** The real kernel, with every damage request it is asked recorded. */
function spiedKernel() {
  const requests: DamageRequest[] = []
  const spied: ScenarioKernel = {
    actionDamage: (request) => (requests.push(request), kernel.actionDamage(request)),
    characterId: (id, version) => kernel.characterId(id, version),
    basicStats: (unit, build) => kernel.basicStats(unit, build),
    scanSource: (source) => kernel.scanSource(source),
  }
  return { spied, requests }
}

describe('Robin Summeretto on her standard build: World-Remaking Deliverer 4-piece and Amphoreus', () => {
  it('runs at 1 and 3 enemies, with damage', () => {
    for (const sc of [scenario(), basicOnly()]) {
      const runs = runScenario(sc, { kernel })
      expect(runs.map((r) => r.enemyCount)).toEqual([1, 3])
      expect(runs.every((r) => r.standardBuilds.length === 1)).toBe(true)
    }
    for (const run of runScenario(basicOnly(), { kernel })) expect(run.result.totalDamage).toBeGreaterThan(0)
    const [one] = runScenario(scenario(), { kernel })
    expect(one!.result.totalDamage).toBeGreaterThan(0)
    expect(one!.result.downed).toEqual([])
  })

  // Robin alone is knocked down at 3 enemies when she summons the Songbirds first (no healer, one body): damage 0, a result and not
  // an error. The same happens with both sets replaced by no-behaviour stand-ins, so it is not these sets.
  it('and alone at 3 enemies on the Skill policy she is downed before the Songbirds act, which is a result, not an error', () => {
    const [, three] = runScenario(scenario(), { kernel })
    expect(three!.result.downed).toEqual(['robin'])
  })

  it("her World-Remaking Deliverer switch is off before her Skill and on after it, with the Songbirds on the field", () => {
    const { spied, requests } = spiedKernel()
    const battle = new Battle(planTeam(scenario(), 'robin_solo', 1, { kernel: spied }).setup)
    const mine = () => requests.filter((r) => r.attacker.characterId === '1512')
    battle.member('robin').instance.actions.basic!.use()
    expect(mine().length).toBeGreaterThan(0)
    expect(mine().every((r) => r.setConditionals?.[WRD] === false)).toBe(true)

    battle.member('robin').instance.actions.skill!.use()
    expect(battle.memospritesOf('robin')).toEqual([songbirdsId('robin')])
    battle.member('robin').instance.actions.basic!.use()
    // The kernel is asked with it on for her Basic ATK (and her Max HP), and with it off for her Max HP without the set.
    const on = mine().filter((r) => r.setConditionals?.[WRD] === true)
    expect(on.length).toBeGreaterThan(0)
    expect(on.every((r) => r.setConditionals?.[AMPHOREUS] === true)).toBe(true)
  })

  it("the party's Max HP follows the switch: hers by the kernel's 24% of base, the Songbirds' by 24% of theirs", () => {
    const battle = new Battle(planTeam(scenario(), 'robin_solo', 1, { kernel }).setup)
    const before = battle.party.get('robin').maxHp
    battle.member('robin').instance.actions.skill!.use()
    const songbirds = songbirdsId('robin')
    const gained = battle.party.get('robin').maxHp - before
    expect(gained).toBeGreaterThan(0)
    // 24% of base HP, so no more than 24% of the total.
    expect(gained).toBeLessThanOrEqual(0.24 * before + TOLERANCE)
    // Summoned at 70% of her Max HP read before the set was on (the kit reads it once), then +24%.
    expect(battle.party.get(songbirds).maxHp).toBeCloseTo(0.7 * before * 1.24, 3)
    // The kernel's own Max HP for her, with the switch live, is what the party holds.
    expect(battle.combatStats('robin').HP).toBeCloseTo(battle.party.get('robin').maxHp, 2)
  })

  it("Amphoreus: the timeline's SPD for her agrees with the kernel's with and without the Songbirds, so no SPD check can trip", () => {
    const battle = new Battle(planTeam(scenario(), 'robin_solo', 1, { kernel }).setup)
    const spd = () => battle.timeline.spd('robin')
    const kernelSpd = () => battle.combatStats('robin').SPD
    expect(kernelSpd()).toBeCloseTo(spd(), 3)
    const before = spd()
    battle.member('robin').instance.actions.skill!.use() // summons the Songbirds
    expect(battle.timeline.modifiers.has('robin', 'set.323.spd')).toBe(true)
    const baseSpd = battle.member('robin').stats.baseSpd
    expect(spd() - before).toBeCloseTo(0.08 * baseSpd, 3)
    expect(kernelSpd()).toBeCloseTo(spd(), 3)
    expect(Math.abs(kernelSpd() - spd())).toBeLessThan(TOLERANCE)
    // The Songbirds leaving takes it off both.
    battle.removeMemosprite(songbirdsId('robin'))
    expect(spd()).toBeCloseTo(before, 6)
    expect(kernelSpd()).toBeCloseTo(spd(), 3)
  })
})
