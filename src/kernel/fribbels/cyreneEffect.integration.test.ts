import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { Battle, CYRENE_KERNEL_ID } from '../../battle/battle'
import type { MemberSetup } from '../../battle/battle'
import type { EngineEvents } from '../../engine'
import { loadEnemyProfile } from '../../enemy/profile'
import { DanHengPT } from '../../kits/danHengPT'
import { JingYuan } from '../../kits/jingYuan'
import type { Kit } from '../../kits/kit'
import { Tribbie } from '../../kits/tribbie'
import type { Rule } from '../../scenario/types'
import type { DamageKernel, DamageRequest, KernelBuild } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Cyrene's ally-specific effects through the real kernel, with a stub Cyrene (character 1415 for Fribbels) that turns an effect on:
 * - Tribbie (Ode to Passage): the kit's `cyreneSpecialEffect` switch reaches Fribbels (its DEF ignore), and her follow-up's Zone
 *   Additional DMG is Fribbels' own price of the doubled hit (the kit's twice the multiple equals Fribbels' doubled `hpScaling`).
 * - Dan Heng PT (Ode to Earth): the Bondmate's attack is priced with the switch on, and is higher than with it off.
 */

const profile = loadEnemyProfile('generic-moc')
const tribbieBuild: KernelBuild = {
  relicSet1: Sets.PioneerDiverOfDeadWaters,
  relicSet2: Sets.PioneerDiverOfDeadWaters,
  ornamentSet: Sets.IzumoGenseiAndTakamaDivineRealm,
  body: Stats.CD,
  feet: Stats.HP_P,
  planarSphere: Stats.Quantum_DMG,
  linkRope: Stats.HP_P,
  substatRolls: { [Stats.HP_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const atkBuild: KernelBuild = {
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.InertSalsotto,
  body: Stats.CD,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

/** The real kernel, keeping every request the battle sent. */
const recording = (): { kernel: DamageKernel, requests: DamageRequest[] } => {
  const requests: DamageRequest[] = []
  return {
    requests,
    kernel: {
      actionDamage: (r) => {
        requests.push(r)
        return kernel.actionDamage(r)
      },
    },
  }
}

const stubCyrene = (targets: readonly string[], active: boolean): Kit => ({
  characterId: 'cyrene-stub',
  path: 'Remembrance',
  element: 'Ice',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: { basic: { kind: 'basic', canUse: () => true, use: () => battle.performAction(self.key, 'basic', 'basic', () => {}) } },
    attackerState: () => ({}),
    teammateState: () => ({}),
    onBattleStart: () => {
      for (const t of targets) battle.setCyreneEffect(t, active, self.key)
    },
  }),
})
const cyrene = (targets: readonly string[], active: boolean, eidolon = 0): MemberSetup => ({
  key: 'cyrene',
  kit: stubCyrene(targets, active),
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 80 },
  kernel: { unit: { characterId: CYRENE_KERNEL_ID, lightConeId: '23024', eidolon, superimposition: 1 }, build: atkBuild },
})

const rule = (unit: string, use: string, when: Rule['when'] = []): Rule => ({ unit, use, when })

describe('Tribbie with Cyrene Ode to Passage on', () => {
  const run = (active: boolean, cyreneEidolon = 0) => {
    const { kernel: recorded, requests } = recording()
    const tribbie: MemberSetup = {
      key: 'tribbie',
      kit: Tribbie,
      eidolon: 6,
      affinitiveEidolon: false,
      stats: { maxHp: 1_000_000, def: 1000, baseSpd: 101 },
      kernel: { unit: { characterId: '1403', lightConeId: '21018', eidolon: 6, superimposition: 1 }, build: tribbieBuild },
    }
    const battle = new Battle({
      members: [tribbie, cyrene(['tribbie'], active, cyreneEidolon)],
      policy: [rule('tribbie', 'ultimate', [{ what: 'tribbie.zone', is: false }]), rule('tribbie', 'basic'), rule('cyrene', 'basic')],
      profile,
      enemyCount: 1,
      weaknesses: 'all',
      cycles: 1,
      start: { energy: 1, skillPoints: 0, techniques: false },
      kernel: recorded,
    })
    const dealt: EngineEvents['damageDealt'][] = []
    battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
    battle.run()
    // Her first request with the Zone up is the one her Ultimate and the follow-up after it are priced from (no Lamb stacks yet).
    const zoneRequest = requests.find((r) => r.attacker.characterId === '1403' && r.attacker.characterConditionals?.ultZone === true)!
    const fua = dealt.filter((d) => d.attacker === 'tribbie' && d.ability === 'FUA')
    return { zoneRequest, fuaTotal: fua.reduce((s, d) => s + d.damage, 0), fuaHits: fua.length }
  }

  for (const [active, label] of [[true, 'on'], [false, 'off']] as const) {
    it(`effect ${label}: the request carries the switch ${label} with Cyrene in the team, and the follow-up equals Fribbels' own FUA hits for it`, () => {
      const { zoneRequest, fuaTotal, fuaHits } = run(active)
      expect(zoneRequest.attacker.characterConditionals).toMatchObject({ cyreneSpecialEffect: active })
      expect(zoneRequest.teammates.map((t) => t.characterId)).toContain(CYRENE_KERNEL_ID)
      const fua = kernel.actionDamage(zoneRequest).hits.FUA!
      // One enemy: the main hit once, the Zone's Additional DMG once per enemy hit. Doubled by Fribbels with the effect on, and by the kit.
      expect(fuaHits).toBe(2)
      expect(fuaTotal).toBeCloseTo(fua[0]!.damage + fua[1]!.damage, 6)
      // Fribbels doubles the hit's multiple with the effect on.
      const off = kernel.actionDamage({
        ...zoneRequest,
        attacker: { ...zoneRequest.attacker, characterConditionals: { ...zoneRequest.attacker.characterConditionals!, cyreneSpecialEffect: false } },
      })
      expect(fua[1]!.scaling! / off.hits.FUA![1]!.scaling!).toBeCloseTo(active ? 2 : 1, 12)
    })
  }

  it('the effect adds damage (the DEF ignore and the extra instance): more with it on than off', () => {
    expect(run(true).fuaTotal).toBeGreaterThan(run(false).fuaTotal)
  })
})

describe('Dan Heng PT with Cyrene Ode to Earth on: the Bondmate DMG boost', () => {
  const run = (active: boolean) => {
    const { kernel: recorded, requests } = recording()
    const dhpt: MemberSetup = {
      key: 'dhpt',
      kit: DanHengPT,
      eidolon: 0,
      affinitiveEidolon: false,
      stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
      kernel: { unit: { characterId: '1414', lightConeId: '24002', eidolon: 0, superimposition: 5 }, build: atkBuild },
    }
    const jy: MemberSetup = {
      key: 'jy',
      kit: JingYuan,
      eidolon: 0,
      affinitiveEidolon: false,
      stats: { maxHp: 1_000_000, def: 1000, baseSpd: 100 },
      kernel: { unit: { characterId: '1204', lightConeId: '21034', eidolon: 0, superimposition: 4 }, build: atkBuild },
    }
    const battle = new Battle({
      members: [dhpt, jy, cyrene(['dhpt'], active)],
      policy: [rule('jy', 'basic')],
      profile,
      enemyCount: 1,
      weaknesses: 'all',
      cycles: 1,
      start: { energy: 0, skillPoints: 5, techniques: false },
      kernel: recorded,
    })
    const dealt: EngineEvents['damageDealt'][] = []
    battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
    battle.member('cyrene').instance.onBattleStart!({ techniques: false })
    battle.member('dhpt').instance.actions.skill!.use('jy')
    battle.member('jy').instance.actions.basic!.use()
    const jyRequest = [...requests].reverse().find((r) => r.attacker.characterId === '1204')!
    return { jyRequest, basic: dealt.filter((d) => d.attacker === 'jy' && d.ability === 'BASIC').reduce((s, d) => s + d.damage, 0) }
  }

  it('the Bondmate is priced with the switch as the effect says, equal to Fribbels own price for that request', () => {
    for (const active of [true, false]) {
      const { jyRequest, basic } = run(active)
      const dhptState = jyRequest.teammates.find((t) => t.characterId === '1414')!.characterConditionals
      expect(dhptState).toMatchObject({ bondmate: true, cyreneSpecialEffect: active })
      expect(basic, `active ${active}`).toBeCloseTo(kernel.actionDamage(jyRequest).damage.BASIC!, 6)
    }
  })

  it('with the effect on the Bondmate hits harder, by the 24% DMG boost on top of his other DMG boosts', () => {
    const on = run(true)
    const off = run(false)
    expect(on.basic).toBeGreaterThan(off.basic)
    // DMG boost is additive with the attacker's other DMG%: the ratio is (1 + other + 0.24) / (1 + other), above 1 and below 1.24.
    expect(on.basic / off.basic).toBeGreaterThan(1.05)
    expect(on.basic / off.basic).toBeLessThan(1.24)
  })
})
