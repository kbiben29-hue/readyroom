# 2. Setup

## 2.1 Central setup (rulebook p.4–5)

Executed once, in order. Numbers match the rulebook's numbered diagram.

1. Place the **Market strip** between the two players.
2. Separate all **common cards** (cards with _no deck icon_) into seven decks by suit:
   `PERSON`, `CARGO`, `SHIP`, `ALLY`, `DISCOVERY/ENCOUNTER`, `INCIDENT`, `LOCATION`.
3. Set the Location deck aside. **Shuffle the other six.** The four **Market decks**
   (PERSON, CARGO, SHIP, ALLY) go facedown in a row above the Market strip.
4. The **Encounter deck** goes facedown above that row, turned sideways.
5. Place the **Incident deck** facedown on one side of the Market strip.
6. Keep the spot on the **opposite** side free; it is the **Junk pile**.
7. Flip the top card of **every Market deck** faceup beneath the strip. → the _Market offer_.
8. Sort the Location deck by each card's bottom position indicator into **Starting Locations**
   and **Advanced Locations**. The Advanced pile is **shuffled** and laid facedown under the
   Market, turned 90° relative to the strip.
9. Shuffle the Starting pile. Take **one** Starting Location **unseen** and put it on **top** of
   the Advanced pile. From now on this combined stack is "the **Location deck**".
10. Turn **3 further Starting Locations** faceup in a row extending away from the
    Location deck → the **Neutral Zone** (3 slots). **Return all remaining Starting Locations
    to the box.**
11. Take the **Stardate cards for the current mode** (2-player game → cards marked "2-PLAYER";
    Cadet Training → the two cards marked "Cadet Training"). Sort by sequence number with **#1
    on top**, highest at the bottom. Place faceup near the Market. Box the rest.
    _Printed set (SD01–SD05, "2-PLAYER"): Glory 5 / 7 / 7 / 6 / 5 (30 in total). #1, #2 and #4
    say "During the next player's Clean-up Step, wipe the Market (removing all tokens)"; #3 adds
    "and any neutral LOCATION with no tokens present"; #5 says "Trigger the end of the game"
    (the final card — never handed over, §3.6.4). Cadet Training uses SD06–SD07 (rules/10)._
12. Create supplies of Dilithium, Latinum, Glory within reach of both players.
13. Place the number of **Glory tokens printed on the visible (top) Stardate card** onto it.
14. Each player chooses a **Crew deck** and takes all its cards + its Crew board.
    _Recommended first game: **Picard** vs **Shran**._
    - **More Incident cards:** any crew card marked `INCIDENT DECK` is shuffled into the
      Incident deck created in step 2. (Picard and Shran have none.)
15. Create a supply of **Ship tokens** for the common ships + both chosen crew decks. Box the
    rest.
16. Give each player **3 Action tokens** and **3 Mission Completion tokens**. The remaining
    3 Action tokens go to a shared spare supply.
17. Randomly determine the **starting player**; give them the Starting Player token.

### 2.1.1 Ordering constraints the code must respect

- Step 14 (crew choice) must happen **before** step 15 (ship token supply) and **before** the
  Incident deck is finalised (crew `INCIDENT DECK` cards are shuffled in).
- Step 9 places a Starting Location on top of the Advanced pile **face down and unseen** — so
  the 4th Location revealed during play is a Starting Location, and everything after is Advanced.
- Step 13 seeds Glory _from the supply_ onto Stardate #1.

## 2.2 Player setup (rulebook p.6–7)

Per player, in order:

1. Place the **Crew board** to the left of your player area. **Choose Basic or Advanced side**
   — independently of your opponent. Place **3 Specialty markers** on the `0` space of the
   Research / Influence / Military tracks.
   - Recommended: Basic for your first games and first game with each deck.
   - **Basic side:** keep only one Mission Completion token; the other two go back in the box.
     (Basic side → 1 mission; Advanced side → 3 missions.)
