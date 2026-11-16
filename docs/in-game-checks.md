# In-game checks

> **Players: you can contribute here without writing code.** Each check below is a question the game's text does not settle.
> Pick one, follow its steps in the game, and report what you saw with the
> [in-game check result issue template](../.github/ISSUE_TEMPLATE/in_game_check.md) (which check, what you saw, screenshots,
> game version). See [CONTRIBUTING.md](../CONTRIBUTING.md#contributing-in-game-checks-without-code). The maintainer or an agent
> applies the answer to the code.

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

### 9. Sacerdos' Relived Ordeal: whose turns count down the stack, and does a new stack renew it?

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

10. **Hyacine's Technique** (code: hyacine.ts header). Start a battle with her Technique used, then look at Little Ica's first
   Rainclouds damage. Compare it with a battle where the Technique wasn't used, and note whether allies were at full HP when
   it healed them. Question: does the Technique's battle-start heal count toward Ica's healing tally? Also, does the team's
   Max HP go up by 20% for 2 turns? **Modelled 2026-11-15 (K31), five readings to check:** (a) the heal comes first and the
   Max HP buff after (allies start at full HP, so the heal is all overheal); (b) the 2 turns count down by each ally's own
   turns; (c) only characters get the heal and the buff, no memosprite; (d) the heal takes her Outgoing Healing; (e) the
   Max HP buff does not raise current HP. **Result:**
11. **Hyacine's After Rain duration after an out-of-turn Ultimate.** Use her Ultimate between two of her turns, then count
   how many of her own actions After Rain is still up for: 2 or 3? **Result:**
12. **Take Sky in Hand during After Rain.** When it triggers, does the ally who lost HP also get the "all allies" heal (two
   heal numbers)? Does Little Ica heal herself? **Result:**
13. **Cyrene's first Ultimate: 1 or 2 Story?** Settled by Smitty in game, 2026-11-15: 2.
14. **Cyrene's Ultimate order.** Settled by Smitty in game, 2026-11-15: the teammates' Ultimates come before Demiurge's extra turn.
15. **Cyrene E6** (only if you have E6). Does the first Ode to Ego Minuet already have the enemies' DEF -20%? **Result:**
16. **Future and Ultimates.** After a teammate uses their Ultimate (or a follow-up), does Cyrene gain Recollection from it?
    The sim says only Basic ATK and Skill consume Future. **Result:**
17. **Cyrene's Max HP and current HP.** When Demiurge arrives and her Max HP goes up 24%, does her current HP go up too, or
    only the maximum? **Result:**
18. **World-Remaking Deliverer** (Robin or Cyrene wearing it). After a Skill that summons the memosprite, is the +15% team
    DMG on right away? If the memosprite leaves before her next Basic/Skill, does the buff end early? **Result:**
19. **Netherwing's last Breath and West Wind** (only matters if it ever expires at turn 3 without the finisher; today the
    sim's modes never let that happen). Skip unless convenient. **Result:**
20. **Robin with a non-heir Ode.** When Demiurge uses This Ode on Robin Summeretto, does the +40% DMG show on both Robin and
    the Songbirds? **Result:**
21. **Can enemies hit the Summer Songbirds?** They show no Backup or Out-of-Bounds tag (like Little Ica, a normal unit),
    and a screenshot showed them with 2 debuffs and lost HP. During Fever, open their details and tap the debuff list: what
    are the debuffs and who applied them? An enemy debuff means enemies can target them. Any enemy damage number on them
    settles it too. **Result (2026-11-15):** a boss's "Target Locked On" and two enemy DoTs were on them; no tag. Switched to a normal unit. Final proof, if convenient: a damage number on them when that boss's "Desmios Evangelion" (damage split across all locked-on targets) lands.

22. **Sacerdos' Relived Ordeal on Sunday himself** (code: sacerdosRelivedOrdeal.ts header). Use Sunday's Ultimate on **Sunday
    himself**. Does a Sacerdos' Relived Ordeal stack appear in **his** buff list? The sim gives none (its NOT MODELLED case).
    **Result:**
23. **Sacerdos' Relived Ordeal after Sunday is knocked down.** If Sunday goes down while an ally holds his Sacerdos stack, does the
    stack stay on the ally until it runs out? The sim keeps it. Skip unless it happens. **Result:**
24. **Two Sacerdos wearers** (only if you ever field two). Do their stacks share one cap of 2, or can an ally hold 2 from each? The sim
    keeps them apart. Skip unless convenient. **Result:**
25. **Self-Enshrouded Recluse on Dan Heng PT himself** (code: selfEnshroudedRecluse.ts header). After his Skill shields the team,
    open **his own** buff list (or his character stats in battle). Does he get the +15% CRIT DMG from his own set while he holds his
    own shield? The sim says yes. **Result:**
26. **Self-Enshrouded Recluse after Dan Heng PT is knocked down.** If he goes down while allies still hold his shield, does their
    +15% CRIT DMG stay until the shield ends? The sim keeps it. Skip unless it happens. **Result:**

27. **Anaxa's talent extra Skill gives energy and stacks?** Basic ATK on an enemy already weak to 5+ types, so the extra Skill
    comes out. Energy gained: 20 + 10 (Basic) + 30 (extra Skill) = 60, or only 30? With E4, ATK stacks after it: 2 or 1? With E1,
    one more Skill Point the first time? **Result:**
28. **Anaxa: which enemy is "them" for the extra Skill?** Basic ATK on an enemy with exactly 4 weakness types, so the Basic's hit
    adds the fifth. Does the extra Skill come out right away (the sim: yes, checked after the action)? **Result:**
29. **Anaxa with Ode to Reason: does the talent's extra Skill also get the 3 more instances?** Count its hits: 8 (sim) or 5.
    **Result:**
30. **Anaxa: does True Knowledge (and E4's ATK stack) already apply to the Basic/Skill that grants it?** Compare the ATK in his
    stats panel during the first Skill after the Ode with a later one. The sim: yes. **Result:**
31. **Anaxa: does an instance see the weakness it implants?** On an enemy with 4 types, the Skill's 1st instance adds the 5th.
    Is the 2nd instance on that enemy already +30% (Disclosure)? The sim: the instance itself no, the next one yes. **Result:**
32. **Anaxa's Sublimation on a boss with 50% Control RES** (most Memory of Chaos bosses). After his Ultimate, does the boss still
    take its next turn? The sim: any Control RES means it acts. The generic enemy has none, so this only matters for real
    bosses later. **Result:**
33. **Anaxa: do weakness implants and Sublimation count as debuffs?** With Acheron (or any "when a debuff is inflicted" effect):
    does his Skill or Ultimate trigger it? The sim: both count. **Result:**
34. **Anaxa's Technique and E2 at the start of battle.** Which weakness does the Technique add when someone else starts the
    fight ("the attacker's Type")? The sim assumes Anaxa's Wind. Note the weakness icons at the start. **Result:**
35. **The Herta's Skill hit spread** on 5 enemies: hits on the middle / its neighbours / the outer two. The sim: 3 / 2 / 1.
    **Result:**
36. **The Herta: Interpretation right after Hear Me Out.** Note the aimed enemy's stacks just after the Skill (the sim: reset
    to 1, plus her own after-attack stacks: 5 if it is the most-stacked enemy hit, else 2). At E1, does the +50% Ice DMG come
    at 28 stacks (28 x 1.5 = 42, the sim and Fribbels) or only at 42? **Result:**
37. **The Herta: "Answer" after her Ultimate.** Is it kept (the sim) or spent? Does a stack put on a 42-stack enemy still give
    an Answer (the sim: yes)? **Result:**
38. **The Herta's trace stacks when she is the only Erudition character.** Does "after attacking, 1 stack on the
    most-stacked enemy hit" still happen? The sim: yes (only the CRIT DMG and "at least 3 targets" need 2 Erudition).
    **Result:**
39. **The Herta with Jing Yuan: does Lightning-Lord count as an Erudition attacker?** Note the most-stacked enemy's Interpretation
    before and after one Lightning-Lord action. The sim gives +1 from Aloofly Honest and +3 from Message per hit (Jing Yuan is
    Erudition), about 6 extra stacks per Jing Yuan turn; if Lightning-Lord is not "an Erudition character", it is +1 +1. **Result:**
40. **Messenger Traversing Hackerspace and Watchmaker: which Ultimates count as "on an ally"** (code: ultimateOnAlly.ts,
    messengerTraversingHackerspace.ts, watchmakerMasterOfDreamMachinations.ts headers). The sim counts an Ultimate that has an ally
    effect (buff, heal, energy, advance on another character) and does not attack. Check with the wearer using an Ultimate that
    targets one ally (Sunday's on another character), all allies (Hyacine's), and the wearer itself (Sunday on himself): does the set
    trigger? The sim: yes, yes, no. Also: does Fu Xuan's Ultimate (it attacks and heals) trigger it? The sim: no. **Result:**
41. **Messenger and Watchmaker durations.** After the trigger, does each ally keep the buff through its own next turn (Messenger,
    1 turn) or next two turns (Watchmaker, 2 turns), counted at the end of each ally's turn? Does the wearer itself get it? The sim:
    yes to all. **Result:**
42. **Longevous Disciple stacks** (code: longevousDisciple.ts header). After two hits, does a third hit or HP loss refresh the 2
    turns of both stacks, or does each stack time out on its own? Does a hit fully absorbed by a shield give a stack? Does damage Fu
    Xuan's Matrix moves onto the wearer count as a hit? The sim: shared timer, yes, no. **Result:**
43. **Guard of Wuthering Snow's 5 Energy** (code: guardOfWutheringSnow.ts header). With a wearer that has Energy Regeneration Rate
    above 0, start a turn at or under 50% HP and note the Energy gained: 5, or 5 times (1 + rate)? Is the 8% heal affected by
    Outgoing Healing? The sim: flat 5, no Outgoing Healing. **Result:**
44. **Eagle of Twilight Line's advance.** After the wearer's Ultimate, is the action advanced by a clean 25% (the sim), also when the
    Ultimate is used right after its own turn? **Result:**
45. **Fleet of the Ageless at exactly 120 SPD** (code: fleetOfTheAgeless.ts header). Does the team ATK +8% show with the wearer at
    SPD 120.0, and does it follow a temporary SPD buff over 120 (a Messenger Ultimate) and drop when the buff ends? The sim: yes
    at exactly 120, and yes it follows. **Result:**

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
