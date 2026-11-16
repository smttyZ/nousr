import { describe, expect, it } from 'vitest'
import type { EngineEvents } from '../engine'
import { loadEnemyProfile } from '../enemy/profile'
import type { EnemyProfile } from '../enemy/profile'
import { fakeResult, ZERO_STATS } from '../kernel/testing'
import type { DamageKernel, DamageRequest } from '../kernel/types'
import type { Kit } from '../kits/kit'
import type { Element, Rule } from '../scenario/types'
import { Battle, ENTANGLED, FROZEN, IMPRISONED } from './battle'
import type { HitPart, MemberSetup } from './battle'
import { BREAK_BASE_DELAY, ENTANGLEMENT_DELAY, IMPRISONMENT_DELAY, IMPRISONMENT_SLOW, THAW_ADVANCE } from './enemies'

/**
 * Weakness break (DESIGN.md, K7 and K7b) against a fake kernel: toughness reduction, the break itself, the
 * element effects that change timing, and recovery. Numbers: a hit is 1000 damage when the enemy is broken and
 * 900 when it is not (the x1.0 and x0.9 toughness multiplier), Break DMG is 5000 broken and 4500 not.
 */

const generic = loadEnemyProfile('generic-moc')
const noBuild = { relicSet1: '', relicSet2: '', ornamentSet: '', body: '', feet: '', planarSphere: '', linkRope: '', substatRolls: {} }
const withBar = (toughness: number): EnemyProfile => ({ ...generic, toughness })

/** A fake kernel whose Break Effect and Weakness Break Efficiency a test sets. Every request is kept. */
function makeKernel(options: { be?: number, wbe?: number, withBreak?: boolean } = {}) {
  const requests: DamageRequest[] = []
  const kernel: DamageKernel = {
    actionDamage(request) {
      requests.push(request)
      const broken = request.enemy?.weaknessBroken === true
      return fakeResult(
        {
          BASIC: [{ damage: broken ? 1000 : 900, scaling: 1 }],
          ...(options.withBreak !== false && { BREAK: [{ damage: broken ? 5000 : 4500 }] }),
        },
        { ...ZERO_STATS, BE: options.be ?? 0, breakEfficiency: options.wbe ?? 0 },
      )
    },
  }
  return { kernel, requests }
}

/** One Basic ATK of the given parts, in the given element. */
const breaker = (element: Element, parts: () => HitPart[]): Kit => ({
  characterId: 'breaker',
  path: 'Destruction',
  element,
  maxEnergy: 0,
  create: (battle, self) => ({
    actions: {
      basic: {
        kind: 'basic',
        canUse: () => true,
        use: () => battle.performAction(self.key, 'basic', 'basic', () => battle.attack({ attacker: self.key, ability: 'BASIC', parts: parts() })),
      },
    },
    attackerState: () => ({}),
    teammateState: () => ({}),
  }),
})

const single = (toughness: number, extra: { ignoresWeakness?: boolean } = {}): HitPart[] => [{ shape: 'single', scaling: 1, hit: 0, toughness, ...extra }]

const member = (kit: Kit, baseSpd = 400): MemberSetup => ({
  key: 'a',
  kit,
  eidolon: 0,
  affinitiveEidolon: false,
  stats: { maxHp: 1_000_000, def: 1000, baseSpd },
  kernel: { unit: { characterId: 'breaker', lightConeId: 'none', eidolon: 0, superimposition: 1 }, build: noBuild },
})

const basicPolicy: Rule[] = [{ unit: 'a', use: 'basic', when: [] }]

function setup(options: {
  element?: Element
  parts?: () => HitPart[]
  toughness?: number
  weaknesses?: 'all' | Element[]
  enemyCount?: number
  be?: number
  wbe?: number
  withBreak?: boolean
  cycles?: number
} = {}) {
  const { kernel, requests } = makeKernel(options)
  const battle = new Battle({
    members: [member(breaker(options.element ?? 'Fire', options.parts ?? (() => single(30))))],
    policy: basicPolicy,
    profile: withBar(options.toughness ?? 480),
    enemyCount: options.enemyCount ?? 1,
    weaknesses: options.weaknesses ?? 'all',
    cycles: options.cycles ?? 1,
    start: { energy: 0, skillPoints: 3, techniques: false },
    kernel,
  })
  const dealt: EngineEvents['damageDealt'][] = []
  const log: { type: string, at: number, detail?: unknown }[] = []
  battle.timeline.bus.on('damageDealt', (e) => dealt.push(e))
  const watch = <K extends keyof EngineEvents>(type: K, detail?: (e: EngineEvents[K]) => unknown) =>
    battle.timeline.bus.on(type, (e) => log.push({ type, at: battle.timeline.now, detail: detail?.(e) }))
  watch('weaknessBroken', (e) => e.element)
  watch('toughnessRecovered')
  watch('enemyAttack')
  watch('enemyTurnSkipped')
  const delays: { enemy: string, amount: number }[] = []
  battle.timeline.bus.on('gaugeChanged', (e) => {
    if (e.cause === 'delay' && battle.enemies.has(e.unit)) delays.push({ enemy: e.unit, amount: e.after - e.before })
  })
  const attack = () => battle.member('a').instance.actions.basic!.use()
  return { battle, requests, dealt, log, delays, attack, bar: (i = 0) => battle.enemies.toughness(battle.enemies.ids[i]!) }
}

