import { Acheron } from './acheron'
import { DanHengPT } from './danHengPT'
import { FuXuan } from './fuXuan'
import { JingYuan } from './jingYuan'
import { RobinSummeretto } from './robinSummeretto'
import { SilverWolf } from './silverWolf'
import { Sunday } from './sunday'
import { Welt } from './welt'
import type { Kit } from './kit'
import { Tribbie } from './tribbie'

/**
 * Every kit the simulator can run, by game character id ('1308'), with a name for error messages.
 * A scenario member whose character has no entry here cannot be simulated.
 *
 * A kit is registered only once it has been reviewed against the in-game text.
 */
export interface RegisteredKit {
  name: string
  kit: Kit
}

export const KITS: ReadonlyMap<string, RegisteredKit> = new Map(
  [
    { name: 'Acheron', kit: Acheron },
    // Reviewed 2026-11-13 (two reviews; see DESIGN.md). Readings awaiting an in-game check are marked IN-GAME CHECK.
    { name: 'Tribbie', kit: Tribbie },
    // Reviewed 2026-11-13. Readings awaiting an in-game check are marked IN-GAME CHECK.
    { name: 'Jing Yuan', kit: JingYuan },
    // Reviewed 2026-11-14, then fixed in engine passes A and B. Readings awaiting an in-game check are marked IN-GAME CHECK.
    { name: 'Silver Wolf', kit: SilverWolf },
    { name: 'Welt', kit: Welt },
    { name: 'Dan Heng • Permansor Terrae', kit: DanHengPT },
    // Reviewed 2026-11-14/15, then fixed. Readings awaiting an in-game check are marked IN-GAME CHECK.
    { name: 'Sunday', kit: Sunday },
    { name: 'Fu Xuan', kit: FuXuan },
    { name: 'Robin • Summeretto', kit: RobinSummeretto },
  ].map((entry) => [entry.kit.characterId, entry]),
)

/** The kit for a game character id, or an error that lists the kits that exist. */
export function kitFor(characterId: string, kits: ReadonlyMap<string, RegisteredKit> = KITS): Kit {
  const entry = kits.get(characterId)
  if (entry) return entry.kit
  throw new Error(`No kit for character ${characterId}. Kits that exist: ${describeKits(kits)}`)
}

/** "1308 (Acheron), ..." */
export function describeKits(kits: ReadonlyMap<string, RegisteredKit> = KITS): string {
  if (kits.size === 0) return '(none)'
  return [...kits.entries()].map(([id, { name }]) => `${id} (${name})`).join(', ')
}
