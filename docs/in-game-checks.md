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

## Tier 1: big effect on results

### 1. Cyrene: is Ode to Ego always on, or only after an Ode on her?

**Why it matters:** if it's always on, every Minuet of Blooms and Plumes gets extra bounces from the very first one (up to
about 7x the Minuet's damage at E0). Today the sim gives no bounces until Demiurge has used "This Ode, to All Lives" on
Cyrene herself. Fribbels assumes always on. Code: `src/kits/cyrene.ts` header, reading 3.

**Setup:** Cyrene plus 2 or 3 teammates, against **one** enemy (easier to count hits).

**Steps:**
1. Let the teammates act at least once each before Cyrene's Ultimate. Each one that acts gives her Recollection, and the
   bounce count is "1 per different teammate Cyrene has gained Recollection from".
2. Use Cyrene's Ultimate once it's ready. Demiurge appears and gets an immediate extra turn.
3. On that extra turn, pick **Minuet of Blooms and Plumes** (the attack), **not** the Ode.
4. Count the hits on the enemy: one AoE hit, plus any extra bounce hits.

**Read it as:**
- Only the 1 AoE hit: Ode to Ego is **not** on yet. The sim is right.
- 1 AoE hit plus about as many bounces as teammates who acted: Ode to Ego is **always on**.

**Result:**

### 2. Cyrene: how much Recollection does her Ultimate cost?

**Why it matters:** the game data says both her Ultimates "cost 12 energy". The sim takes 24 for the first one. If it only
takes 12, she keeps 12 and gets an extra Reunion at First Sight (an extra Demiurge turn) much sooner. Code:
`src/kits/cyrene.ts`, reading 2.

**Steps:**
1. In any battle, just before her first Ultimate, write down her Recollection (the number on her Ultimate / energy display).
2. Use the Ultimate, then write down her Recollection again.
3. Later, in "Ripples of Past Reverie" (after that first Ultimate), do the same around a Reunion at First Sight Ultimate.

**Result:**
- Before / after first Ultimate:
- Before / after a Reunion:

### 3. Cyrene: Recollection at the start of a Memory of Chaos battle

**Why it matters:** her data gives "max energy 24", the same number as her first Ultimate's threshold. If Recollection is
her energy bar, Memory of Chaos's 50% starting energy gives her 12 at the start, and her first Ultimate comes much earlier.
The sim starts her at 0 plus her Ripples Across Time trace (2 / 3 / 6 for 1 / 2 / 3 other Chrysos Heir or Remembrance
characters in the team), plus 12 at E2.

**Steps:**
1. Enter any **Memory of Chaos** stage with Cyrene.
2. Before anyone acts, read her Recollection.
3. Write down which teammates she had and her eidolon (the trace bonus depends on both).

**Result:**

### 4. Castorice: does healing a full-HP ally give Newbud?

**Why it matters:** Contained Dark Tide turns healing into Newbud. The sim counts only HP actually restored, so a heal on a
full-HP ally gives nothing. If overheal counts too, Newbud fills faster with Hyacine, and so do Netherwing's HP refills in
the "hold" mode (DESIGN.md K25, the burn vs hold experiment). Code: `src/kits/castorice.ts` header.