describe('toughness reduction', () => {
  it('takes a part\'s toughness in internal units: a Basic ATK of 30 leaves 450 of a 480 bar', () => {
    const s = setup()
    s.attack()
    expect(s.bar()).toBe(450)
    expect(s.battle.enemies.maxToughness('enemy1')).toBe(480)
  })

  it('removes toughness from an enemy weak to the attacker\'s element, and not from one that is not', () => {
    const weak = setup({ element: 'Fire', weaknesses: ['Fire', 'Ice'] })
    weak.attack()
    expect(weak.bar()).toBe(450)
    const notWeak = setup({ element: 'Fire', weaknesses: ['Ice'] })
    notWeak.attack()
    expect(notWeak.bar()).toBe(480)
  })

  it('every element is a weakness with weaknesses "all" (S5)', () => {
    for (const element of ['Physical', 'Fire', 'Ice', 'Lightning', 'Wind', 'Quantum', 'Imaginary'] as const) {
      const s = setup({ element, weaknesses: 'all' })
      s.attack()
      expect(s.bar(), element).toBe(450)
    }
  })

  it('a part that ignores weakness removes toughness from a non-weak enemy', () => {
    const s = setup({ element: 'Fire', weaknesses: ['Ice'], parts: () => single(30, { ignoresWeakness: true }) })
    s.attack()
    expect(s.bar()).toBe(450)
  })

  it('judges each part on its own: only the part that ignores weakness counts against a non-weak enemy', () => {
    const s = setup({
      weaknesses: ['Ice'],
      parts: () => [
        { shape: 'single', scaling: 1, hit: 0, toughness: 30 },
        { shape: 'single', scaling: 0, hit: 0, toughness: 15, ignoresWeakness: true },
      ],
    })
    s.attack()
    expect(s.bar()).toBe(465)
  })

  it('multiplies by 1 + Weakness Break Efficiency', () => {
    const s = setup({ wbe: 0.5 })
    s.attack()
    expect(s.bar()).toBe(480 - 45)
  })

  it('a part with no toughness removes none', () => {
    const s = setup({ parts: () => [{ shape: 'single', scaling: 1, hit: 0 }] })
    s.attack()
    expect(s.bar()).toBe(480)
  })

  it('splits a blast, an AoE and a bounce across the enemies by shape', () => {
    const blast = setup({ enemyCount: 3, parts: () => [{ shape: 'blast', scaling: 1, adjacent: 0.5, hit: 0, toughness: 30, adjacentToughness: 15 }] })
    blast.attack()
    expect(blast.battle.enemies.ids.map((id) => blast.battle.enemies.toughness(id))).toEqual([465, 450, 465])
    const aoe = setup({ enemyCount: 3, parts: () => [{ shape: 'aoe', scaling: 1, hit: 0, toughness: 20 }] })
    aoe.attack()
    expect(aoe.battle.enemies.ids.map((id) => aoe.battle.enemies.toughness(id))).toEqual([460, 460, 460])
    // 6 hits of 10 spread over 3 enemies: 20 each in expectation.
    const bounce = setup({ enemyCount: 3, parts: () => [{ shape: 'bounce', scaling: 1, hits: 6, hit: 0, toughness: 10 }] })
    bounce.attack()
    expect(bounce.battle.enemies.ids.map((id) => bounce.battle.enemies.toughness(id))).toEqual([460, 460, 460])
  })
})

