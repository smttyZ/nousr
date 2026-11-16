# AGENTS.md

Instructions for AI coding agents working on NouSR. The full working rules are in [CLAUDE.md](CLAUDE.md) and the
step-by-step guides are in [CONTRIBUTING.md](CONTRIBUTING.md); read both, then [DESIGN.md](DESIGN.md).

The five most important rules:

1. **Design decisions are the maintainer's** (Smitty, GitHub smttyZ): what the sim models, approximations, schemas,
   public interfaces, new dependencies. Propose options with what each does to results (a small "Today / Effect /
   Options / Recommendation" demo, labelled `[Design · big]` or `[Design · small]`); never choose silently.
2. **Deterministic expected value, Fribbels as the damage kernel, MIT.** No randomness. Never copy srsim code (it has
   no license); credit MIT sources you port.
3. **Transcribe from the game's own text** (`node tools/gamedata/kit-text.mjs <id>`, `lc-text.mjs`). Mark readings the
   text does not settle as `IN-GAME CHECK`, and list what a module leaves out under `NOT MODELLED`.
4. **Test your tests:** break the code on purpose and check a test fails. Before a PR run `npm run typecheck`,
   `npm test` and `npm run build`. One topic per PR.
5. **Label factual claims** as **Recalled**, **Searched** (with a link) or **Computed** (re-runnable). Commit and push
   only when your user asks.
