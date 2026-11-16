# Proposal: per-member kit options in a scenario

Status: APPROVED by Smitty 2026-11-15 (generic `kit_options`) and BUILT: `schema/scenario.schema.json` (`member.kit_options`),
`schema/kit-options/1407.schema.json` and `1415.schema.json`, `src/scenario/kitOptions.ts` (validation, defaults, member keys,
the finiteness rule), `RegisteredKit.configure` in `src/kits/index.ts`, and the echo `TeamRun.kitOptions` in `src/run/run.ts`.
Castorice's option runs; Cyrene's schema exists but her kit is not written yet. The two warning codes exist (`src/run/warnings.ts`)
for Cyrene's kit to raise through `Battle.warn`.
Related: DESIGN.md K25 and K26 (the decisions this serves), S4 (team policy), S7 (strictness), the optimizer roadmap item.

## The problem

Some choices a player makes are not "which ability on this turn" (the team policy, S4) but how one character's own mechanic is driven:

- **Castorice:** on which Netherwing turn to launch Breath into the finisher. The game's auto-battle burns everything on Netherwing's
  first turn; holding above 25% HP and finishing later lets refilled HP pay for more Breaths and keeps the Territory up longer.
  Smitty (2026-11-15): model both, selectable by the user, to measure whether burning is really a mistake.
- **Cyrene:** which ally each of Demiurge's "This Ode, to All Lives" goes to, in order, as part of the rotation (for example
  Hyacine, then Castorice, then Robin / attack; the Ode cannot target Cyrene herself, settled by Smitty in game 2026-11-15). Smitty (2026-11-15): customizable by the user and ready for the
  optimizer, to get a definitive answer on the best order.

Both are choices with a small, finite set of legal values, so they are exactly what a later optimizer should search over.

## The proposal

A scenario member may carry `kit_options`, an object whose shape belongs to that member's kit:

```json
{
  "key": "castorice",
  "character": "1407",
  "eidolon": 0,
  "kit_options": { "netherwing_finish_turn": 3 }
},
{
  "key": "cyrene",
  "character": "1415",
  "eidolon": 0,
  "kit_options": {
    "demiurge_order": ["hyacine", "castorice", "robin", "attack"],
    "after_order": "attack"
  }
}
```

1. **Each kit publishes its options schema** as `schema/kit-options/<character id>.schema.json` (JSON Schema 2020-12, like every
   other schema here). The loader validates `kit_options` against the file for the member's character. Unknown keys are rejected
   (S7); `notes` is allowed. A member whose kit has no options file may not carry `kit_options`.
2. **Every option has a finite domain** written in its schema (an `enum`, an integer range, or a list whose items are member keys of
   the same team). That is what makes it searchable: the optimizer can enumerate a kit's options from the schema alone, with no
   per-kit code. Options with an unbounded domain are not allowed.
3. **Every option has a default** stated in its schema, so a scenario that leaves `kit_options` out keeps running, and the run result
   echoes the options actually used (like the standard build's echo, K14c step 7).
4. **Member keys** in an option are checked by the loader against the team (`demiurge_order` naming a member not in the team is an
   error, never ignored). An option can also rule out the key of the member that carries it, with `"exclude_self": true` in its
   `x-nousr-domain` (settled 2026-11-15: "This Ode, to All Lives" cannot target Cyrene herself, so her own key in `demiurge_order` is
   refused with a clear message).

### Castorice (1407)

| Option | Values | Default | Meaning |
|---|---|---|---|
| `netherwing_finish_turn` | 1, 2, 3 | 1 | The Netherwing turn (its own, from the summoning) on which it launches Breath down into the finisher. 1 = burn, as the game's auto-battle and Fribbels' combo. 2 or 3 = hold: on earlier turns Breath only while its HP is above 25%, Claw Splits the Veil on a turn that starts at 25% or less |

Search size: 3.

### Cyrene (1415)

Demiurge has SPD 0 and acts only in extra turns. The ones where the player chooses what it does are the extra turns from Cyrene's
Ultimates (the summoning one, and each later "Reunion at First Sight"). The others are automatic and not choices: the "Story" extra
turn and the Trailblazer (Remembrance) one always use "Minuet of Blooms and Plumes".

| Option | Values | Default | Meaning |
|---|---|---|---|
| `demiurge_order` | list of: a member key of the team other than Cyrene's own, or `"attack"` | placeholder, with a warning (review item 3) | Demiurge's choice turns, in order. A member key means "This Ode, to All Lives" on that member: a Chrysos Heir gets their special Ode, anyone else +40% DMG for 2 turns. Cyrene's own key is not allowed: the Ode cannot target her (settled by Smitty in game, 2026-11-15), and Ode to Ego is always on, so it needs no Ode. `"attack"` means Minuet of Blooms and Plumes |
| `after_order` | `"attack"`, `"repeat"`, `"cycle"` | `"attack"` (review item 2) | What Demiurge does once the list is used up: attack, repeat the last entry, or start the list again |

Search size: with a team of 4 and lists up to the number of choice turns in the window (about 3 to 6 over 5 cycles), at most 5^6 =
15,625 orders, fewer once orders that differ only after the window ends are merged. Small enough to search exhaustively.

## What it does to results

Nothing for scenarios that leave `kit_options` out: Castorice's default is today's behaviour, and Cyrene has no behaviour yet. Two
teams in one scenario that differ only in one option compare that choice on one scale (S1). That is how the Castorice experiment in
DESIGN.md ("Planned experiments") is run.

## Searching the options in parallel

Each option set is plain data and each battle is deterministic and independent, so the simple optimizer (one whole battle per
option set) splits across workers with no coordination: each worker takes a slice of the space, which the schemas' finite domains
define without per-kit code. Each worker loads its own Fribbels and keeps its own damage cache (memory, not correctness).

A faster search would share work between option sets with the same prefix (Demiurge orders that start the same): run to the first
choice turn once, snapshot, and branch. The list shape helps, since every choice point is explicit. What it needs is in the engine,
not this schema: kit state today lives in closure variables inside each kit's `create()` (e.g. `src/kits/castorice.ts`, `let newbud`),
so a battle cannot be copied from outside. Kits would have to expose their state for snapshots. A later engine decision, not needed
for the MVP optimizer.

## Review (Smitty, 2026-11-15)

1. **Shape.** Asked whether `kit_options` limits parallel or faster searching later; answered above (it does not; prefix branching
   needs engine snapshots, whatever the schema shape). Generic `kit_options` with a schema file per kit: approved.
2. **After the list runs out.** Rare in practice, to be measured. Default `"attack"`, and the run result carries a warning
   (K19, code `kit-option-list-exhausted`) whenever a battle used a turn past the end of the list, so testing shows how often it
   happens.
3. **Default order** when a scenario gives none: a placeholder (every other team member in party order, then attack),
   with a run warning (code `kit-option-default-used`) whenever a default decided a choice. Before anyone outside the private beta
   relies on it, it is replaced by a priority derived from runs, as the game's auto mode has its own.
4. **Option names.** Approved: `netherwing_finish_turn`, `demiurge_order`, `after_order`.
