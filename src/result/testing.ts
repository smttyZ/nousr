/**
 * Test support for the result writer and the command line: a made-up character pair, a fake kernel and the files a scenario run
 * reads, so tests run `main` in process without Fribbels. Not used by the program itself.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CliDeps } from '../cli'
import { createRegistry, lightConeWithoutBehaviour, setWithoutBehaviour } from '../equipment/equipment'
import { fakeResult } from '../kernel/testing'
import type { BasicStats, KernelBuild, ScenarioKernel } from '../kernel/types'
import type { RegisteredKit } from '../kits/index'
import type { Kit } from '../kits/kit'
import type { AccountScan, ScanRelic, ScenarioFile } from '../scenario/types'

/** 9001: Basic 100% single (+1 SP), Skill 200% AoE (-1 SP). A member with `defaultAbility` of 1,000 per 100%. */
export const Striker: Kit = {
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

/** 1407 (Castorice's id, so the real kit-options schema applies): the same moves as `Striker`. */
export const Plain: Kit = { ...Striker, characterId: '1407', abilityVersions: [0] }

export const FAKE_KITS: ReadonlyMap<string, RegisteredKit> = new Map<string, RegisteredKit>([
  ['9001', { name: 'Striker', kit: Striker }],
  ['1407', { name: 'Optioned', kit: Plain, configure: () => ({ ...Plain }) }],
])

export const FAKE_EQUIPMENT = createRegistry([
  lightConeWithoutBehaviour({ id: '20000', name: 'Fake Cone', reason: 'test item' }),
  setWithoutBehaviour({ type: 'relic', name: 'Set A', reason: 'test item' }),
  setWithoutBehaviour({ type: 'ornament', name: 'Ornament', reason: 'test item' }),
  setWithoutBehaviour({ type: 'relic', name: 'Fake 117', setId: '117', reason: 'test item' }),
])

export const BASIC: BasicStats = {
  ATK: 3000, DEF: 1200, HP: 1_000_000, SPD: 134.5, CR: 0.5, CD: 1, EHR: 0, RES: 0.35, BE: 0, ERR: 0.194, OHB: 0, baseSPD: 101,
}

/** Knows characters 9001 and 1407. 1,000 damage per 100% ATK; reads HSR-Scanner (SPD rounded down) and reliquary_archiver. */
export function fakeKernel(): ScenarioKernel {
  return {
    characterId(gameId, abilityVersion) {
      if (gameId === '1407' && (abilityVersion ?? 0) === 0) return '1407'
      if (gameId !== '9001') throw new Error(`no character ${gameId}`)
      if (abilityVersion === undefined || abilityVersion === 1) return '9001b1'
      if (abilityVersion === 0) return '9001'
      throw new Error(`no ability_version ${abilityVersion} of ${gameId}`)
    },
    basicStats: () => ({ ...BASIC }),
    scanSource(source) {
      if (source === 'HSR-Scanner') return { speedVerified: false }
      if (source === 'reliquary_archiver') return { speedVerified: true }
      throw new Error(`no reader for scan source "${source}"`)
    },
    actionDamage: () => fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }], SKILL: [{ damage: 2000, scaling: 2 }] }, { ...BASIC }),
  }
}

const FAKE_BUILD: KernelBuild = {
  relicSet1: 'Set A', relicSet2: 'Set A', ornamentSet: 'Ornament', body: 'CRIT DMG', feet: 'SPD',
  planarSphere: 'Fire DMG Boost', linkRope: 'ATK%', substatRolls: { 'CRIT Rate': 10 },
}

/** A scenario of two teams: `solo` (one Striker) and `pair` (a Striker and a Castorice-id stand-in with kit options), at 1 and 3 enemies. */
export function scenarioFile(overrides: Partial<ScenarioFile> = {}): ScenarioFile {
  const striker = () => ({
    key: 'striker',
    character: '9001',
    eidolon: 2,
    affinitive_eidolon: true,
    light_cone: { id: '20000', superimposition: 4 },
    relics: 'standard' as const,
  })
  return {
    format: 'nousr-scenario',
    version: 1,
    game_version: '4.7',
    name: 'Fake scenario',
    battle: { mode: 'moc', cycles: 3, start: { energy: 0.5, skill_points: 3, techniques: true } },
    enemies: { profile: 'generic-moc', counts: [1, 3], weaknesses: 'all' },
    teams: [
      {
        id: 'solo',
        members: [striker()],
        policy: [{ unit: 'striker', use: 'skill' }, { unit: 'striker', use: 'basic' }],
      },
      {
        id: 'pair',
        name: 'Striker and friend',
        members: [
          striker(),
          { key: 'cas', character: '1407', eidolon: 0, light_cone: { id: '20000', superimposition: 1 }, relics: 'standard' as const, kit_options: { netherwing_finish_turn: 2 } },
        ],
        policy: [
          { unit: 'striker', use: 'skill' },
          { unit: 'striker', use: 'basic' },
          { unit: 'cas', use: 'skill' },
          { unit: 'cas', use: 'basic' },
        ],
      },
    ],
    ...overrides,
  }
}

/** An account scan in HSR-Scanner's format with a SPD substat on a Striker relic (so a run warns that SPD may be understated). */
export function accountScan(source = 'HSR-Scanner'): AccountScan {
  const relic: ScanRelic = {
    set_id: '117', slot: 'Head', rarity: 5, level: 15, mainstat: 'HP',
    substats: [{ key: 'SPD', value: 4 }], location: '9001', _uid: 'r1',
  }
  return { source, version: 4, characters: [], light_cones: [], relics: [relic] }
}

/** A new empty folder under the system's temp folder, for scenario and output files. */
export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'nousr-test-'))
}

/** Writes a JSON file (and the folders above it) and returns its path. */
export function writeJson(dir: string, name: string, value: unknown): string {
  const file = join(dir, name)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2))
  return file
}

export interface Captured {
  deps: CliDeps
  out: () => string
  err: () => string
}

/** Everything `main` needs, with the fake kernel and kits, capturing what it prints. `tty` makes both streams look like a terminal. */
export function captureDeps(cwd: string, options: { tty?: boolean, env?: Record<string, string> } = {}): Captured {
  let out = ''
  let err = ''
  const deps: CliDeps = {
    stdout: { write: (t) => ((out += t), true), isTTY: options.tty === true },
    stderr: { write: (t) => ((err += t), true), isTTY: options.tty === true },
    env: options.env ?? {},
    cwd,
    kernel: fakeKernel,
    runOptions: { kits: FAKE_KITS, equipment: FAKE_EQUIPMENT, standardBuild: () => FAKE_BUILD },
    identity: { nousr: '9.9.9', nousr_commit: null },
  }
  return { deps, out: () => out, err: () => err }
}
