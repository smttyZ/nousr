# NouSR

A deterministic action-value timeline simulator for Honkai: Star Rail teams.

**Status:** early release (MIT licensed), pre-alpha research tool. Built around one account's roster, pinned to game
version 4.7. No support or update cadence is promised; issues and pull requests are welcome.

> [!WARNING]
> **Results are only valid for the teams NouSR v1 was built for.** Only the v1 roster's characters, light cones
> and relic sets have kits (DESIGN.md, "Scope (v1 roster)"), and some game mechanics are not modelled at all:
> damage over time from weakness break (Bleed, Burn, Shock, Wind Shear, Entanglement), effects that trigger on a
> kill, and wave changes. A team that relies on any of these will be understated without any error. Modelling
> them, so that anyone can run their own teams without extra work, is a goal, not done yet.

Other limits to know before reading a number (each is explained in [DESIGN.md](DESIGN.md), "Known approximations"):

- **Expected value, no randomness.** Crits, random targets and enemy targeting are averaged; thresholds such as "energy
  full" are evaluated on those averages.
- **Every character is simulated fully built:** all traces unlocked and abilities at the level their eidolon gives. An
  account scan's ability and trace levels are not read, so an unfinished character is overstated.
- **Enemies never die.** A run is a fixed number of Memory of Chaos cycles against one generic floor-12 enemy profile
  (1, 3 and 5 copies); real stage bosses are not modelled.
- **No Memory of Chaos period rules yet.** `battle.period` must be `null`; a scenario that names a period stops with an
  error.
- **Debuffs always land** (Effect Hit Rate is a stat, never a roll), and allies are never crowd-controlled.
- The team policies in `examples/` are simple placeholders, not tuned play.

See [DESIGN.md](DESIGN.md) for architecture, decisions and open questions.

## Getting started

Needs Node 24 or newer, npm and git. From a fresh clone, in this order:

```
npm run setup        # fetch the Fribbels submodule, install its dependencies, generate its resource types (about a minute)
npm ci               # NouSR's own dependencies
npm run build        # bundles the command into dist/cli.js
node dist/cli.js run examples/acheron-welt-vs-tribbie.scenario.json
```

`npm run setup` prints an `EBADENGINE` warning on Node 24 or 25 (Fribbels asks for Node 26) and a `patch-package`
warning. Both are harmless here: NouSR only imports Fribbels' damage code.

## Running a scenario

```
npm run build                                                    # bundles the command into dist/cli.js
node dist/cli.js run examples/acheron-welt-vs-tribbie.scenario.json
node dist/cli.js run examples/acheron-welt-vs-tribbie.scenario.json -o results/acheron.json   # also write the JSON
npx nousr run <scenario.json>                                    # the same, through the package's bin
```

`nousr run` prints the totals per team and enemy count with ratios against a baseline team, then who did the damage
(`--cycles` adds per-cycle tables, `--log <team>:<count>` an action log). `-o <file>` writes the `nousr-result` JSON
(`schema/result.schema.json`; `--json` prints it, `--no-log` leaves the action log out). `nousr validate <scenario.json>`
checks a scenario without running it. Warnings go to stderr; `--strict` makes them exit code 3. `nousr run --help` lists
every option. Needs Node 24 or newer, and the repository folder: the data files are read from it.

A scenario with no `account` runs every member on NouSR's standard relics (`data/standard-builds/`). To use your own
builds, point `account` at an HSR-Scanner v4 or Reliquary Archiver JSON file (a path relative to the scenario file).

## Development

Fribbels' optimizer is a git submodule under `vendor/hsr-optimizer`, pinned to one commit. After "Getting started":

```
npm test             # NouSR's tests
npm run typecheck    # NouSR's code, then the Fribbels adapter with Fribbels' compiler options
npm run test:fribbels -- src/lib/simulations/tests/statSim   # run some of Fribbels' own tests
```

- `src/engine` is the timeline: action gauge, cycles, events, timed modifiers.
- `src/kernel` is the damage kernel boundary. Only `src/kernel/fribbels` imports Fribbels.
- `schema/scenario.schema.json` is the scenario format (version 1), with an example under `examples/`.
- `schema/enemy-profile.schema.json` is the enemy profile format (version 1); `data/enemies/` holds the profiles
  and `src/enemy` loads them.
- `src/battle` is the allied side's HP, shields, energy and aggro, the enemy turns that hit it, and the
  battle runner that plays a team's policy against the enemies.
- `src/kits` holds the character kits: 14 of the roster in DESIGN.md's "Scope (v1 roster)" (all but Pela and Jiaoqiu).
  `src/equipment` holds their light cones and relic sets.
- `tools/gamedata` reads the game's own data tables: `fetch.mjs` downloads them into `.gamedata/`
  (git-ignored, about 110 MB, needs the GitHub CLI), `moc-enemies.mjs` prints the enemy and aggro numbers
  DESIGN.md cites, and `kit-text.mjs <characterId>` prints a character's in-game kit text.
- `src/scenario` loads a scenario: it checks the file against that schema, then resolves each member's
  eidolon, light cone and relics against the account scan. `src/run` turns it into battles, `src/result` writes the
  `nousr-result` JSON (`schema/result.schema.json`, version 1) and `src/cli.ts` is the command.

## Credits

- [fribbels/hsr-optimizer](https://github.com/fribbels/hsr-optimizer) (MIT): the damage kernel, used as a pinned submodule.
- [kel-z/HSR-Scanner](https://github.com/kel-z/HSR-Scanner): the build JSON format.
- [tingyumian662/hsr-simulator](https://github.com/tingyumian662/hsr-simulator) (MIT): reference for the enemy profile
  layout and the HP-loss pipeline.
- [simimpact/srsim](https://github.com/simimpact/srsim): architecture ideas only. It has no license and none of its code is used.