2. Sort your Crew deck using each card's **position indicator** (printed along its bottom edge).

   | Indicator             | Goes to               |
   | --------------------- | --------------------- |
   | `INCIDENT DECK`       | central Incident deck |
   | `DEPLOYED`            | Fleet Area            |
   | `CONTROLLED LOCATION` | Location Area         |
   | `DEVELOPMENT`         | Development pile      |
   | `RESERVE`             | Reserve deck          |
   | `AVAILABLE`           | Draw deck             |
   | `DISCARD`             | Discard pile          |

   No indicator is printed on the **Captain card**, nor on a **Status card** if the crew has one.
   Cards marked `INCIDENT DECK` were already shuffled into the Incident deck in central setup.

3. The **Captain card** sits just right of the Crew board. The space **above** the Captain stays
   free — that is the **Duty Officer** slot.
4. A crew with a **Status card** puts it above the Crew board. _(Picard & Shran have none;
   Burnham has "Inert Dilithium".)_
5. Shuffle all `AVAILABLE` cards into a facedown **Draw deck**, below your Captain card.
6. Place all `DEVELOPMENT` cards **faceup** in a pile above your Crew board → the
   **Development pile** (public, unordered, freely inspectable).
7. Shuffle all `RESERVE` cards into a facedown **Reserve deck**, on top of the Development pile,
   rotated sideways.
8. Place any `CONTROLLED LOCATION` cards faceup to the right of your Duty Officer slot →
   the **Location Area** (your top row).
9. Place any `DEPLOYED` cards faceup to the right of your Captain → the **Fleet Area**
   (your middle row). For each deployed `SHIP`, put its matching Ship token **on the card itself**.
10. Place any `DISCARD` cards faceup as your starting **Discard pile**, at the far side of your
    Staging Area.
11. Your personal resource pool starts with **1 Dilithium, 1 Latinum and 1 Glory**, all taken
    from the **supply** (the Glory does not come off the Stardate card).
12. Place the number of **Away Team tokens printed on your Captain card** onto that card.
    Box the rest. Each player uses a distinct colour.
13. **Draw 5 cards** as your opening hand; 5 is also your normal hand size.
    _(Burnham: draw 6 — see `11-crew-decks.md`.)_

Whoever holds the Starting Player token goes first.

## 2.3 Player area layout (three rows)

```
┌ Crew board ┐  ┌ Status card (if any) ┐
│ RESEARCH   │
│ INFLUENCE  │   Development pile  + Reserve deck (sideways, on top)
│ MILITARY   │
└────────────┘
                 [ DUTY OFFICER ]  [ LOCATION AREA ────────────────────► ]   (top row)
                 [ CAPTAIN      ]  [ FLEET AREA ───────────────────────► ]   (middle row)
                 [ DRAW DECK    ]  [ STAGING AREA ─────────────► ] [ DISCARD ]  (bottom row)
                        ▲
                  Captain's Log is tucked *under* the Captain card
```

- **Location Area** = top row, right of the Duty Officer slot. Controlled LOCATIONs.
- **Fleet Area** = middle row, right of the Captain. Deployed SHIPs and `ONGOING` cards.
- **Staging Area** = bottom row, right of the Draw deck. Cards played this turn.
- **Captain's Log** = under the Captain card. Permanently out of play but still scores.
- With more than one Duty Officer, shift the Location Area right to make room.

## 2.4 Central layout

```
        [ENCOUNTER deck, sideways]
        [PERSON][CARGO][SHIP][ALLY]   ← facedown Market decks
 [INCIDENT]  ══════ MARKET STRIP ══════  [JUNK]
        [ person ][ cargo ][ ship ][ ally ]   ← faceup Market offer (4 cards)

        [LOCATION deck] [NZ 1] [NZ 2] [NZ 3]   ← Neutral Zone, 3 slots

        [STARDATE #n ... #1]  ← faceup pile, #1 on top, Glory on top card
```
