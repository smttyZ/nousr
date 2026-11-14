import type { SetModule } from './equipment'

/**
 * Lushaka, the Sunken Seas (set 317), an ornament, from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs --set 317`).
 * Summary: 2 pieces +5% Energy Regeneration Rate for the wearer. If the wearer is not the first character in the lineup,
 * the first character's ATK is +12%.
 *
 * The buff never reaches the wearer's own ATK. When the wearer attacks, the set's conditional is off, whatever the
 * lineup. Fribbels' default is on, which would give the wearer's own ATK +12%, so the module always passes false.
 *
 * When a teammate attacks, the buff is on only for the first character in the lineup, and only while the wearer is not
 * first. Fribbels' team effect is an ATK +12% that it applies to the attacker it prices. So the module gives the team
 * effect to the attacker only when the attacker is the first character and the wearer is not. The lineup is the
 * battle's member order, with index 0 on the left.
 *
 * The +5% Energy Regeneration Rate is not added here: it is the scenario's energy regen, as the always-on stats are.
 */

const NAME = 'Lushaka, the Sunken Seas'

export const LushakaTheSunkenSeas: SetModule = {
  kind: 'set',
  type: 'ornament',
  name: NAME,
  setId: '317',

  create(battle) {
    const first = battle.members[0]!.key
    return {
      attackerState: () => ({ setConditionals: { [NAME]: false } }),
      // `teammateState` is never called with the wearer as the attacker (the battle asks a member's own modules for the
      // wearer's own attacks through `attackerState`). So when the attacker is the first character it is not the wearer,
      // which means the wearer is not first, and no separate "wearer is not first" check is needed.
      teammateState: (attacker) => (attacker.key === first ? { teamOrnamentSet: NAME } : {}),
    }
  },
}
