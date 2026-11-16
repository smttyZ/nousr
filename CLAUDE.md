# CLAUDE.md — NouSR

Read **DESIGN.md** first. It holds the architecture, every decision made so far, and the prior-art findings.
This file covers how to work in this repo.

## For any contributor's agent

Humans and agents from outside contribute here. Read **CONTRIBUTING.md** for the step-by-step guides (adding a kit,
a light cone or relic set, an in-game check) and the PR checklist. The rules that hold for everyone:

- **Design decisions are the maintainer's.** Anything that changes what the sim models, approximations, schema
  shape, public interfaces, or adding a dependency: stop, lay out the options with what each does to results, and
  ask (format below). Don't pick silently. Busywork is yours: the scheduler, transcribing kits from in-game text,
  tests, plumbing.
- **Transcribe from the game's own text** (`node tools/gamedata/kit-text.mjs <id>`, `lc-text.mjs`). Where wording
  is ambiguous, leave an `IN-GAME CHECK` note and an entry in `docs/in-game-checks.md` rather than guessing.
- **Test your tests.** Break the code on purpose (mutation checks) and report how many mutations were caught.
- **Before a PR:** `npm run typecheck`, `npm test`, `npm run build`. One topic per PR. Do not touch code when asked
  for docs, or docs unrelated to the code you change.
- **Commit and push only when your user asks.**

## Maintainer: Smitty (GitHub smttyZ)

The maintainer is Smitty (Henry Hicks). He is an experienced C++/Swift/Java and low-level systems programmer and is
newer to git, so explain git operations that aren't routine. He uses Windows with PowerShell, which is useful when
a path or shell command misbehaves. This is how he likes to be worked with; it applies in his sessions and when
you ask him (or a PR/issue thread) a question:

- **Authorship split.** See the first rule above. Design is his; you bring options.
- **Show design questions as mini-demos.** He understands fastest by seeing cause and effect. For each
  question, use code blocks, short prose, and this order:
  1. **Today:** a few lines of the current code or pseudo-code.
  2. **Effect:** what goes wrong, with a worked number.
  3. **Options:** each as its own small snippet, with one line on what it does to results.
  4. **Recommendation.**

  A longer proposal doc can follow for the record. Agents and side sessions asking him questions use this
  format too.
- **Label every question.** Design questions and permission requests look alike to him. Start each question
  with one label:
  - **[Design · big]**: real alternatives that change results (mini-demo format).
  - **[Design · small]**: real alternatives, low stakes, with a clear recommendation.
  - **[Go-ahead]**: nothing contested, just permission (commit, push, start a session).
  - **[In-game]**: needs him to look at the game (also add it to `docs/in-game-checks.md`).
  - **[FYI]**: no answer needed.

  Agents and side sessions use the labels too.
- **Narrate steps.** Before each step or command, post a one-line note ("now doing X"). Don't chain
  many actions silently.
- **Label factual claims** as exactly one of: **Recalled** (from memory, nothing to point to),
  **Searched** (with a plain link), or **Computed** (a result he can re-run: command, test, script).
  He acts on claims, so they must be checkable.
- **Look things up** when the answer is a quick search away, rather than answering from memory.
  Game mechanics change every patch.
- **Challenge factual or logical errors** directly. On his decisions, only push back on real,
  visible problems.
- **Commit and push only when asked.** In his sessions, don't commit or push on your own; `gh` is authenticated
  as smttyZ.

## Build order (history)

The order the project was built in, kept as history. Steps 1 to 6 are done (all 14 roster kits are registered, and
`nousr run` works); step 7 is next. DESIGN.md, "Where things stand" and "Roadmap", is the current state.

1. **Project setup.** TypeScript, a test runner, and Fribbels' optimizer as a git submodule
   pinned to `31644d9` (2026-11-10, has the 4.7 Affinitive Eidolons).
2. **Timeline engine.** 10,000 action gauge, time to act = gauge ÷ SPD, advance and delay, SPD buffs
   that change mid-gauge, MoC cycle boundaries (150 AV, then 100), the event bus, and timed modifiers.
   Tests: known MoC SPD breakpoints (e.g. 134 SPD gives 2 turns in cycle 1; check the full table
   against a source and cite it).
