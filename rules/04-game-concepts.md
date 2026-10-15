# 4. Core Concepts: Decks, Cycling & Resources

## 4.1 Deck cycling and enlisting (p.14)

This procedure runs when **your deck is empty** at a moment you need it — either to **draw a
card**, or because some operation touches the **top card of your Draw deck** (drawing, discarding
or merely looking at it all count):

1. **Shuffle your Discard pile** to form a new Draw deck.
2. **Enlist a Reserve**: without looking, put your Reserve deck's **top card** onto the
   fresh Draw deck, so it sits **on top**.
3. If your **Reserve deck is empty**, you **may instead enlist a Development** (see §4.2).
4. **Continue drawing.** The newly enlisted card is the next card you draw.

Consequences:

- Your deck **grows by one each reshuffle**.
- The enlisted card is **guaranteed to be the next card drawn** after the reshuffle.
- If your deck cycles **multiple times** in one draw sequence (or across different steps), you
  enlist **multiple cards** — one per cycle.
- "Your deck" always means **your Draw deck**. Reserve deck, opponent decks etc. are always
  named explicitly.

## 4.2 Development cards (p.14, 30)

The Development pile is **faceup, public, unordered** and freely inspectable by you.

**Enlist a Development:**

- Normally available **only when you reshuffle and your Reserve deck is already empty**.
- Choose any one Development card, pay the **development cost** on its black strip, and put it
  on the freshly shuffled Draw deck as its **top card**.
- **You cannot enlist a Development if you cannot fully pay/perform its cost.** (Costs can be
  more than resources — e.g. "take an INCIDENT".)
- Exception: an effect that **explicitly** grants a Development enlist ignores the Reserve
  condition — cards may still be left in your Reserve deck.

> **Edge case (p.14):** if the Development's cost adds a card to your hand (e.g. take an
> INCIDENT), that card counts against your hand size immediately — so you may end up **not
> drawing** the newly enlisted card, which remains on top of your deck.

## 4.3 Resources (p.8, 30, 33)

Three resource types: **Dilithium `[DIL]`**, **Latinum `[LAT]`**, **Glory `[GLO]`**.

### 4.3.1 Gaining

- **Dilithium / Latinum** → take from the **supply**.
- **Glory** → normally comes off the **topmost Stardate card**; after a Resolution has been
  triggered it comes from the **supply**.
- Gaining more Glory than the topmost Stardate card holds: take all of it, hand the emptied
  Stardate card to the inactive player, refill the next Stardate card
  from the supply, and **continue gaining**. (See `03-turn-structure.md` §3.6.4.)

### 4.3.2 Spending

Return the indicated tokens from your pool to the supply.

**If you cannot pay, you cannot resolve the operation.**

**Glory substitution:**

| Paying for  | Glory equivalence |
| ----------- | ----------------- |
| 1 Latinum   | 1 Glory           |
| 2 Dilithium | 1 Glory           |

- **No change is given.** Spending 1 Glory for a 1-Dilithium cost wastes the extra Dilithium.
- **No other conversions** between resource types are permitted unless a card explicitly says so.
- _(Burnham exception: while her Inert Dilithium Status card is in play, she **cannot** spend
  Glory as Dilithium. See `11-crew-decks.md`.)_

### 4.3.3 Stealing

`steal [resource]` takes resources **from your opponent's pool**.

- If the opponent has fewer than required, steal **as much as you can** (possibly zero).
- **You cannot steal a different type instead.**
- **Stealing is not gaining.** REACTIONs that trigger "when you gain a resource" **do not fire**
  on a steal.

### 4.3.4 Unlimited supply

Dilithium, Latinum, Glory and Action tokens are **not meant to be limited**. Model as unbounded
integers; the physical `×5` tokens are a counting convenience only.

## 4.4 Actions (p.31)

- Base **3 actions per turn**; reset to exactly 3 during Clean-up.
- `gain an [action]` → take an extra Action token (4th, 5th, …) available side up.
- Excess tokens gained during a turn are returned to the supply at Clean-up.
- Spending: place an available token **on the card**, spent side up.
- **No available token → the operation cannot be used.**
- An Action token **on a card never blocks that card's REACTION or ACTIVATION** — it is only a
  reminder of what you spent actions on.

## 4.5 Secret vs. public information (p.21)

**Secret:**

- Your hand (from your opponent).
- The order of cards in any facedown deck (yours, theirs, and the common decks).
- The contents of the common facedown decks.
- **Your Captain's Log is visible to you, but not to your opponent.**

**Public:**

- Open to both players: Junk pile, Discard piles, Development piles and beamed cards; also the
  fact that each Log exists.
- Which cards make up the common decks overall (a reference list in the box gives every common
  card's suit, traits, skill and focus icons).

> **Implementation:** the Captain's Log is asymmetrically visible — own-visible, opponent-hidden.
> The Discard pile is fully public and **order does not matter** (you may look through it freely).
