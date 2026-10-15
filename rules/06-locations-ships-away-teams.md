# 6. Locations, Ships, Away Teams & Beaming

## 6.1 Locations (p.18)

- `LOCATION` cards are **never added to your deck**.
- A Location in your **Location Area** is **controlled**: you may use its Skill icons, table
  operations, Focus icon, VP, etc.
- A Location in the **Neutral Zone** is controlled by **neither** player: **its operations and
  icons cannot be used by anyone**.
- Most Crew decks include their own `CONTROLLED LOCATION` cards (start in play) and/or Locations
  played from hand. Once played, these behave like any other controlled Location.

### 6.1.1 The Neutral Zone

- **3 slots**, refilled from the Location deck whenever a Location leaves.
- The Location deck = 1 unseen **Starting** Location on top of the shuffled **Advanced**
  Locations (setup step 9).
- Locations leave the Neutral Zone by being **taken control of**, or by being **wiped** by a
  Stardate card (only if they have **no tokens** on them).

### 6.1.2 Taking control

See `03-turn-structure.md` §3.4 for the Control Step, and `08-keywords-reference.md` →
`take control` for the general procedure.

Key points:

- Dismiss all Ships present, remove all Away Teams.
- **The other player gains 1 Glory per token removed/dismissed** (their own tokens only).
- Move the card into your Location Area, then **resolve its CONTROL operation**.
- This **counts as putting the card into play** for REACTION purposes.

Three routes to control:

1. Control Step, from a **secured** neutral Location.
2. **Playing a LOCATION from your hand** (its PLAY operation performs the procedure).
3. A card effect granting control **directly from the Location deck**.

### 6.1.3 Locations cannot be…

- **beamed** (from hand) to other cards — never, under any circumstances.
- **dismissed** — unless explicitly instructed by the Location itself.
- **recalled** — unless explicitly instructed by the Location itself.

_(Reason: most Locations cannot enter your deck.)_

A Location **can** be **logged** or **destroyed**. In both cases: Ships present are **dismissed**
and Away Teams are **returned to their owners' Captain cards**.

## 6.2 Ships (p.18, 33)

### 6.2.1 Deploying

- Only a `SHIP` or a card with the **`ONGOING`** trait can be deployed.
- Deploying relocates the card: **Staging Area → Fleet Area**.
- Deploying a `SHIP` also puts that ship's **Ship token** (pulled from the supply) **onto the card**.
- The card's **table operations become immediately available**.
- If a `duplicate` effect would deploy a non-SHIP, non-`ONGOING` card, the keyword has **no effect**.

### 6.2.2 Warping

Once deployed, you can **warp** a SHIP: place or move its Ship token to either

- a **LOCATION you control**, or
- a **LOCATION in the Neutral Zone**.

Rules:

- A SHIP may warp **from one Location to another**.
- **No limit** on how many Ship tokens can be at one Location.
- **Staying in place is not warping** — an effect requiring a warp cannot be satisfied by not moving.
- **A Ship token that has left its SHIP card never goes back onto it.** The only reset is to
  dismiss or recall the SHIP, then play it and deploy it anew.
- While its token sits at a Location, the SHIP **together with every card beamed to it** counts
  as **"at" that Location**, which in turn is **"that ship's LOCATION"**.

> **Unimplemented location:** some cards refer to a Location called **the Badlands**, which does
> not exist in this box. Treat any such reference as unsatisfiable in the base game.

### 6.2.3 Dismissing ships

Dismissing a deployed SHIP:

1. Return its **Ship token to the supply**.
2. Move its **card to your Discard pile**.
3. Move **all cards beamed to it** to your Discard pile as well.

## 6.3 Away Teams (p.19, 33)

- Your Captain card prints how many **Away Team tokens** you start with — these sit on the
  Captain card as your **personal pool**.
- Each player uses a **distinct colour**.

### 6.3.1 Placement rules

Legal destinations for an Away Team:

- any **LOCATION you control**;
- a **Neutral Zone LOCATION**, **unless the opponent's Ship tokens there outnumber yours**.

Notes:

- **You do NOT need a Ship token present** to send an Away Team (unless the effect explicitly
  requires it) — thematically they arrive by unrepresented shuttle.
- The blocking condition counts **Ship tokens only**, not Away Teams. **Tying** your opponent's
  Ship count is enough to unblock.
- The restriction applies only to **neutral** Locations. A Location you control is always a
  legal target.
- Some card effects explicitly **override** the blocking restriction (e.g. Iconian Gateway).

### 6.3.2 Token economy

- **Out of Away Team tokens** but need to place more? **Pull them off other cards** at will
  until the placement is done.
- Away Teams removed for **any other reason** (Location logged, opponent attack, taking control,
  …) return to your **personal pool** on your Captain card.
- **Your total number of Away Teams is never reduced during play.**

## 6.4 Beaming (p.19, 29)

**Beam** = **tuck a card faceup under** a host card — typically a deployed `SHIP`, occasionally
a `LOCATION` — leaving **just its suit and trait icons showing**. The tucked card comes from your
**hand** unless the effect names a different source.

### 6.4.1 What beamed cards do and don't do

| Property                          | Beamed card                 |
| --------------------------------- | --------------------------- |
| Considered **in play**?           | ✅ Yes                      |
| **Traits** count?                 | ✅ Yes                      |
| **Suit** counts?                  | ✅ Yes                      |
| **Skill icons** count?            | ❌ **No**                   |
| **Table operations** usable?      | ❌ No (covered)             |
| Fires in **Resupply / Clean-up**? | ❌ No (explicitly excluded) |
| **Public information**?           | ✅ Yes                      |

### 6.4.2 Beaming rules

- **No limit** on the number of cards beamed to a single card.
- Some effects restrict **which suit** can be beamed.
- **A `LOCATION` can never be beamed to another card.**
- A `SHIP` **can** be beamed — even to another SHIP ("tractor-beaming").
- **Cascade:** if the host card is **dismissed / recalled / logged / destroyed**, all cards
  beamed to it suffer **the same fate**.
- The reverse is not true: dismissing a beamed card leaves the host unaffected.
- When a SHIP warps, its beamed cards travel with it.

### 6.4.3 The beaming/mission interaction — the key trade-off

> **When a beamed card contributes to completing a mission, it is DISMISSED.** Other in-play
> cards (deployed SHIPs, LOCATIONs, Staging Area cards) contributing to that mission are **not**.

This is the central tension of beaming: beamed cards are cheap, persistent trait-fuel, but they
are consumed by the missions they enable.

### 6.4.4 Beaming vs. self-logging

The rulebook calls this out explicitly (p.21): many cards end their PLAY operation with "Log
this card." Such a card is **never in play at a moment when trait-counting is evaluated** —
the count happens either before it was played or after it was logged. **If you want its traits
counted, beam it instead of playing it.**
