import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRegistry, lightConeWithoutBehaviour, setWithoutBehaviour } from '../equipment/equipment'
import { fakeResult } from '../kernel/testing'
import type { BasicStats, BenchmarkBuild, KernelBuild, KernelUnit, ScenarioKernel } from '../kernel/types'
import type { RegisteredKit } from '../kits/index'
import type { Kit } from '../kits/kit'
import { parseScenario } from '../scenario/load'
import type { MemberFile, ScenarioFile } from '../scenario/types'
import { STANDARD_BUILD_DIR } from '../standard/load'
import { planTeam, RunError, runScenario } from './run'

/** A made-up character with Acheron's standard-build file: Basic 100% single. */
const Striker: Kit = {
  characterId: '9001',
  path: 'Hunt',
  element: 'Lightning',
  maxEnergy: 100,
  abilityVersions: [0],
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'basic', 'basic', () => {
            battle.gainSkillPoints(1)
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
          }),
      },
      skill: { kind: 'skill', canUse: () => false, use: () => {} },
      ultimate: { kind: 'ultimate', canUse: () => false, use: () => {} },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
}
const kits: ReadonlyMap<string, RegisteredKit> = new Map([['9001', { name: 'Striker', kit: Striker }]])

const equipment = createRegistry([
  lightConeWithoutBehaviour({ id: '20000', name: 'Fake Cone', reason: 'test item' }),
  setWithoutBehaviour({ type: 'relic', name: 'Pioneer Diver of Dead Waters', reason: 'test item' }),
  setWithoutBehaviour({ type: 'ornament', name: 'Izumo Gensei and Takama Divine Realm', reason: 'test item' }),
])

/** A directory with one standard-build file, for character 9001: Acheron's, under another id. */
function standardBuildDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nousr-run-standard-'))
  const file = JSON.parse(readFileSync(join(STANDARD_BUILD_DIR, '1308.json'), 'utf8'))
  file.character = '9001'
  file.name = 'Striker'
  writeFileSync(join(dir, '9001.json'), JSON.stringify(file))
  return dir
}

/** SPD follows the file's own arithmetic: base 101, SPD boots 25.032, 2.3 per SPD roll at K14d's roll value. */
function fakeKernel() {
  const builds: KernelBuild[] = []
  const kernel: ScenarioKernel = {
    characterId: (gameId) => {
      if (gameId !== '9001') throw new Error(`no character ${gameId}`)
      return '9001'
    },
    basicStats(_unit: KernelUnit, build: KernelBuild): BasicStats {
      builds.push(build)
      const b = build as BenchmarkBuild
      const SPD = 101 + (b.feet === 'SPD' ? 25.032 : 0) + b.substatRolls.SPD! * (b.speedRollValue ?? 2.6)
      return { ATK: 3000, DEF: 1200, HP: 1_000_000, SPD, CR: 0.5, CD: 1, EHR: 0, RES: 0, BE: 0, ERR: 0, OHB: 0, baseSPD: 101 }
    },
    scanSource: () => ({ speedVerified: true }),
    actionDamage: () => fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] }),
  }
  return { kernel, builds }
}

function setup(member: Partial<MemberFile> = {}) {
  const file: ScenarioFile = {
    format: 'nousr-scenario',
    version: 1,
    game_version: '4.7',
    battle: { mode: 'moc', cycles: 2 },
    enemies: { profile: 'generic-moc', counts: [1, 3] },
    teams: [{
      id: 'solo',
      members: [{ key: 'striker', character: '9001', eidolon: 0, ability_version: 0, light_cone: { id: '20000', superimposition: 1 }, relics: 'standard', ...member }],
      policy: [{ unit: 'striker', use: 'basic' }],
    }],
  }
  const { kernel, builds } = fakeKernel()
  return { scenario: parseScenario(file), builds, options: { kernel, kits, equipment, standardBuildDir: standardBuildDir() } }
}

