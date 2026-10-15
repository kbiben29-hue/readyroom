# TODO 06 — Setup & the turn loop

**Depends on:** `05`. **Blocks:** `08`, `10`, `15`.
**Estimate:** 1 day.

Implements `rules/02` and `rules/03`.

---

## 1. Setup

- [ ] `src/engine/setup.ts`:
  ```ts
  export interface SetupConfig {
  	mode: 'TWO_PLAYER' | 'CADET'
  	players: { deck: DeckId; boardSide: 'BASIC' | 'ADVANCED' }[]
  	seed: number
  }
  export function setup(config: SetupConfig): GameState
  ```
- [ ] Follow `rules/02` §2.1 **in order**. The order matters for RNG determinism — changing the
      order of shuffles changes every game with the same seed.
- [ ] Ordering constraints to respect (`rules/02` §2.1.1):
  - crew decks chosen **before** the Incident deck is assembled (crew `INCIDENT_DECK` cards are
    shuffled in);
  - crew decks chosen **before** the Ship token supply is built;
  - the Location deck is **1 unseen Starting Location on top of the shuffled Advanced pile**
    (step 9) — so the 4th Location revealed is a Starting one and all later ones are Advanced;
  - unused Starting Locations go to the **box**, not back into the deck.
- [ ] Stardate filtering by `mode`: `2P` cards for two-player, the two `CADET` cards for Cadet
      Training (`rules/10` §10.1).
