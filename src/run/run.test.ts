import { describe, expect, it } from 'vitest'
import { fakeResult } from '../kernel/testing'
import type { BasicStats, DamageRequest, KernelBuild, KernelUnit, ScannedRelic, ScenarioKernel } from '../kernel/types'
import { createRegistry, lightConeWithoutBehaviour, setWithoutBehaviour } from '../equipment/equipment'
import type { RegisteredKit } from '../kits/index'
import type { Kit } from '../kits/kit'
import { parseScenario } from '../scenario/load'
import type { AccountScan, MemberFile, ScanRelic, ScenarioFile } from '../scenario/types'
import { isScannedBuild } from '../kernel/types'
import { buildBattleSetup, planTeam, RunError, runScenario, runTeam, type StandardBuildRequest } from './run'

/** A made-up character: Basic 100% single (+1 skill point), Skill 200% to all (-1 skill point). */
const Striker: Kit = {
  characterId: '9001',
  path: 'Hunt',
  element: 'Fire',
  maxEnergy: 100,
  abilityVersions: [0, 1],
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
      skill: {
        kind: 'skill',
        canUse: () => battle.skillPoints >= 1,
        use: () =>
          battle.performAction(self.key, 'skill', 'skill', () => {
            battle.spendSkillPoints(1)
            battle.attack({ attacker: self.key, ability: 'SKILL', parts: [{ shape: 'aoe', scaling: 2, hit: 0 }] })
          }),
      },
      ultimate: { kind: 'ultimate', canUse: () => false, use: () => {} },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
}

const kits: ReadonlyMap<string, RegisteredKit> = new Map([['9001', { name: 'Striker', kit: Striker }]])

/** Made-up items for the made-up character: a light cone and the sets of the fake build and the fake scan. */
const equipment = createRegistry([
  lightConeWithoutBehaviour({ id: '20000', name: 'Fake Cone', reason: 'test item' }),
  setWithoutBehaviour({ type: 'relic', name: 'Set A', reason: 'test item' }),
  setWithoutBehaviour({ type: 'ornament', name: 'Ornament', reason: 'test item' }),
  setWithoutBehaviour({ type: 'relic', name: 'Fake 117', setId: '117', reason: 'test item' }),
])

const BASIC: BasicStats = {
  ATK: 3000, DEF: 1200, HP: 1_000_000, SPD: 134.5, CR: 0.5, CD: 1, EHR: 0, RES: 0.35, BE: 0, ERR: 0.194, OHB: 0, baseSPD: 101,
}

/** Knows character 9001 in versions 0 and 1, and 1407 in version 0. 1,000 damage per 100% ATK. */
function fakeKernel() {
  const calls = { basicStats: [] as { unit: KernelUnit, build: KernelBuild }[], damage: [] as DamageRequest[] }
  const kernel: ScenarioKernel = {
    characterId(gameId, abilityVersion) {
      if (gameId === '1407' && (abilityVersion ?? 0) === 0) return '1407' // for the kit-options tests (a stand-in kit)
      if (gameId !== '9001') throw new Error(`no character ${gameId}`)
      if (abilityVersion === undefined || abilityVersion === 1) return '9001b1'
      if (abilityVersion === 0) return '9001'
      throw new Error(`no ability_version ${abilityVersion} of ${gameId}`)
    },
    basicStats(unit, build) {
      calls.basicStats.push({ unit, build })
      return { ...BASIC }
    },
    scanSource(source) {
      if (source === 'HSR-Scanner') return { speedVerified: false }
      if (source === 'reliquary_archiver') return { speedVerified: true }
      throw new Error(`no reader for scan source "${source}"`)
    },
    actionDamage(request) {
      calls.damage.push(request)
      return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }], SKILL: [{ damage: 2000, scaling: 2 }] }, { ...BASIC })
    },
  }
  return { kernel, calls }
}

const build: KernelBuild = {
  relicSet1: 'Set A', relicSet2: 'Set A', ornamentSet: 'Ornament', body: 'CRIT DMG', feet: 'SPD',
  planarSphere: 'Fire DMG Boost', linkRope: 'ATK%', substatRolls: { 'CRIT Rate': 10 },
}

