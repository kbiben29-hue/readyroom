# TODO 08 — Market, acquisition, Locations, ships & Away Teams

**Depends on:** `05`, `06`, `07`.
**Estimate:** 1 day.

Implements `rules/05` §5.4–5.6 and `rules/06`.

---

## 1. Market structure

- [ ] Four decks + four offer slots (`MARKET_DECK:<suit>`, `MARKET_OFFER:<suit>`).
- [ ] `refillMarket(state, suit)` — reveal the next card of that deck into the offer slot.
      **If the deck is empty, leave the slot empty** (`rules/08` → gain). An empty slot is a
      legal, permanent state; every Market code path must tolerate it.
- [ ] Resource tokens live on the offer card (`CardInstance.resourceTokens`).
- [ ] "The Market" in card text **always** means the four faceup cards, never the decks
      (`rules/08` → market). Encode this in the `MarketQuery` type so it can't be got wrong.

## 2. `GAIN_CARD`

- [ ] Choice 1: faceup offer card **or** top of the deck (unseen).
  - Present the deck option as "top of the PERSON deck (unknown)". Do **not** reveal it first.
- [ ] Reveal the selection, then Choice 2: **top of Draw deck or Discard pile**
      (`CHOOSE_DESTINATION`).
- [ ] If a faceup card was taken: **transfer its resource tokens to the player's pool**, then
      refill the slot.
- [ ] Multiple suits listed → `CHOOSE_SUIT` first.
- [ ] **No cards of that suit anywhere (offer empty and deck empty) → no effect** (skip silently,
      log a `SKIPPED` entry).
- [ ] `includeJunk` variant: add every matching Junk card to the candidate set.
- [ ] Emit `CARD_GAINED`.

## 3. `SCAN_N`

- [ ] `CHOOSE_SUIT` if multiple suits. **Once chosen, it is locked** — no take-backs, and the
      other suits' faceup cards become ineligible (`rules/08` → scan).
- [ ] Reveal `min(n, deck.length)` cards **to the acting player only**.
- [ ] Candidates = the revealed cards **∪** the faceup offer card of that suit (**∪** the Junk
      pile if `includeJunk`).
- [ ] Gain one; `CHOOSE_DESTINATION`.
- [ ] **Unselected revealed cards go to the BOTTOM of the deck**, in an order the player chooses
      (`ORDER_CARDS`). Auto-resolve when ≤1 card remains.
- [ ] If the offer card was taken, transfer tokens and refill.
- [ ] Emit `CARD_GAINED` — REACTIONs on gaining **do** fire from a scan (`rules/08` → scan).

## 4. `SCAN_FOR_TRAIT`

Four-step search (`rules/05` §5.4.3):

- [ ] 1. Any faceup Market card with the trait → choose one, gain it, done.
- [ ] 2. (`includeJunk` only) Search the Junk pile **after the Market, before the decks**. Taking
      from Junk is optional; declining proceeds.
- [ ] 3. `CHOOSE_SUIT`, then reveal from the top of that deck until a match is found.
  - Found → gain it, **shuffle the other revealed cards back** into that deck.
  - Not found (deck exhausted) → those cards go back; pick another of the remaining suits.
- [ ] 4. Not found in any of the four → **gain nothing, gain 2 Glory instead**.
- [ ] **You cannot change which trait you scan for once you have started looking through a deck**
      — emit `CHOOSE_TRAIT` once, up front.
