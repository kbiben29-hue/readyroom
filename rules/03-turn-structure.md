# 3. Game Structure & Turn Structure

## 3.1 Game structure and end conditions (p.8)

Play **strictly alternates**. A player resolves **all four steps** of their turn before passing.

### End trigger A — Resolution

The **last Stardate card empties** → a _Resolution_ is triggered.

1. Keep going until the round is complete — the second player ends their turn, so both players
   have taken the same number of turns.
2. Then **each player takes one more turn**.
3. Then final scoring.

After a Resolution has been triggered, **all Glory is gained from the supply**, not from a
Stardate card. The empty final Stardate card stays in place as a reminder and is never handed
to the inactive player.

### End trigger B — The Burn

The **Incident deck empties** → the game ends **immediately**.

- The player owning **fewer INCIDENT cards** wins. Count INCIDENTs in **hand + Discard pile +
  Draw deck + Captain's Log**. **Do not count the Reserve deck.**
- On a tie → proceed to final scoring.
- The Burn can fire during the extra turns after a Resolution. **The Burn takes priority** and
  ends the game immediately.

> **Implementation:** check "Incident deck is empty" as a _continuous_ condition immediately
> after any effect that draws from it (take an INCIDENT). It is not a step-boundary check.

## 3.2 Turn structure

```
RESUPPLY  →  CONTROL  →  ACTION  →  CLEAN-UP
```

---

## 3.3 Resupply Step (p.9)

Trigger **every RESUPPLY operation you have in play**, in **an order of your choosing**.

- All effects are **mandatory** unless prefixed with "may".
- **Beamed cards are excluded** (they are tucked; their operations are unavailable).
- Cards in the Staging Area are empty at this point (cleared during Clean-up), so in practice
  RESUPPLY fires from Captain, Status card, Duty Officer(s), Fleet Area and Location Area.
- Usually nothing fires on turn 1.

---

## 3.4 Control Step (p.9)

### 3.4.1 Secured

A **neutral LOCATION is _secured_ by you** if, at that Location, you have:

- **3 or more tokens**, AND
- a lead of **2 or more tokens** over your opponent's count.

"Tokens" = Away Teams + Ship tokens, in any combination.

### 3.4.2 Taking control

If you have **one or more secured neutral Locations** during this step, you **may take control
of exactly one of them**:

1. For every token of theirs at that Location (Away Team or Ship), your **opponent gains 1 Glory**.
2. **All Away Teams there** (both players') are **removed** → returned to their owner's Captain
   card. **All Ships there** (both players') are **dismissed** → card to its owner's Discard
   pile, standee back to the supply.
3. The Location card leaves the Neutral Zone and joins **your Location Area**; its **CONTROL
   operation** resolves right away.
4. Reveal the next Location deck card into the empty slot so the Neutral Zone is back at
   **three** cards (skip if the deck is exhausted).

> Note the asymmetry: **only the opponent** gains Glory for tokens lost (step 1). You gain
> nothing for your own sacrificed tokens.

> A Location's **RESUPPLY operation does not fire on the turn you take control** — Resupply
> already happened (Step 1) before the Control Step.

> Only **one** Location may be taken per Control Step. Certain card effects can take control of
> a secured Location at other times (see `take control` in `08-keywords-reference.md`).

---

## 3.5 Action Step (p.10–11)

### 3.5.1 The action budget

- You have **3 actions** per turn (more if an effect grants extras).
- **There is no limit on the number of operations you resolve** — only on actions.
- An operation prefixed with the `[action]` icon **costs one action**. Mark it by putting an
  Action token, spent side showing, onto that card.
- No available Action token → **you cannot resolve that operation**.
- **Unused actions are lost.** Some CLEAN-UP operations reward unused actions.

### 3.5.2 Optional vs. mandatory

- Once an operation resolves, every effect in it must be carried out — the only optional parts
  are those introduced by **"may"**.
- What counts as a **cost**: paying resources; moving cards to a named destination (Discard,
  top of deck, Staging Area, …); and, in any sentence shaped "do _A_ to do _B_", the _A_ part.
- **If a cost cannot be paid, the operation cannot be resolved at all.**
- **If a non-cost benefit cannot be resolved (a useless benefit), skip it** — the rest still
  resolves.

### 3.5.3 ATTACK operations

- Any operation prefixed with `ATTACK` negatively affects your opponent.
- When an `ATTACK` makes the opponent pick between effects, the pick is restricted to an
  effect they are **able to carry out completely**.
- The presence of `ATTACK` **does not** by itself make an operation cost an action.

### 3.5.4 PLAY operations

- You may play **any number of cards from hand** during your Action Step.
- Playing a card = put it in your **Staging Area**, pick **one** of its PLAY operations
  (**white/grey** strip) and resolve that one **in full**.
- A card none of whose PLAY operations could be resolved **is not playable** at all.
- After resolving, the card **stays in the Staging Area** unless an effect moves it (deploy,
  log, promote, …). Its **suit and traits remain in play** for the rest of the turn — usable
  for missions and trait-counting.
- **"THIS CARD CANNOT BE PLAYED"**: a few cards have no PLAY operation. You cannot move them
  from hand to Staging Area — but you can still beam, discard, promote, etc. them.

### 3.5.5 Table operations

Usable on cards **in play but not in the Staging Area and not beamed** — i.e. a deployed SHIP,
a controlled LOCATION, a PERSON in the Duty Officer slot, your Captain, your Status card.

| Type           | Strip | When                                                                                                                                                                                      | Exhausts? |
| -------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **ACTIVATION** | blue  | Anytime in **your** Action Step — before, after or between card plays, but **never interrupting the resolution of another operation**                                                     | **Yes**   |
| **PASSIVE**    | blue  | **Always in effect.** If conditional, may trigger any number of times, on **either** player's turn. Works even while the card is exhausted. **Always mandatory**, even when unfavourable. | No        |
| **REACTION**   | blue  | When its stated condition is met — **even outside your Action Step, even on the opponent's turn**                                                                                         | **Yes**   |

- Exhausting = rotate the card sideways. Refreshing = rotate it back.
- An exhausted card's ACTIVATION/REACTION is unavailable until refreshed.
- A card with multiple ACTIVATION operations: **choose one**.

### 3.5.6 Promoting

Almost every PERSON has a table operation, but **you cannot use it by playing the card**. A
PERSON must be **promoted to Duty Officer** (usually via an ability on your starting SHIP)
before its table operation becomes usable. Default Duty Officer limit: **1**.

### 3.5.7 Completing missions

Any mission whose GOAL is met right now may be completed in your Action Step — **several** in one
turn if you qualify.
**No action cost.** See `07-missions-specialties-scoring.md` §7.2.

---

## 3.6 Clean-up Step (p.12–13)

Substeps, in order:

```
CLEAN-UP OPERATIONS → STARDATE RESOLUTION → GLORY PLACEMENT → DISCARD, DRAW & REFRESH
```

### 3.6.1 Clean-up operations

Each **CLEAN-UP operation on your in-play cards** fires once, in whatever order you pick.

- Mandatory unless "may".
- **Beamed cards excluded.**
- **Cards in your Staging Area are INCLUDED** — unlike Resupply, where the Staging Area is empty.

### 3.6.2 Stardate resolution

If you were handed a Stardate card during the opponent's previous turn, **resolve its effect now**.

- **Wipe the Market** = return all resource tokens from Market cards to the supply, then move
  all 4 Market cards to the **Junk pile**. Reveal one replacement for each wiped card, if possible.
- If it also says **wipe the Neutral Zone**: move every neutral LOCATION **with no tokens on it**
  (no Ships, no Away Teams) to the Junk pile, and draw replacements. Neutral Locations **with
  one or more tokens are untouched**.
- Once resolved, the Stardate card **goes back in the box**.

Both Market and Neutral Zone are refilled immediately, before the next substep.

### 3.6.3 Glory placement

Move **1 Glory** off the current Stardate card onto a Market card of your choice (**any of the
four**). There is no cap on how many tokens one Market card can carry.

- If this empties the current Stardate card, hand it to the other player exactly as in §3.6.4.
- After a Resolution has been triggered, this Glory comes **from the supply**.

### 3.6.4 Emptying a Stardate card — the handoff rule _(applies at any time, not only Clean-up)_

Whenever taking Glory empties the topmost Stardate card:

1. **Immediately give that Stardate card to the inactive player** (whoever is _not_ taking the
   current turn). They place it in their Staging Area as a reminder.
2. **The Stardate card now on top receives its printed Glory amount, paid from the supply.**
3. **Continue gaining Glory** if the effect still requires more.

The receiving player resolves it in **their** Clean-up Step's Stardate Resolution substep.

**Exception — final Stardate card:** do **not** hand it over and do **not** refill it. It stays
in place as the marker that a **Resolution** has been triggered. Continue gaining Glory from
the supply.

### 3.6.5 Discard cards

- Your whole **Staging Area** goes to your Discard pile.
- Optionally, also discard as many of the cards still in your hand as you like (zero is fine).
- Location Area, Fleet Area and Duty Officer(s) **stay in play**.

### 3.6.6 Draw to hand size

Draw until you reach your **current hand size** (normally **5**; Burnham **6** while Inert
Dilithium is in play).

- If you already have **≥** hand size cards, you **do not discard** — you simply draw none.
- **Hand size is not a hand limit.** There is no hand limit in this game.
- If your Draw deck empties mid-draw → see deck cycling in `04-game-concepts.md` §4.1, then
  **continue drawing**.

### 3.6.7 Refresh

- **Refresh all your exhausted cards in play** (Captain, Duty Officer(s), deployed SHIPs,
  controlled LOCATIONs, …).
- **Reset your Action tokens to 3**, available side up. Return any excess tokens gained this
  turn to the supply.

### 3.6.8 SPECIAL operations

A few cards carry `SPECIAL` operations (purple strip) for situations a PASSIVE cannot express.
They are self-explanatory and **always state when they must be resolved**. Notably, a card with
an **asterisk in its VP icon** uses its SPECIAL operation to define its scoring — and that
applies **even if the card is not in play**.