- [ ] Seed Glory onto Stardate #1 **from the supply** (step 13).
- [ ] Player setup per `rules/02` §2.2, including:
  - Basic side ⇒ `missionTokens = 1`; Advanced ⇒ `3`;
  - starting pool of **1 DIL + 1 LAT + 1 GLO from the supply** (not from the Stardate card);
  - `awayTeamsTotal` from the Captain card;
  - deployed SHIPs get their Ship token **on the card** (`shipTokenAt = ON_CARD`);
  - **draw 5** (or 6 for Burnham — route it through the `handSize` modifier, don't special-case).
- [ ] Assert at the end of setup: every card of both chosen decks plus all commons is in exactly
      one zone, and the total count matches `rules/01` §1.3. Throw on mismatch.

## 2. Phase machine

- [ ] `src/engine/phases.ts`:
  ```ts
  export function beginTurn(state): GameState // -> RESUPPLY
  export function advancePhase(state): GameState // RESUPPLY -> CONTROL -> ACTION -> CLEANUP -> next turn
  ```
- [ ] Phases push `PHASE_STEP` frames onto the same stack the effects use. Do **not** run phases
      outside the stack machine — a Resupply operation can open a REACTION window, and the window
      must be able to interrupt.

### 2.1 Resupply Step (`rules/03` §3.3)

- [ ] Collect every `RESUPPLY` operation on your in-play cards, **excluding beamed**
      (`rules/12` §12.5).
- [ ] Emit `ORDER_OPERATIONS` **only if more than one is pending**.
- [ ] Offer an "auto — order doesn't matter" shortcut when the engine can prove independence
      (the pending effects touch disjoint resources and read no shared counts). **Start with a
      conservative prover**: if all pending effects are pure `GAIN_RESOURCE`/`DRAW`, auto-resolve.
- [ ] All mandatory unless wrapped in `MAY`.
- [ ] The Staging Area is empty at this point; assert it in dev builds.

### 2.2 Control Step (`rules/03` §3.4)

- [ ] `securedLocations(state, seat)`.
- [ ] If empty → advance immediately, **no prompt**.
- [ ] Else emit a `CHOOSE_LOCATION` with a **Skip** option (taking control is a _may_).
- [ ] On selection, run `TAKE_CONTROL` (`todo/08` §4). **At most one per Control Step.**
- [ ] **Do not fire the Location's RESUPPLY operation** — Resupply has passed
      (`rules/12` §12.18). Regression-test this explicitly.

### 2.3 Action Step (`rules/03` §3.5)

- [ ] Reset nothing here — actions were reset during the previous Clean-up.
- [ ] Accept `PLAY_CARD`, `ACTIVATE`, `COMPLETE_MISSION`, `END_ACTION_STEP` intents.
- [ ] `PLAY_CARD`: move the card to the Staging Area **first**, then push the chosen PLAY
      operation. Order matters — some operations reference "this card in play".
- [ ] After the PLAY operation completes, emit `CARD_PLAYED` **and** `PUT_INTO_PLAY`
      (`rules/08` → put into play: _after_ for a play).
- [ ] If the operation moved the card (deploy / log / promote), respect that; otherwise it stays
      in Staging (`rules/03` §3.5.4).
- [ ] `ACTIVATE`: verify the card is in play, **not** in Staging, **not** beamed, and **not**
      exhausted; exhaust it, then push the operation.
- [ ] **Unused actions are simply lost** at step end — but expose `unusedActions` because some
      CLEAN-UP operations reward them (`rules/03` §3.5.1). Capture the count **before** resetting.

### 2.4 Clean-up Step (`rules/03` §3.6)

Six substeps, each a `PHASE_STEP` frame:

- [ ] **`OPERATIONS`** — every `CLEANUP` operation in play, **including Staging Area cards**
      (`rules/12` §12.3), excluding beamed. Same ordering choice as Resupply.
- [ ] **`STARDATE`** — if `player.heldStardate`, resolve its effect (wipe Market, and possibly
      the Neutral Zone), then **return the card to the box** and clear `heldStardate`.
- [ ] **`GLORY_PLACEMENT`** — move 1 Glory from the current Stardate card onto a chosen Market
      card. From the **supply** if `resolutionTriggered`. **Route through the
      `cleanupGloryPlacement` modifier hook** (Burnham replaces this entirely).
  - If this empties the Stardate card, run the handoff (`rules/12` §12.9).
- [ ] **`DISCARD`** — move all Staging Area cards to Discard; then emit an optional
      `CHOOSE_CARDS(min: 0, max: hand.length)` for voluntary hand discards.
- [ ] **`DRAW`** — `drawCards(state, seat, max(0, handSize - hand.length))`. **Hand size is not a
      hand limit** (`rules/12` §12.21).
- [ ] **`REFRESH`** — refresh all your exhausted in-play cards; set `actions.available = 3`,
      `spent = 0`; clear action tokens from cards; return excess gained tokens.
- [ ] Then hand the turn to the other player.

## 3. Turn bookkeeping

- [ ] `turnsTaken: [number, number]`; increment at turn end.
- [ ] On `resolutionTriggered`, compute the extra-turn budget
      (`docs/state-machine.md` §6). Write the three tests listed there.
- [ ] Check the Burn after **every** primitive, not per phase (`rules/12` §12.11).

## 4. Cadet Training mode wiring

- [ ] `mode === 'CADET'` changes (`rules/10`):
  - Stardate cards: the two `CADET` cards;
  - **all Glory from the supply**, always;
  - an extra Clean-up substep **before** `GLORY_PLACEMENT`: **wipe one Market card of your
    choice** (return its tokens, junk it, refill);
  - ignore effects that remove Glory from a Stardate card outside your Clean-up Step;
  - the virtual opponent (see `todo/15`);
  - **the Burn = you lose**, immediately.
- [ ] Keep these as **conditionals on `state.mode`**, not a forked turn loop. One loop, two modes.

---

## Definition of Done

- [ ] `setup({mode:'TWO_PLAYER', players:[picard, shran], seed:1})` produces a state where:
  - the Market offer has 4 cards, one per suit;
  - the Neutral Zone has 3 Starting Locations;
  - the Location deck is `1 Starting + all Advanced`;
  - both hands have 5 cards;
  - both pools are `{DIL:1, LAT:1, GLO:1}`;
  - Stardate #1 is on top with its printed Glory;
  - every card is in exactly one zone and the totals match `rules/01` §1.3.
- [ ] `setup` with the same seed twice produces **deep-equal** states.
- [ ] A turn advances Resupply → Control → Action → Clean-up → opponent's Resupply with no stuck
      states, using a deck of fake no-op cards.
- [ ] Regression test: taking control in the Control Step does **not** fire the Location's
      RESUPPLY operation that turn.
- [ ] Clean-up test: 7 cards in hand with hand size 5 → you draw 0, discard 0 (unless you choose
      to), and end with 7.
- [ ] Cadet mode: the extra "wipe one Market card" substep runs every Clean-up.
