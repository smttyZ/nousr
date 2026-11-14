import { beforeAll, describe, expect, it } from 'vitest'
import { Sets, Stats } from '../../../vendor/hsr-optimizer/src/lib/constants/constants'
import { Battle } from '../../battle/battle'
import type { MemberSetup } from '../../battle/battle'
import type { EngineEvents } from '../../engine'
import { loadEnemyProfile } from '../../enemy/profile'
import { GoodNightAndSleepWell } from '../../equipment/goodNightAndSleepWell'
import type { Kit } from '../../kits/kit'
import { SilverWolf, silverWolfScalings } from '../../kits/silverWolf'
import type { DamageRequest, KernelBuild, KernelTeammate } from '../types'
import { FribbelsKernel } from './fribbelsKernel'

/**
 * Silver Wolf (buffed version 1, Fribbels 1006b1) with her light cone Good Night and Sleep Well (21001) at S5, priced hit by
 * hit (K11): every hit the battle records equals the number Fribbels gives for a request written here by hand from the
 * in-game text, with each debuff's state spelled out, not read back from the kit.
 *
 * Her Bugs are random (K22): "1 random Bug" is each of ATK, DEF and SPD at 1/3, so after k applications on an enemy each
 * type is there with 1 - (2/3)^k, independently. The battle prices a hit in every state of those uncertain debuffs and weights
 * the states by their probabilities, so the expected number for a hit is Fribbels' number for each state written out by hand
 * (`expected` below, over `bugStates`), weighted the same way.
 */

const build: KernelBuild = {
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.IzumoGenseiAndTakamaDivineRealm,
  body: Stats.EHR,
  feet: Stats.SPD,
  planarSphere: Stats.Quantum_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 8, [Stats.CR]: 8, [Stats.CD]: 8, [Stats.EHR]: 6 },
}
const acheronBuild: KernelBuild = {
  relicSet1: Sets.MusketeerOfWildWheat,
  relicSet2: Sets.MusketeerOfWildWheat,
  ornamentSet: Sets.IzumoGenseiAndTakamaDivineRealm,
  body: Stats.CD,
  feet: Stats.ATK_P,
  planarSphere: Stats.Lightning_DMG,
  linkRope: Stats.ATK_P,
  substatRolls: { [Stats.ATK_P]: 10, [Stats.CR]: 10, [Stats.CD]: 10 },
}
const profile = loadEnemyProfile('generic-moc')
const swUnit = (eidolon: number, superimposition = 5) => ({ characterId: '1006b1', lightConeId: '21001', eidolon, superimposition })
const acheronUnit = { characterId: '1308', lightConeId: '23024', eidolon: 0, superimposition: 1 }

/** What the debuffs on one enemy are, as the text gives them. */
interface Debuffs {
  skillRes?: boolean
  bugDef?: boolean
  ultDef?: boolean
  /** Every debuff on the enemy, from any source (before the cap at 5 and, for the light cone, 3). */
  count: number
  e2?: boolean
}

const flags = (d: Debuffs) => ({
  skillResShredDebuff: d.skillRes ?? false,
  skillWeaknessResShredDebuff: false,
  talentDefShredDebuff: d.bugDef ?? false,
  ultDefShredDebuff: d.ultDef ?? false,
  targetDebuffs: Math.min(5, d.count),
  e2Vulnerability: d.e2 ?? false,
})

const enemyOf = (count: number) => ({
  count,
  level: profile.level,
  maxToughness: profile.toughness,
  resistance: profile.res,
  elementalWeak: true,
  weaknessBroken: false,
})

/** Silver Wolf attacking an enemy with these debuffs on it. Her light cone counts 1 stack per debuff, to 3. */
const swRequest = (eidolon: number, d: Debuffs, enemies = 1, superimposition = 5): DamageRequest => ({
  attacker: {
    ...swUnit(eidolon, superimposition),
    characterConditionals: { ehrToAtkConversion: true, ...flags(d) },
    lightConeConditionals: { debuffStacksDmgIncrease: Math.min(3, d.count) },
  },
  teammates: [],
  build,
  enemy: enemyOf(enemies),
})

/** Acheron's Basic ATK on an enemy with these debuffs, with Silver Wolf next to her. */
const allyRequest = (eidolon: number, d: Debuffs, enemies = 1): DamageRequest => ({
  attacker: acheronUnit,
  teammates: [{ ...swUnit(eidolon), characterConditionals: flags(d) } as KernelTeammate],
  build: acheronBuild,
  enemy: enemyOf(enemies),
})

