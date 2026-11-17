# Web UI reference: gcsim's result page vs NouSR's result data

Recorded 2026-11-16 for the post-MVP local web companion (DESIGN.md, Roadmap). The maintainer likes how KQM's gcsim
result pages account for every bit of damage, e.g. https://db.kqm.gg/db/kqm-cd23eebb-93f1-44ce-848f-2f3c527aff96
(a Genshin Impact team). The web companion reads `nousr-result` files as a read-only data source (K33); this table
says which of gcsim's sections the current result format can already feed.

| gcsim section | NouSR today |
|---|---|
| Team cards (level, talents, weapon, artifact set) | Yes: build, ability levels, light cone, relics, eidolons in every result |
| Summary cards: damage, energy, reactions, healing, shields per second | Damage yes; energy, healing and shields not recorded yet |
| Damage over time, cumulative damage | Yes: the action log carries action value and damage per action |
| Damage by character / element / target | Character yes; element derivable from the kit; per enemy not recorded yet |
| Source DPS (damage by named source) | By ability yes; by named hit (e.g. "Thunder Core bounce") not yet |
| Actions per character | Yes |
| Energy per source, energy at end | Not yet (HSR: energy gained per member and source) |
| Reactions per source | Not applicable; HSR equivalents (breaks, Slashed Dream, Breaths, Story) go in `kit_stats` |
| Aura uptime | Not yet (HSR: buff and debuff uptime, e.g. Netherwing's Territory) |
| min / max / std, DPS histogram | By design no: gcsim runs ~1,000 random iterations, NouSR one exact expected-value battle. The stochastic mode on the roadmap would add these |
| The config | Yes: the scenario is embedded in every result |
| Warnings banner (e.g. energy-deficient bursts) | Yes: structured warnings (K19) |

Differences worth designing for: HSR is turn-based, so the natural x-axis is action value with Memory of Chaos cycle
boundaries (150 AV, then every 100), not seconds; enemy counts (1 / 3 / 5) are separate runs and are never blended
into one score (K33); downed allies matter as much as damage at 5 enemies.

A first mock-up built from real results (four teams, switchable enemy counts, plus layered SVGs for Illustrator)
exists outside the repo, because it holds the maintainer's account numbers; its generator is a small script that reads
`nousr-result` files.