describe('"standard" relics read the character\'s file', () => {
  it('the kernel gets the file\'s build with K14d\'s roll values, and the member\'s stats come from it', () => {
    const { scenario, options, builds } = setup()
    const plan = planTeam(scenario, 'solo', 1, options)
    const build = builds.at(-1) as BenchmarkBuild
    expect(build).toMatchObject({ body: 'CRIT Rate', feet: 'SPD', rollQuality: 0.9, speedRollValue: 2.3 })
    expect(build.substatRolls).toMatchObject({ SPD: 4, 'CRIT DMG': 14, 'CRIT Rate': 12, 'ATK%': 2 })
    const member = plan.setup.members[0]!
    expect(member.stats.baseSpd + member.stats.spdFlat!).toBeCloseTo(135.232, 9)
    expect(plan.warnings).toEqual([])
    expect(plan.standardBuilds).toHaveLength(1)
    expect(plan.standardBuilds[0]).toMatchObject({ member: 'striker', report: { path: 'file', moves: [], spd: { target: 133.34 } } })
  })

  it('the run result echoes the split used, for every enemy count', () => {
    const { scenario, options } = setup({ standard_build: { main_stats: { Body: 'CRIT DMG' } } })
    const runs = runScenario(scenario, options)
    expect(runs.map((r) => r.enemyCount)).toEqual([1, 3])
    for (const run of runs) {
      expect(run.standardBuilds).toHaveLength(1)
      const { member, report } = run.standardBuilds[0]!
      expect(member).toBe('striker')
      expect(report.path).toBe('re-split')
      expect(report.moveText).toEqual(['2 CRIT DMG -> CRIT Rate'])
      expect(report.distributed).toMatchObject({ SPD: 2, 'CRIT DMG': 10, 'CRIT Rate': 12 })
      expect(report.totals).toMatchObject({ SPD: 4, 'CRIT DMG': 12, 'CRIT Rate': 14 })
      expect(report.mainStats.Body).toBe('CRIT DMG')
    }
  })

  it('the standardBuild hook replaces the files, with no report and no SPD check', () => {
    const { scenario, options } = setup()
    const runs = runScenario(scenario, { ...options, standardBuild: () => ({
      relicSet1: 'Pioneer Diver of Dead Waters', relicSet2: 'Pioneer Diver of Dead Waters', ornamentSet: 'Izumo Gensei and Takama Divine Realm',
      body: 'CRIT Rate', feet: 'SPD', planarSphere: 'Lightning DMG Boost', linkRope: 'ATK%', substatRolls: { SPD: 4 },
    }) })
    // The standardBuild hook stands in for the files: no report, no SPD check.
    expect(runs[0]!.standardBuilds).toEqual([])
    expect(runs[0]!.warnings).toEqual([])
  })
})

