# In-game checks

A to-do list for Smitty, to work through in the game when there's time. Each check answers a question the game text
doesn't settle. The simulator already does one thing for each (marked `IN-GAME CHECK` in the code), and the check says
whether that's right. **You only need to write down what you see.** Claude does the arithmetic and updates the code.

How to use it:
- Work top to bottom. Tier 1 changes results the most for the teams being built now.
- Under each check, fill in **Result** with what you saw (numbers, screenshots, "yes/no"). Partial results help too.
- Then tell Claude "in-game checks are filled in". It reads this file, applies the answers, and moves each one to
  DESIGN.md as "Settled by Smitty".

Notes on the steps:
- UI steps are written from memory (Recalled), not checked against the 4.7 client. If a button or panel is somewhere else,
  use whatever shows the same thing and note it.
- **Crits:** these checks compare single damage numbers, and a crit can make one hit look bigger for no other reason.
  Compare non-crit hits with non-crit hits. Crit numbers look different on screen (bigger, with a crit marker).
- **Memory of Chaos** matters only where a check says so (its 50% starting energy). Anywhere else, any battle works:
  an overworld enemy, a Calyx, or Simulated Universe.
- A screenshot of a buff list or a damage number is a perfectly good result.

---

## Done (Smitty, 2026-11-15)

Results recorded here. Claude applies each to the code and moves it to DESIGN.md as "Settled by Smitty".

