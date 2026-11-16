import type { Member } from '../battle/battle'
import type { UnitId } from '../engine/events'
import type { EquipmentInstance, SetModule, SetPieces } from './equipment'

/**
 * World-Remaking Deliverer (set 127), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 127`).
 * Summary: 2 pieces: CRIT Rate +8%. 4 pieces: after the wearer uses Basic ATK or Skill, if the wearer's memosprite is
 * on the field, the wearer's and their memosprite's Max HP +24%, and all allies' DMG +15%, until after the wearer's
 * next Basic ATK or Skill.
 *
 * Kind of each part:
 * - CRIT Rate +8% (2 pieces): always on. Fribbels adds it itself (`p2c`).
 * - The 4-piece effect is entirely conditional. Fribbels has one switch for it, `setConditionals['World-Remaking Deliverer']`
 *   (`enabledWorldRemakingDeliverer`), which gates the wearer's and its memosprite's Max HP +24% and the team's DMG +15%. Its
 *   default depends on the path (its presets turn it ON for the Remembrance path), so the switch is always given its live value.
 * - Its team form is `teamRelicSet`, which Fribbels reads from a teammate as the all-allies DMG +15% only.
 *
 * Modelled as one flag, `active`, kept by the wearer's own actions:
 * - On every Basic ATK or Skill of the wearer (`actionUsed` with `actor` the wearer and `kind` 'basic' or 'skill') the flag is
 *   set to "a memosprite of the wearer is on the field right now". It stays as set until the wearer's next Basic ATK or Skill,
 *   which sets it again. The action that triggers it is already priced, so it never benefits from its own trigger.
 *   Cyrene's enhanced Basic ATK is a Basic ATK (`kind` 'basic') and so counts. A memosprite's own Skill or any other
 *   memosprite action is not the wearer's: the actor is the memosprite, and it is skipped. Ultimates and follow-ups do not count.
 * - The wearer's own pricing (and its memosprite's, which the kernel prices as the owner's, K6): the switch is `active`.
 * - A teammate's pricing: while `active`, the wearer gives `teamRelicSet: 'World-Remaking Deliverer'` (DMG +15%).
 * - At 2 pieces the switch is OFF and nothing is given to the team.
 *
 * Max HP +24% on the party (`Party.setStats`): the kernel already prices the wearer's +24% through the switch (its damage, its
 * heals, `Battle.combatStats`), but the timeline's party keeps its own Max HP, which sizes percentages of Max HP (heals, HP
 * costs, "HP at or above 50%") and anything copied from it. So the module keeps the party's Max HP in step, as Hyacine's and Fu
 * Xuan's kits do, with a tracked delta that is added and taken off again, never an absolute value (other buffs compose):
 * - the wearer: the kernel's Max HP with the switch on minus with it off (`Battle.combatStats`, read from a listener), so it is
 *   24% of base HP exactly as Fribbels computes it;
 * - each memosprite on the field when the effect is granted: 24% of its Max HP at that moment, less the delta already on it
 *   (the kit gave it a Max HP computed from the owner's; that is taken as its base HP, which the kernel does not report).
 * A memosprite that has other Max HP% buffs on the party (Hyacine's After Rain on Little Ica) is a slight overcount.
 * NOT MODELLED: current HP does not rise with Max HP (the party's `setStats` only moves the cap), the same as every kit that
 * buffs Max HP in this simulator. The effect: a wearer or memosprite below full HP does not gain the 24% in current HP.
 *
 * IN-GAME CHECK: the condition "if the wearer's memosprite is on the field" is read once, after the Basic ATK or Skill resolves, so
 *   a Skill that summons the memosprite (Cyrene's memosprite, Hyacine's Ica) counts it as on the field.
 * IN-GAME CHECK: once granted, the effect does not end early when the memosprite leaves before the wearer's next Basic ATK or Skill
 *   (the team's DMG +15% stays; the memosprite's own Max HP bonus leaves with it). The text conditions only the grant.
 * IN-GAME CHECK: a memosprite summoned after the grant does not get the Max HP +24% (it was not on the field when the effect was
 *   applied; the same reading as Memory's Curtain Never Falls). The wearer and the team's DMG are unaffected.
 * IN-GAME CHECK: a downed wearer ends the effect (its memosprite leaves with it, and no team flag is given).
 * IN-GAME CHECK: two wearers' DMG +15% stack (Fribbels' teammate entry for this set is not marked non-stackable).
 */

