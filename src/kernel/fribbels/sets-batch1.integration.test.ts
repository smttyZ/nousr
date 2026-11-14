import { describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { Battle, type BattleSetup, type MemberSetup } from '../../battle/battle'
import { lightConeWithoutBehaviour } from '../../equipment/equipment'
import type { MemberEquipment } from '../../equipment/equipment'
import { TheAshblazingGrandDuke } from '../../equipment/ashblazingGrandDuke'
import { GeniusOfBrilliantStars } from '../../equipment/geniusOfBrilliantStars'
import { ScholarLostInErudition } from '../../equipment/scholarLostInErudition'
import { TheWondrousBananAmusementPark } from '../../equipment/wondrousBananAmusementPark'
import { loadEnemyProfile } from '../../enemy/profile'
import type { Kit, KitAction } from '../../kits/kit'
import type { Rule } from '../../scenario/types'
import type { DamageRequest, HitResult, KernelBuild, KernelUnit } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * The five relic and ornament sets of batch 1 against the real Fribbels kernel. For each set with a conditional:
 * (1) the kernel's own response to the value (the way the in-game text says), and
 * (2) a battle run through the module: every damage event equals a direct kernel call with the value the module
 * was meant to supply, so the module's value is what reaches Fribbels and not its default.
 *
 * Wearer: Jing Yuan (1204), Lightning, on Dance! Dance! Dance! (no Fribbels conditionals for that light cone).
 */

const kernel = new FribbelsKernel()
const profile = loadEnemyProfile('generic-moc')
const unit: KernelUnit = { characterId: '1204', lightConeId: '21018', eidolon: 0, superimposition: 1 }
const enemy = {
  count: 1,
  level: profile.level,
  maxToughness: profile.toughness,
  resistance: profile.res,
  elementalWeak: true,
  weaknessBroken: false,
}

/** A build with a 4-piece relic set and an ornament, every substat rolled the same way as the other kernel tests. */
const buildWith = (relic: string, ornament: string): KernelBuild => ({
  relicSet1: relic,
  relicSet2: relic,
  ornamentSet: ornament,
  body: Stats.CD,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
})

const DEFAULT_ORNAMENT = Sets.IzumoGenseiAndTakamaDivineRealm

/** The kernel's answer for one action of Jing Yuan, with the set value given (or left to Fribbels' default). */
function direct(build: KernelBuild, setConditionals?: Record<string, number | boolean>) {
  const request: DamageRequest = {
    attacker: unit,
    teammates: [],
    build,
    enemy,
    ...(setConditionals && { setConditionals }),
  }
  return kernel.actionDamage(request)
}

/** Damage per 100% of the scaling stat for the first hit of an ability: what one battle part of multiple 1 deals. */
const perUnit = (hits: HitResult[] | undefined) => {
  const hit = hits?.[0]
  if (!hit) throw new Error('the kernel has no hit for that ability')
  return hit.damage / hit.scaling!
}

type Use = 'basic' | 'skill' | 'ultimate' | 'followUp' | 'dismiss'
interface Step { use: Use }
const ABILITY = { basic: 'BASIC', skill: 'SKILL', ultimate: 'ULT', followUp: 'FUA' } as const
const KIND = { basic: 'basic', skill: 'skill', ultimate: 'ultimate', followUp: 'followUp' } as const

/** A wearer that takes `script` one step per turn, then Basic ATKs. `dismiss` removes a summon. */
function scripted(key: string, script: Step[], summon?: boolean): Kit {
  return {
    characterId: key,
    path: 'Erudition',
    element: 'Lightning',
    maxEnergy: 0,
    create: (battle) => {
      let step = 0
      const actions: Record<string, KitAction> = {}
      for (const use of ['basic', 'skill', 'ultimate', 'followUp'] as const) {
        actions[use] = {
          kind: 'basic',
          canUse: () => true,
          use: () => {
            step += 1
            battle.performAction(key, use, KIND[use], () => {
              battle.attack({ attacker: key, ability: ABILITY[use], parts: [{ shape: 'aoe', scaling: 1, hit: 0 }] })
            })
          },
        }
      }
      actions.dismiss = {
        kind: 'basic',
        canUse: () => true,
        use: () => {
          step += 1
          battle.removeSummon(`${key}.lightning_lord`)
        },
      }
      return {
        actions,
        quantities: { step: () => step },
        onBattleStart: () => {
          if (summon) battle.addSummon({ id: `${key}.lightning_lord`, owner: key, baseSpd: 60, takeTurn: () => {} })
        },
        attackerState: () => ({}),
        teammateState: () => ({}),
      }
    },
  }
}

function policyOf(key: string, script: Step[]): Rule[] {
  return [
    ...script.map((s, i): Rule => ({ unit: key, use: s.use, when: [{ what: `${key}.step`, min: i, max: i }] })),
    { unit: key, use: 'basic', when: [] },
  ]
}

/** A battle with the real kernel for the wearer, returning every damage event of the wearer in order. */
function run(
  build: KernelBuild,
  equipment: MemberEquipment,
  kit: Kit,
  script: Step[],
  weaknesses: BattleSetup['weaknesses'] = 'all',
): { ability: string, damage: number }[] {
  const member: MemberSetup = {
    key: 'wearer',
    kit,
    eidolon: 0,
    affinitiveEidolon: false,
    stats: { maxHp: 1_000_000_000, def: 1000, baseSpd: 1000 },
    kernel: { unit, build },
    equipment,
  }
  const setup: BattleSetup = {
    members: [member],
    policy: policyOf('wearer', script),
    profile,
    enemyCount: 1,
    weaknesses,
    cycles: 1,
    start: { energy: 0.5, skillPoints: 3, techniques: false },
    kernel,
  }
  const battle = new Battle(setup)
  const seen: { ability: string, damage: number }[] = []
  battle.timeline.bus.on('damageDealt', (dealt) => {
    if (dealt.attacker === 'wearer') seen.push({ ability: dealt.ability, damage: dealt.damage })
  })
  battle.run()
  return seen
}

const equipmentOf = (...sets: { module: MemberEquipment['sets'][number]['module'], pieces: 2 | 4 }[]): MemberEquipment => ({
  lightCone: lightConeWithoutBehaviour({ id: '21018', name: 'Dance! Dance! Dance!', reason: 'no Fribbels conditionals' }),
  sets,
})

describe('The Ashblazing Grand Duke (115) against Fribbels', () => {
  const build = buildWith(Sets.TheAshblazingGrandDuke, DEFAULT_ORNAMENT)
  const name = Sets.TheAshblazingGrandDuke

  it('the ATK it adds scales BASIC damage exactly: 8 stacks is 48% ATK on the base, so the damage ratio is the ATK ratio', () => {
    const none = direct(build, { [name]: 0 })
    const eight = direct(build, { [name]: 8 })
    expect(eight.stats.ATK).toBeGreaterThan(none.stats.ATK)
    expect(perUnit(eight.hits.BASIC) / perUnit(none.hits.BASIC)).toBeCloseTo(eight.stats.ATK / none.stats.ATK, 6)
  })

  it('a battle sends the stacks it built to Fribbels: the first Basic reads 0, the Follow-Up reads the stacks before it, the next Basic reads what the Follow-Up built', () => {
    // One enemy and one part per action: each action is one damage event, and each Follow-Up instance builds one stack.
    const script: Step[] = [{ use: 'basic' }, { use: 'followUp' }, { use: 'followUp' }, { use: 'basic' }]
    const seen = run(build, equipmentOf({ module: TheAshblazingGrandDuke, pieces: 4 }), scripted('wearer', script), script)
    const at = (stacks: number) => direct(build, { [name]: stacks })
    expect(seen[0]!.damage).toBeCloseTo(perUnit(at(0).hits.BASIC), 6)
    // Follow-Up 1 is priced with 0 stacks and builds 1; Follow-Up 2 is priced with those 1 and builds 1 again.
    expect(seen[1]!.damage).toBeCloseTo(perUnit(at(0).hits.FUA), 6)
    expect(seen[2]!.damage).toBeCloseTo(perUnit(at(1).hits.FUA), 6)
    expect(seen[3]!.damage).toBeCloseTo(perUnit(at(1).hits.BASIC), 6)
  })
})

describe('Scholar Lost in Erudition (122) against Fribbels', () => {
  const build = buildWith(Sets.ScholarLostInErudition, DEFAULT_ORNAMENT)
  const name = Sets.ScholarLostInErudition

  it('the +25% Skill DMG is on when the flag is, and does not touch Basic ATK', () => {
    const on = direct(build, { [name]: true })
    const off = direct(build, { [name]: false })
    expect(perUnit(on.hits.SKILL) / perUnit(off.hits.SKILL)).toBeGreaterThan(1.1)
    expect(perUnit(on.hits.BASIC)).toBeCloseTo(perUnit(off.hits.BASIC)!, 9)
  })

  it('Fribbels defaults the flag to on (measured in a fresh kernel), so without the module every Skill would carry the +25%', () => {
    expect(perUnit(direct(build).hits.SKILL)).toBeCloseTo(perUnit(direct(build, { [name]: true }).hits.SKILL)!, 9)
  })

  it('a battle sends the flag to Fribbels only for the Skill after an Ultimate', () => {
    const script: Step[] = [{ use: 'ultimate' }, { use: 'skill' }, { use: 'skill' }]
    const seen = run(build, equipmentOf({ module: ScholarLostInErudition, pieces: 4 }), scripted('wearer', script), script)
    const on = direct(build, { [name]: true })
    const off = direct(build, { [name]: false })
    expect(seen[1]!.damage).toBeCloseTo(perUnit(on.hits.SKILL)!, 6)
    expect(seen[2]!.damage).toBeCloseTo(perUnit(off.hits.SKILL)!, 6)
  })
})

describe('Genius of Brilliant Stars (108) against Fribbels', () => {
  const build = buildWith(Sets.GeniusOfBrilliantStars, DEFAULT_ORNAMENT)
  const name = Sets.GeniusOfBrilliantStars

  it('the extra 10% DEF PEN with Quantum Weakness is on when the flag is, and raises damage', () => {
    const on = direct(build, { [name]: true })
    const off = direct(build, { [name]: false })
    expect(perUnit(on.hits.BASIC)).toBeGreaterThan(perUnit(off.hits.BASIC)!)
  })

  it('Fribbels\' default is off for a Lightning wearer (measured): its element preset enables it only for Quantum wearers', () => {
    expect(perUnit(direct(build).hits.BASIC)).toBeCloseTo(perUnit(direct(build, { [name]: false }).hits.BASIC)!, 9)
  })

  it('with 4 pieces a Lightning wearer gets the extra 10% only when the enemies are weak to Quantum', () => {
    const script: Step[] = [{ use: 'basic' }]
    const eq = equipmentOf({ module: GeniusOfBrilliantStars, pieces: 4 })
    const withQuantum = run(build, eq, scripted('wearer', script), script, ['Lightning', 'Quantum'])
    const without = run(build, eq, scripted('wearer', script), script, ['Lightning'])
    const all = run(build, eq, scripted('wearer', script), script, 'all')
    expect(withQuantum[0]!.damage).toBeCloseTo(perUnit(direct(build, { [name]: true }).hits.BASIC), 6)
    expect(without[0]!.damage).toBeCloseTo(perUnit(direct(build, { [name]: false }).hits.BASIC), 6)
    expect(all[0]!.damage).toBeCloseTo(withQuantum[0]!.damage, 9)
    expect(withQuantum[0]!.damage).toBeGreaterThan(without[0]!.damage)
  })

  it('with 2 pieces the module runs and the kernel is given no flag (the 2-piece Quantum DMG is Fribbels\' own)', () => {
    const mixed: KernelBuild = { ...buildWith(Sets.GeniusOfBrilliantStars, DEFAULT_ORNAMENT), relicSet2: Sets.PioneerDiverOfDeadWaters }
    const script: Step[] = [{ use: 'basic' }]
    const seen = run(mixed, equipmentOf({ module: GeniusOfBrilliantStars, pieces: 2 }), scripted('wearer', script), script)
    expect(seen[0]!.damage).toBeCloseTo(perUnit(direct(mixed).hits.BASIC), 6)
  })
})

describe('The Wondrous BananAmusement Park (318) against Fribbels', () => {
  const build = buildWith(Sets.MusketeerOfWildWheat, Sets.TheWondrousBananAmusementPark)
  const name = Sets.TheWondrousBananAmusementPark

  it('the +32% CRIT DMG is on when the flag is, and raises damage for Jing Yuan', () => {
    const on = direct(build, { [name]: true })
    const off = direct(build, { [name]: false })
    expect(perUnit(on.hits.BASIC)).toBeGreaterThan(perUnit(off.hits.BASIC)!)
  })

  it('Fribbels\' default is on for this kernel path (measured), where its display default says off: the module has to supply the value', () => {
    expect(perUnit(direct(build).hits.BASIC)).toBeCloseTo(perUnit(direct(build, { [name]: true }).hits.BASIC)!, 9)
  })

  it('a battle sends the summon-on-field flag: on while the summon is there, off after it is dismissed', () => {
    const script: Step[] = [{ use: 'basic' }, { use: 'dismiss' }, { use: 'basic' }]
    const kit = scripted('wearer', script, true)
    const seen = run(build, equipmentOf({ module: TheWondrousBananAmusementPark, pieces: 2 }), kit, script)
    expect(seen[0]!.damage).toBeCloseTo(perUnit(direct(build, { [name]: true }).hits.BASIC)!, 6)
    expect(seen[1]!.damage).toBeCloseTo(perUnit(direct(build, { [name]: false }).hits.BASIC)!, 6)
  })
})

describe('Rutilant Arena (309) against Fribbels: the CRIT Rate threshold', () => {
  it('Fribbels adds the 20% Basic and Skill DMG itself when the wearer\'s CRIT Rate reaches 70%', () => {
    // CRIT Rate from the build alone: the CRIT Rate substat rolls are swept (the ornament's 8% is in every point).
    const sweep: { crit: number, basic: number }[] = []
    for (let rolls = 0; rolls <= 12; rolls += 1) {
      const build: KernelBuild = {
        relicSet1: Sets.MusketeerOfWildWheat,
        relicSet2: Sets.MusketeerOfWildWheat,
        ornamentSet: Sets.RutilantArena,
        body: Stats.CR,
        feet: Stats.ATK_P,
        planarSphere: Stats.Lightning_DMG,
        linkRope: Stats.ATK_P,
        substatRolls: { [Stats.CR]: rolls, [Stats.ATK_P]: 10, [Stats.CD]: 10 },
      }
      const result = direct(build)
      sweep.push({ crit: result.stats.CR, basic: perUnit(result.hits.BASIC) })
    }
    // The first point at or above 70%: one roll before it is below. Measured 2026-11-13: 67.4% -> 70.6% CRIT Rate.
    const first = sweep.findIndex((p) => p.crit >= 0.7)
    expect(first).toBe(1)
    expect(sweep[first - 1]!.crit).toBeLessThan(0.7)
    // The 20% lands on the step across 70%: about +16% Basic DMG, where a CRIT Rate roll adds about 2%.
    expect(sweep[first]!.basic / sweep[first - 1]!.basic - 1).toBeGreaterThan(0.1)
    expect(sweep[first + 1]!.basic / sweep[first]!.basic - 1).toBeLessThan(0.05)
  })

  it('counts a CRIT Rate injected by a kit (K15a): crossing 70% with an injected buff turns the bonus on', () => {
    // 0 CRIT Rate rolls is 67.4% (measured above): below the threshold on the build alone.
    const build: KernelBuild = {
      relicSet1: Sets.MusketeerOfWildWheat,
      relicSet2: Sets.MusketeerOfWildWheat,
      ornamentSet: Sets.RutilantArena,
      body: Stats.CR,
      feet: Stats.ATK_P,
      planarSphere: Stats.Lightning_DMG,
      linkRope: Stats.ATK_P,
      substatRolls: { [Stats.CR]: 0, [Stats.ATK_P]: 10, [Stats.CD]: 10 },
    }
    const withInjected = (value: number) =>
      kernel.actionDamage({ attacker: unit, teammates: [], build, enemy, injectedBuffs: [{ stat: 'CRIT_RATE', value, target: 'self' }] })
    const base = direct(build)
    const under = withInjected(0.01)
    const over = withInjected(0.05)
    expect(base.stats.CR).toBeLessThan(0.7)
    expect(under.stats.CR).toBeLessThan(0.7)
    expect(over.stats.CR).toBeGreaterThanOrEqual(0.7)
    // A CRIT Rate point or so adds about 2% Basic DMG; crossing 70% adds the 20% DMG bonus on top (about +16%).
    expect(perUnit(under.hits.BASIC) / perUnit(base.hits.BASIC) - 1).toBeLessThan(0.05)
    expect(perUnit(over.hits.BASIC) / perUnit(base.hits.BASIC) - 1).toBeGreaterThan(0.1)
  })
})