describe('the break', () => {
  it('breaks at exactly 0, not before', () => {
    const s = setup({ toughness: 60 })
    s.attack()
    expect(s.bar()).toBe(30)
    expect(s.battle.enemies.isBroken('enemy1')).toBe(false)
    expect(s.log.filter((l) => l.type === 'weaknessBroken')).toHaveLength(0)
    s.attack()
    expect(s.bar()).toBe(0)
    expect(s.battle.enemies.isBroken('enemy1')).toBe(true)
    expect(s.log.filter((l) => l.type === 'weaknessBroken')).toHaveLength(1)
  })

  it('breaks when a chain of float reductions lands on 0 within rounding', () => {
    // 3 x 0.1 x 100 is 30.000000000000004; a bar of 30 is gone.
    const s = setup({ toughness: 30, wbe: 0, parts: () => [{ shape: 'bounce', scaling: 1, hits: 3, hit: 0, toughness: 10 }] })
    s.attack()
    expect(s.battle.enemies.isBroken('enemy1')).toBe(true)
  })

  it('prices Break DMG once per break, as the kernel\'s own BREAK number with the enemy broken, and credits the breaker', () => {
    const s = setup({ toughness: 30 })
    s.attack()
    const breaks = s.dealt.filter((d) => d.ability === 'BREAK')
    expect(breaks).toHaveLength(1)
    expect(breaks[0]!.damage).toBe(5000)
    expect(breaks[0]!.scaling).toBe(0)
    // Another attack on the broken enemy: no second Break DMG.
    s.attack()
    expect(s.dealt.filter((d) => d.ability === 'BREAK')).toHaveLength(1)
    expect(s.battle.enemies.hp('enemy1')).toBe(generic.hp! - (900 + 5000 + 1000))
  })

  it('prices the hit that breaks as against an enemy not yet broken, and the next hit as broken', () => {
    const s = setup({ toughness: 30 })
    s.attack()
    s.attack()
    expect(s.dealt.filter((d) => d.ability === 'BASIC').map((d) => d.damage)).toEqual([900, 1000])
  })

  it('is credited to the breaker in the totals', () => {
    const s = setup({ toughness: 30, cycles: 1 })
    s.attack()
    expect(s.battle.run().damageByMember.a).toBeGreaterThanOrEqual(5900)
  })

  it('is stopped with an error when the kernel has no BREAK ability for the breaker', () => {
    const s = setup({ toughness: 30, withBreak: false })
    expect(() => s.attack()).toThrow(/no BREAK ability/)
  })

  it('no break without a break: an enemy not weak to the element keeps its bar and takes no Break DMG', () => {
    const s = setup({ toughness: 30, weaknesses: ['Ice'] })
    s.attack()
    expect(s.dealt.some((d) => d.ability === 'BREAK')).toBe(false)
    expect(s.battle.enemies.isBroken('enemy1')).toBe(false)
  })
})

describe('weaknessBroken at pricing time', () => {
  it('reaches the kernel only while the enemy is broken', () => {
    const s = setup({ toughness: 30 })
    s.attack()
    s.attack()
    const flags = s.requests.map((r) => r.enemy?.weaknessBroken)
    // Request 1: the breaking hit (not broken yet). Request 2: Break DMG (broken). Request 3: the next hit (broken).
    expect(flags).toEqual([false, true])
    expect(s.requests.every((r) => r.enemy?.weaknessBroken !== undefined)).toBe(true)
  })

  it('goes back to false after the bar refills', () => {
    const s = setup({ toughness: 30 })
    s.battle.run()
    expect(s.log.find((l) => l.type === 'toughnessRecovered')).toBeDefined()
    // The ally keeps hitting (the kernel caches answers, so read the damage it priced): the breaking hit is
    // 900, hits while broken are 1000, and the hit that breaks the refilled enemy is 900 again.
    const hits = s.dealt.filter((d) => d.ability === 'BASIC').map((d) => d.damage)
    expect(hits[0]).toBe(900)
    expect(hits[1]).toBe(1000)
    expect(hits.slice(1).includes(900)).toBe(true)
  })
})