let kernel: FribbelsKernel
beforeAll(() => {
  kernel = new FribbelsKernel()
})

const hitsOf = (request: DamageRequest, ability: string) => kernel.actionDamage(request).hits[ability]!

/**
 * The states of an enemy whose Bugs are uncertain: the Bugs are independent, each present with its chance, on top of the debuffs
 * that are there for certain (`base`). Each state is the Debuffs of that world, with its probability.
 */
function bugStates(base: Debuffs, bugs: ReadonlyArray<{ chance: number, def?: boolean }>): Array<{ weight: number, state: Debuffs }> {
  const out: Array<{ weight: number, state: Debuffs }> = []
  for (let mask = 0; mask < 1 << bugs.length; mask++) {
    let weight = 1
    let present = 0
    let def = base.bugDef ?? false
    bugs.forEach((bug, i) => {
      if (mask & (1 << i)) {
        weight *= bug.chance
        present += 1
        if (bug.def) def = true
      } else weight *= 1 - bug.chance
    })
    out.push({ weight, state: { ...base, bugDef: def, count: base.count + present } })
  }
  return out
}

/** The Bugs an enemy has after `k` applications of a random Bug: ATK, DEF, SPD, each at 1 - (2/3)^k. */
const bugsAfter = (k: number) => {
  const chance = 1 - (2 / 3) ** k
  return [{ chance }, { chance, def: true }, { chance }]
}

/** The weighted mean of Fribbels' number for one hit over the states (what the battle's mixture should come to). */
const expected = (states: ReturnType<typeof bugStates>, price: (state: Debuffs) => number) =>
  states.reduce((sum, { weight, state }) => sum + weight * price(state), 0)

const silverWolfMember = (eidolon: number, superimposition = 5, withLightCone = true): MemberSetup => ({
  key: 'sw',
  kit: SilverWolf,
  eidolon,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 1 },
  kernel: { unit: swUnit(eidolon, superimposition), build },
  ...(withLightCone && { equipment: { lightCone: GoodNightAndSleepWell, sets: [] } }),
})

/** A plain ally with Acheron's identity: one Basic ATK on a chosen enemy, so the real kernel prices a teammate's hit. */
const Striker: Kit = {
  characterId: 'stub',
  path: 'Destruction',
  element: 'Lightning',
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: (target) =>
          battle.performAction(self.key, 'basic', 'basic', () =>
            battle.attack({ attacker: self.key, ability: 'BASIC', parts: [{ shape: 'single', scaling: 1, hit: 0, ...(target && { target }) }] }),
          ),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
}
const strikerMember: MemberSetup = {
  key: 'striker',
  kit: Striker,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd: 1 },
  kernel: { unit: acheronUnit, build: acheronBuild },
}

