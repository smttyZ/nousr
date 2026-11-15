import { describe, expect, it } from 'vitest'
import { Battle } from '../battle/battle'
import type { MemberSetup } from '../battle/battle'
import { loadEnemyProfile } from '../enemy/profile'
import { fakeResult } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Path } from '../battle/party'
import type { Kit } from '../kits/kit'
import { Sunday } from '../kits/sunday'
import { PastAndFuture } from './pastAndFuture'

const profile = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }

const Ally: Kit = {
  characterId: 'ally',
  path: 'Hunt',
  element: 'Lightning',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () =>
          battle.performAction(self.key, 'basic', 'basic', () =>
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0 }] }),
          ),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
}

const kernel = (requests: DamageRequest[]): DamageKernel => ({
  actionDamage(request) {
    requests.push(request)
    return fakeResult({ BASIC: [{ damage: 1000, scaling: 1 }] })
  },
})

const sunday = (superimposition = 5): MemberSetup => ({
  key: 'sunday',
  kit: Sunday,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1e6, def: 1000, baseSpd: 100 },
  kernel: { unit: { characterId: '1313', lightConeId: '21025', eidolon: 0, superimposition }, build: noBuild },
  equipment: { lightCone: PastAndFuture, sets: [] },
})
const ally = (key: string, baseSpd: number): MemberSetup => ({
  key,
  kit: Ally,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1e6, def: 1000, baseSpd },
  kernel: { unit: { characterId: 'ally', lightConeId: 'x', eidolon: 0, superimposition: 1 }, build: noBuild },
})

function setup(options: { superimposition?: number, supPath?: Path } = {}) {
  const superimposition = options.superimposition ?? 5
  const requests: DamageRequest[] = []
  const battle = new Battle({
    members: [sunday(superimposition), ally('dps', 90), { ...ally('sup', 80), kit: { ...Ally, path: options.supPath ?? 'Hunt' } }],
    policy: ['sunday', 'dps', 'sup'].map((unit) => ({ unit, use: 'basic' as const, when: [] })),
    profile,
    enemyCount: 1,
    weaknesses: 'all',
    cycles: 3,
    start: { energy: 0, skillPoints: 4, techniques: false },
    kernel: kernel(requests),
  })
  /** What the module tells the kernel about the wearer when `key` attacks. */
  const told = (key: string) => battle.member('sunday').equipmentInstances[0]!.teammateState!(battle.member(key), battle.primary).lightConeConditionals!.postSkillDmgBuff === true
  return { battle, requests, told, skill: (target: string) => battle.member('sunday').instance.actions.skill!.use(target) }
}

describe('Past and Future', () => {
  it('is Fribbels\' 21025, with the text\'s 16% to 32% living in Fribbels, and rejects a bad superimposition', () => {
    expect(PastAndFuture.id).toBe('21025')
    expect(() => setup({ superimposition: 6 })).toThrow(/superimposition must be 1 to 5/)
  })

  it('is off before the wearer uses a Skill (never Fribbels\' default of on)', () => {
    const { told } = setup()
    expect(told('dps')).toBe(false)
    expect(told('sup')).toBe(false)
  })

  it("lands on the next ally to take action, only for that ally's turn", () => {
    const { battle, told, skill } = setup()
    skill('dps')
    const seen: Array<{ unit: string, dps: unknown, sup: unknown, sunday: unknown }> = []
    battle.timeline.bus.on('turnStart', (t) => {
      if (t.unit === 'sunday' || t.unit === 'dps' || t.unit === 'sup') seen.push({ unit: t.unit, dps: told('dps'), sup: told('sup'), sunday: told('sunday') })
    })
    battle.run()
    // Sunday's Skill advances dps, so dps acts next: the buff is on dps for that turn only.
    expect(seen[0]).toEqual({ unit: 'dps', dps: true, sup: false, sunday: false })
    for (const turn of seen.slice(1)) expect(turn, `${turn.unit} later`).toMatchObject({ dps: false, sup: false, sunday: false })
  })

  it("goes to whoever acts next, not necessarily the Skill's target (a Harmony target takes no immediate action)", () => {
    const { battle, told, skill } = setup({ supPath: 'Harmony' })
    skill('sup')
    expect(battle.timeline.gauge('sup')).toBeGreaterThan(0)
    const seen: Array<{ unit: string, dps: boolean, sup: boolean }> = []
    battle.timeline.bus.on('turnStart', (t) => {
      if (t.unit === 'dps' || t.unit === 'sup') seen.push({ unit: t.unit, dps: told('dps'), sup: told('sup') })
    })
    battle.run()
    // dps (90 SPD) acts before sup (80 SPD): it gets the buff, and sup, the Skill's target, does not.
    expect(seen[0]).toEqual({ unit: 'dps', dps: true, sup: false })
    expect(seen.find((t) => t.unit === 'sup')).toEqual({ unit: 'sup', dps: false, sup: false })
  })

  it('does not reach the wearer, and a second Skill before anyone acts does not stack', () => {
    const { battle, told, skill } = setup()
    skill('dps')
    skill('dps')
    expect(battle.timeline.modifiers.has('sunday', 'lightcone.21025.dmg:sunday')).toBe(false)
    battle.run()
    expect(told('sunday')).toBe(false)
  })
})