| # | Check | Result |
|---|---|---|
| 1 | Cyrene: Ode to Ego | **Always on.** Every Minuet gets bounces. "This Ode, to All Lives" **cannot target Cyrene herself** |
| 2 | Cyrene: Ultimate cost | First Ultimate **needs 24, spends 12** (leaves 12). Reunion at First Sight spends 12 |
| 3 | Cyrene: Memory of Chaos start | 0 + trace only (6 of 24 with 3 Chrysos Heir / Remembrance teammates, E0/E1). The 50% start energy adds nothing. The sim already does this |
| 4 | Castorice: overheal and Newbud | **Overheal counts.** Newbud 47% to 63% from Hyacine's Ultimate on 3 full-HP allies |
| 5 | Hyacine: Ultimate heal | **Before After Rain's buff.** 4,946 Max HP, 34.5% Outgoing Healing, Lv10: +1,073 on allies, +1,288 on Little Ica. Computed by Claude: before-Rain plus a likely +20% (her Technique) gives 1,067, after-Rain gives about 1,214; Ica is exactly 1.2x |
| 6 | Along the Passing Shore | **The applying hit already gets the bonus** (Fribbels' reading). Non-crit 2,028 then 2,842 with Sunday's +53%: 2,842 / 2,028 = 1.4014, matching 1.85 / 1.32 = 1.4015 |
| 10 | Cyrene: first Ultimate's Story | **2 Story** (1 for the Ultimate, 1 for the summon) |
| 11 | Cyrene: order | **Teammates' Ultimates come before Demiurge's extra turn** |

Also from screenshots: Demiurge is Out-of-Bounds, Netherwing is Backup, Little Ica is a normal unit (DESIGN.md, Memosprites row).

## Tier 1: big effect on results

All six Tier 1 checks are settled (the "Done" table above). Each is applied in the code and recorded in DESIGN.md (Open questions
table) as settled; their `IN-GAME CHECK` notes now read "Settled by Smitty in game, 2026-11-15".

1. Cyrene: Ode to Ego is always on, and "This Ode, to All Lives" cannot target her. Settled by Smitty in game, 2026-11-15.
2. Cyrene: the first Ultimate needs 24 and spends 12; Reunion at First Sight spends 12. Settled by Smitty in game, 2026-11-15.
3. Cyrene: Recollection at the start of a Memory of Chaos battle is 0 + trace. Settled by Smitty in game, 2026-11-15.
4. Castorice: overheal counts for Newbud. Settled by Smitty in game, 2026-11-15.
5. Hyacine: the Ultimate's heal uses her Max HP before After Rain's buff. Settled by Smitty in game, 2026-11-15.
6. Along the Passing Shore: the hit that applies Mirage Fizzle already gets the bonus. Settled by Smitty in game, 2026-11-15.

---

## Tier 2: smaller effect

Short procedures. Same idea: write down what you see.

7. **Hyacine's Technique** (code: hyacine.ts header). Start a battle with her Technique used, then look at Little Ica's first
   Rainclouds damage. Compare it with a battle where the Technique wasn't used, and note whether allies were at full HP when
   it healed them. Question: does the Technique's battle-start heal count toward Ica's healing tally? Also, does the team's
   Max HP go up by 20% for 2 turns? **Modelled 2026-11-15 (K31), five readings to check:** (a) the heal comes first and the
   Max HP buff after (allies start at full HP, so the heal is all overheal); (b) the 2 turns count down by each ally's own
   turns; (c) only characters get the heal and the buff, no memosprite; (d) the heal takes her Outgoing Healing; (e) the
   Max HP buff does not raise current HP. **Result:**
8. **Hyacine's After Rain duration after an out-of-turn Ultimate.** Use her Ultimate between two of her turns, then count
   how many of her own actions After Rain is still up for: 2 or 3? **Result:**
9. **Take Sky in Hand during After Rain.** When it triggers, does the ally who lost HP also get the "all allies" heal (two
   heal numbers)? Does Little Ica heal herself? **Result:**
10. **Cyrene's first Ultimate: 1 or 2 Story?** Settled by Smitty in game, 2026-11-15: 2.
11. **Cyrene's Ultimate order.** Settled by Smitty in game, 2026-11-15: the teammates' Ultimates come before Demiurge's extra turn.
12. **Cyrene E6** (only if you have E6). Does the first Ode to Ego Minuet already have the enemies' DEF -20%? **Result:**
13. **Future and Ultimates.** After a teammate uses their Ultimate (or a follow-up), does Cyrene gain Recollection from it?
    The sim says only Basic ATK and Skill consume Future. **Result:**
14. **Cyrene's Max HP and current HP.** When Demiurge arrives and her Max HP goes up 24%, does her current HP go up too, or
    only the maximum? **Result:**
15. **World-Remaking Deliverer** (Robin or Cyrene wearing it). After a Skill that summons the memosprite, is the +15% team
    DMG on right away? If the memosprite leaves before her next Basic/Skill, does the buff end early? **Result:**
16. **Netherwing's last Breath and West Wind** (only matters if it ever expires at turn 3 without the finisher; today the
    sim's modes never let that happen). Skip unless convenient. **Result:**
17. **Robin with a non-heir Ode.** When Demiurge uses This Ode on Robin Summeretto, does the +40% DMG show on both Robin and
    the Songbirds? **Result:**
18. **Can enemies hit the Summer Songbirds?** They show no Backup or Out-of-Bounds tag (like Little Ica, a normal unit),
    and a screenshot showed them with 2 debuffs and lost HP. During Fever, open their details and tap the debuff list: what
    are the debuffs and who applied them? An enemy debuff means enemies can target them. Any enemy damage number on them
    settles it too. **Result (2026-11-15):** a boss's "Target Locked On" and two enemy DoTs were on them; no tag. Switched to a normal unit. Final proof, if convenient: a damage number on them when that boss's "Desmios Evangelion" (damage split across all locked-on targets) lands.

---

## Tier 3: everything else

The rest are smaller or affect teams that aren't the current focus:
- Every row of DESIGN.md "Open questions" without "Settled by Smitty" (about 55: Tribbie, Acheron, Jing Yuan, Welt,
  Silver Wolf, Dan Heng PT, Fu Xuan, Sunday, Robin, equipment, break).
- Every `IN-GAME CHECK` note in the code. List them with:

```bash
grep -rn "IN-GAME CHECK" src --include=*.ts
```

When you get to these, ask Claude to write Tier-1-style steps for whichever ones you want to do. It's better to do that
when you're about to play than to write all of them now.
