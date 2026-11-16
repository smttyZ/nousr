import { beforeAll, describe, expect, it } from 'vitest'
import { levelBuff, LevelView, loadLevelTable, maxAbilityLevel, maxLevels, type AbilityKey } from '../../levels/levels'
import { runScenario, type TeamRun } from '../../run/run'
import { parseScenario } from '../../scenario/load'
import type { MemberFile, ScenarioFile } from '../../scenario/types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Level-aware kits through the real kernel (K15, K15a), two kinds of check:
 *
 * 1. Multipliers. One member, Basic ATK only: the damage of an ability level L over the damage at the maximum is the level table's
 *    ratio of the multiple (value at L over value at the maximum), exactly.
 * 2. Injected buffs. Fribbels prices a level-dependent buff at the maximum level of the eidolon, and Fribbels itself raises that
 *    level at the eidolons that only add levels (Cyrene E3 and E5, Tribbie E3 and E5, ...). So a member at the eidolon below, with
 *    its ability level forced up to what the higher eidolon gives, must deal exactly what the same member at the higher eidolon
 *    deals: kit multiples, injected deltas and Fribbels' own numbers agree at that level. (The forced level is above the legal
 *    maximum for the lower eidolon, which the scenario file refuses; the test sets it on the resolved scenario.)
 */

const LC = { cyrene: '23052', tribbie: '21018', sw: '21001', welt: '23004', dhpt: '24002', robin: '24005', herta: '21034', anaxa: '22004', sunday: '21025', fuxuan: '21016', hyacine: '21054', acheron: '23024' }

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

interface Mem {
  key: string
  character: string
  eidolon: number
  lc: string
  /** Forced levels (above the legal maximum for the eidolon allowed). */
  force?: Partial<Record<AbilityKey, number>>
  levels?: MemberFile['levels']
}

function run(members: Mem[], policy: { unit: string, use: string, target?: string, when?: { what: string, is?: boolean, min?: number, max?: number }[] }[], options: { cycles?: number, energy?: number, skillPoints?: number } = {}): TeamRun {
  const file: ScenarioFile = {
    format: 'nousr-scenario',
    version: 1,
    game_version: '4.7',
    battle: { mode: 'moc', cycles: options.cycles ?? 1, period: null, start: { energy: options.energy ?? 1, skill_points: options.skillPoints ?? 3, techniques: false } },
    enemies: { profile: 'generic-moc', counts: [1] },
    teams: [{
      id: 't',
      members: members.map((m): MemberFile => ({
        key: m.key,
        character: m.character,
        eidolon: m.eidolon,
        light_cone: { id: m.lc, superimposition: 1 },
        relics: 'standard',
        ...(m.levels !== undefined && { levels: m.levels }),
      })),
      policy,
    }],
  }
  const scenario = parseScenario(file)
  for (const m of members) {
    if (m.force === undefined) continue
    const resolved = scenario.teams[0]!.members.find((x) => x.key === m.key)!
    Object.assign(resolved.levels!.abilities, m.force)
  }
  return runScenario(scenario, { kernel })[0]!
}

const dmg = (r: TeamRun, member: string, ability?: string): number =>
  ability === undefined ? r.result.damageByMember[member]! : r.result.damageByAbility[member]![ability] ?? 0

/** The multiple's value at `level` over the value at the maximum for the eidolon, from the committed table. */
function tableRatio(character: string, version: number | undefined, key: AbilityKey, skillId: string, param: number, level: number, eidolon: number): number {
  const table = loadLevelTable(character, version)!
  const row = (l: number) => table.abilities[key]!.skills[skillId]!.levels[l - 1]![param]!
  return row(level) / row(maxAbilityLevel(table, key, eidolon))
}