**Steps:**
1. Battle with Castorice and a healer (Hyacine), Netherwing **not** on the field.
2. Make sure everyone is at full HP. Write down Castorice's Newbud (her Ultimate gauge).
3. Use a heal (Hyacine's Skill) on the full-HP team. Check Newbud again.

**Read it as:**
- Newbud unchanged: only restored HP counts. The sim is right.
- Newbud went up: overheal counts.

**Result:**

### 5. Hyacine: is her Ultimate's heal based on her Max HP before or after After Rain?

**Why it matters:** the sim prices the Ultimate's heal on her After Rain-boosted Max HP. The text lists the heal before the
state, so the heal may use her Max HP before the boost. Code: `src/kits/hyacine.ts` header.

**Steps:**
1. Out of battle, write down Hyacine's Max HP and Outgoing Healing Boost from her character screen.
2. In battle, damage an ally a little so the heal is fully visible (no overheal). Use Hyacine's Ultimate and write down the
   heal number shown on that ally.
3. Write down Hyacine's eidolon.

Claude computes both readings from these numbers and sees which one matches.

**Result:**

### 6. Along the Passing Shore: does the hit that applies Mirage Fizzle already get its DMG bonus?

**Why it matters:** this moves Acheron's single-hit Basic ATK and Skill damage by about 24%. The sim says no, Fribbels
says yes. Code: `src/equipment/alongThePassingShore.ts`.

**Steps:**
1. Acheron with Along the Passing Shore, one enemy without Mirage Fizzle on it.
2. Use Basic ATK and write down the damage, noting whether it was a crit.
3. Use Basic ATK again on the same enemy (it now has Mirage Fizzle). Write down the damage and whether it crit.
4. Repeat until you have one non-crit number from a "first hit" and one from a "second hit". Other buffs must stay the same
   between the two hits (same team, nothing new applied).

**Read it as:**
- The two non-crit numbers about equal: the first hit already had the bonus (Fribbels is right).
- The second clearly bigger: the first hit had no bonus. The sim is right.

**Result:**

### 7. Anaxa: how much energy does his Skill give?

**Why it matters:** it sets how often he uses his Ultimate. The game data prints "+6" for the Skill. For Welt's Skill the data
also printed 6, and you measured 30 in game (6 per hit, 5 hits), so the sim gives Anaxa 6 per Skill instance: 30 for a normal
Skill (1 + 4 instances), 48 with Cyrene's Ode to Reason (3 more instances). Not checked for Anaxa himself. With 6 per Skill he
used his Ultimate only 1 to 2 times in 5 cycles in a test run. Code: `src/kits/anaxa.ts`, `SKILL_ENERGY`.

**Steps:**
1. Any battle, **one** enemy that is **not** yet weak to 5 types (so his talent's extra Skill does not come out and add
   energy): for example an enemy with 3 weaknesses, on the first Skill of the fight.
2. Write down Anaxa's energy just before his Skill and just after it (before anyone else acts).
3. If you have Cyrene: after Demiurge uses Ode to Reason on him, do the same for that Skill.

**Read it as:**
- About +30 (times his Energy Regeneration Rate): 6 per instance. The sim is right.
- About +6: 6 per Skill. The sim gives him far too much energy.
- With the Ode, about +48: per instance, the extra 3 count. About +30: the Ode's instances give none.

**Result:**

### 8. The Herta: does the Interpretation bonus apply once, or on every hit of Hear Me Out?

**Why it matters:** at 42 stacks with 2 Erudition characters the bonus is +739% of ATK on the primary target (42 x 8.8% x 2).
Added once (Fribbels, and the sim) or on each of the 3 hits on that enemy is a 3x difference on most of her damage.
Code: `src/kits/theHerta.ts` header.

**Steps:**
1. The Herta with Inspiration (after her Ultimate), **one** enemy with a known Interpretation count (the stack number on it).
2. Use Hear Me Out and look at the three hits on that enemy (not the last all-enemy hit). Use non-crit numbers.

**Read it as:**
- The first hit clearly bigger than the next two: the bonus is added once. The sim is right.
- All three about equal and large: the bonus is on every hit. The sim undercounts her.

**Result:**

---

## Tier 2: smaller effect

Short procedures. Same idea: write down what you see.

9. **Hyacine's Technique** (code: hyacine.ts header). Start a battle with her Technique used, then look at Little Ica's first
   Rainclouds damage. Compare it with a battle where the Technique wasn't used, and note whether allies were at full HP when
   it healed them. Question: does the Technique's battle-start heal count toward Ica's healing tally? Also, does the team's
   Max HP go up by 20% for 2 turns? **Result:**
10. **Hyacine's After Rain duration after an out-of-turn Ultimate.** Use her Ultimate between two of her turns, then count
   how many of her own actions After Rain is still up for: 2 or 3? **Result:**
11. **Take Sky in Hand during After Rain.** When it triggers, does the ally who lost HP also get the "all allies" heal (two
   heal numbers)? Does Little Ica heal herself? **Result:**
12. **Cyrene's first Ultimate: 1 or 2 Story?** Her text gives Story "after Cyrene uses Ultimate **or** when Demiurge is
    summoned", and the first Ultimate does both. Read Demiurge's Story count (its buff list) right after. **Result:**
13. **Cyrene's Ultimate order.** When she ults, do the teammates' filled Ultimates come before or after Demiurge's extra turn?
    **Result:**
14. **Cyrene E6** (only if you have E6). Does the first Ode to Ego Minuet already have the enemies' DEF -20%? **Result:**
15. **Future and Ultimates.** After a teammate uses their Ultimate (or a follow-up), does Cyrene gain Recollection from it?
    The sim says only Basic ATK and Skill consume Future. **Result:**
16. **Cyrene's Max HP and current HP.** When Demiurge arrives and her Max HP goes up 24%, does her current HP go up too, or
    only the maximum? **Result:**
17. **World-Remaking Deliverer** (Robin or Cyrene wearing it). After a Skill that summons the memosprite, is the +15% team
    DMG on right away? If the memosprite leaves before her next Basic/Skill, does the buff end early? **Result:**
18. **Netherwing's last Breath and West Wind** (only matters if it ever expires at turn 3 without the finisher; today the
    sim's modes never let that happen). Skip unless convenient. **Result:**
19. **Robin with a non-heir Ode.** When Demiurge uses This Ode on Robin Summeretto, does the +40% DMG show on both Robin and
    the Songbirds? **Result:**

20. **Anaxa's talent extra Skill gives energy and stacks?** Basic ATK on an enemy already weak to 5+ types, so the extra Skill
    comes out. Energy gained: 20 + 10 (Basic) + 30 (extra Skill) = 60, or only 30? With E4, ATK stacks after it: 2 or 1? With E1,
    one more Skill Point the first time? **Result:**
21. **Anaxa: which enemy is "them" for the extra Skill?** Basic ATK on an enemy with exactly 4 weakness types, so the Basic's hit
    adds the fifth. Does the extra Skill come out right away (the sim: yes, checked after the action)? **Result:**
22. **Anaxa with Ode to Reason: does the talent's extra Skill also get the 3 more instances?** Count its hits: 8 (sim) or 5.
    **Result:**
23. **Anaxa: does True Knowledge (and E4's ATK stack) already apply to the Basic/Skill that grants it?** Compare the ATK in his
    stats panel during the first Skill after the Ode with a later one. The sim: yes. **Result:**
24. **Anaxa: does an instance see the weakness it implants?** On an enemy with 4 types, the Skill's 1st instance adds the 5th.
    Is the 2nd instance on that enemy already +30% (Disclosure)? The sim: the instance itself no, the next one yes. **Result:**
25. **Anaxa's Sublimation on a boss with 50% Control RES** (most Memory of Chaos bosses). After his Ultimate, does the boss still
    take its next turn? The sim: any Control RES means it acts. The generic enemy has none, so this only matters for real
    bosses later. **Result:**
26. **Anaxa: do weakness implants and Sublimation count as debuffs?** With Acheron (or any "when a debuff is inflicted" effect):
    does his Skill or Ultimate trigger it? The sim: both count. **Result:**
27. **Anaxa's Technique and E2 at the start of battle.** Which weakness does the Technique add when someone else starts the
    fight ("the attacker's Type")? The sim assumes Anaxa's Wind. Note the weakness icons at the start. **Result:**
28. **The Herta's Skill hit spread** on 5 enemies: hits on the middle / its neighbours / the outer two. The sim: 3 / 2 / 1.
    **Result:**
29. **The Herta: Interpretation right after Hear Me Out.** Note the aimed enemy's stacks just after the Skill (the sim: reset
    to 1, plus her own after-attack stacks: 5 if it is the most-stacked enemy hit, else 2). At E1, does the +50% Ice DMG come
    at 28 stacks (28 x 1.5 = 42, the sim and Fribbels) or only at 42? **Result:**
30. **The Herta: "Answer" after her Ultimate.** Is it kept (the sim) or spent? Does a stack put on a 42-stack enemy still give
    an Answer (the sim: yes)? **Result:**
31. **The Herta's trace stacks when she is the only Erudition character.** Does "after attacking, 1 stack on the
    most-stacked enemy hit" still happen? The sim: yes (only the CRIT DMG and "at least 3 targets" need 2 Erudition).
    **Result:**
32. **The Herta with Jing Yuan: does Lightning-Lord count as an Erudition attacker?** Note the most-stacked enemy's Interpretation
    before and after one Lightning-Lord action. The sim gives +1 from Aloofly Honest and +3 from Message per hit (Jing Yuan is
    Erudition), about 6 extra stacks per Jing Yuan turn; if Lightning-Lord is not "an Erudition character", it is +1 +1. **Result:**

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
