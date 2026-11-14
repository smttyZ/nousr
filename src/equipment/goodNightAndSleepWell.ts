import type { LightConeModule } from './equipment'

/**
 * Good Night and Sleep Well (21001), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs 21001`).
 * Summary: for every debuff the target enemy has, the wearer's DMG increases by 12% (superimposition 1) to 24%
 * (superimposition 5), stacking up to 3 times. The text adds that it also applies to DoT, which no NouSR kit deals.
 * It has no always-on stat that Fribbels does not add itself.
 *
 * The effect scales with the target's debuff count, which is why this module exists: Fribbels' default
 * (`debuffStacksDmgIncrease: 3`) counts all 3 stacks as always on. The kernel's `debuffStacksDmgIncrease` is read at every
 * pricing and is the number of debuffs the enemy being priced has right now, from any source (`Battle.debuffCount`,
 * K1: per enemy), capped at 3. Fribbels multiplies it by the superimposition's 12% to 24% itself.
 *
 * A debuff is whatever the battle records as one: a modifier applied with `debuff: true`, which any kit,
 * light cone or set can put on an enemy. Break effects (Entanglement, Imprisonment, Freeze) count while they last (K24).
 *
 * Debuffs are present with a probability (K22). The count is capped at 3, so it is not linear in the expected count
 * (min(3, N) is not min(3, E[N])): the kernel's `debuffStacksDmgIncrease` is priced in each debuff state (the stacks are a
 * whole number there) and the states are weighted by their probabilities (`Battle.kernelResult`), which is exact for the
 * cap.
 */

const MAX_STACKS = 3

export const GoodNightAndSleepWell: LightConeModule = {
  kind: 'lightCone',
  id: '21001',
  name: 'Good Night and Sleep Well',

  create(battle) {
    return {
      attackerState: (enemy) => ({
        lightConeConditionals: { debuffStacksDmgIncrease: Math.min(MAX_STACKS, battle.debuffCount(enemy)) },
      }),
    }
  },
}