/**
 * Character ids of the characters that have a memosprite, from Fribbels' config (its `memosprite` entities): Aglaea,
 * Castorice, Cyrene, Evernight, Hyacine, Robin Summeretto, and the Trailblazer (Remembrance) Caelus and Stelle.
 * Shared with The Wondrous BananAmusement Park, which has the same kind of memosprite condition.
 */
export const MEMOSPRITE_CHARACTERS: ReadonlySet<string> = new Set(['1402', '1407', '1409', '1413', '1415', '1512', '8007', '8008'])

/**
 * Whether the wearer's character has a memosprite. The kernel id of a buffed ability version ends in `b<n>` ('1407b1'); that
 * suffix is the same character, so it is stripped before the lookup.
 */
export function hasMemosprite(wearer: Member): boolean {
  return MEMOSPRITE_CHARACTERS.has(wearer.kernel.unit.characterId.replace(/b\d+$/, ''))
}

const NAME = 'World-Remaking Deliverer'
const HP_PCT = 0.24
/** Below this a Max HP delta is float noise and nothing is applied. */
const EPSILON = 1e-9

export const WorldRemakingDeliverer: SetModule = {
  kind: 'set',
  type: 'relic',
  name: NAME,
  setId: '127',

  create(battle, wearer, pieces: SetPieces): EquipmentInstance {
    // Below 4 pieces the 4-piece effect is not worn: the switch is off, nothing is tracked, nothing is given to the team.
    if (pieces < 4) return { attackerState: () => ({ setConditionals: { [NAME]: false } }) }

    const me = wearer.key
    const { timeline, party } = battle
    let active = false
    /** True while the module prices the wearer's Max HP "without the set", to read the set's own part. */
    let suppress = false
    let wearerApplied = 0
    const memoApplied = new Map<UnitId, number>()

    const shift = (unit: UnitId, applied: number, target: number): number => {
      if (Math.abs(applied - target) < EPSILON || !party.has(unit)) return applied
      party.setStats(unit, { maxHp: party.get(unit).maxHp - applied + target })
      return target
    }

    /**
     * Brings the party's Max HP in step with `active`. Called from listeners only (it asks the kernel), and only when the effect is
     * granted or ends (the wearer's Basic ATK or Skill, the wearer downed), so it reaches the memosprites on the field at that moment
     * and never one that is summoned later.
     */
    const syncHp = () => {
      let target = 0
      if (active && !party.get(me).downed) {
        const withSet = battle.combatStats(me).HP
        suppress = true
        let without: number
        try {
          without = battle.combatStats(me).HP
        } finally {
          suppress = false
        }
        target = withSet - without
      }
      wearerApplied = shift(me, wearerApplied, target)

      const onField = new Set(battle.memospritesOf(me))
      for (const unit of [...memoApplied.keys()]) {
        if (!onField.has(unit)) memoApplied.delete(unit)
      }
      for (const unit of onField) {
        const applied = memoApplied.get(unit) ?? 0
        const base = party.get(unit).maxHp - applied
        memoApplied.set(unit, shift(unit, applied, active ? HP_PCT * base : 0))
      }
    }

    timeline.bus.on('actionUsed', (action) => {
      if (action.actor !== me || (action.kind !== 'basic' && action.kind !== 'skill')) return
      active = !party.get(me).downed && battle.memospritesOf(me).length > 0
      syncHp()
    })

    timeline.bus.on('memospriteRemoved', (e) => {
      if (e.owner !== me) return
      // The party has dropped it already; forget what was on it. The effect itself stays (IN-GAME CHECK).
      memoApplied.delete(e.unit)
    })

    // A downed wearer ends the effect: `syncHp` and `teammateState` both read the party's downed flag.
    timeline.bus.on('unitDowned', (e) => {
      if (e.unit === me) syncHp()
    })

    return {
      attackerState: () => ({ setConditionals: { [NAME]: active && !suppress } }),
      teammateState: () => (active && !party.get(me).downed ? { teamRelicSet: NAME } : {}),
    }
  },
}
