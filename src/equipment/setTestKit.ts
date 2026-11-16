import { Battle, type BattleSetup, type MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { CombatStats, DamageKernel, DamageRequest, KernelBuild } from '../kernel/types'
import type { Kit, KitAction } from '../kits/kit'
import type { Rule } from '../scenario/types'
import { lightConeWithoutBehaviour } from './equipment'
import type { MemberEquipment, SetModule, SetPieces } from './equipment'

/** Shared scaffolding for the relic-set module tests of the release sprint (not a test itself). */

export const profile = loadEnemyProfile('generic-moc')
export const noBuild: KernelBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
export const noCone = lightConeWithoutBehaviour({ id: 'x', name: 'x', reason: 'test' })

type Use = 'basic' | 'skill' | 'ultimate'
export interface Step {
  use: Use
  /** What the action does besides attacking: runs inside the action. */
  effect?: (battle: Battle, self: string) => void
  /** Whether the action attacks the enemy. Default true. */
  attack?: boolean
}

const ABILITY = { basic: 'BASIC', skill: 'SKILL', ultimate: 'ULT' } as const

/**
 * A made-up character that takes `script` one step per turn (an Ultimate is taken in the Ultimate window, by the policy), then
 * Basic ATKs. Its `characterId` is its key, which is what the recording kernel reads the attacker by.
 */
export function scriptedKit(key: string, script: readonly Step[] = [], maxEnergy = 0): Kit {
  return {
    characterId: key,
    path: 'Harmony',
    element: 'Fire',
    maxEnergy,
    create: (battle: Battle) => {
      let step = 0
      const actions: Record<string, KitAction> = {}
      for (const use of ['basic', 'skill', 'ultimate'] as const) {
        actions[use] = {
          kind: use,
          canUse: () => true,
          use: () => {
            const mine = script[step]
            step += 1
            battle.performAction(key, use, use, () => {
              mine?.effect?.(battle, key)
              if (mine?.attack !== false) battle.attack({ attacker: key, ability: ABILITY[use], parts: [{ shape: 'aoe', scaling: 1, hit: 0 }] })
            })
          },
        }
      }
      return { actions, quantities: { step: () => step }, attackerState: () => ({}), teammateState: () => ({}) }
    },
  }
}

/** Rules that play `script` in order for `key`, then Basic ATK. */
export function policyOf(key: string, script: readonly Step[]): Rule[] {
  return [
    ...script.map((s, i): Rule => ({ unit: key, use: s.use, when: [{ what: `${key}.step`, min: i, max: i }] })),
    { unit: key, use: 'basic', when: [] },
  ]
}

export const idle = (key: string): Rule => ({ unit: key, use: 'basic', when: [] })

export function memberOf(key: string, kit: Kit, set?: { module: SetModule, pieces: SetPieces }, stats: Partial<MemberSetup['stats']> = {}): MemberSetup {
  return {
    key,
    kit,
    eidolon: 0,
    affinitiveEidolon: false,
    stats: { maxHp: 1_000_000_000, def: 1000, baseSpd: 1000, ...stats },
    kernel: { unit: { characterId: key, lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
    ...(set && { equipment: { lightCone: noCone, sets: [set] } satisfies MemberEquipment }),
  }
}

export function battleOf(members: MemberSetup[], policy: Rule[], kernel: DamageKernel, overrides: Partial<BattleSetup> = {}): Battle {
  return new Battle({
    members,
    policy,
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0.5, skillPoints: 3, techniques: false },
    kernel,
    ...overrides,
  })
}

/** A kernel that records every request and prices every hit at 1000, with the given stats for the attacker (by its key). */
export function recordingKernel(stats: (request: DamageRequest) => CombatStats | undefined = () => undefined): { kernel: DamageKernel, requests: DamageRequest[] } {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = {
    actionDamage(request) {
      requests.push(request)
      const hit = [{ damage: 1000, scaling: 1 }]
      return fakeResult({ BASIC: hit, SKILL: hit, ULT: hit, FUA: hit }, stats(request))
    },
  }
  return { kernel, requests }
}

/** The requests priced for `key` as the attacker. */
export const byAttacker = (requests: readonly DamageRequest[], key: string): DamageRequest[] => requests.filter((r) => r.attacker.characterId === key)

/**
 * What `read` returns at each damage event of `attacker`, in order: the state the kernel was priced with (a damage event comes right after
 * its pricing and nothing changes between). The battle caches the kernel's answers, so a recording kernel sees only the first request of
 * each distinct state; this sees every hit. Start it before `run`.
 */
export function watch<T>(battle: Battle, attacker: string, read: () => T): T[] {
  const seen: T[] = []
  battle.timeline.bus.on('damageDealt', (dealt) => {
    if (dealt.attacker === attacker) seen.push(read())
  })
  return seen
}

/** The module instance `index` of a member (0 is the light cone, 1 the first set). */
export const instanceOf = (battle: Battle, key: string, index = 1) => battle.member(key).equipmentInstances[index]!
