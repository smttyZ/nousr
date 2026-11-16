import type { UnitId } from '../engine/events'
import type { EquipmentInstance, SetModule, SetPieces } from './equipment'

/**
 * Sacerdos' Relived Ordeal (set 121), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 121`).
 * Summary: 2 pieces +6% SPD (the scenario's SPD, as for the other always-on stats). 4 pieces: "When using Skill or Ultimate on one
 * ally target, increases the ability target's CRIT DMG by 18%, lasting for 2 turn(s). This effect can stack up to 2 time(s)."
 *
 * Kind of each part:
 * - SPD +6% (2 pieces): always on. Fribbels adds it itself (`p2c`); the timeline reads it from the kernel's stats.
 * - The 4-piece CRIT DMG lives on the ability's target. Fribbels has two forms for it: the wearer's own select
 *   (`setConditionals["Sacerdos' Relived Ordeal"]`, 0 to 2 for stacks the wearer itself holds, 3 and 4 for an optimizer-only
 *   "outgoing buff" view) and the team form `teamRelicSet` "Sacerdos' Relived Ordeal 1x" / "… 2x" (+18% / +36% CRIT DMG on the
 *   attacker). Its default for the wearer's select is 0.
 *
 * Which ally the Skill or Ultimate targets (Smitty, 2026-11-15: "a buff lives on the unit that holds it"): no event names the target,
 * so it is read from the buffs the ability itself put on an ally. While an action is in progress, every `modifierApplied` whose
 * `source` is the wearer and whose `target` is an ally character other than the wearer is recorded against that action's serial
 * (`Battle.actionSerialInProgress`). When the wearer's own Skill or Ultimate resolves (`actionUsed`, `actor` the wearer, `kind` 'skill'
 * or 'ultimate', same serial), the recorded ally is the ability target and gains one stack. What this excludes:
 * - buffs the wearer gives outside its Skill or Ultimate (Basic ATK, follow-ups, the start of battle, turn-start passives such as
 *   Past and Future's, buffs given from an `actionUsed` listener such as Memory's Curtain Never Falls'): their serial is not the
 *   wearer's Skill or Ultimate, or there is none;
 * - buffs on memosprites and summons (Sunday's Skill advances the target's memosprites; only a character can be "the ability
 *   target" here) and debuffs on enemies: the target is not an ally character;
 * - a buff the same action put on more than one ally (a team-wide effect riding on the ability): the same modifier id on two or more
 *   allies is not a single-target buff, so those allies are not candidates.
 * If more than one ally is still a candidate, the ability's target cannot be told from its buffs and the run stops with an error
 * rather than guess. If none is (an ability that buffs no single ally), no stack is given.
 * Sunday's Talent stacks and Technique buff go to the same ally as his Skill, so they only confirm the target.
 *
 * The stack is a modifier on the holder, `set.121.cd:<wearer>`, with `stacks` 1 or 2 and 2 turns. It is given after the ability has
 * resolved. None of the abilities that target one ally in the roster deals damage, so no hit is priced too early or too late.
 * Pricing: when a teammate holding stacks from this wearer attacks, the wearer gives `teamRelicSet` "… 1x" or "… 2x". Fribbels decides
 * from the wearer's character whether the attacker's memosprite shares it (Sunday: self and memosprite; anyone else: the attacker only).
 * The wearer's own select is 0: the wearer never targets itself through this path, and stacks from another wearer reach it through
 * that wearer's team form.
 *
 * IN-GAME CHECK: the 2 turns count down on the holder's turns, at the end of each, and the turn it was given in does not count.
 * IN-GAME CHECK: a new stack renews the duration of both stacks.
 * IN-GAME CHECK: two different wearers' stacks are kept apart (each up to 2), not one shared cap of 2. The roster has one wearer.
 * IN-GAME CHECK: stacks stay on the holder when the wearer is downed (the text ties them to the holder, not to the wearer).
 * NOT MODELLED: the wearer targeting itself (Sunday's Ultimate on himself puts no buff on him in his kit, so he gets no stack). Whether
 *   "one ally target" includes the wearer is an IN-GAME CHECK; if it does, he is missing his own stack in that case.
 * The 2-piece SPD is not added here, as in the other modules.
 */

const NAME = "Sacerdos' Relived Ordeal"
export const SACERDOS_ONE_STACK = "Sacerdos' Relived Ordeal 1x"
export const SACERDOS_TWO_STACKS = "Sacerdos' Relived Ordeal 2x"
const MAX_STACKS = 2
const TURNS = 2

/** The id of the CRIT DMG stacks a wearer gives. */
export const sacerdosModifierId = (wearer: UnitId): string => `set.121.cd:${wearer}`

export const SacerdosRelivedOrdeal: SetModule = {
  kind: 'set',
  type: 'relic',
  name: NAME,
  setId: '121',

  create(battle, wearer, pieces: SetPieces): EquipmentInstance {
    if (pieces < 4) return {}

    const me = wearer.key
    const { timeline } = battle
    const { modifiers } = timeline
    const id = sacerdosModifierId(me)
    /** Per action serial: for each modifier id the wearer applied to an ally character, the allies it went to. */
    const given = new Map<number, Map<string, Set<UnitId>>>()

    timeline.bus.on('modifierApplied', ({ modifier }) => {
      const serial = battle.actionSerialInProgress
      if (serial === undefined || modifier.source !== me || modifier.id === id) return
      if (modifier.target === me || !battle.isCharacter(modifier.target)) return
      const byId = given.get(serial) ?? new Map<string, Set<UnitId>>()
      const allies = byId.get(modifier.id) ?? new Set<UnitId>()
      allies.add(modifier.target)
      byId.set(modifier.id, allies)
      given.set(serial, byId)
    })

    timeline.bus.on('actionUsed', (action) => {
      const byId = given.get(action.serial)
      given.delete(action.serial)
      if (action.actor !== me || (action.kind !== 'skill' && action.kind !== 'ultimate') || byId === undefined) return
      const candidates = new Set<UnitId>()
      for (const allies of byId.values()) if (allies.size === 1) candidates.add([...allies][0]!)
      if (candidates.size > 1) {
        throw new Error(
          `${NAME} (wearer ${me}): its ${action.kind} '${action.action}' put single-ally buffs on ${[...candidates].join(', ')}, so its ` +
            'one ally target cannot be told from them. Not modelled for an ability that buffs several allies one by one.',
        )
      }
      const [target] = candidates
      if (target === undefined || battle.party.get(target).downed) return
      const stacks = Math.min(MAX_STACKS, (modifiers.get(target, id)?.stacks ?? 0) + 1)
      modifiers.apply({ id, target, source: me, stacks, duration: { turns: TURNS, tick: 'turnEnd' } })
    })

    return {
      attackerState: () => ({ setConditionals: { [NAME]: 0 } }),
      teammateState: (attacker) => {
        const stacks = modifiers.get(attacker.key, id)?.stacks ?? 0
        if (stacks >= 2) return { teamRelicSet: SACERDOS_TWO_STACKS }
        if (stacks === 1) return { teamRelicSet: SACERDOS_ONE_STACK }
        return {}
      },
    }
  },
}
