import { Acheron } from './acheron'
import { Castorice, makeCastorice } from './castorice'
import { Hyacine } from './hyacine'
import { DanHengPT } from './danHengPT'
import { FuXuan } from './fuXuan'
import { JingYuan } from './jingYuan'
import { RobinSummeretto } from './robinSummeretto'
import { SilverWolf } from './silverWolf'
import { Sunday } from './sunday'
import { Welt } from './welt'
import type { Kit } from './kit'
import type { KitOptions } from '../scenario/kitOptions'
import { Tribbie } from './tribbie'

/**
 * Every kit the simulator can run, by game character id ('1308'), with a name for error messages.
 * A scenario member whose character has no entry here cannot be simulated.
 *
 * A kit is registered only once it has been reviewed against the in-game text.
 */
export interface RegisteredKit {
  name: string
  /** The kit with its default options. */
  kit: Kit
  /**
   * For a kit that takes options (schema/kit-options/<character id>.schema.json, K25/K26): the kit for a member's options, as
   * the loader resolved them (validated, defaults filled in, keys as in the scenario file).
   */
  configure?: (options: KitOptions) => Kit
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
    // Reviewed 2026-11-15, then fixed. Readings awaiting an in-game check are marked IN-GAME CHECK.
    {
      name: 'Castorice',
      kit: Castorice,
      configure: (o: KitOptions) => makeCastorice({ finishOnTurn: (o.netherwing_finish_turn ?? 1) as 1 | 2 | 3 }),
    },
    { name: 'Hyacine', kit: Hyacine },
  ].map((entry): [string, RegisteredKit] => [entry.kit.characterId, entry]),
)

/**
 * The kit for a game character id, or an error that lists the kits that exist. With `options` (a member's resolved kit options),
 * the kit configured for them; a kit that takes no options must not be given any.
 */
export function kitFor(characterId: string, kits: ReadonlyMap<string, RegisteredKit> = KITS, options?: KitOptions): Kit {
  const entry = kits.get(characterId)
  if (!entry) throw new Error(`No kit for character ${characterId}. Kits that exist: ${describeKits(kits)}`)
  if (options === undefined) return entry.kit
  if (!entry.configure) throw new Error(`The kit for ${characterId} (${entry.name}) takes no kit options, but the scenario has a schema for them`)
  return entry.configure(options)
}

/** "1308 (Acheron), ..." */
export function describeKits(kits: ReadonlyMap<string, RegisteredKit> = KITS): string {
  if (kits.size === 0) return '(none)'
  return [...kits.entries()].map(([id, { name }]) => `${id} (${name})`).join(', ')
}