function battleOf(members: MemberSetup[], enemyCount = 1) {
  const battle = new Battle({
    members,
    policy: members.map((m) => ({ unit: m.key, use: 'basic' as const, when: [] })),
    profile,
    enemyCount,
    weaknesses: 'all',
    cycles: 1,
    start: { energy: 0, skillPoints: 3, techniques: false },
    kernel,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  for (const m of members) battle.member(m.key).instance.onBattleStart?.({ techniques: false })
  const use = (key: string, action: string, target?: string) => battle.member(key).instance.actions[action]!.use(target)
  /** What an enemy took from an ability's attack calls, in the order they were made: one entry per call. */
  const calls = (ability: string, enemy: string) => dealt.filter((d) => d.ability === ability && d.enemy === enemy)
  return { battle, dealt, use, calls }
}

describe('Silver Wolf through the real kernel: every hit equals Fribbels\' for the same state, at every eidolon', () => {
  for (let eidolon = 0; eidolon <= 6; eidolon++) {
    it(`E${eidolon}: Basic ATK, Skill and Ultimate (and E4's Additional DMG) on one enemy`, () => {
      const { battle, use, calls } = battleOf([silverWolfMember(eidolon)])
      // From E2 the enemy starts with the 20% Vulnerability debuff, one debuff before any attack.
      const e2 = eidolon >= 2
      const v = e2 ? 1 : 0
      const s = silverWolfScalings(eidolon)

      // Basic ATK: nothing of hers on the enemy yet (the Bug lands after the damage).
      use('sw', 'basic')
      const basic = hitsOf(swRequest(eidolon, { count: v, e2 }), 'BASIC')
      expect(basic).toHaveLength(1)
      expect(basic[0]!.scaling).toBeCloseTo(s.basic, 12)
      expect(calls('BASIC', 'enemy1')[0]!.damage).toBeCloseTo(basic[0]!.damage, 6)

      // Skill: her RES shred is on for the hit, and the Basic ATK left one random Bug: each type at 1/3.
      use('sw', 'skill')
      const skillStates = bugStates({ skillRes: true, count: v + 1, e2 }, bugsAfter(1))
      expect(hitsOf(swRequest(eidolon, skillStates[0]!.state), 'SKILL')[0]!.scaling).toBeCloseTo(s.skill, 12)
      expect(calls('SKILL', 'enemy1')[0]!.damage).toBeCloseTo(expected(skillStates, (d) => hitsOf(swRequest(eidolon, d), 'SKILL')[0]!.damage), 6)

      // Ultimate: DEF -45% on for the hit, with the Skill's RES shred still up and the Bugs of the Basic ATK and the Skill (two
      // applications: each type at 5/9).
      battle.party.setEnergy('sw', 110)
      use('sw', 'ultimate')
      const ultStates = bugStates({ skillRes: true, ultDef: true, count: v + 2, e2 }, bugsAfter(2))
      expect(hitsOf(swRequest(eidolon, ultStates[0]!.state), 'ULT')[0]!.scaling).toBeCloseTo(s.ult, 12)
      const dealt = calls('ULT', 'enemy1')
      expect(dealt[0]!.damage).toBeCloseTo(expected(ultStates, (d) => hitsOf(swRequest(eidolon, d), 'ULT')[0]!.damage), 6)

      if (eidolon >= 4) {
        // E4: 20% ATK per debuff on the enemy (up to 5), Fribbels' hit 1: the scaling is the expected capped count over the states,
        // and the damage is Fribbels' number for each state, weighted.
        expect(dealt).toHaveLength(2)
        expect(dealt[1]!.scaling).toBeCloseTo(expected(ultStates, (d) => 0.2 * Math.min(5, d.count)), 12)
        expect(dealt[1]!.damage).toBeCloseTo(expected(ultStates, (d) => hitsOf(swRequest(eidolon, d), 'ULT')[1]!.damage), 6)
        expect(hitsOf(swRequest(eidolon, ultStates[0]!.state), 'ULT')).toHaveLength(2)
      } else {
        expect(hitsOf(swRequest(eidolon, ultStates[0]!.state), 'ULT')).toHaveLength(1)
        expect(dealt).toHaveLength(1)
      }
    })
  }

  it('E6 adds 20% DMG per debuff to the hit, as an additive DMG bonus: linear in the debuff count, and absent at E5', () => {
    // Everything but `targetDebuffs` held fixed, which is what E6 reads (the light cone's own stacks are held at 3 by a count of 3 or more).
    const at = (eidolon: number, targetDebuffs: number) => {
      const request = swRequest(eidolon, { count: 3, e2: true })
      return hitsOf({ ...request, attacker: { ...request.attacker, characterConditionals: { ...request.attacker.characterConditionals, targetDebuffs } } }, 'ULT')[0]!.damage
    }
    const step = at(6, 4) - at(6, 3)
    expect(step).toBeGreaterThan(0)
    expect(at(6, 5) - at(6, 4)).toBeCloseTo(step, 6)
    expect(at(6, 1) - at(6, 0)).toBeCloseTo(step, 6)
    expect(at(5, 5)).toBeCloseTo(at(5, 0), 9)
  })

  it('the multiples are Fribbels\' own at the eidolons that change them (E3: Skill and Talent, E5: Basic ATK and Ultimate)', () => {
    const at = (e: number, ability: string) => hitsOf(swRequest(e, { count: 0 }), ability)[0]!.scaling
    expect([at(2, 'BASIC'), at(5, 'BASIC')]).toEqual([1, 1.1])
    expect([at(2, 'SKILL'), at(3, 'SKILL')]).toEqual([1.96, 2.156])
    expect([at(4, 'ULT'), at(5, 'ULT')].map((x) => Number(x!.toFixed(6)))).toEqual([3.8, 4.104])
  })
})

describe('Silver Wolf through the real kernel: three enemies, each priced against its own debuffs (K1)', () => {
  it('E4: after a Basic ATK and a Skill on the middle enemy, the Ultimate prices each enemy with its own state and its own Additional DMG', () => {
    const { battle, use, calls } = battleOf([silverWolfMember(4)], 3)
    use('sw', 'basic')
    use('sw', 'skill')
    battle.party.setEnergy('sw', 110)
    use('sw', 'ultimate')

    // E4 includes E2: every enemy starts with the Vulnerability debuff. Middle enemy: that, the RES shred, the Ultimate DEF and the
    // Bugs of the Basic ATK and the Skill (two applications, each type at 5/9). The others: Vulnerability and the Ultimate DEF only.
    const primary = bugStates({ skillRes: true, ultDef: true, count: 3, e2: true }, bugsAfter(2))
    const other = bugStates({ ultDef: true, count: 2, e2: true }, [])
    for (const [enemy, states] of [['enemy2', primary], ['enemy1', other], ['enemy3', other]] as const) {
      const dealt = calls('ULT', enemy)
      expect(dealt, enemy).toHaveLength(2)
      expect(dealt[0]!.damage, enemy).toBeCloseTo(expected(states, (d) => hitsOf(swRequest(4, d, 3), 'ULT')[0]!.damage), 6)
      expect(dealt[1]!.damage, enemy).toBeCloseTo(expected(states, (d) => hitsOf(swRequest(4, d, 3), 'ULT')[1]!.damage), 6)
      expect(dealt[1]!.scaling, enemy).toBeCloseTo(expected(states, (d) => 0.2 * Math.min(5, d.count)), 12)
    }
    // And they are different numbers: the middle enemy takes more.
    expect(calls('ULT', 'enemy2')[0]!.damage).toBeGreaterThan(calls('ULT', 'enemy1')[0]!.damage)
    expect(calls('ULT', 'enemy1')[0]!.damage).toBeCloseTo(calls('ULT', 'enemy3')[0]!.damage, 9)
  })
})

describe('Silver Wolf through the real kernel: a teammate\'s hits carry her debuffs, enemy by enemy', () => {
  for (const eidolon of [0, 2, 3, 5]) {
    it(`E${eidolon}: an ally's Basic ATK after her Skill and Ultimate matches Fribbels' with her debuff switches on or off as they are`, () => {
      const { battle, use, calls } = battleOf([silverWolfMember(eidolon), strikerMember], 3)
      const e2 = eidolon >= 2
      const v = e2 ? 1 : 0
      // Before she has done anything: only E2's Vulnerability, if any.
      use('striker', 'basic', 'enemy2')
      const none = { count: v, e2 }
      expect(calls('BASIC', 'enemy2')[0]!.damage).toBeCloseTo(hitsOf(allyRequest(eidolon, none, 3), 'BASIC')[0]!.damage, 6)

      use('sw', 'skill')
      battle.party.setEnergy('sw', 110)
      use('sw', 'ultimate')
      // Middle enemy: RES shred, Ultimate DEF, and two random Bugs (the Skill's and the Ultimate's), plus E2's Bug from the first ally attack
      // above: each type at 1 - (2/3)^applications. The others: Ultimate DEF and one random Bug (the Ultimate's): each type at 1/3.
      const middle = bugStates({ skillRes: true, ultDef: true, count: v + 2, e2 }, bugsAfter(e2 ? 3 : 2))
      const side = bugStates({ ultDef: true, count: v + 1, e2 }, bugsAfter(1))
      const before = calls('BASIC', 'enemy1').length
      use('striker', 'basic', 'enemy2')
      use('striker', 'basic', 'enemy1')
      const second = calls('BASIC', 'enemy2').at(-1)!
      const first = calls('BASIC', 'enemy1').at(-1)!
      expect(calls('BASIC', 'enemy1').length).toBe(before + 1)
      expect(second.damage).toBeCloseTo(expected(middle, (d) => hitsOf(allyRequest(eidolon, d, 3), 'BASIC')[0]!.damage), 6)
      expect(first.damage).toBeCloseTo(expected(side, (d) => hitsOf(allyRequest(eidolon, d, 3), 'BASIC')[0]!.damage), 6)
      // Her debuffs raise it: with them off the same hit is smaller (RES and DEF shred).
      expect(second.damage).toBeGreaterThan(calls('BASIC', 'enemy2')[0]!.damage)
      expect(second.damage).toBeGreaterThan(first.damage)
    })
  }

  it('E2: an ally\'s attack puts a Bug on the enemy inside the action, so the next ally hit sees it', () => {
    const { battle, use, calls } = battleOf([silverWolfMember(2), strikerMember])
    use('striker', 'basic')
    // E2's Bug from that attack: one random Bug (each type at 1/3), so 2 debuffs in expectation (Vulnerability and the Bug).
    expect(battle.debuffCount('enemy1')).toBeCloseTo(2, 12)
    use('striker', 'basic')
    const states = bugStates({ count: 1, e2: true }, bugsAfter(1))
    expect(calls('BASIC', 'enemy1')[1]!.damage).toBeCloseTo(expected(states, (d) => hitsOf(allyRequest(2, d), 'BASIC')[0]!.damage), 6)
  })
})

describe('Good Night and Sleep Well through the real kernel: the debuff count, live', () => {
  /** Silver Wolf's Basic ATK at E0 on an enemy that already has `k` other debuffs, which are not hers. */
  function basicWith(k: number, superimposition = 5, withLightCone = true) {
    const { battle, use, calls } = battleOf([silverWolfMember(0, superimposition, withLightCone)])
    for (let n = 0; n < k; n++) battle.applyDebuff({ id: `other${n}`, target: 'enemy1', source: 'sw' })
    use('sw', 'basic')
    return calls('BASIC', 'enemy1')[0]!.damage
  }

  it('0 to 5 debuffs on the target: priced with min(3, debuffs) stacks, equal to Fribbels\' for that state', () => {
    for (const k of [0, 1, 2, 3, 4, 5]) {
      expect(basicWith(k), `${k} debuffs`).toBeCloseTo(hitsOf(swRequest(0, { count: k }), 'BASIC')[0]!.damage, 6)
    }
  })

  it('and not Fribbels\' default of 3 stacks always: with 0 debuffs the hit is smaller than the default\'s', () => {
    const defaultStacks = hitsOf({ ...swRequest(0, { count: 0 }), attacker: { ...swUnit(0), characterConditionals: { ehrToAtkConversion: true, ...flags({ count: 0 }) } } }, 'BASIC')[0]!.damage
    expect(basicWith(0)).toBeLessThan(defaultStacks)
    expect(basicWith(3)).toBeCloseTo(defaultStacks, 6)
    // The step from stack to stack is the light cone's 24% of Silver Wolf's base DMG bonuses, at S5.
    expect(basicWith(0)).toBeLessThan(basicWith(1))
    expect(basicWith(1)).toBeLessThan(basicWith(2))
    expect(basicWith(2)).toBeLessThan(basicWith(3))
    expect(basicWith(3)).toBeCloseTo(basicWith(4), 9)
  })

  it('S1 prices each stack at 12%, S5 at 24% (Fribbels reads the superimposition itself)', () => {
    for (const s of [1, 3, 5]) {
      for (const k of [0, 2, 3]) {
        expect(basicWith(k, s), `S${s}, ${k} debuffs`).toBeCloseTo(hitsOf(swRequest(0, { count: k }, 1, s), 'BASIC')[0]!.damage, 6)
      }
    }
    expect(basicWith(3, 5)).toBeGreaterThan(basicWith(3, 1))
  })

  it('without the module the kernel\'s default counts all 3 stacks, which is why a run refuses a light cone with no module', () => {
    expect(basicWith(0, 5, false)).toBeCloseTo(basicWith(3), 6)
  })

  it('counts the debuffs Silver Wolf herself puts on in the same battle: Skill, then Ultimate', () => {
    // After the Skill there are the RES shred and one random Bug, and the Ultimate adds its DEF: 2 certain debuffs and each Bug type at
    // 1/3. The light cone counts min(3, debuffs) in each state, and the states are weighted.
    const { battle, use, calls } = battleOf([silverWolfMember(0)])
    use('sw', 'skill')
    battle.party.setEnergy('sw', 110)
    use('sw', 'ultimate')
    const states = bugStates({ skillRes: true, ultDef: true, count: 2 }, bugsAfter(1))
    expect(calls('ULT', 'enemy1')[0]!.damage).toBeCloseTo(expected(states, (d) => hitsOf(swRequest(0, d), 'ULT')[0]!.damage), 6)
    expect(calls('SKILL', 'enemy1')[0]!.damage).toBeCloseTo(hitsOf(swRequest(0, { skillRes: true, count: 1 }), 'SKILL')[0]!.damage, 6)
  })
})
