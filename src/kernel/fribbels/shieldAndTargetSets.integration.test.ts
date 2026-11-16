import { beforeAll, describe, expect, it } from 'vitest'
import { Battle } from '../../battle/battle'
import { SACERDOS_ONE_STACK, SACERDOS_TWO_STACKS, sacerdosModifierId } from '../../equipment/sacerdosRelivedOrdeal'
import { planTeam, runScenario } from '../../run/run'
import { parseScenario } from '../../scenario/load'
import type { ScenarioFile } from '../../scenario/types'
import type { DamageRequest, ScenarioKernel } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Sunday's and Dan Heng PT's standard builds through the real kernel, end to end: Sacerdos' Relived Ordeal 4-piece (Sunday) and
 * Self-Enshrouded Recluse 4-piece (Dan Heng PT) no longer refuse, and their team forms reach Fribbels with live values that it prices.
 */

const RECLUSE = 'Self-Enshrouded Recluse'
const SACERDOS = "Sacerdos' Relived Ordeal"

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
      id: 'jy_sunday',
      members: [
        // Today Is Another Peaceful Day S4; Past and Future S5. Both on "standard" relics (Sunday: Sacerdos 4-piece).
        { key: 'jy', character: '1204', eidolon: 0, light_cone: { id: '21034', superimposition: 4 }, relics: 'standard' },
        { key: 'sunday', character: '1313', eidolon: 0, light_cone: { id: '21025', superimposition: 5 }, relics: 'standard' },
      ],
      policy: [
        { unit: 'sunday', use: 'ultimate', target: 'jy' },
        { unit: 'jy', use: 'skill', when: [{ what: 'team.skill_points', min: 2 }] },
        { unit: 'jy', use: 'basic' },
        { unit: 'sunday', use: 'skill', target: 'jy', when: [{ what: 'team.skill_points', min: 1 }] },
        { unit: 'sunday', use: 'basic' },
      ],
    },
    {
      id: 'acheron_dhpt',
      members: [
        // Along the Passing Shore S1; Texture of Memories S5. Both on "standard" relics (Dan Heng PT: Recluse 4-piece).
        { key: 'acheron', character: '1308', eidolon: 0, light_cone: { id: '23024', superimposition: 1 }, relics: 'standard' },
        { key: 'dan_heng', character: '1414', eidolon: 0, light_cone: { id: '24002', superimposition: 5 }, relics: 'standard' },
      ],
      policy: [
        { unit: 'acheron', use: 'ultimate' },
        { unit: 'dan_heng', use: 'ultimate' },
        { unit: 'dan_heng', use: 'skill', target: 'acheron', when: [{ what: 'dan_heng.has_bondmate', is: false }] },
        { unit: 'acheron', use: 'skill', when: [{ what: 'team.skill_points', min: 1 }] },
        { unit: 'acheron', use: 'basic' },
        { unit: 'dan_heng', use: 'basic' },
      ],
    },
  ],
} satisfies ScenarioFile
const scenario = () => parseScenario(file)

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

/** Fribbels' price of `request`'s Basic ATK, and the same with the team relic flag of `teammate` removed. */
function withAndWithout(request: DamageRequest, teammate: string) {
  const without: DamageRequest = {
    ...request,
    teammates: request.teammates.map((t) => (t.characterId === teammate ? { ...t, teamRelicSet: undefined } : t)),
  }
  const first = (r: DamageRequest) => kernel.actionDamage(r).damage.BASIC!
  return { with: first(request), without: first(without) }
}

describe('Sunday and Dan Heng PT on their standard builds run end to end', () => {
  it('both teams run at 1 and 3 enemies, with damage and the standard builds used', () => {
    for (const team of ['jy_sunday', 'acheron_dhpt']) {
      const sc = parseScenario({ ...file, teams: file.teams.filter((t) => t.id === team) })
      const runs = runScenario(sc, { kernel })
      expect(runs.map((r) => r.enemyCount)).toEqual([1, 3])
      for (const run of runs) {
        expect(run.standardBuilds.length).toBe(2)
        expect(run.result.totalDamage).toBeGreaterThan(0)
      }
    }
  })
})

describe("Sacerdos' Relived Ordeal on Sunday's standard build", () => {
  it("his Skill on Jing Yuan gives him a stack, then two; Jing Yuan's attacks carry 1x then 2x, and Fribbels prices them higher", () => {
    const { spied, requests } = spiedKernel()
    const battle = new Battle(planTeam(scenario(), 'jy_sunday', 1, { kernel: spied }).setup)
    const jyFlag = () => requests.filter((r) => r.attacker.characterId === '1204').at(-1)!.teammates.find((t) => t.characterId === '1313')?.teamRelicSet
    const use = (who: string, kind: 'basic' | 'skill', target?: string) => battle.member(who).instance.actions[kind]!.use(target)

    use('jy', 'basic')
    expect(jyFlag()).toBeUndefined()
    use('sunday', 'skill', 'jy')
    expect(battle.timeline.modifiers.get('jy', sacerdosModifierId('sunday'))?.stacks).toBe(1)
    use('jy', 'basic')
    expect(jyFlag()).toBe(SACERDOS_ONE_STACK)
    use('sunday', 'skill', 'jy')
    use('jy', 'basic')
    expect(jyFlag()).toBe(SACERDOS_TWO_STACKS)

    const last = requests.filter((r) => r.attacker.characterId === '1204').at(-1)!
    const price = withAndWithout(last, '1313')
    expect(price.with).toBeGreaterThan(price.without)
    // Sunday's own pricing passes 0 stacks to his own select.
    use('sunday', 'basic')
    expect(requests.filter((r) => r.attacker.characterId === '1313').at(-1)!.setConditionals?.[SACERDOS]).toBe(0)
  })
})

describe("Self-Enshrouded Recluse on Dan Heng PT's standard build", () => {
  it("after his Skill shields the team, Acheron's attacks carry the team form and his own switch is on; Fribbels prices it higher", () => {
    const { spied, requests } = spiedKernel()
    const battle = new Battle(planTeam(scenario(), 'acheron_dhpt', 1, { kernel: spied }).setup)
    const use = (who: string, kind: 'basic' | 'skill', target?: string) => battle.member(who).instance.actions[kind]!.use(target)
    const lastOf = (id: string) => requests.filter((r) => r.attacker.characterId === id).at(-1)!

    use('acheron', 'basic')
    use('dan_heng', 'basic')
    expect(lastOf('1308').teammates.find((t) => t.characterId === '1414')?.teamRelicSet).toBeUndefined()
    // Texture of Memories' own shield comes only when he is hit, so before his Skill he holds none of his.
    expect(lastOf('1414').setConditionals?.[RECLUSE]).toBe(false)

    use('dan_heng', 'skill', 'acheron')
    expect(battle.party.shieldFrom('acheron', 'dan_heng')).toBeGreaterThan(0)
    use('acheron', 'basic')
    use('dan_heng', 'basic')
    expect(lastOf('1308').teammates.find((t) => t.characterId === '1414')?.teamRelicSet).toBe(RECLUSE)
    expect(lastOf('1414').setConditionals?.[RECLUSE]).toBe(true)

    const price = withAndWithout(lastOf('1308'), '1414')
    expect(price.with).toBeGreaterThan(price.without)
  })
})
