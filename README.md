# NouSR

A deterministic action-value timeline simulator for Honkai: Star Rail teams.

**Status:** personal research tool, pre-alpha, private. Scoped to one account's roster, pinned to game
version 4.7. No support or update cadence is promised.

See [DESIGN.md](DESIGN.md) for architecture, decisions and open questions.

## Development

Needs Node 24 or newer and git. Fribbels' optimizer is a git submodule under `vendor/hsr-optimizer`,
pinned to one commit.

```
npm install          # NouSR's own tools (TypeScript, Vitest)
npm run setup        # fetch the submodule, install its dependencies, generate its resource types
npm test             # NouSR's tests
npm run typecheck    # NouSR's code, then the Fribbels adapter with Fribbels' compiler options
npm run test:fribbels -- src/lib/simulations/tests/statSim   # run some of Fribbels' own tests
```

- `src/engine` is the timeline: action gauge, cycles, events, timed modifiers.
- `src/kernel` is the damage kernel boundary. Only `src/kernel/fribbels` imports Fribbels.
- `schema/scenario.schema.json` is the scenario format (version 1), with an example under `examples/`.
- `schema/enemy-profile.schema.json` is the enemy profile format (version 1); `data/enemies/` holds the profiles
  and `src/enemy` loads them.
- `src/battle` is the allied side's HP, shields, energy and aggro, and the enemy turns that hit it.
- `tools/gamedata` reads the game's own data tables: `fetch.mjs` downloads them into `.gamedata/`
  (git-ignored, about 110 MB, needs the GitHub CLI), `moc-enemies.mjs` prints the enemy and aggro numbers
  DESIGN.md cites, and `kit-text.mjs <characterId>` prints a character's in-game kit text.
- `src/scenario` loads a scenario: it checks the file against that schema, then resolves each member's
  eidolon, light cone and relics against the account scan.
