import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { theHertaSkillPlan, theHertaUltMultiple } from '../../kits/theHerta'
import type { DamageRequest, KernelBuild } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * The Herta through the real kernel.
 * - The parts of one Enhanced Skill sum, on the primary, to Fribbels' lumped Skill multiple for the same stacks (at several
 *   eidolons), and the Ultimate's multiple is Fribbels' (with the same enemy count and Answer).
 * - Message From Beyond the Veil's +80% CRIT DMG reaches an Erudition teammate and her only with 2+ Erudition in the team.
 */

const build: KernelBuild = {
  relicSet1: Sets.ScholarLostInErudition,
  relicSet2: Sets.ScholarLostInErudition,
  ornamentSet: Sets.IzumoGenseiAndTakamaDivineRealm,
  body: Stats.CD,
  feet: Stats.ATK_P,
  planarSphere: Stats.Ice_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const enemy = { count: 3, level: 95, maxToughness: 360, resistance: 0.2, elementalWeak: true, effectResistance: 0, weaknessBroken: false }
const TODAY_IS_ANOTHER_PEACEFUL_DAY = '21034'
const GREAT_COSMIC_ENTERPRISE = '23003'
const anaxa = { characterId: '1405', lightConeId: GREAT_COSMIC_ENTERPRISE, eidolon: 0, superimposition: 1 }
const pela = { characterId: '1106', lightConeId: GREAT_COSMIC_ENTERPRISE, eidolon: 0, superimposition: 1 }

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

const hertaUnit = (eidolon: number, characterConditionals: Record<string, number | boolean>) => ({
  characterId: '1401',
  lightConeId: TODAY_IS_ANOTHER_PEACEFUL_DAY,
  eidolon,
  superimposition: 1,
  characterConditionals,
})
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)

describe('The Herta through the real kernel', () => {
  it("the parts of one Enhanced Skill sum, on the primary, to Fribbels' lumped Skill multiple for the same stacks; the kit's conditional keys are accepted", () => {
    for (const [eidolon, stacks] of [[0, 30], [1, 28], [3, 42], [6, 17]] as const) {
      const request: DamageRequest = {
        attacker: hertaUnit(eidolon, {
          enhancedSkill: true,
          ultAtkBuff: false,
          interpretationStacks: stacks,
          totalInterpretationStacks: 60,
          eruditionTeammate: true,
          e1BonusStacks: true,
          e4EruditionSpdBuff: true,
          e6Buffs: true,
        }),
        teammates: [anaxa],
        build,
        enemy,
      }
      const hits = kernel.actionDamage(request).hits
      const lumped = hits.SKILL![0]!.scaling!
      // Fribbels counts E1's extra 50% on the same enemy (primary has the most); the kit's N is own + 0.5 x the most of itself and neighbours.
      const counted = eidolon >= 1 ? stacks * 1.5 : stacks
      const plan = theHertaSkillPlan({ eidolon, enemyCount: 3, target: 1, enhanced: true, counted, eruditionBonus: true })
      const onPrimary = plan.instances.flat().filter((h) => h.enemy === 1).reduce((a, h) => a + h.scaling, 0) + plan.tail
      near(onPrimary, lumped)
      // The Ultimate: 200% (220% at E5) + 1% per Answer (+ E6, with Fribbels' 3 enemies = 140%).
      near(hits.ULT![0]!.scaling!, theHertaUltMultiple(eidolon, 60, 3))
    }
  })

  it('Message From Beyond the Veil: +80% CRIT DMG with 2+ Erudition in the team, none with one', () => {
    const cd = (attacker: DamageRequest['attacker'], teammates: DamageRequest['teammates']) =>
      kernel.actionDamage({ attacker, teammates, build, enemy }).stats.CD
    const on = { eruditionTeammate: true, e4EruditionSpdBuff: true }
    const off = { eruditionTeammate: false, e4EruditionSpdBuff: true }
    // A teammate attacker (Anaxa, 2 Erudition): the switch the kit's teammateState sends, on against off.
    near(cd(anaxa, [hertaUnit(0, on)]) - cd(anaxa, [hertaUnit(0, off)]), 0.8)
    // Herself next to another Erudition: on against off.
    const self = (c: Record<string, number | boolean>) => hertaUnit(0, { enhancedSkill: false, ultAtkBuff: false, ...c })
    near(cd(self(on), [anaxa]) - cd(self(off), [anaxa]), 0.8)
    // Herself as the only Erudition: the switch changes nothing.
    near(cd(self(on), [pela]) - cd(self(off), [pela]), 0)
  })
})
