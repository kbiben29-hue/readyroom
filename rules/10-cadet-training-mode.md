# 10. Cadet Training Mode (solo practice, p.28)

A solo mode **without a Bot** — for learning a deck or the rules. It is _not_ the full solo game
(which uses the 12 Automated Command cards + 2 Solo cards and a separate rulebook).

## 10.1 Setup changes

- Use the **two Stardate cards marked "Cadet Training"** (each showing **5 Glory**) instead of
  the regular Stardate cards.
  _Printed as SD06/SD07 "SOLO CADET PRACTICE" #1/#2. #1: "At the beginning of the your next
  Clean-up Step, wipe the Market (removing all tokens) and any neutral LOCATION with no tokens
  present." #2: "Trigger the end of the game." Both add "Only take tokens from here during
  Clean-up step!" (= §10.2 #1–#2)._
- Everything else as normal, for one player.

## 10.2 Rule changes

1. **All Glory you gain comes from the supply**, not from the Stardate cards.
2. If an effect **explicitly** tells you to remove a Glory from a Stardate card **outside your
   Clean-up Step**, **ignore it**.
3. **Treat the virtual opponent as always owning exactly "one of everything"** — the single
   exception: on neutral Locations they have zero Ship tokens.
   - "Remove up to 2 opponent Away Teams to gain 1 Glory each" → you gain only **1** Glory.
   - "Steal 3 Dilithium" → only **1** is available to steal.
   - **You still need 3 tokens to secure a neutral Location** (the virtual opponent has 1 Away
     Team there, so 3 of yours satisfies "≥3 and ≥2 more").
4. Every time the opponent **would be forced to take an INCIDENT**, **skip it and gain 1 Glory
   instead**.
5. **If the Burn is ever triggered, you lose.**

## 10.3 Clean-up & Stardates

During **each** Clean-up Step:

1. **Pick a Market card and wipe it**: its tokens go back to the supply, the card goes to the
   Junk pile, and the slot is refilled.
2. Then **place 1 Glory from the Stardate card onto a card in the Market** (as normal).

> **Burnham variant:** the Glory still comes off the Stardate card (**1**), but the Market card
> receives **1 Dilithium** rather than Glory. (Her Status card says place 2 Dilithium; **in Cadet mode place only one**.)

### Fixed timeline

| Turn   | Event                                                                                                                                                                                                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **5**  | The **first Stardate card empties** during your Clean-up Step                                                                                                                                                                                                                |
| **6**  | At the **beginning of your Clean-up Step**: wipe the Market, and wipe every Neutral Zone Location you have **no** token on; then place **5 Glory from the supply** on the second Stardate card. After that, the usual Cadet Clean-up follows (wipe one card, place 1 Glory). |
| **10** | The **second Stardate card empties** during your Clean-up Step → triggers game end                                                                                                                                                                                           |
| **11** | Play one final turn, then score                                                                                                                                                                                                                                              |

## 10.4 Scoring

Score as usual (`07-missions-specialties-scoring.md` §7.4).

| Score    | Meaning                                    |
| -------- | ------------------------------------------ |
| ≥ 70 VP  | You understand how to play Captain's Chair |
| ≥ 100 VP | Quite proficient with this deck            |
| > 120 VP | Outstanding                                |

## 10.5 Implementation note

Cadet Training is the **cheapest path to a playable single-player build** — it needs no Bot AI,
no opponent decision-making, and no hidden-information model. Ship it first; see
`todo/15-opponent-modes.md`.

The "virtual opponent has one of everything" rule is best implemented as a **query interceptor**:
when any effect queries an opponent-owned quantity, clamp the answer to `min(requested, 1)`, and
return `0` for Ship tokens at neutral Locations.