- [ ] `matchTrait` here uses `allowWildcard: true` (it's a benefit).

## 5. `JUNK` and `WIPE_MARKET`

- [ ] `JUNK`: **refuse any offer card bearing resource tokens** (`rules/08` → junk). Filter them
      out of the candidate set with a `disabled` reason so the player understands.
- [ ] `WIPE_MARKET`: return **all** tokens from **all four** offer cards to the supply, junk all
      four, refill all four. **Wipe ignores the token restriction** (`rules/12` §12.19).

## 6. Neutral Zone & Locations

- [ ] 3 slots; `refillNeutralZone(state)` after any departure.
- [ ] `WIPE_NEUTRAL_ZONE`: junk only Locations with **zero** tokens (Ships **and** Away Teams,
      either player's); refill (`rules/12` §12.20).
- [ ] `TAKE_CONTROL(locIid)`, per `rules/08` → take control:
  1. If neutral: **dismiss all Ships present** (each to its owner's Discard, token to supply);
     **remove all Away Teams** (to owners' Captain cards).
  2. **The other player gains 1 Glory per token _they_ had there.** You gain nothing for yours.
     Route through `gainResource` so the Stardate handoff can fire.
  3. `moveCard(loc, LOCATION_AREA:seat)`.
  4. Emit `PUT_INTO_PLAY` **before** resolving the CONTROL operation
     (`rules/08` → put into play).
  5. Push the CONTROL operation.
  6. Emit `LOCATION_CONTROLLED`.
  7. `refillNeutralZone`.
- [ ] `TRIGGER_CONTROL(locIid)`: resolve **only** the CONTROL operation. **Does not** emit
      `LOCATION_CONTROLLED` or `PUT_INTO_PLAY`; **does not** move tokens or beamed cards;
      **does not** cost an action unless the text says so (`rules/08` → trigger).
- [ ] Playing a `LOCATION` from hand: its PLAY operation contains a `TAKE_CONTROL` node targeting
      itself. Same code path.
- [ ] Locations **cannot** be dismissed, recalled or beamed (`rules/06` §6.1.3). Enforce it in
      `DISMISS`/`RECALL`/`BEAM` `canResolve`, with an `unless the Location itself instructs it`
      escape flag on the node.

## 7. Ships & warping

- [ ] `DEPLOY`: Staging → Fleet; take the named Ship token from the supply onto the card
      (`shipTokenAt = 'ON_CARD'`). SHIP or `ONGOING` only; otherwise **no-op**
      (`rules/08` → deploy).
- [ ] `WARP(ship, to)`: set `shipTokenAt = locIid`.
  - Legal destinations: Locations **you control** ∪ the **Neutral Zone**.
  - **Staying in place is not warping** — exclude the current Location from the candidate set
    (`rules/12` §12.16).
  - **The token can never return to the card.** Enforce it: no code path may set
    `shipTokenAt = 'ON_CARD'` except `DEPLOY`.
  - Beamed cards travel implicitly (they're attached to the card, and "at" is derived from
    `shipTokenAt`).
  - No limit on tokens at a Location.
- [ ] `DISMISS` of a SHIP: token → supply, card → Discard, **beamed cards → Discard**
      (`rules/08` → dismiss).
- [ ] The **Badlands** is referenced by some cards but is not in this box: any
      `LocationQuery` naming it yields an empty candidate set (`rules/12` §12.30). Log a warning
      once, don't throw.

## 8. Away Teams

- [ ] `SEND_AWAY_TEAM(count, target, ignoreBlocking?)`:
  - Legal targets: controlled Locations ∪ neutral Locations where **not**
    `oppShips > yourShips` (`rules/12` §12.15). `ignoreBlocking` overrides (Iconian Gateway).
  - **No Ship presence required** unless the effect says so.
  - **If your pool is empty, you may freely pull tokens off other Locations** to complete the
    placement (`rules/08` → send/remove). Emit a `CHOOSE_LOCATION` over the Locations you have
    tokens on. Auto-resolve when only one source exists.
  - Emit `AWAY_TEAM_SENT`.
- [ ] `REMOVE_AWAY_TEAM(count, target, whose)` — removed tokens return to the **owner's** Captain
      card pool.
- [ ] `awayTeamsTotal` **never decreases** during play; assert it as an invariant after every
      primitive in dev builds.

## 9. Beaming

- [ ] `BEAM(from, filter, to, count)`:
  - **Refuse a `LOCATION` as the card being beamed — always** (`rules/08` → beam).
  - A `SHIP` **may** be beamed, even onto another SHIP.
  - Set `beamedTo = hostIid`, move to `BEAMED:<host>`.
  - No limit per host.
- [ ] `BEAMED` zone props: traits ✅, suit ✅, **skills ❌**, table ops ❌, Resupply/Clean-up ❌,
      public ✅ (`rules/12` §12.5). This is already in `zoneProps`; just make sure every query
      goes through it.
- [ ] Cascade on host dismiss/recall/log/destroy is in `moveCard` (`todo/05` §3) — verify here.

---

## Definition of Done

- [ ] `gain` with an empty offer slot **and** empty deck resolves as a no-op and logs `SKIPPED`.
- [ ] `gain` of a faceup card carrying 3 Glory transfers all 3 to the player's pool.
- [ ] `scan 2 of CARGO` with 1 card left in the deck looks at 1 and still offers the faceup card.
- [ ] `scan for KLINGON` with no KLINGON anywhere in the Market grants exactly **2 Glory**.
- [ ] `scan for X`: after choosing the SHIP deck, the PERSON faceup card is **not** a candidate.
- [ ] `junk` cannot target a Market card bearing tokens; `WIPE_MARKET` junks it anyway and
      returns the tokens.
- [ ] `TAKE_CONTROL` of a Location with 2 opponent Away Teams + 1 opponent Ship gives the
      **opponent** exactly 3 Glory, and the acting player 0.
- [ ] `TRIGGER_CONTROL` leaves tokens and beamed cards untouched and fires no
      `LOCATION_CONTROLLED` event.
- [ ] `WIPE_NEUTRAL_ZONE` spares a Location holding a single Away Team.
- [ ] A warped Ship token can never be returned to its card except via dismiss → replay → deploy.
- [ ] Sending an Away Team with an empty pool pulls one from another Location.
- [ ] Beaming a `LOCATION` is rejected in every code path.