function scenarioFile(overrides: Partial<ScenarioFile> = {}): ScenarioFile {
  return {
    format: 'nousr-scenario',
    version: 1,
    game_version: '4.7',
    battle: { mode: 'moc', cycles: 3, start: { energy: 0.5, skill_points: 3, techniques: true } },
    enemies: { profile: 'generic-moc', counts: [1, 3], weaknesses: 'all' },
    teams: [
      {
        id: 'solo',
        members: [{
          key: 'striker',
          character: '9001',
          eidolon: 2,
          affinitive_eidolon: true,
          light_cone: { id: '20000', superimposition: 4 },
          relics: 'standard',
        }],
        policy: [{ unit: 'striker', use: 'skill' }, { unit: 'striker', use: 'basic' }],
      },
    ],
    ...overrides,
  }
}

function setup(file: ScenarioFile = scenarioFile()) {
  const { kernel, calls } = fakeKernel()
  const requests: StandardBuildRequest[] = []
  const options = {
    kernel,
    kits,
    equipment,
    standardBuild: (request: StandardBuildRequest) => {
      requests.push(request)
      return build
    },
  }
  return { scenario: parseScenario(file), options, calls, requests }
}

describe('building a battle from a scenario', () => {
  it('takes stats from the kernel\'s basic stats, folding the build\'s SPD% into flat SPD', () => {
    const { scenario, options } = setup()
    const battle = buildBattleSetup(scenario, 'solo', 3, options)
    const member = battle.members[0]!
    expect(member.stats).toEqual({ maxHp: 1_000_000, def: 1200, baseSpd: 101, spdFlat: 33.5, energyRegen: 0.194, effectRes: 0.35 })
    expect(member.stats.baseSpd + member.stats.spdFlat!).toBe(BASIC.SPD)
  })

  it('gives the kernel the mapped id, eidolon, Affinitive Eidolon flag and light cone, and the standard build', () => {
    const { scenario, options, calls, requests } = setup()
    const member = buildBattleSetup(scenario, 'solo', 1, options).members[0]!
    const unit = { characterId: '9001b1', eidolon: 2, ex: 1, lightConeId: '20000', superimposition: 4 }
    expect(member.kernel).toEqual({ unit, build })
    expect(member.kit).toBe(Striker)
    expect(member.eidolon).toBe(2)
    expect(member.affinitiveEidolon).toBe(true)
    expect(calls.basicStats).toEqual([{ unit, build }])
    expect(requests[0]!.characterId).toBe('9001b1')
    expect(requests[0]!.member.key).toBe('striker')
    expect(requests[0]!.team.id).toBe('solo')
  })

  it('passes ability_version through to the kernel\'s id mapping', () => {
    const file = scenarioFile()
    file.teams[0]!.members[0]!.ability_version = 0
    const { scenario, options } = setup(file)
    expect(buildBattleSetup(scenario, 'solo', 1, options).members[0]!.kernel.unit.characterId).toBe('9001')
  })

  it('copies the battle and enemy settings', () => {
    const file = scenarioFile({ enemies: { profile: 'generic-moc', counts: [5], weaknesses: ['Ice'] } })
    const { scenario, options } = setup(file)
    const battle = buildBattleSetup(scenario, scenario.teams[0]!, 5, options)
    expect(battle.enemyCount).toBe(5)
    expect(battle.cycles).toBe(3)
    expect(battle.weaknesses).toEqual(['Ice'])
    expect(battle.start).toEqual({ energy: 0.5, skillPoints: 3, techniques: true })
    expect(battle.profile.id).toBe('generic-moc')
    expect(battle.policy).toBe(scenario.teams[0]!.policy)
    expect(battle.kernel).toBe(options.kernel)
  })
})

