# CLAUDE.md — NouSR

Read **DESIGN.md** first. It holds the architecture, every decision made so far, and the prior-art findings.
This file covers how to work in this repo.

## The owner: Smitty (smttyZ)

- **Authorship split.** Design decisions are Smitty's. Examples: anything that changes what the sim
  models, approximations, schema shape, public interfaces, adding a dependency. Busywork is yours: the
  scheduler, transcribing kits from in-game text, tests, plumbing. When a design choice comes up, stop,
  lay out the options with what each one does to results, and ask. Don't pick silently.
- **Narrate steps.** Before each step or command, post a one-line note ("now doing X"). Don't chain
  many actions silently.
- **Label factual claims** as exactly one of: **Recalled** (from memory, nothing to point to),
  **Searched** (with a plain link), or **Computed** (a result he can re-run: command, test, script).
  He acts on claims, so they must be checkable.
- **Look things up** when the answer is a quick search away, rather than answering from memory.
  Game mechanics change every patch.
- **Challenge factual or logical errors** directly. On his decisions, only push back on real,
  visible problems.
- He's an experienced C++/Swift/Java and low-level systems programmer and is newer to git. Explain
  git operations when they aren't routine. Commit and push only when asked.
- Environment: Windows 11 desktop "yuki", PowerShell, `gh` authenticated as smttyZ.

## Build order

1. **Project setup.** TypeScript, a test runner, and Fribbels' optimizer as a git submodule
   pinned to `31644d9` (2026-11-10, has the 4.7 Affinitive Eidolons).
2. **Timeline engine.** 10,000 action gauge, time to act = gauge ÷ SPD, advance and delay, SPD buffs
   that change mid-gauge, MoC cycle boundaries (150 AV, then 100), the event bus, and timed modifiers.
   Tests: known MoC SPD breakpoints (e.g. 134 SPD gives 2 turns in cycle 1; check the full table
   against a source and cite it).
3. **Damage kernel adapter.** Call Fribbels per action with the sim's live buff state. Test: single
   actions must match Fribbels' own numbers exactly.
4. **⛔ STOP: scenario JSON schema.** Draft it and get Smitty's review before building on it.
   He wants it to be a standard other people can use. Builds come in as HSR-Scanner v4 JSON
   (see DESIGN.md).
5. **Generic MoC enemy profile, plus the HP and aggro pipeline** (expected value, fractional by aggro).
6. **Kits, in this order:** Acheron, Jing Yuan (with Affinitive Eidolons), then their teams (Silver Wolf
   B1, Welt B1, Dan Heng • Permansor Terrae, Fu Xuan, Sunday, Tribbie, Robin Summeretto), then Castorice's
   team (Castorice, Cyrene, Hyacine), then The Herta and Anaxa. Transcribe from the in-game text. Where
   wording is ambiguous, ask Smitty to check in-game rather than guessing.
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

Fribbels benchmark ratios with Smitty's actual light cones, standard relics. These are buff-only (no
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
Curtain Never Falls; Hyacine The Story's Next Page; The Herta Today Is Another Peaceful Day S4; Anaxa
The Great Cosmic Enterprise; Acheron Along the Passing Shore S1; Jing Yuan options Eternal Calculus S1
and Today Is Another Peaceful Day S4.

Live Affinitive Eidolon text (in-game, 2026-11-10) matches Fribbels: Jing Yuan +240% DMG and
Lightning-Lord hit cap +20; Acheron 300% ATK AoE + 6×80% bounce, counted as Ultimate DMG, The Abyss
applies, once per turn; Imbibitor Lunae +240% and 500% AoE every 5 SP, counted as Basic ATK DMG.