describe('multipliers: a lower Basic ATK level scales the damage by the table\'s ratio', () => {
  const cases: { name: string, mem: Mem, skillId: string, param: number, version?: number }[] = [
    { name: 'Cyrene', mem: { key: 'm', character: '1415', eidolon: 0, lc: LC.cyrene }, skillId: '141501', param: 0 },
    { name: 'Hyacine', mem: { key: 'm', character: '1409', eidolon: 0, lc: LC.hyacine }, skillId: '140901', param: 0 },
    { name: 'Tribbie', mem: { key: 'm', character: '1403', eidolon: 0, lc: LC.tribbie }, skillId: '140301', param: 0 },
    { name: 'Silver Wolf', mem: { key: 'm', character: '1006', eidolon: 0, lc: LC.sw }, skillId: '1100601', param: 0, version: 1 },
    { name: 'Welt', mem: { key: 'm', character: '1004', eidolon: 0, lc: LC.welt }, skillId: '1100401', param: 0, version: 1 },
    { name: 'Dan Heng PT', mem: { key: 'm', character: '1414', eidolon: 0, lc: LC.dhpt }, skillId: '141401', param: 0 },
    { name: 'Robin Summeretto', mem: { key: 'm', character: '1512', eidolon: 0, lc: LC.robin }, skillId: '151201', param: 0 },
    { name: 'The Herta', mem: { key: 'm', character: '1401', eidolon: 0, lc: LC.herta }, skillId: '140101', param: 0 },
    { name: 'Anaxa', mem: { key: 'm', character: '1405', eidolon: 0, lc: LC.anaxa }, skillId: '140501', param: 0 },
    { name: 'Sunday', mem: { key: 'm', character: '1313', eidolon: 0, lc: LC.sunday }, skillId: '131301', param: 0 },
    { name: 'Fu Xuan', mem: { key: 'm', character: '1208', eidolon: 0, lc: LC.fuxuan }, skillId: '120801', param: 0 },
  ]
  it.each(cases)('$name: Basic ATK at level 1 and 4', ({ mem, skillId, param, version }) => {
    const policy = [{ unit: 'm', use: 'basic' }]
    const full = run([mem], policy, { energy: 0 })
    expect(dmg(full, 'm', 'BASIC')).toBeGreaterThan(0)
    for (const level of [1, 4]) {
      const low = run([{ ...mem, levels: { abilities: { basic: level } } }], policy, { energy: 0 })
      const want = tableRatio(mem.character, version, 'basic', skillId, param, level, mem.eidolon)
      expect(want).toBeLessThan(1)
      expect(dmg(low, 'm', 'BASIC') / dmg(full, 'm', 'BASIC')).toBeCloseTo(want, 9)
    }
  })

  it('the first action of every kit is unchanged at the maximum level (ratio exactly 1)', () => {
    const [{ mem }] = cases as [typeof cases[0]]
    const a = run([mem], [{ unit: 'm', use: 'basic' }], { energy: 0 })
    const b = run([{ ...mem, levels: 'max' }], [{ unit: 'm', use: 'basic' }], { energy: 0 })
    expect(dmg(a, 'm')).toBe(dmg(b, 'm'))
  })
})

describe('ultimate and skill multiples scale by the table\'s ratio', () => {
  it('Welt Ultimate at level 4 (Imprison and Weightless come after the hit)', () => {
    const mem: Mem = { key: 'm', character: '1004', eidolon: 0, lc: LC.welt }
    const policy = [{ unit: 'm', use: 'ultimate' }, { unit: 'm', use: 'basic' }]
    const full = run([mem], policy, { energy: 1 })
    const low = run([{ ...mem, levels: { abilities: { ult: 4 } } }], policy, { energy: 1 })
    const want = tableRatio('1004', 1, 'ult', '1100403', 0, 4, 0)
    expect(dmg(low, 'm', 'ULT') / dmg(full, 'm', 'ULT')).toBeCloseTo(want, 9)
  })

  it('Dan Heng PT Ultimate at level 4 (his own AoE hit)', () => {
    const mem: Mem = { key: 'm', character: '1414', eidolon: 0, lc: LC.dhpt }
    const policy = [{ unit: 'm', use: 'ultimate' }, { unit: 'm', use: 'basic' }]
    const full = run([mem], policy, { energy: 1 })
    const low = run([{ ...mem, levels: { abilities: { ult: 4 } } }], policy, { energy: 1 })
    const want = tableRatio('1414', undefined, 'ult', '141403', 0, 4, 0)
    expect(dmg(low, 'm', 'ULT') / dmg(full, 'm', 'ULT')).toBeCloseTo(want, 9)
  })
})

