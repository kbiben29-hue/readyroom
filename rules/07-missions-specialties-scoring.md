# 7. Specialties, Missions, Captain's Log & Final Scoring

## 7.1 Specialties (p.17)

Three Specialties, one track each on your Crew board:

| Specialty     | Machine ID  | Colour     |
| ------------- | ----------- | ---------- |
| **Research**  | `RESEARCH`  | blue       |
| **Influence** | `INFLUENCE` | yellow-ish |
| **Military**  | `MILITARY`  | red        |

- Each track runs **0 to 15**. **You cannot advance past 15.**
- "Gain Research" → advance that marker **one space right**.
- The most common source is the `Utilize` DIRECTIVE card, which counts your **Skill icons**.

### 7.1.1 The three icon families

| Icon                 | Position on card                 | Meaning                                                                                  |
| -------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| **Skill icon**       | upper-left, below the title bar  | Counted (mostly by `Utilize`) to advance Specialty tracks. **Up to 3 printed per card.** |
| **Focus icon**       | bottom-right, beside the VP icon | Determines the card's **endgame VP** via the corresponding track's multiplier            |
| **Restriction icon** | on the operation                 | Gates an operation behind a **minimum track level**                                      |

Skill icon variants:

- **`ANY` skill** — represents any one Specialty (chosen when counted).
- **`VARIABLE` skill** — changes based on conditions printed on the card.

### 7.1.2 Specialty restrictions

An operation marked with a Research / Influence / Military **restriction** is available only if
that track is **at or above** the shown level.

> If you do not meet the requirement you can **neither play nor resolve** that operation.
> (For a card whose _only_ PLAY operation is restricted, this means the card cannot be played.)

### 7.1.3 "A card exhibiting a Specialty"

Some cards reference _having_ or _discarding_ a card **exhibiting** a Specialty. This is
satisfied by a card with either:

- a **Skill icon** of that colour, **or**
- a **Focus icon** of that colour.

**A card with only a coloured _restriction_ icon does NOT count.**

### 7.1.4 Specialty VP multipliers

Certain steps on each track carry a **VP multiplier** (`×2`, `×3`, `×4`, …). At the end of the
game, the **highest-reached multiplier** on a track (not the step number) multiplies the count
of your cards bearing that track's **Focus icon**.

> **This scoring is gated on completing at least one mission.** See §7.4.

The glyphs differ per crew **and** per board side (board photos; `src/data/cards/boards/`). The
Basic side prints `×1` at step 0; the Advanced side prints **no** glyph at step 0, so a track that
has not reached its first glyph multiplies its Focus icons by **0** (docs/card-rulings.md 045).

## 7.2 Missions (p.20)

Missions are printed on your **Crew board**:

- **Basic side** → 1 mission (and you return 2 of your 3 Mission Completion tokens to the box).
- **Advanced side** → 3 missions, each with a **printed VP value** that only scores on the
  Advanced side.

Each mission has a **GOAL**. Typically it asks you to reach some value on a Specialty track, or
to have enough cards of given suits/traits in play. Some missions require suits/traits to be
**on the same SHIP**: this
counts **icons on that one SHIP plus every card beamed to that particular SHIP**.

### 7.2.1 Completing a mission

While a mission's GOAL is met, you may complete it **at any time during your turn**, **without
spending an action**. Then:

1. **Resolve the REWARD effect.**
2. **Dismiss every beamed card that contributed** to the completion. Other in-play contributors
   (deployed SHIPs, LOCATIONs, Staging Area cards) are **not** dismissed.
3. **Place a Mission Completion token** on the mission.

Each mission can be completed **only once**.

> **Implementation:** step 2 requires the engine to record _which specific cards satisfied the
> goal_, not merely that it was satisfied. Where multiple sets satisfy the goal, the choice of
> contributing set is presumably the player's — surface it as a choice.

### 7.2.2 "Mission failed"

