# Contributing to NouSR

Thank you for helping! This file is for people and for AI coding agents alike. Agents should also read
[CLAUDE.md](CLAUDE.md) (working rules) and [AGENTS.md](AGENTS.md) (the short version).

## What NouSR is, and its rules

NouSR is a deterministic action-value timeline simulator for Honkai: Star Rail teams. It plays a team through
Memory of Chaos cycles, prices every action with [Fribbels' optimizer](https://github.com/fribbels/hsr-optimizer) as
the damage kernel, and reports who did how much damage and when. [DESIGN.md](DESIGN.md) holds the architecture,
the decisions and the known approximations.

The rules that every change must respect:

- **Deterministic expected value.** No randomness in the engine (DESIGN.md, "Known approximations").
- **Fribbels is the damage kernel.** Kits describe what happens and when; Fribbels prices a hit. Only
  `src/kernel/fribbels` imports it. Do not re-implement its formulas.
- **MIT licensed.** hsr-optimizer and hsr-simulator are MIT; if you port their logic, credit them
  ([DESIGN.md](DESIGN.md), "Prior work and credits"). **srsim has no license: never copy its code**, and do not
  paste code from other projects without a license you have checked.
- **The game's own text is the source.** Kits are transcribed from the in-game text (see below), not from memory
  and not from wikis. Where the text is ambiguous, leave a marked `IN-GAME CHECK` rather than guessing.
- **Nobody gets a confidently wrong number.** The simulator refuses what it cannot model yet instead of
  approximating it silently, and lists what a module leaves out.

### Who decides what

Design decisions belong to the maintainer, Smitty (GitHub [@smttyZ](https://github.com/smttyZ)). That means anything
that changes what the simulator models, an approximation, the shape of a schema, a public interface, or a new
dependency. You are very welcome to **propose** one: open an issue or a PR, lay out the options and what each does to
results (see "Asking design questions" below), and wait for his answer. Transcribing a kit, writing tests, fixing a
bug and plumbing do not need a decision.

## Setup

See the [README](README.md#development): Node 24 or newer and git, then

```
npm install
npm run setup
```

For game text you also need the game data tables, `node tools/gamedata/fetch.mjs` (needs the GitHub CLI; the
tables land in the git-ignored `.gamedata/`). Windows is fine; the maintainer uses Windows and PowerShell.

Before you open a PR, all three must pass:

```
npm run typecheck
npm test
npm run build
```

## How to add a kit

Use a reviewed kit as the model: `src/kits/castorice.ts` and `src/kits/castorice.test.ts` (and the real-kernel test
`src/kernel/fribbels/castorice.integration.test.ts`). Steps:

1. **Read the in-game text.** `node tools/gamedata/kit-text.mjs <characterId>` prints abilities, memosprite, traces,
   eidolons and the Affinitive Eidolon. For a buffed ("Nova Flare") kit add `--version N`. For the character's light
   cone use `node tools/gamedata/lc-text.mjs <lightConeId>`, and `--set <setId>` for a relic set.
2. **Read Fribbels' conditional file** for the character under
   `vendor/hsr-optimizer/src/lib/conditionals/character/` (and `lightcone/` for light cones). It tells you which
   switches (conditionals) the kernel reads and how it prices each hit (hit indexes such as BASIC 0, SKILL 0/1).
   Your kit supplies the live value of each switch; the kernel does the maths. Note every place where the game text
   and Fribbels differ, and which one the kit follows.
3. **Write `src/kits/<name>.ts`** with the same structure as Castorice's:
   - A header comment that names the sources (the game id and `kit-text.mjs` command, the Fribbels file), lists each
     ability with what the kit does, and explains each modelling reading.
   - **`IN-GAME CHECK` notes** for every reading the text does not settle. Also add the check to
     [docs/in-game-checks.md](docs/in-game-checks.md) (see below).
   - A **`NOT MODELLED`** list of everything the kit leaves out, so a reader knows what the number excludes.
   - Export the kit and register it in `src/kits/index.ts` (`KITS`). Register it only when it is done and tested.
   - If the kit takes options (for example a choice between two ways to play), that is a schema decision: propose it
     first (`schema/kit-options/`, `docs/proposals/scenario-kit-options.md`).
4. **Write `src/kits/<name>.test.ts`** with a fake kernel (as in Castorice's test): one `describe` per part of the
   kit, with worked numbers in comments. Then **mutation-check your own tests**: break the kit on purpose (change a
   multiplier, flip a condition, drop an event handler, off-by-one a turn count), confirm a test fails, and restore it.
   Report how many mutations you ran and how many were caught in the PR. A test that survives a breakage tests nothing.
5. **Write a real-kernel integration test** in `src/kernel/fribbels/<name>.integration.test.ts`: price the kit's
   actions through the real Fribbels kernel and check them against Fribbels' own multiples. A single action must match
   Fribbels' own number exactly.
6. **Add the light cone and relic modules** the kit's standard build needs (next section), and a standard build under
   `data/standard-builds/` if the character does not have one (the shape is `schema/standard-build.schema.json`).
7. **Docs.** Update the README line listing kits, DESIGN.md "Where things stand" with what is new, what is not
   modelled and any open questions, and add your IN-GAME CHECKs to `docs/in-game-checks.md`.

## How to add a light cone or relic set module

Modules live in `src/equipment/`. Read the text with `node tools/gamedata/lc-text.mjs <id>` (or `--set <id>`), then
follow a nearby module as a model: `worldRemakingDeliverer.ts` (a relic set with state, and its test) or
`alongThePassingShore.ts` (a light cone). Each has a header that states the text, what part of it Fribbels already
handles, what the module supplies, and what is NOT MODELLED. A set with nothing conditional is declared with
`setWithoutBehaviour` in `src/equipment/index.ts` with a one-line reason. Register the module in `EQUIPMENT`
(`src/equipment/index.ts`) and write its test file with the same mutation check as a kit. A module that cannot be
modelled correctly should refuse with a clear message rather than approximate.

## How to add a period module

A Memory of Chaos period is a module with the same hook interface as a kit that registers modifiers and subscribes
to events, selected from a scenario by id (DESIGN.md, "Period modules"). The current period (build order step 7) is
not built yet. If you want to take it on, open an issue first: the interface it needs is a design decision.

## Contributing in-game checks without code

If you play the game you can help without touching code. [docs/in-game-checks.md](docs/in-game-checks.md) lists
questions that the game's text does not settle, each with short steps to follow in game. Pick one, follow the steps,
and open an **in-game check result** issue (the issue template has the fields): which check, what you saw (numbers,
screenshots), and the game version. Compare non-crit hits with non-crit hits. The maintainer or an agent applies the
answer to the code.

## Pull requests

- **One topic per PR.** A kit, or a bug fix, or a doc change; not all three.
- `npm run typecheck`, `npm test` and `npm run build` pass. CI runs the same.
- Documentation-only PRs must not touch code, schemas, data or tests, and code PRs should not rewrite docs
  unrelated to the change.
- **Label factual claims** in your PR description and in comments as exactly one of:
  - **Recalled**: from memory, nothing to point to.
  - **Searched**: with a plain link.
  - **Computed**: a result a reader can re-run (command, test or script).
- **Say what you did not do:** what is not modelled, which readings are guesses, which checks are pending.
- Do not change the pinned Fribbels submodule commit without an issue; bumping it changes numbers.

### Asking design questions

Maintainer decisions are asked as small demos, so the cause and effect is visible. Start each question with one label:

- **[Design · big]**: real alternatives that change results.
- **[Design · small]**: real alternatives, low stakes, with a clear recommendation.
- **[Go-ahead]**: nothing contested, just permission.
- **[In-game]**: needs someone to look at the game (also add it to `docs/in-game-checks.md`).
- **[FYI]**: no answer needed.

For the two design labels, use this order, with short prose and code blocks:

1. **Today:** a few lines of the current code or pseudo-code.
2. **Effect:** what goes wrong, with a worked number.
3. **Options:** each as its own small snippet, with one line on what it does to results.
4. **Recommendation.**

A longer proposal under `docs/proposals/` can follow for the record.

## AI agents

Agent-written contributions are welcome and held to the same bar as any other: tests with mutation checks, honest
labels, and the decision rules above. The repository keeps [docs/agent-ledger.md](docs/agent-ledger.md) and
[docs/agent-briefs/](docs/agent-briefs/) as a record of how agents have been used here.