describe('what a break does to the enemy\'s turn', () => {
  it('delays 25% for any element, not scaled by Break Effect', () => {
    for (const be of [0, 1.5]) {
      const s = setup({ element: 'Fire', toughness: 30, be })
      s.attack()
      expect(s.delays).toEqual([{ enemy: 'enemy1', amount: BREAK_BASE_DELAY * 10_000 }])
    }
  })

  it('Quantum adds 20% x (1 + Break Effect) to the base delay (Entanglement)', () => {
    const s = setup({ element: 'Quantum', toughness: 30, be: 0.5 })
    s.attack()
    expect(s.delays[0]!.amount).toBe(2500)
    expect(s.delays[1]!.amount).toBeCloseTo(ENTANGLEMENT_DELAY * 1.5 * 10_000, 9)
    expect(s.delays[1]!.amount).toBeCloseTo(3000, 9)
  })

  it('Imaginary adds 30% x (1 + Break Effect) and slows the enemy by 10% for one turn (Imprisonment)', () => {
    const s = setup({ element: 'Imaginary', toughness: 30, be: 0.5 })
    const spdBefore = s.battle.timeline.spd('enemy1')
    s.attack()
    expect(s.delays[0]!.amount).toBe(2500)
    expect(s.delays[1]!.amount).toBeCloseTo(IMPRISONMENT_DELAY * 1.5 * 10_000, 9)
    expect(s.delays[1]!.amount).toBeCloseTo(4500, 9)
    expect(s.battle.timeline.spd('enemy1')).toBeCloseTo(spdBefore * (1 - IMPRISONMENT_SLOW), 9)
    // The slow is not scaled by Break Effect: the same at BE 0.
    const plain = setup({ element: 'Imaginary', toughness: 30, be: 0 })
    plain.attack()
    expect(plain.battle.timeline.spd('enemy1')).toBeCloseTo(spdBefore * 0.9, 9)
  })

  it('the Imprisonment slow ends with the enemy\'s next turn', () => {
    const s = setup({ element: 'Imaginary', toughness: 30 })
    const removed: number[] = []
    s.battle.timeline.bus.on('modifierRemoved', (e) => {
      if (e.modifier.id === IMPRISONED) removed.push(s.battle.timeline.now)
    })
    s.battle.run()
    const firstEnemyTurn = s.log.find((l) => l.type === 'enemyAttack')!.at
    expect(removed[0]).toBeCloseTo(firstEnemyTurn, 9)
  })

  describe('break effects are debuffs while they last (K24)', () => {
    it('Entanglement (Quantum): an Entangled debuff of the breaker for 1 turn, recorded as inflicted by the breaking action', () => {
      const s = setup({ element: 'Quantum', toughness: 30 })
      const actions: EngineEvents['actionUsed'][] = []
      s.battle.timeline.bus.on('actionUsed', (a) => actions.push(a))
      s.attack()
      const entangled = s.battle.timeline.modifiers.get('enemy1', ENTANGLED)!
      expect(entangled.debuff).toBe(true)
      expect(entangled.source).toBe('a')
      expect(s.battle.debuffCount('enemy1')).toBe(1)
      expect(s.battle.debuffChance('enemy1')).toBe(1)
      // A break's effect counts as a debuff inflicted during the breaking ability (checked in game 2026-11-15:
      // a Quantum break gave Acheron a Slashed Dream), so talents keyed on that fire for it.
      expect(actions[0]!.debuffed).toEqual(['enemy1'])
      expect(actions[0]!.debuffChance).toEqual({ enemy1: 1 })
    })

    it('Entanglement ends with the next turn of the enemy', () => {
      const s = setup({ element: 'Quantum', toughness: 30 })
      const removed: number[] = []
      s.battle.timeline.bus.on('modifierRemoved', (m) => {
        if (m.modifier.id === ENTANGLED) removed.push(s.battle.timeline.now)
      })
      s.battle.run()
      expect(removed[0]).toBeCloseTo(s.log.find((l) => l.type === 'enemyAttack')!.at, 9)
    })

    it('Imprisonment (Imaginary): the shared Imprisoned state is a debuff; a second break or Welt refreshes it, one SPD cut', () => {
      const s = setup({ element: 'Imaginary', toughness: 30 })
      const base = s.battle.timeline.spd('enemy1')
      s.attack()
      expect(s.battle.timeline.modifiers.get('enemy1', IMPRISONED)!.debuff).toBe(true)
      expect(s.battle.debuffCount('enemy1')).toBe(1)
      s.battle.imprison('enemy1', 'a', 0.12, true)
      expect(s.battle.debuffCount('enemy1')).toBe(1)
      expect(s.battle.timeline.spd('enemy1')).toBeCloseTo(base * (1 - IMPRISONMENT_SLOW), 9)
      expect(s.battle.timeline.modifiers.on('enemy1').filter((m) => m.id === IMPRISONED)).toHaveLength(1)
    })

    it('Freeze (Ice): a Frozen debuff that ends with the skipped turn', () => {
      const s = setup({ element: 'Ice', toughness: 30, cycles: 2 })
      const removedAt: number[] = []
      s.battle.timeline.bus.on('modifierRemoved', (m) => {
        if (m.modifier.id === FROZEN) removedAt.push(s.battle.timeline.now)
      })
      s.attack()
      expect(s.battle.timeline.modifiers.get('enemy1', FROZEN)!.debuff).toBe(true)
      s.battle.run()
      const skippedAt = s.log.find((l) => l.type === 'enemyTurnSkipped')!.at
      expect(removedAt[0]).toBeCloseTo(skippedAt, 9)
    })

    it('other elements leave no debuff', () => {
      for (const element of ['Fire', 'Physical', 'Lightning', 'Wind'] as const) {
        const s = setup({ element, toughness: 30 })
        s.attack()
        expect(s.battle.debuffChance('enemy1'), element).toBe(0)
      }
    })
  })

  it('other elements add nothing: Fire, Physical, Lightning and Wind give only the base delay', () => {
    for (const element of ['Fire', 'Physical', 'Lightning', 'Wind'] as const) {
      const s = setup({ element, toughness: 30, be: 1 })
      s.attack()
      expect(s.delays.map((d) => d.amount), element).toEqual([2500])
      expect(s.battle.timeline.modifiers.on('enemy1'), element).toHaveLength(0)
      expect(s.battle.enemies.isFrozen('enemy1'), element).toBe(false)
    }
  })

  it('Ice freezes: the next enemy turn is skipped, the one after comes 50% sooner', () => {
    const s = setup({ element: 'Ice', toughness: 30, cycles: 2 })
    s.battle.run()
    const times = (type: string) => s.log.filter((l) => l.type === type).map((l) => l.at)
    const brokenAt = times('weaknessBroken')[0]!
    // Ally SPD 400 acts first at AV 25 and breaks. The enemy (SPD 158.4) would have acted at 63.13; the 25% delay moves it by 2500/158.4.
    const firstTurn = 10_000 / 158.4 + 2500 / 158.4
    expect(brokenAt).toBeCloseTo(25, 9)
    expect(times('enemyTurnSkipped')[0]).toBeCloseTo(firstTurn, 6)
    // No attack at the skipped turn; the next enemy turn comes after half a gauge.
    expect(times('enemyAttack')[0]).toBeCloseTo(firstTurn + (10_000 * (1 - THAW_ADVANCE)) / 158.4, 6)
    expect(times('enemyAttack')[0]).toBeGreaterThan(times('enemyTurnSkipped')[0]!)
  })

  it('a frozen enemy stays broken through the skipped turn and recovers at the turn after it (IN-GAME CHECK reading)', () => {
    const s = setup({ element: 'Ice', toughness: 30, cycles: 2 })
    s.battle.run()
    const order = s.log.map((l) => l.type)
    expect(order.slice(0, 4)).toEqual(['weaknessBroken', 'enemyTurnSkipped', 'toughnessRecovered', 'enemyAttack'])
  })
})