> **If you complete NO missions, every card with a Focus icon scores 0 VP at final scoring.**

This is a large swing. Completing one mission is effectively mandatory.

## 7.3 Captain's Log (p.21, 31)

The Log is the **permanent deck-thinning** mechanism: logged cards go **underneath your Captain
card**.

- Logged cards are **out of play** and **cannot be interacted with** unless a card says otherwise.
- **They still score Victory Points at final scoring.**
- **You may always look at your own Log; your opponent may not.**
- If a logged card had cards **beamed** to it, those are **also logged**.
- Logging a **LOCATION** → Ships present are **dismissed**, Away Teams **return to their owner's
  Captain card**.
- If an `ATTACK` logs one of the opponent's cards, it goes into **their** Log.
- An Action token riding on a logged card is set beside your Captain card purely as a
  reminder; that action is **not** regained.

### 7.3.1 Self-logging cards

A common PLAY-operation ending is "**Log this card**". Sequence: the card enters the Staging
Area, its operation resolves, and finally the card moves to your Log.

> **Crucially, there is no moment outside its own operation's resolution at which the card
> (and its suit/traits) is in play.** It cannot contribute to missions or trait-counting effects,
> because those are evaluated either before it was played or after it was logged.
> **If you want it counted, beam it instead.**

## 7.4 Final scoring (p.24–25)

Final scoring runs when **(a)** the game ended by **Resolution**, or **(b)** the **Burn** ended
in a **tie**.

**First, set aside whatever is still in your Reserve deck or Development pile** — those cards score nothing.

**Everything else you own counts** — including cards in your Captain's Log and cards beamed to
other cards.

### 7.4.1 Score components

| #   | Component                       | Detail                                                                                                                                                             |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Glory**                       | **1 VP per Glory token** in your pool                                                                                                                              |
| 2   | **Tokens on neutral Locations** | **1 VP per Away Team or Ship token** you have on **neutral** Locations (not controlled ones)                                                                       |
| 3   | **ENDGAME operations**          | Resolve `ENDGAME` operations of cards you have **in play** (typically the Captain and controlled Locations)                                                        |
| 4   | **Printed VP**                  | Sum the printed VP on **all your cards**, wherever they are (hand, deck, discard, log, in play, beamed)                                                            |
| 5   | **Focus icons**                 | For each Specialty track: **highest reached multiplier value × number of your cards with that Focus icon**. **Skip entirely (0 VP) if you completed no missions.** |
| 6   | **Completed missions**          | **Advanced side only** — printed VP per mission marked with a completion token                                                                                     |

Highest total wins. **On a tie, both players win.**

### 7.4.2 Scoring edge cases

- **Unused ENDGAME operations.** A scoring card that ends the game **outside play** — in your
  Log, deck or hand — still contributes its **printed VP**; only its **ENDGAME operation is
  skipped**.
- **Asterisk VP.** If a card's VP icon contains an asterisk, its `SPECIAL` operation explains how
  it scores — **and that applies even if the card is not in play**.
- **At final scoring a `WILDCARD` trait is just itself** — it substitutes for nothing.
- Once ENDGAME conditions are scored, cards can be gathered up freely — nothing else cares about
  where they were.

### 7.4.3 Worked example (rulebook p.25)

Picard's ENDGAME scores 1 VP per `ALLY` you own. With 4 ALLYs (Denobulans, Edosians, Halkan
Council, Kelpiens) that is 4 VP. Three of the cards shown have printed VP totalling 9. Four
cards carry a blue (Research) Focus icon and the Research track is past the `×4` multiplier →
4 × 4 = **16 VP**. Total for that subset: **29 VP**.

### 7.4.4 Cadet Training benchmarks (solo practice)

| Score    | Meaning                    |
| -------- | -------------------------- |
| ≥ 70 VP  | You understand how to play |
| ≥ 100 VP | Proficient with this deck  |
| > 120 VP | Outstanding                |