/** Equal to a relative 1e-9: the two runs add the same numbers in a different order. */
function same(actual: number, expected: number): void {
  expect(expected).toBeGreaterThan(0)
  expect(Math.abs(actual - expected) / expected).toBeLessThan(1e-9)
}

describe('injected buffs: an eidolon that only adds levels and the same levels forced on the eidolon below deal the same damage', () => {
  const dpsOf = (eidolon = 0): Mem => ({ key: 'dps', character: '1308', eidolon, lc: LC.acheron })

  /**
   * `high` is a member at the higher eidolon; `low` the same at the one below with `force` set. Their teams run the same policy;
   * every member's damage must agree, and `moves` says the levels did change something (the lower eidolon without the forced
   * levels deals less or more).
   */
  function agree(high: Mem, low: Mem, policy: Parameters<typeof run>[1], options: Parameters<typeof run>[2] = {}) {
    const a = run([high, dpsOf()], policy, options)
    const b = run([low, dpsOf()], policy, options)
    const unforced = run([{ ...low, force: undefined }, dpsOf()], policy, options)
    for (const member of ['dps', high.key]) {
      if (dmg(a, member) > 0) same(dmg(b, member), dmg(a, member))
    }
    // The forced levels matter: without them the lower eidolon deals something else to Acheron.
    expect(Math.abs(dmg(unforced, 'dps') - dmg(a, 'dps')) / dmg(a, 'dps')).toBeGreaterThan(1e-6)
  }

  it('Tribbie E3 (Ultimate +2, Basic +1): the Zone\'s Vulnerability and Additional DMG, on her and on Acheron', () => {
    agree(
      { key: 'tribbie', character: '1403', eidolon: 3, lc: LC.tribbie },
      { key: 'tribbie', character: '1403', eidolon: 2, lc: LC.tribbie, force: { ult: 12, basic: 7 } },
      [{ unit: 'tribbie', use: 'ultimate' }, { unit: 'dps', use: 'basic' }, { unit: 'tribbie', use: 'basic' }],
      { cycles: 2 },
    )
  })

  it('Tribbie E5 (Skill +2, Talent +2): Numinosity\'s RES PEN and the follow-up', () => {
    agree(
      { key: 'tribbie', character: '1403', eidolon: 5, lc: LC.tribbie },
      { key: 'tribbie', character: '1403', eidolon: 4, lc: LC.tribbie, force: { skill: 12, talent: 12 } },
      [{ unit: 'tribbie', use: 'skill' }, { unit: 'dps', use: 'basic' }, { unit: 'tribbie', use: 'basic' }],
      { cycles: 2, energy: 0 },
    )
  })

  it('Cyrene E5 (Skill +2, Basic +1): the Zone\'s True DMG on Acheron', () => {
    agree(
      { key: 'cyrene', character: '1415', eidolon: 5, lc: LC.cyrene },
      { key: 'cyrene', character: '1415', eidolon: 4, lc: LC.cyrene, force: { skill: 12, basic: 7, memo_talent: 7 } },
      [{ unit: 'cyrene', use: 'skill' }, { unit: 'dps', use: 'basic' }, { unit: 'cyrene', use: 'basic' }],
      { cycles: 2, energy: 0 },
    )
  })

  it('Cyrene E3 (Talent +2, Ultimate +2): her Talent\'s DMG on Acheron', () => {
    agree(
      { key: 'cyrene', character: '1415', eidolon: 3, lc: LC.cyrene },
      { key: 'cyrene', character: '1415', eidolon: 2, lc: LC.cyrene, force: { ult: 12, talent: 12, memo_skill: 7 } },
      [{ unit: 'dps', use: 'basic' }, { unit: 'cyrene', use: 'basic' }],
      { cycles: 2, energy: 0 },
    )
  })

  it('Silver Wolf E5 (Ultimate +2, Basic +1): the Ultimate\'s DEF shred, on her and on Acheron', () => {
    agree(
      { key: 'sw', character: '1006', eidolon: 5, lc: LC.sw },
      { key: 'sw', character: '1006', eidolon: 4, lc: LC.sw, force: { ult: 12, basic: 7 } },
      [{ unit: 'sw', use: 'ultimate' }, { unit: 'dps', use: 'basic' }, { unit: 'sw', use: 'basic' }],
      { cycles: 2 },
    )
  })

  it('Silver Wolf E3 (Skill +2, Talent +2): the Skill\'s RES shred and the DEF Bug', () => {
    agree(
      { key: 'sw', character: '1006', eidolon: 3, lc: LC.sw },
      { key: 'sw', character: '1006', eidolon: 2, lc: LC.sw, force: { skill: 12, talent: 12 } },
      [{ unit: 'sw', use: 'skill' }, { unit: 'dps', use: 'basic' }, { unit: 'sw', use: 'basic' }],
      { cycles: 2, energy: 0 },
    )
  })

  it('Sunday E5 (Skill +2, Talent +2): the Skill\'s DMG and the Talent\'s CRIT Rate on his target', () => {
    agree(
      { key: 'sunday', character: '1313', eidolon: 5, lc: LC.sunday },
      { key: 'sunday', character: '1313', eidolon: 4, lc: LC.sunday, force: { skill: 12, talent: 12 } },
      [{ unit: 'sunday', use: 'skill', target: 'dps' }, { unit: 'dps', use: 'basic' }, { unit: 'sunday', use: 'basic' }],
      { cycles: 2, energy: 0 },
    )
  })

  it('Sunday E3 (Ultimate +2, Basic +1): The Beatified\'s CRIT DMG on his target', () => {
    agree(
      { key: 'sunday', character: '1313', eidolon: 3, lc: LC.sunday },
      { key: 'sunday', character: '1313', eidolon: 2, lc: LC.sunday, force: { ult: 12, basic: 7 } },
      [{ unit: 'sunday', use: 'ultimate', target: 'dps' }, { unit: 'dps', use: 'basic' }, { unit: 'sunday', use: 'basic' }],
      { cycles: 2 },
    )
  })
})