3. **Damage kernel adapter.** Call Fribbels per action with the sim's live buff state. Test: single
   actions must match Fribbels' own numbers exactly.
4. **⛔ STOP: scenario JSON schema.** Draft it and get the maintainer's review before building on it.
   He wants it to be a standard other people can use. Builds come in as HSR-Scanner v4 JSON
   (see DESIGN.md).
5. **Generic MoC enemy profile, plus the HP and aggro pipeline** (expected value, fractional by aggro).
6. **Kits, in this order:** Acheron, Jing Yuan (with Affinitive Eidolons), then their teams (Silver Wolf
   B1, Welt B1, Dan Heng • Permansor Terrae, Fu Xuan, Sunday, Tribbie, Robin Summeretto), then Castorice's
   team (Castorice, Cyrene, Hyacine), then The Herta and Anaxa. Transcribe from the in-game text. Where
   wording is ambiguous, ask the maintainer to check in-game rather than guessing.
7. **Current MoC period module** (Survival of the Fittest), swappable by ID and never hard-coded.

## Known traps

- **Fribbels "Combo DMG" is not comparable across characters or configurations.** Each character has
  its own hand-written rotation, and there is no clock. Its docs say so (`docs/guides/en/benchmarks.md`).
  That gap is why NouSR exists. Use Fribbels for per-action damage only.
- **Fribbels' tests need Node 26.** Its vite config passes `--no-webstorage`, which older Node rejects.
  On older Node, run vitest with `--pool=forks` and a config that sets `test.execArgv = []`.
- **Nova Flare versions.** Silver Wolf and Welt have buffed versions (`1006b1`, `1004b1`). Use those.
- **srsim has no license.** Architecture ideas only, never its code. hsr-simulator and Fribbels are MIT;
  credit them if their logic is ported.
- **The engine is deterministic expected value.** Thresholds evaluated on expected values are a
  documented approximation (DESIGN.md → Known approximations). Don't add RNG.
- **Effect Hit Rate stays a full stat** (EHR→ATK conversions, thresholds), but debuffs always land.

## Reference numbers (Computed, 2026-11-10)

Fribbels benchmark ratios with the maintainer's reference account (his own light cones), standard relics. These are buff-only (no
timing), so the timeline sim should agree on direction for pure buff swaps and differ where timing
matters.

| Comparison | Ratio |
|---|---|
| Acheron E1+EX: Silver Wolf/Welt/DHPT over Silver Wolf/Tribbie E1/DHPT | 1.434 |
| Acheron: DHPT over Fu Xuan (Trend of the Universal Market S1) | 1.026 |
| Acheron: Affinitive Eidolon on/off | 1.391 |
| Acheron: E1 over E0 | 1.111 |
| Jing Yuan E0: Affinitive Eidolon on/off | 4.52 |
| Jing Yuan: Tribbie E1 (Dance! Dance! Dance! S3) over Robin Summeretto | 0.988 |

Light cones: Silver Wolf Good Night and Sleep Well S5; Pela Resolution Shines As Pearls of Sweat S5;
Welt In the Name of the World S1; Fu Xuan Trend of the Universal Market S1; Sunday Past and Future S5;
Tribbie Dance! Dance! Dance! S3; Dan Heng • PT Texture of Memories S5; Robin Summeretto Memory's
Curtain Never Falls; Hyacine The Story's Next Page S1; Castorice Make Farewells More Beautiful S1; Cyrene
This Love, Forever S1 (these three checked in game 2026-11-15); The Herta Today Is Another Peaceful Day S4; Anaxa
The Great Cosmic Enterprise; Acheron Along the Passing Shore S1; Jing Yuan options Eternal Calculus S1
and Today Is Another Peaceful Day S4.

Live Affinitive Eidolon text (in-game, 2026-11-10) matches Fribbels: Jing Yuan +240% DMG and
Lightning-Lord hit cap +20; Acheron 300% ATK AoE + 6×80% bounce, counted as Ultimate DMG, The Abyss
applies, once per turn; Imbibitor Lunae +240% and 500% AoE every 5 SP, counted as Basic ATK DMG.
