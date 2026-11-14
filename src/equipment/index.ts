import { AlongThePassingShore } from './alongThePassingShore'
import { DanceDanceDance } from './danceDanceDance'
import { createRegistry, setWithoutBehaviour } from './equipment'
import { EternalCalculus } from './eternalCalculus'
import { PioneerDiverOfDeadWaters } from './pioneerDiverOfDeadWaters'
import { TodayIsAnotherPeacefulDay } from './todayIsAnotherPeacefulDay'

export * from './equipment'
export { AlongThePassingShore, DanceDanceDance, EternalCalculus, PioneerDiverOfDeadWaters, TodayIsAnotherPeacefulDay }

/**
 * Izumo Gensei and Takama Divine Realm (set 314): 2 pieces give +12% ATK, and +12% CRIT Rate when entering
 * battle with a teammate of the wearer's Path (`node tools/gamedata/lc-text.mjs --set 314`). The Path check is
 * fixed at the start of the battle, and Fribbels makes it itself from the team it is given (its
 * `overrideConditional` counts the Paths), so there is nothing for a module to supply.
 */
export const IzumoGensei = setWithoutBehaviour({
  type: 'ornament',
  name: 'Izumo Gensei and Takama Divine Realm',
  setId: '314',
  reason: 'its one conditional, a teammate of the same Path, is derived by Fribbels from the team',
})

/**
 * Musketeer of Wild Wheat (set 102): 2 pieces +12% ATK; 4 pieces +6% SPD and +10% Basic ATK DMG
 * (`node tools/gamedata/lc-text.mjs --set 102`). Nothing conditional, and Fribbels reads no conditional for it.
 */
export const MusketeerOfWildWheat = setWithoutBehaviour({
  type: 'relic',
  name: 'Musketeer of Wild Wheat',
  setId: '102',
  reason: 'always-on stats only',
})

/**
 * Inert Salsotto (set 306): 2 pieces +8% CRIT Rate, and +15% Ultimate and Follow-Up DMG while the wearer's CRIT
 * Rate is 50% or more (`node tools/gamedata/lc-text.mjs --set 306`). Fribbels checks the threshold on the
 * finished CRIT Rate inside its calculation, so there is no conditional to supply.
 */
export const InertSalsotto = setWithoutBehaviour({
  type: 'ornament',
  name: 'Inert Salsotto',
  setId: '306',
  reason: 'its one conditional is a CRIT Rate threshold that Fribbels evaluates itself',
})

/**
 * Every light cone and set the simulator can run. An item not listed here stops a scenario (see
 * `resolveEquipment`). Add an item only once its text has been read in game.
 */
export const EQUIPMENT = createRegistry([AlongThePassingShore, DanceDanceDance, EternalCalculus, TodayIsAnotherPeacefulDay, PioneerDiverOfDeadWaters, IzumoGensei, MusketeerOfWildWheat, InertSalsotto])