describe('Hyacine\'s Talent, priced by the kernel', () => {
  // A whole battle cannot isolate it: her Skill's heals (the tally Rainclouds is paid from) also rise at E5. So this asks the kernel
  // directly: Rainclouds' price per unit of tally with three stacks, at E5, against E4 with the kit's injected level delta.
  const build = { relicSet1: 'Sacerdos\' Relived Ordeal', relicSet2: 'Sacerdos\' Relived Ordeal', ornamentSet: 'Fleet of the Ageless', body: 'HP%', feet: 'SPD', planarSphere: 'Wind DMG Boost', linkRope: 'HP%', substatRolls: { 'HP%': 10, 'CRIT Rate': 10, 'CRIT DMG': 10 } }
  const unit = (eidolon: number, stacks = 3) => ({ characterId: '1409', lightConeId: LC.hyacine, eidolon, superimposition: 1, characterConditionals: { healingDmgStacks: stacks, healTallyMultiplier: 1 } })

  it('E4 plus three stacks of the table\'s delta (levels 10 to 12) equals E5', () => {
    // Rainclouds' hit is the tally's heal times the multipliers, and the Skill's heal differs between E4 and E5 (not a Talent level),
    // so the stacks' effect is read as the price with three stacks over the price with none, which cancels the heal.
    const e5 = kernel.actionDamage({ attacker: unit(5), teammates: [], build })
    const e5None = kernel.actionDamage({ attacker: unit(5, 0), teammates: [], build })
    const e4None = kernel.actionDamage({ attacker: unit(4, 0), teammates: [], build })
    const table = loadLevelTable('1409', 0)!
    const levels = maxLevels(table, 4)
    levels.abilities.talent = 12
    const view = new LevelView(table, levels, 4)
    const injectedBuffs = levelBuff('DMG_PERCENT', 3 * view.delta('talent', '140904', 2), 'selfAndMemosprite', 'test', { abilityKind: 'MEMO_SKILL' })
    const e4 = kernel.actionDamage({ attacker: unit(4), teammates: [], build, injectedBuffs })
    const e4Plain = kernel.actionDamage({ attacker: unit(4), teammates: [], build })
    const rainclouds = (r: typeof e5) => r.hits.MEMO_SKILL!.find((h) => h.output === undefined)!.damage
    same(rainclouds(e4) / rainclouds(e4None), rainclouds(e5) / rainclouds(e5None))
    expect(rainclouds(e4Plain) / rainclouds(e4None)).toBeLessThan(rainclouds(e5) / rainclouds(e5None))
  })
})