describe('running', () => {
  it('runs one team', () => {
    const { scenario, options } = setup()
    const result = runTeam(scenario, 'solo', 3, options)
    expect(result.enemyCount).toBe(3)
    expect(result.cycles).toBe(3)
    expect(result.totalDamage).toBeGreaterThan(0)
  })

  it('runs every team at every enemy count, in file order', () => {
    const file = scenarioFile()
    file.teams.push({ ...file.teams[0]!, id: 'again' })
    const { scenario, options } = setup(file)
    const runs = runScenario(scenario, options)
    expect(runs.map((r) => [r.team, r.enemyCount])).toEqual([['solo', 1], ['solo', 3], ['again', 1], ['again', 3]])
    for (const run of runs) expect(run.result.enemyCount).toBe(run.enemyCount)
    // The skill hits every enemy, so three enemies take more in total than one.
    expect(runs[1]!.result.totalDamage).toBeGreaterThan(runs[0]!.result.totalDamage)
    expect(runs.every((r) => r.result.downed.length === 0)).toBe(true)
  })
})

describe('warnings from the battle', () => {
  /**
   * Hits the primary, then asks for the enemy with the highest HP among all of them: enemy 1 and enemy 3 are
   * tied and the primary is not among them. Enemy 3 carries a mark that the fake kernel prices at double.
   */
  const Zoner: Kit = {
    ...Striker,
    create: (battle, self) => ({
      actions: {
        ...Striker.create(battle, self).actions,
        basic: {
          kind: 'basic',
          canUse: () => true,
          use: () =>
            battle.performAction(self.key, 'basic', 'basic', () => {
              if (battle.enemies.ids.length > 2) battle.applyDebuff({ id: 'zoner.mark', target: battle.enemies.ids[2]!, source: self.key })
              battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] })
              const pick = battle.highestHpAmong(battle.enemies.ids, { attacker: self.key, ability: 'BASIC', hit: 0 })
              battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 0.1, hit: 0, target: pick }] })
            }),
        },
      },
      attackerState: (enemy) => ({ characterConditionals: { marked: battle.debuffChance(enemy) === 1 } }),
      teammateState: () => ({}),
    }),
  }

  function zonerSetup() {
    const { scenario, options } = setup(scenarioFile({ enemies: { profile: 'generic-moc', counts: [1, 3], weaknesses: 'all' } }))
    scenario.teams[0]!.policy = [{ unit: 'striker', use: 'basic', when: [] }]
    const kernel = {
      ...options.kernel,
      actionDamage: (r: DamageRequest) =>
        fakeResult({ BASIC: [{ damage: r.attacker.characterConditionals?.marked ? 2000 : 1000, scaling: 1 }] }, { ...BASIC }),
    }
    return { scenario, options: { ...options, kernel, kits: new Map([['9001', { name: 'Zoner', kit: Zoner }]]) } }
  }

  it("reach the team's warnings with the team and enemy count in front, and only where the tie is undecided", () => {
    const { scenario, options } = zonerSetup()
    const runs = runScenario(scenario, options)
    expect(runs.map((r) => r.result.warnings.length)).toEqual([0, 1])
    expect(runs[0]!.warnings).toEqual([])
    expect(runs[1]!.warnings).toEqual([
      {
        severity: 'warning',
        code: 'undecided-tie',
        message: expect.stringMatching(/^Undecided "highest HP" tie: striker's BASIC hit 0 .*DESIGN.md, "Known approximations"/),
        team: 'solo',
        enemyCount: 3,
      },
    ])
    // The battle's own record carries no team or enemy count; the runner adds them.
    expect(runs[1]!.result.warnings[0]).toEqual({ severity: 'warning', code: 'undecided-tie', message: runs[1]!.warnings[0]!.message })
  })

  it('a plain run has none', () => {
    const { scenario, options } = setup()
    for (const run of runScenario(scenario, options)) {
      expect(run.result.warnings).toEqual([])
      expect(run.warnings).toEqual([])
    }
  })
})

