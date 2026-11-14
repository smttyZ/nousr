import { lightConeWithoutBehaviour } from './equipment'

/**
 * Today Is Another Peaceful Day (21034), from the 4.7.0 in-game text (`node tools/gamedata/lc-text.mjs 21034`).
 * After entering battle, the wearer's DMG rises by a share per point of Max Energy (0.2% at superimposition 1 up to
 * 0.4% at 5), counting at most 160 energy. It has no timing: it is on from the first moment of the battle and
 * never changes. Fribbels' one switch for it (`maxEnergyDmgBoost`) is on by default, which is correct for
 * the whole battle, and it reads the wearer's max energy itself (`context.baseEnergy`, the character's max_sp).
 */
export const TodayIsAnotherPeacefulDay = lightConeWithoutBehaviour({
  id: '21034',
  name: 'Today Is Another Peaceful Day',
  reason: 'its one effect is on for the whole battle and Fribbels derives its size from the wearer\'s max energy',
})