describe('recovery', () => {
  it('refills the bar and ends the broken state at the start of the enemy\'s turn, before it acts', () => {
    const s = setup({ element: 'Fire', toughness: 30, cycles: 1 })
    s.battle.run()
    const order = s.log.map((l) => l.type)
    expect(order.slice(0, 3)).toEqual(['weaknessBroken', 'toughnessRecovered', 'enemyAttack'])
    const recovered = s.log.find((l) => l.type === 'toughnessRecovered')!
    const attackAt = s.log.find((l) => l.type === 'enemyAttack')!
    expect(recovered.at).toBe(attackAt.at)
    // 25 AV: the first break. The enemy's turn is at 63.13 + 15.78 (the 25% delay).
    expect(recovered.at).toBeCloseTo((10_000 + 2500) / 158.4, 6)
  })

  it('leaves the enemy broken until then: its bar is 0 and further hits remove nothing', () => {
    const s = setup({ toughness: 30 })
    s.attack()
    expect(s.battle.enemies.toughness('enemy1')).toBe(0)
    s.attack()
    expect(s.battle.enemies.toughness('enemy1')).toBe(0)
    expect(s.log.filter((l) => l.type === 'weaknessBroken')).toHaveLength(1)
  })

  it('a refilled enemy can be broken again, with a new Break DMG', () => {
    const s = setup({ element: 'Fire', toughness: 30, cycles: 2 })
    s.battle.run()
    expect(s.log.filter((l) => l.type === 'weaknessBroken').length).toBeGreaterThan(1)
    expect(s.dealt.filter((d) => d.ability === 'BREAK').length).toBe(s.log.filter((l) => l.type === 'weaknessBroken').length)
  })
})
