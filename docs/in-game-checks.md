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

---

### 7. Sacerdos' Relived Ordeal: whose turns count down the stack, and does a new stack renew it?

**Why it matters:** this decides how often Jing Yuan (or Acheron) has 1 or 2 stacks of +18% CRIT DMG from Sunday's set. The sim
counts the 2 turns on the **ally holding it**, at the end of each of their turns (the turn Sunday gives it in doesn't count), and a
new stack renews the duration of both. If it counts on Sunday's turns instead, or a new stack doesn't renew the old one, the uptime
of the second stack changes. Code: `src/equipment/sacerdosRelivedOrdeal.ts` header.

**Setup:** Sunday wearing 4 pieces of Sacerdos' Relived Ordeal, plus a damage dealer that isn't Harmony (Jing Yuan or Acheron),
plus anyone else. Any battle.

**Steps:**
1. Use Sunday's **Skill** on the damage dealer. They act immediately (his Skill pulls them forward).
2. Before they act, open their buff list and find the Sacerdos' Relived Ordeal buff. Write down its stack count and turns left.
3. Let the damage dealer take that turn. Open their buff list again and write down stacks and turns left.
4. On Sunday's next turn, use his **Skill** on the same ally again. Write down stacks and turns left right after.
5. Let a few turns pass without Sunday buffing that ally (use his Basic ATK) and note when the buff disappears: after the ally's own
   turn, or after Sunday's turn?

**Read it as:**
- Turns left drop after the **ally's** turns and the buff ends after the ally's 2nd turn: the sim is right on whose turns.
- Turns left drop after **Sunday's** turns: the clock is Sunday's.
- At step 4: 2 stacks with turns left back at 2: a new stack renews both (the sim's reading). 2 stacks but the turns left stay where
  they were: no renewal.

**Result:**

## Tier 2: smaller effect

Short procedures. Same idea: write down what you see.

8. **Hyacine's Technique** (code: hyacine.ts header). Start a battle with her Technique used, then look at Little Ica's first
   Rainclouds damage. Compare it with a battle where the Technique wasn't used, and note whether allies were at full HP when
   it healed them. Question: does the Technique's battle-start heal count toward Ica's healing tally? Also, does the team's
   Max HP go up by 20% for 2 turns? **Result:**
9. **Hyacine's After Rain duration after an out-of-turn Ultimate.** Use her Ultimate between two of her turns, then count
   how many of her own actions After Rain is still up for: 2 or 3? **Result:**
10. **Take Sky in Hand during After Rain.** When it triggers, does the ally who lost HP also get the "all allies" heal (two
   heal numbers)? Does Little Ica heal herself? **Result:**
11. **Cyrene's first Ultimate: 1 or 2 Story?** Her text gives Story "after Cyrene uses Ultimate **or** when Demiurge is
    summoned", and the first Ultimate does both. Read Demiurge's Story count (its buff list) right after. **Result:**
12. **Cyrene's Ultimate order.** When she ults, do the teammates' filled Ultimates come before or after Demiurge's extra turn?
    **Result:**
13. **Cyrene E6** (only if you have E6). Does the first Ode to Ego Minuet already have the enemies' DEF -20%? **Result:**
14. **Future and Ultimates.** After a teammate uses their Ultimate (or a follow-up), does Cyrene gain Recollection from it?
    The sim says only Basic ATK and Skill consume Future. **Result:**
15. **Cyrene's Max HP and current HP.** When Demiurge arrives and her Max HP goes up 24%, does her current HP go up too, or
    only the maximum? **Result:**
16. **World-Remaking Deliverer** (Robin or Cyrene wearing it). After a Skill that summons the memosprite, is the +15% team
    DMG on right away? If the memosprite leaves before her next Basic/Skill, does the buff end early? **Result:**
17. **Netherwing's last Breath and West Wind** (only matters if it ever expires at turn 3 without the finisher; today the
    sim's modes never let that happen). Skip unless convenient. **Result:**
18. **Robin with a non-heir Ode.** When Demiurge uses This Ode on Robin Summeretto, does the +40% DMG show on both Robin and
    the Songbirds? **Result:**

19. **Sacerdos' Relived Ordeal on Sunday himself** (code: sacerdosRelivedOrdeal.ts header). Use Sunday's Ultimate on **Sunday
    himself**. Does a Sacerdos' Relived Ordeal stack appear in **his** buff list? The sim gives none (its NOT MODELLED case).
    **Result:**
20. **Sacerdos' Relived Ordeal after Sunday is knocked down.** If Sunday goes down while an ally holds his Sacerdos stack, does the
    stack stay on the ally until it runs out? The sim keeps it. Skip unless it happens. **Result:**
21. **Two Sacerdos wearers** (only if you ever field two). Do their stacks share one cap of 2, or can an ally hold 2 from each? The sim
    keeps them apart. Skip unless convenient. **Result:**
22. **Self-Enshrouded Recluse on Dan Heng PT himself** (code: selfEnshroudedRecluse.ts header). After his Skill shields the team,
    open **his own** buff list (or his character stats in battle). Does he get the +15% CRIT DMG from his own set while he holds his
    own shield? The sim says yes. **Result:**
23. **Self-Enshrouded Recluse after Dan Heng PT is knocked down.** If he goes down while allies still hold his shield, does their
    +15% CRIT DMG stay until the shield ends? The sim keeps it. Skip unless it happens. **Result:**

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
