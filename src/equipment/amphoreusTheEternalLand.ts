import type { EquipmentInstance, SetModule } from './equipment'

/**
 * Amphoreus, The Eternal Land (set 323), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 323`).
 * Summary: an ornament, 2 pieces: CRIT Rate +8%. While the wearer's memosprite is on the field, all allies' SPD +8%.
 * The effect cannot be stacked.
 *
 * Kind of each part:
 * - CRIT Rate +8%: always on. Fribbels adds it itself (`p2c`).
 * - All allies' SPD +8%: conditional on the wearer's memosprite, in two places that have to agree:
 *   - The timeline: a modifier `set.323.spd` (`spdPct` 0.08, no duration) on every ally that has a place on the timeline, one shared
 *     id, so two wearers cannot stack it. It is put on when a wearer's memosprite joins the field and taken off when no wearer has a
 *     memosprite left (`memospriteAdded` / `memospriteRemoved`, at a high priority so the timeline is right before any other
 *     listener of the same event looks at it). A memosprite that joins later (a teammate's) gets it too while the effect is up.
 *   - The kernel: Fribbels' switch `setConditionals['Amphoreus, The Eternal Land']` applies the team SPD +8% to the attacker when the
 *     attacker is the wearer (and the character has a memosprite). A teammate's attack reads the team form `teamOrnamentSet`,
 *     which is a flat team SPD +8% with no memosprite condition (`optimization/teammateSetUtils.ts`), so the module gives it only
 *     while that wearer has a memosprite on the field. Fribbels counts the effect once when both forms are present (the wearer's
 *     switch is skipped if a teammate gives the team form: its `teammateSetEffects` check, and the set's teammate entry is marked
 *     non-stackable), which is the "cannot be stacked" rule in the kernel, as the shared modifier id is on the timeline.
 *   Both read the same fact, "some wearer has a memosprite on the field", so the timeline's SPD and the kernel's SPD agree for the
 *   wearer and every teammate. That keeps the SPD threshold checks that compare the two readings quiet (Giant Tree of Rapt
 *   Brooding's heal check; a kit's `checkSpd`).
 *
 * All allies: characters AND memosprites that are on the timeline (a memosprite is an ally in the engine's own sense,
 * `Battle.isAlly`, and Memory's Curtain Never Falls reaches them the same way). Summons (Lightning-Lord) are not allies and are
 * skipped. A memosprite with no SPD (not on the timeline) has nothing to buff. A suspended one (Summer Songbirds before Fever) is on
 * the timeline and carries the modifier for when it resumes.
 *
 * IN-GAME CHECK: whether memosprites count as "all allies" for the SPD +8% (read as yes, as for the light cone above).
 * IN-GAME CHECK: whether the effect needs the wearer to be standing; a downed wearer's memosprite leaves with it, so it ends.
 */

const NAME = 'Amphoreus, The Eternal Land'
const MODIFIER = 'set.323.spd'
const SPD_PCT = 0.08
/** Ahead of every default-priority listener of the same event. */
const FIRST = 1000

export const AmphoreusTheEternalLand: SetModule = {
  kind: 'set',
  type: 'ornament',
  name: NAME,
  setId: '323',

  create(battle, wearer): EquipmentInstance {
    const me = wearer.key
    const { timeline } = battle

    /** Whether the member's equipment includes this set. */
    const wearsIt = (key: string): boolean => battle.members.find((m) => m.key === key)?.equipment?.sets.some((s) => s.module.name === NAME) ?? false
    /** Some wearer has a memosprite on the field. */
    const providing = (): boolean => battle.members.some((m) => wearsIt(m.key) && battle.memospritesOf(m.key).length > 0)

    /** Puts the modifier on every ally on the timeline while some wearer provides it, and takes it off all of them when none does. */
    const sync = () => {
      const on = providing()
      for (const member of battle.members) {
        for (const unit of [member.key, ...battle.memospritesOf(member.key)]) {
          if (!timeline.has(unit)) continue
          const has = timeline.modifiers.has(unit, MODIFIER)
          if (on && !has) timeline.modifiers.apply({ id: MODIFIER, target: unit, source: me, spdPct: SPD_PCT })
          else if (!on && has) timeline.modifiers.remove(unit, MODIFIER)
        }
      }
    }

    timeline.bus.on('memospriteAdded', sync, { priority: FIRST })
    timeline.bus.on('memospriteRemoved', sync, { priority: FIRST })

    return {
      // The wearer's own pricing, and its memosprite's (priced as the owner's): Fribbels' switch, true while this wearer has a memosprite.
      attackerState: () => ({ setConditionals: { [NAME]: battle.memospritesOf(me).length > 0 } }),
      // A teammate's pricing: the team form, only while this wearer has a memosprite.
      teammateState: () => (battle.memospritesOf(me).length > 0 ? { teamOrnamentSet: NAME } : {}),
    }
  },
}