describe('kit options (K25, K26)', () => {
  // A stand-in kit for Castorice's id: the loader uses the real schema/kit-options/1407.schema.json.
  const configured: Record<string, unknown>[] = []
  const Plain: Kit = { ...Striker, characterId: '1407' }
  const optionKits: ReadonlyMap<string, RegisteredKit> = new Map([
    ['1407', { name: 'Optioned', kit: Plain, configure: (o) => { configured.push(o); return { ...Plain } } }],
  ])
  const withMember = (extra: object) => {
    const file = scenarioFile()
    file.teams[0]!.members[0] = { ...file.teams[0]!.members[0]!, key: 'cas', character: '1407', ...extra }
    file.teams[0]!.policy = [{ unit: 'cas', use: 'basic' }]
    return file
  }

  it("the kit is configured with the member's options, defaults filled in, and the plan echoes them", () => {
    configured.length = 0
    const { scenario, options } = setup(withMember({ kit_options: { netherwing_finish_turn: 3 } }))
    const plan = planTeam(scenario, 'solo', 1, { ...options, kits: optionKits })
    expect(configured).toEqual([{ netherwing_finish_turn: 3 }])
    expect(plan.setup.members[0]!.kit).not.toBe(Plain)
    expect(plan.kitOptions).toEqual([{ member: 'cas', options: { netherwing_finish_turn: 3 }, defaulted: [] }])
  })

  it('without kit_options the kit gets the defaults, and the echo says they were defaulted', () => {
    configured.length = 0
    const { scenario, options } = setup(withMember({}))
    const plan = planTeam(scenario, 'solo', 1, { ...options, kits: optionKits })
    expect(configured).toEqual([{ netherwing_finish_turn: 1 }])
    expect(plan.kitOptions).toEqual([{ member: 'cas', options: { netherwing_finish_turn: 1 }, defaulted: ['netherwing_finish_turn'] }])
  })

  it('a kit registered without configure for a character that has an options schema is refused', () => {
    const { scenario, options } = setup(withMember({}))
    const kits: ReadonlyMap<string, RegisteredKit> = new Map([['1407', { name: 'NoConfigure', kit: Plain }]])
    expect(() => planTeam(scenario, 'solo', 1, { ...options, kits })).toThrow(/takes no kit options, but the scenario has a schema/)
  })

  it('members whose kit takes no options are not echoed', () => {
    const { scenario, options } = setup()
    expect(planTeam(scenario, 'solo', 1, options).kitOptions).toEqual([])
  })
})