describe('the scenario override (K14c)', () => {
  it('a main-stat swap with a re-split: the kernel gets the new body and the moved rolls', () => {
    const { scenario, options, builds } = setup({ standard_build: { main_stats: { Body: 'CRIT DMG' } } })
    planTeam(scenario, 'solo', 1, options)
    const build = builds.at(-1) as BenchmarkBuild
    expect(build.body).toBe('CRIT DMG')
    expect(build.substatRolls).toMatchObject({ 'CRIT DMG': 12, 'CRIT Rate': 14, SPD: 4 })
  })

  it('a swap that needs no re-split leaves the file\'s split', () => {
    const { scenario, options } = setup({ standard_build: { main_stats: { 'Link Rope': 'HP%' } } })
    const { report } = planTeam(scenario, 'solo', 1, options).standardBuilds[0]!
    expect(report.path).toBe('file')
    expect(report.moves).toEqual([])
    expect(report.swaps).toEqual([{ slot: 'Link Rope', from: 'ATK%', to: 'HP%' }])
  })

  it('an explicit split overrides the re-split', () => {
    const { scenario, options, builds } = setup({
      standard_build: { main_stats: { Body: 'CRIT DMG' }, distributed: { rolls: { SPD: 2, 'CRIT DMG': 6, 'CRIT Rate': 12, 'ATK%': 4 } } },
    })
    const { report } = planTeam(scenario, 'solo', 1, options).standardBuilds[0]!
    expect(report.path).toBe('explicit')
    expect(report.moves).toEqual([])
    expect((builds.at(-1) as BenchmarkBuild).substatRolls).toMatchObject({ 'CRIT DMG': 8, 'CRIT Rate': 14, 'ATK%': 6 })
  })

  it('an illegal explicit split stops the run, naming the member, the file, the rule and the stat', () => {
    const { scenario, options } = setup({
      standard_build: { main_stats: { Body: 'CRIT DMG' }, distributed: { rolls: { SPD: 2, 'CRIT DMG': 12, 'CRIT Rate': 10 } } },
    })
    const error = (() => {
      try { planTeam(scenario, 'solo', 1, options) } catch (e) { return e }
    })()
    expect(error).toBeInstanceOf(RunError)
    expect((error as RunError).problems).toEqual([
      expect.stringMatching(/^team "solo", member "striker": .*9001\.json: rule \(b\) per-stat cap: standard_build\.distributed gives CRIT DMG 12 rolls, over its cap of 10/),
    ])
    const total = setup({ standard_build: { distributed: { rolls: { SPD: 2, 'CRIT DMG': 12, 'CRIT Rate': 9 } } } })
    expect(() => runScenario(total.scenario, total.options)).toThrow(/rule \(a\) 24 distributed rolls: standard_build\.distributed adds up to 23, not 24/)
  })

  it('a re-split that cannot place its rolls stops the run with what to fix', () => {
    // Acheron's priority is CRIT DMG, CRIT Rate, ATK%, ATK. Fill every stat after CRIT DMG to its cap: 12 CRIT Rate.
    const { scenario, options } = setup({ standard_build: { main_stats: { Body: 'CRIT DMG' } } })
    const dir = options.standardBuildDir
    const path = join(dir, '9001.json')
    const file = JSON.parse(readFileSync(path, 'utf8'))
    file.main_stats.Body = 'ATK%'
    file.distributed.rolls = { 'CRIT DMG': 12, 'CRIT Rate': 12 }
    file.distributed.priority = ['CRIT DMG', 'CRIT Rate']
    writeFileSync(path, JSON.stringify(file))
    expect(() => planTeam(scenario, 'solo', 1, options)).toThrow(/the re-split cannot place 2 of CRIT DMG's 12 distributed rolls.*Give the split yourself in standard_build\.distributed/)
  })

  it('a Feet swap keeps the rolls, runs at the resulting SPD, and warns how far the target was missed (K14f)', () => {
    const { scenario, options, builds } = setup({ standard_build: { main_stats: { Feet: 'ATK%' } } })
    const plan = planTeam(scenario, 'solo', 1, options)
    const build = builds.at(-1) as BenchmarkBuild
    expect(build.feet).toBe('ATK%')
    expect(build.substatRolls.SPD).toBe(4)
    expect(plan.setup.members[0]!.stats.baseSpd + plan.setup.members[0]!.stats.spdFlat!).toBeCloseTo(110.2, 9)
    expect(plan.warnings).toEqual([
      {
        severity: 'warning',
        code: 'spd-target-missed',
        message: expect.stringMatching(/^The standard build's SPD target 133\.34 is missed by 23\.14: the build has 110\.20 out of combat after the main-stat change \(Feet SPD -> ATK%\)\. The distributed rolls were not re-solved for it \(the file's SPD rolls stay as they are, K14f\)\.$/),
        team: 'solo',
        member: 'striker',
      },
    ])
    // The warning reaches the run result for every enemy count, with the team and no enemy count.
    for (const run of runScenario(scenario, options)) {
      expect(run.warnings.filter((w) => w.code === 'spd-target-missed')).toHaveLength(1)
    }
  })

  it('SPD boots that reach the target warn about nothing', () => {
    const { scenario, options } = setup({ standard_build: { main_stats: { Body: 'CRIT DMG' } } })
    expect(planTeam(scenario, 'solo', 1, options).warnings).toEqual([])
  })
})
