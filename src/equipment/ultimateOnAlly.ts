import type { Battle, Member } from '../battle/battle'
import type { EngineEvents, UnitId } from '../engine/events'

/**
 * "When the wearer uses their Ultimate on an ally": the trigger Messenger Traversing Hackerspace and Watchmaker, Master of
 * Dream Machinations share.
 *
 * No event names the target of an ability, so the module reads it from what the Ultimate did. The wearer's Ultimate counts as
 * used on an ally when, while it was the innermost action in progress, it
 * - put a modifier (a buff) with the wearer as `source` on an ally other than the wearer (Sunday's Beatified, Robin Summeretto's guest), or
 * - healed an ally other than the wearer (`healed` with the wearer, or a summon or memosprite of the wearer, as `source`), or
 * - gave an ally other than the wearer energy (`energyGained`: Sunday's and Robin Summeretto's Ultimates), or
 * - advanced an ally other than the wearer (`gaugeChanged`, cause 'advance'),
 * and it did NOT attack: an Ultimate that deals damage to enemies is an Ultimate on enemies, even when it also heals or buffs
 * allies (Fu Xuan's Ultimate heals through Dunjia, Tribbie's gives herself a Zone), which is how the game types it.
 *
 * "An ally other than the wearer" excludes the wearer's own memosprites and summons. A teammate's memosprite counts as an ally.
 *
 * What it cannot see: an Ultimate on an ally that leaves none of the four traces above (a kit that keeps the effect in a private
 * variable the kernel state reads, with no modifier, heal, energy or advance). Such a case does not trigger, silently. Every Ultimate
 * the roster has that targets allies leaves at least one trace.
 *
 * IN-GAME CHECK: that this typing of Ultimates (on an ally = has an ally effect and no attack) matches the game's for the roster;
 * and that an Ultimate on all allies (Hyacine's heal) counts as "on an ally" as well as an Ultimate on one ally (Sunday's).
 */
export function onUltimateOnAlly(battle: Battle, wearer: Member, callback: (action: EngineEvents['actionUsed']) => void): void {
  const me = wearer.key
  const { timeline } = battle
  /** Serials of actions in progress that did something to another ally. */
  const touchedAlly = new Set<number>()
  /** Serials of actions in progress that attacked an enemy. */
  const attacked = new Set<number>()

  /** An ally of the wearer that is not the wearer or one of its own memosprites. */
  const otherAlly = (unit: UnitId): boolean => unit !== me && battle.isAlly(unit) && battle.ownerOf(unit) !== me
  const touch = () => {
    const serial = battle.actionSerialInProgress
    if (serial !== undefined) touchedAlly.add(serial)
  }

  timeline.bus.on('modifierApplied', ({ modifier }) => {
    if (modifier.source === me && otherAlly(modifier.target)) touch()
  })
  timeline.bus.on('healed', ({ unit, source, amount, overheal }) => {
    if (!(amount + overheal > 0) || !otherAlly(unit)) return
    if (source === me || battle.ownerOf(source) === me || battle.summonsOf(me).includes(source)) touch()
  })
  timeline.bus.on('energyGained', ({ unit }) => {
    if (otherAlly(unit)) touch()
  })
  timeline.bus.on('gaugeChanged', ({ unit, cause }) => {
    if (cause === 'advance' && otherAlly(unit)) touch()
  })
  timeline.bus.on('attackResolved', ({ attacker }) => {
    const serial = battle.actionSerialInProgress
    if (attacker === me && serial !== undefined) attacked.add(serial)
  })

  timeline.bus.on('actionUsed', (action) => {
    const touched = touchedAlly.delete(action.serial)
    const hit = attacked.delete(action.serial)
    if (action.actor !== me || action.kind !== 'ultimate') return
    if (touched && !hit) callback(action)
  })
}