describe('major traces switch their effects off in the kit', () => {
  it('Welt without Judgment (B2) deals less on Basic ATK; the Judgment hit is the difference', () => {
    const mem: Mem = { key: 'm', character: '1004', eidolon: 0, lc: LC.welt }
    const policy = [{ unit: 'm', use: 'basic' }]
    const full = run([mem], policy, { energy: 0 })
    // S5, S6 and S7 hang off B2.
    const locked = run([{ ...mem, levels: { traces: { major: [true, false, true], minor: { locked: [5, 6, 7] } } } }], policy, { energy: 0 })
    expect(dmg(locked, 'm', 'BASIC')).toBeLessThan(dmg(full, 'm', 'BASIC'))
    // The Judgment hit is 80% of the Basic ATK multiple, so Basic ATK without it is 1 / 1.8 of the whole when both hits are priced alike
    // (a stat sheet with the three minor traces off differs a little, which is why this is a bound and not an equality).
    expect(dmg(locked, 'm', 'BASIC') / dmg(full, 'm', 'BASIC')).toBeGreaterThan(1 / 1.8 - 0.1)
    expect(dmg(locked, 'm', 'BASIC') / dmg(full, 'm', 'BASIC')).toBeLessThan(1 / 1.8 + 0.1)
  })

  it('Silver Wolf without Side Note (B3) loses the EHR to ATK conversion', () => {
    const mem: Mem = { key: 'm', character: '1006', eidolon: 0, lc: LC.sw }
    const policy = [{ unit: 'm', use: 'basic' }]
    const full = run([mem], policy, { energy: 0 })
    // S8 and S9 hang off B3.
    const locked = run([{ ...mem, levels: { traces: { major: [true, true, false], minor: { locked: [8, 9] } } } }], policy, { energy: 0 })
    expect(dmg(locked, 'm', 'BASIC')).toBeLessThan(dmg(full, 'm', 'BASIC'))
  })
})

describe('injected buffs on the member itself', () => {
  it('Anaxa E5 (Skill +2, Talent +2): Qualitative Disclosure\'s DMG bonus on his own Basic ATK', () => {
    const policy = [{ unit: 'anaxa', use: 'basic' }]
    const e5 = run([{ key: 'anaxa', character: '1405', eidolon: 5, lc: LC.anaxa }], policy, { energy: 0 })
    const forced = run([{ key: 'anaxa', character: '1405', eidolon: 4, lc: LC.anaxa, force: { skill: 12, talent: 12 } }], policy, { energy: 0 })
    const plain = run([{ key: 'anaxa', character: '1405', eidolon: 4, lc: LC.anaxa }], policy, { energy: 0 })
    same(dmg(forced, 'anaxa'), dmg(e5, 'anaxa'))
    expect(dmg(plain, 'anaxa')).toBeLessThan(dmg(forced, 'anaxa'))
  })
})