describe('what cannot be run yet is refused clearly', () => {
  it('a character with no kit, listing the kits that exist', () => {
    const file = scenarioFile()
    file.teams[0]!.members.push({ key: 'other', character: '1006', eidolon: 0, light_cone: { id: '21001', superimposition: 5 } })
    const { scenario, options } = setup(file)
    expect(() => buildBattleSetup(scenario, 'solo', 1, options)).toThrow(/No kit for character 1006\. Kits that exist: 9001 \(Striker\)/)
  })

  it('the real registry lists every reviewed kit', () => {
    const file = scenarioFile()
    file.teams[0]!.members[0]!.character = '1101' // no kit
    const { scenario, options } = setup(file)
    expect(() => buildBattleSetup(scenario, 'solo', 1, { ...options, kits: undefined })).toThrow(/Kits that exist: 1308 \(Acheron\), 1403 \(Tribbie\), 1204 \(Jing Yuan\), 1006 \(Silver Wolf\), 1004 \(Welt\), 1414 \(Dan Heng • Permansor Terrae\), 1313 \(Sunday\), 1208 \(Fu Xuan\), 1512 \(Robin • Summeretto\), 1407 \(Castorice\), 1409 \(Hyacine\), 1415 \(Cyrene\), 1401 \(The Herta\), 1405 \(Anaxa\)$/m)
  })

  describe('scanned relics', () => {
    const spdRelic: ScannedRelic & ScanRelic = {
      set_id: '117', slot: 'Head', rarity: 5, level: 15, mainstat: 'HP',
      substats: [{ key: 'SPD', value: 4, count: 2, step: 3 }], location: '9001', _uid: 'r1',
    }
    const plain: ScannedRelic & ScanRelic = { ...spdRelic, _uid: 'r2', slot: 'Hands', mainstat: 'ATK', substats: [{ key: 'CRIT Rate_', value: 3.2 }] }
    const accountOf = (source: string): AccountScan => ({
      source, version: 4, characters: [], light_cones: [], relics: [spdRelic, plain] as ScanRelic[],
    })
    const choices: [string, MemberFile['relics']][] = [
      ['"equipped"', 'equipped'],
      ['scan ids', ['r1', 'r2']],
      ['relic objects', [spdRelic, plain]],
    ]

    it.each(choices)('are handed to the kernel as they are, given as %s', (_name, relics) => {
      const file = scenarioFile({ account: accountOf('reliquary_archiver') })
      file.teams[0]!.members[0]!.relics = relics
      const { scenario, options, calls } = setup(file)
      const member = buildBattleSetup(scenario, 'solo', 1, { ...options, scanSource: 'reliquary_archiver' }).members[0]!
      const built = member.kernel.build
      expect(isScannedBuild(built) && built.source).toBe('reliquary_archiver')
      expect(isScannedBuild(built) && built.relics.map((r) => r._uid)).toEqual(['r1', 'r2'])
      // The relic objects are the file's own, count and step included.
      expect(isScannedBuild(built) && built.relics[0]).toBe((scenario.teams[0]!.members[0]!.relics as ScanRelic[])[0])
      expect(isScannedBuild(built) && built.relics[0]!.substats[0]).toEqual({ key: 'SPD', value: 4, count: 2, step: 3 })
      expect(calls.basicStats[0]!.build).toBe(built)
      expect(member.stats).toMatchObject({ maxHp: BASIC.HP, baseSpd: 101, spdFlat: 33.5 })
    })

    function planWith(source: string | undefined, scanSource: string | undefined) {
      const file = scenarioFile({ account: accountOf(source ?? 'reliquary_archiver') })
      file.teams[0]!.members[0]!.relics = 'equipped'
      const { scenario, options } = setup(file)
      return planTeam(scenario, 'solo', 1, { ...options, scanSource })
    }

    it('carry no warning from a scanner that writes exact SPD', () => {
      expect(planWith('reliquary_archiver', 'reliquary_archiver').warnings).toEqual([])
    })

    it('carry a warning naming the member when the scanner writes rounded SPD', () => {
      const { warnings } = planWith('HSR-Scanner', 'HSR-Scanner')
      expect(warnings).toEqual([
        {
          severity: 'warning',
          code: 'spd-may-be-understated',
          message: expect.stringMatching(/^SPD may be understated by up to just under 1 \(1 SPD substat.*HSR-Scanner/),
          team: 'solo',
          member: 'striker',
        },
      ])
    })

    it("take the account scan's own source when the caller gives none", () => {
      expect(planWith('reliquary_archiver', undefined).warnings).toEqual([])
      expect(planWith('HSR-Scanner', undefined).warnings).toEqual([
        expect.objectContaining({ code: 'spd-may-be-understated', message: expect.stringMatching(/HSR-Scanner scanner writes SPD rounded down/) }),
      ])
    })

    it("let the caller's scan source override the account's", () => {
      expect(planWith('HSR-Scanner', 'reliquary_archiver').warnings).toEqual([])
    })

    it("read relics as HSR-Scanner's and say so when nothing gives a source (relics inline, no account)", () => {
      const file = scenarioFile({ account: accountOf('reliquary_archiver') })
      file.teams[0]!.members[0]!.relics = 'equipped'
      const { scenario, options } = setup(file)
      delete scenario.scanSource
      const { warnings } = planTeam(scenario, 'solo', 1, options)
      expect(warnings).toEqual([
        expect.objectContaining({ code: 'spd-may-be-understated', message: expect.stringMatching(/source was not given.*HSR-Scanner/) }),
      ])
    })

    it('give no warning when no relic has an SPD substat', () => {
      const file = scenarioFile({ account: accountOf('HSR-Scanner') })
      file.teams[0]!.members[0]!.relics = [plain]
      const { scenario, options } = setup(file)
      expect(planTeam(scenario, 'solo', 1, { ...options, scanSource: 'HSR-Scanner' }).warnings).toEqual([])
    })

    it("reach runScenario's result", () => {
      const file = scenarioFile({ account: accountOf('HSR-Scanner') })
      file.teams[0]!.members[0]!.relics = 'equipped'
      const { scenario, options } = setup(file)
      const runs = runScenario(scenario, { ...options, scanSource: 'HSR-Scanner' })
      expect(runs.map((r) => r.warnings.length)).toEqual([1, 1])
    })

    it("stop with the kernel's reason for a scan source it cannot read", () => {
      const file = scenarioFile({ account: accountOf('HSR-Scanner') })
      file.teams[0]!.members[0]!.relics = 'equipped'
      const { scenario, options } = setup(file)
      expect(() => buildBattleSetup(scenario, 'solo', 1, { ...options, scanSource: 'yas?' }))
        .toThrow("member \"striker\": no reader for scan source \"yas?\"")
    })
  })

  it('standard relics for a character with no standard-build file read the files, and name the character', () => {
    const { scenario, options } = setup()
    expect(() => buildBattleSetup(scenario, 'solo', 1, { ...options, standardBuild: undefined }))
      .toThrow(/team "solo", member "striker": no standard build for character 9001, ability_version 1 in .*standard-builds/)
  })

  it('an ability version the kernel does not have', () => {
    const file = scenarioFile()
    file.teams[0]!.members[0]!.ability_version = 2
    const { scenario, options } = setup(file)
    expect(() => buildBattleSetup(scenario, 'solo', 1, options)).toThrow(/no ability_version 2 of 9001/)
  })

  describe('kit versions (K13)', () => {
    const OnlyBuffed: Kit = { ...Striker, abilityVersions: [1] }
    const buffedKits: ReadonlyMap<string, RegisteredKit> = new Map([['9001', { name: 'Striker', kit: OnlyBuffed }]])

    it('a scenario that names a version the kit does not implement stops with an error', () => {
      const file = scenarioFile()
      file.teams[0]!.members[0]!.ability_version = 0
      const { scenario, options } = setup(file)
      expect(() => buildBattleSetup(scenario, 'solo', 1, { ...options, kits: buffedKits })).toThrow(
        'team "solo", member "striker": the scenario asks for ability_version 0 of character 9001, but its kit implements version 1 only',
      )
    })

    it("a scenario that names no version resolves to the kernel's newest, which the kit must implement", () => {
      const file = scenarioFile()
      const { scenario, options } = setup(file)
      expect(buildBattleSetup(scenario, 'solo', 1, { ...options, kits: buffedKits }).members[0]!.kernel.unit.characterId).toBe('9001b1')
      const oldKit: ReadonlyMap<string, RegisteredKit> = new Map([['9001', { name: 'Striker', kit: { ...Striker, abilityVersions: [0] } }]])
      expect(() => buildBattleSetup(scenario, 'solo', 1, { ...options, kits: oldKit })).toThrow(
        /asks for the newest version the kernel has \(1\) of character 9001, but its kit implements version 0 only/,
      )
    })

    it('a kit that does not declare its versions is refused', () => {
      const { scenario, options } = setup()
      const bare: Kit = { ...Striker }
      delete bare.abilityVersions
      expect(() => buildBattleSetup(scenario, 'solo', 1, { ...options, kits: new Map([['9001', { name: 'Striker', kit: bare }]]) }))
        .toThrow(/does not say which ability versions it implements/)
    })

    it('is reported with the other problems of every team', () => {
      const file = scenarioFile()
      file.teams[0]!.members[0]!.ability_version = 0
      const { scenario, options } = setup(file)
      expect(() => runScenario(scenario, { ...options, kits: buffedKits })).toThrow(/implements version 1 only/)
    })
  })

  describe('equipment (K4)', () => {
    it('hands each member the modules for its light cone and sets', () => {
      const { scenario, options } = setup()
      const member = buildBattleSetup(scenario, 'solo', 1, options).members[0]!
      expect(member.equipment!.lightCone.id).toBe('20000')
      expect(member.equipment!.sets.map((s) => [s.module.name, s.pieces])).toEqual([['Set A', 4], ['Ornament', 2]])
    })

    it('stops, naming every item, when a light cone or set has no module', () => {
      const file = scenarioFile()
      file.teams[0]!.members[0]!.light_cone = { id: '23024', superimposition: 1 }
      const { scenario, options } = setup(file)
      expect(() => buildBattleSetup(scenario, 'solo', 1, { ...options, equipment: createRegistry([]) })).toThrow(
        /team "solo", member "striker": light cone 23024 has no equipment module.*set "Set A" \(4 pieces\) has no equipment module.*set "Ornament" \(2 pieces\) has no equipment module.*as always on/,
      )
    })

    it('uses the real registry by default, which does not know the fake light cone', () => {
      const { scenario, options } = setup()
      expect(() => buildBattleSetup(scenario, 'solo', 1, { ...options, equipment: undefined })).toThrow(/light cone 20000 has no equipment module/)
    })
  })

  it('a period module, which does not exist yet', () => {
    const { scenario, options } = setup(scenarioFile({ battle: { mode: 'moc', cycles: 3, period: 'moc-2026-11-survival-of-the-fittest' } }))
    expect(() => runScenario(scenario, options)).toThrow(/period modules are not built yet/)
  })

  it('an unknown team or an impossible enemy count', () => {
    const { scenario, options } = setup()
    expect(() => buildBattleSetup(scenario, 'nope', 1, options)).toThrow(/no team "nope".*teams: solo/)
    expect(() => buildBattleSetup(scenario, 'solo', 6, options)).toThrow(/from 1 to 5, got 6/)
  })

  it('reports every problem in every team at once, before any battle runs', () => {
    const file = scenarioFile()
    file.teams[0]!.members.push({ key: 'other', character: '1006', eidolon: 0, light_cone: { id: '21001', superimposition: 5 } })
    file.teams.push({ ...file.teams[0]!, id: 'second', members: [{ ...file.teams[0]!.members[0]!, ability_version: 3 }] })
    const { scenario, options, calls } = setup(file)
    let error: RunError | undefined
    try {
      runScenario(scenario, options)
    } catch (cause) {
      error = cause as RunError
    }
    expect(error).toBeInstanceOf(RunError)
    expect(error!.problems).toEqual([
      'team "solo", member "other": No kit for character 1006. Kits that exist: 9001 (Striker)',
      'team "solo", member "other": no character 1006',
      'team "second", member "striker": no ability_version 3 of 9001',
    ])
    expect(calls.damage).toEqual([])
  })
})

describe('technique per member (K31)', () => {
  const seen: Record<string, boolean> = {}
  const Spy: Kit = {
    ...Striker,
    create: (battle, self) => ({ ...Striker.create(battle, self), onBattleStart: ({ techniques }) => { seen[self.key] = techniques } }),
  }
  const spyKits: ReadonlyMap<string, RegisteredKit> = new Map([['9001', { name: 'Spy', kit: Spy }]])

  it('each kit is told its own resolved technique through onBattleStart, and the plan and the run echo who used it', () => {
    const file = scenarioFile()
    file.battle.start = { techniques: false }
    const first = file.teams[0]!
    const team = (id: string, key: string, technique?: boolean) => ({
      ...first,
      id,
      members: [{ ...first.members[0]!, key, ...(technique !== undefined && { technique }) }],
      policy: [{ unit: key, use: 'basic' as const }],
    })
    file.teams = [team('t_on', 'on', true), team('t_default', 'default'), team('t_off', 'off', false)]
    const { scenario, options } = setup(file)
    const plans = ['t_on', 't_default', 't_off'].map((id) => planTeam(scenario, id, 1, { ...options, kits: spyKits }))
    expect(plans.map((p) => p.setup.members.map((m) => m.technique))).toEqual([[true], [false], [false]])
    expect(plans.map((p) => p.techniques)).toEqual([
      [{ member: 'on', used: true, given: true }],
      [{ member: 'default', used: false, given: false }],
      [{ member: 'off', used: false, given: true }],
    ])
    const runs = runScenario(scenario, { ...options, kits: spyKits })
    expect(runs.filter((r) => r.team === 't_on').every((r) => r.techniques[0]!.used)).toBe(true)
    expect(seen).toEqual({ on: true, default: false, off: false })
  })

  it('with no member setting, battle.start.techniques applies to everyone, and the echo says it was not given', () => {
    const { scenario, options } = setup()
    expect(planTeam(scenario, 'solo', 1, options).techniques).toEqual([{ member: 'striker', used: true, given: false }])
  })
})
