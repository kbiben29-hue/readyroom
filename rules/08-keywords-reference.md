# 8. Keywords in Detail — authoritative reference

> **Precedence (rulebook p.8): if this section contradicts any other chapter, THIS section is
> correct.** Implement the engine against this file.

Each entry lists the rule, then an `id:` suggestion for the effect DSL (see
`docs/effect-dsl.md`).

---

## `areas` — Location / Fleet / Staging / etc.

See **`in play`** below.

---

## `beam` · `id: BEAM`

Tuck a card **faceup under** a target card (typically a `SHIP`), leaving **just its suit/trait
icons showing**. The tucked card comes **from your hand** unless the effect names another source.

- **No limit** to how many cards may be beamed to one card.
- Some effects specify which **suit** may be beamed.
- **A `LOCATION` can never be beamed to another card, under any circumstances.**
- A `SHIP` **may** be beamed, even to another `SHIP` (tractor-beaming).
- A beamed card **is in play**, but **its table operations cannot be used** and **its Skill
  icons cannot be counted**. (Its **traits and suit DO count.**)
- If the host card is **dismissed / recalled / logged**, the beamed cards suffer **the same effect**.
- **Beamed cards are public information.**
- A beamed card contributing to a **mission** is **dismissed** on completion (see `07`, §7.2.1).

---

## `deploy` · `id: DEPLOY`

Shift a card that is **already in play** out of the **Staging Area** and into the **Fleet Area**.

- Only a **`SHIP`** or a card with the **`ONGOING`** trait (`CARGO` / `DIRECTIVE` / `ENCOUNTER`)
  can be deployed.
- Deploying a `SHIP` also puts that ship's **Ship token** (pulled from the supply) **onto the card**.
- The card's **table operations become immediately available**.
- Via `duplicate`, if a non-`SHIP`/non-`ONGOING` card would be deployed → **no effect**.

---

## `destroy` · `id: DESTROY`

**The card goes back in the box** and is gone for good — nothing can retrieve it, and **it no
longer belongs to you** (so it does **not** score).

Contrast with `log`: logged cards still score.

- Cards **beamed to** a destroyed card are **also destroyed**.
- Ships present at a destroyed `LOCATION` are **dismissed**; Away Teams **return to their
  owners' Captain cards**.

---

## `discard` · `id: DISCARD`

Move one card **from your hand** to your **Discard pile**. If the effect restricts which card,
it must match.

- **Always a cost.** If you cannot do it, you cannot choose to resolve the effect.
- **`discard` never interacts with cards in play** — that is `dismiss`.
- Some effects discard from the **top of a specified deck** instead of hand; the card still goes
  to the Discard pile.

---

## `dismiss` · `id: DISMISS`

An **in-play** card is sent to your **Discard pile**.

- Cards **beamed to** the dismissed card also go to the Discard pile.
- If the dismissed card **was itself beamed** to another card, **the host is unaffected**.
- **Dismiss can never target a card in your Staging Area.**
- **A `LOCATION` cannot be dismissed**, unless the Location itself explicitly instructs it.
- An **Action token** sitting on a dismissed card is set down beside the Discard pile as a
  reminder. **The spent action is not refunded.**
- Dismissing a **`SHIP`**: return its Ship token to the supply, dismiss the card, and dismiss
  all cards beamed to it.
- If an `ATTACK` dismisses an opponent's in-play card, it goes to **their** Discard pile.

---

## `draw` / `draw from discard` · `id: DRAW`, `DRAW_FROM_DISCARD`

**Draw**: the **top card of your Draw deck** goes to your hand. You may hold any number of cards (no hand limit).

Drawing from an empty Draw deck triggers deck cycling:

1. **Reshuffle your Discard pile** into a new Draw deck.
2. **Enlist a Reserve** if you can; **otherwise, optionally enlist a Development** (only if the
   Reserve deck is already empty **and** you pay the Development's cost).
3. **Continue drawing** — the newly enlisted card is drawn next.

**Draw from Discard**: look through your **entire Discard pile** (it is faceup and order is
irrelevant) and draw a card matching the effect's restrictions.

- **`draw` never touches in-play cards** — use `recall` for that.

---

## `drone`, `assimilate`

The rulebook lists these words but gives them no meaning or effect yet.

Reserved for a future (Borg) expansion. **Not used in this box.** Implement as a no-op that
logs a warning.

---

## `duplicate` · `id: DUPLICATE`

Choose a card of the named suit(s) in one of the named places — the **Market**, a **Discard
pile**, or **your Log** — then **carry out one of that card's operations, whichever kind the
duplicating effect points to** (most often a PLAY operation).

- **You do NOT pay an additional action**, even if the duplicated operation shows `[action]`.
  (You still paid whatever the duplicating effect itself cost.)
- **You must still meet any Specialty restriction** of the target operation.
- **Self-reference redirection:** if the duplicated operation refers to its own card by name or
  as "this card" (most commonly "Log this card"), **it is redirected to the card that did the
  duplicating**, where possible.
- **Impossible sub-effects are skipped.** E.g. duplicating an effect that says "deploy" with a
  `PERSON` as the resolving card → the deploy is ignored (a PERSON cannot be deployed), while
  the rest of the operation resolves.
- **`duplicate` cannot itself be duplicated.** Duplicating an operation that contains
  `duplicate` results in **no effect** for that sub-effect — no chains.

_Rulebook examples:_ using **Orb of Time** to duplicate either **Denobulans** operation results
in **Orb of Time** being logged. Using **Odo** to duplicate **Cloaking Device** refreshes up to
3 `SHIP`, draws 2, junks 1 — and the deploy is ignored because Odo is a `PERSON`.

---

## `enlist a Development` · `id: ENLIST_DEVELOPMENT`

Choose any card in your Development pile, pay its **development cost**, and it becomes the new
**top card of your Draw deck**.

- The pile is **unordered and freely inspectable**; choose any card.
- Normally done when **reshuffling after the Reserve deck has emptied**.
- If an effect **explicitly** allows enlisting a Development, you may do so **even with a
  non-empty Reserve deck**.
- **You cannot enlist if you cannot fully pay/perform the cost.**

---

## `enlist a Reserve` · `id: ENLIST_RESERVE`

Unseen, your Reserve deck's **top card** becomes your Draw deck's **top card**.

- **Empty Reserve deck → nothing happens.** This keyword never falls back to enlisting a
  Development.

---

## `exhaust` · `id: EXHAUST`

Rotate an **in-play** card sideways (Fleet Area, Location Area, Duty Officer, or Captain — as
specified), as if an ACTIVATION or REACTION had been resolved.

- Its **ACTIVATION/REACTION stays locked** until your Clean-up Step ends (refresh), or until an
  effect explicitly refreshes it earlier.
- **Exhausting is always a cost.** If you have no legal card to exhaust, you cannot resolve the
  operation.

---

## `find [name/suit/trait]` · `id: FIND`

Look through your **hand, Discard pile, Draw deck and Reserve deck** until you find a card with
the indicated name / suit / trait, and **add it to your hand** (if it isn't there already).

- **You do not have to take the first match** — keep looking until you run out of places.
- Some effects restrict which zones you may search (most commonly **"excluding Reserve"** →
  hand + Discard + Draw deck).
- Several suits/traits named → every card matching **any** of them is a candidate; pick one.
- **Any `find [trait]` also permits finding a `WILDCARD` card.**
- **Afterwards, shuffle any facedown deck you looked through** (Draw deck, Reserve deck).

---

## `force` · `id: FORCE`

"Force your opponent to X" means the opponent **must resolve X**, but **every choice inside X is
theirs**.

| Wording                                       | Who chooses                |
| --------------------------------------------- | -------------------------- |
| "Dismiss an opponent `SHIP`"                  | **You** choose which ship  |
| "**Force** your opponent to dismiss a `SHIP`" | **They** choose which ship |

- If the forced effect contains a choice ("either A or B"), they **must pick one they can fully
  resolve**, if able.
- **A forced effect they are wholly unable to resolve is simply skipped.**

---

## `free play [suit / trait / INCIDENT / named card]` · `id: FREE_PLAY`

Select a matching card **from your hand** (unless stated otherwise) and **play it as normal**,
except: if the selected PLAY operation is prefixed `[action]`, **you do not spend an action**.

- **Free playing does not make any other cost free.**
- **It does not grant you an extra action** if the operation you chose didn't need one.

---

## `gain [a card]` · `id: GAIN_CARD`

See `05-cards-suits-traits.md` §5.4.1. Summary:

- Take either that suit's **faceup Market card** or the **unseen top card of its deck**.
- Destination is up to you: **top of Draw deck** or **Discard pile**.
- Multiple suits → choose one. **No cards of that suit in the Market → no effect.**
- Selecting a **faceup** card also gives you **any resource tokens on it**, then the slot refills.
  If that deck is empty, the slot stays empty.
- `gain from the Junk` → pick any card of the indicated suit(s) from the Junk pile.

---

## `gain resources` · `id: GAIN_RESOURCE`

- **Latinum / Dilithium** → from the **supply**.
- **Glory** → from the **topmost Stardate card**; from the **supply** once a Resolution has
  been triggered.

**Stardate overflow procedure:** if you must gain more Glory than remain on the top Stardate card:

1. Gain as many as you can (emptying it).
2. **Give the Stardate card to the inactive player.**
3. **Fill the new topmost Stardate card with its indicated Glory from the supply**, then
   **continue gaining**.
4. **If this was the last Stardate card**, leave it in place and **continue gaining from the
   supply**.

Resource tokens are **not limited**.

---

## `gain / spend an [action]` · `id: GAIN_ACTION`, `SPEND_ACTION`

- **Gain** → take an additional (4th, 5th, …) Action token from the supply, available side up.
  Not limited; use proxies beyond 6.
- **Spend** → flip one of your available tokens to its spent side and set it on the card.
  **No available token left → that operation is unusable.**

---

## `in play` / `from play` · `id: ZONE_IN_PLAY`

**Counts as in play for you:**

- the **Location Area** (each `LOCATION` you control)
- Cards in your **Fleet Area** — every deployed `SHIP` and `ONGOING` card
- Your **Duty Officer(s)**
- Your **Captain** (and your **Status card**, if any)
- Cards in your **Staging Area** — _in play_, but their **table operations are not available**,
  and they move to the Discard pile at Clean-up
- Cards **beamed** to other cards — _in play_, but table operations unavailable, and **dismissed
  if their suit/trait icons contribute to a mission**

**NOT in play:** the cards in your **hand**, **Draw deck**, **Discard pile**, **Reserve deck**
and **Development pile**, plus everything in your **Captain's Log**.

> **Your opponent's cards are in play for their effects, but not for yours**, unless explicitly
> stated otherwise.

---

## `junk a card (from the Market)` · `id: JUNK`

Choose a **faceup Market card** and place it in the **Junk pile**; reveal the next card of that
deck to refill. Empty deck → leave the slot empty.

- **You may never junk a card that has one or more resource tokens on it.**
  (Such a card **can** still be **wiped** by a Stardate card.)

---

## `log` · `id: LOG`

Place the card **underneath your Captain card**.

- Cards **beamed to** the logged card are **also logged**.
- Logging a `LOCATION`: **Ships present are dismissed**, **Away Teams return to their owners'
  Captain cards**.
- Logged cards are **out of play** and **cannot be interacted with** unless a card says otherwise.
- **They still score VP.**
- **You may always look at your own Log; other players may not.**
- "**Log this card**" in a PLAY operation → the card moves to the Log **instead of** staying in
  the Staging Area.
- An Action token on a logged card moves near the Captain card as a reminder only.
- If an `ATTACK` logs one of the opponent's cards, it goes into **their** Log.

---

## `market` · `id: ZONE_MARKET`

Card text saying "the Market" refers **only to the faceup offer** — normally four cards, very
occasionally fewer. The facedown decks are never included.

---

## `promote (a PERSON to Duty Officer)` · `id: PROMOTE`

Select a `PERSON` from the indicated position (**hand**, **Staging Area**, or **Discard pile**)
and place it in your **Duty Officer slot**.

- Its **table operations are immediately available**.
- A PLAY operation may instruct the resolving card to promote **itself** — it moves immediately
  and does **not** stay in the Staging Area.
- An Action token on a promoted card **moves along with it**. It **never blocks** any REACTION
  or ACTIVATION — including ones whose cost is a further action.
- **Duty Officer limit is normally 1.** Some effects raise it (outright, or conditionally on the
  extra PERSON's traits).
- **If you ever exceed your limit, you must dismiss Duty Officers until you meet it.**
  Otherwise, you **may** dismiss one when promoting a new one.
- With more than one Duty Officer, shift the Location Area right to make room.
- Via `duplicate`, if a **non-`PERSON`** would be promoted → **no effect**. A non-PERSON can
  never be promoted.

---

## `put a card (somewhere)` · `id: PUT`

Move a card that meets any stated restrictions to the destination the effect names (e.g. top
of your deck, Staging Area, …). Source is **your hand** unless the effect says otherwise.

- **Always a cost.** If you cannot do it, you cannot resolve the effect.

---

## `put into play` · `id: EVENT_PUT_INTO_PLAY`

Events that count as **putting a card into play**:

| Event                                                                        | Moment it counts                                   |
| ---------------------------------------------------------------------------- | -------------------------------------------------- |
| The card is **played**                                                       | right **after** the chosen PLAY operation finishes |
| You take control of a **neutral `LOCATION`**                                 | right **before** its CONTROL operation             |
| A `PERSON` is **promoted** to Duty Officer, coming from hand or Discard pile | on promotion                                       |
| A card is **beamed** onto another card, coming from hand or Discard pile     | on beaming                                         |
| Another card's effect **explicitly puts it into your Staging Area**          | on placement                                       |

A **trait or suit** is put into play when a card carrying it is put into play.

> Note the timing asymmetry: for a **played** card it is **after** the PLAY operation; for a
> **controlled Location** it is **before** the CONTROL operation. REACTIONs keying on
> "put into play" must respect this.

---

## `REACTION operations` · `id: TRIGGER_REACTION`

- **Never mandatory to trigger.** But once you start resolving one, **all its effects are
  mandatory** (unless "may").
- A REACTION **can interrupt another operation** at the point its condition was met, and then
  the interrupted operation resumes.
- **Same-card trigger:** a card may carry a REACTION keyed on "after [doing something]". If that
  card's own **PLAY or CONTROL operation** does that thing — and that operation also lands the
  card in play (deployed, or its Location taken control of) — **the REACTION is usable at once**.
- **Several cards** answering **one trigger**: resolve as many as you wish, sequenced however
  you like.
- Resolving a REACTION **exhausts** its card.

---

## `recall` · `id: RECALL`

An **in-play** card returns **to your hand**.

- **A recalled card can be played again**, potentially a second time on the same turn.
- Cards **beamed to** the recalled card are **also recalled**.
- If the recalled card **was beamed** to another card, the host is **unaffected**.
- **A `LOCATION` cannot be recalled** unless the Location itself says so.
- An Action token on a recalled card is set aside; **the action is not refunded**.

---

## `recrystallize` · `id: RECRYSTALLIZE`

**Burnham only.** Shifts **1 Dilithium** off her Inert Dilithium Status card into her **personal
pool**. Found on three of her cards: Reno, Tilly, Stamets. See `11-crew-decks.md`.

---

## `refresh` · `id: REFRESH`

Rotate an exhausted in-play card upright, making its ACTIVATION/REACTION available again **this
turn**.

- **An Action token on the card stays on it** and does **not** prevent reuse.

---

## `return an INCIDENT` · `id: RETURN_INCIDENT`

Place the `INCIDENT` **facedown on the bottom of the Incident deck**.

- An Action token on it moves near the Incident deck as a reminder.

> **Implementation:** returning an Incident makes the Burn _further away_. Taking one brings it
> closer. The Incident deck is a shared clock.

---

## `scan` · `id: SCAN_N`, `SCAN_FOR_TRAIT`

Full text in `05-cards-suits-traits.md` §5.4.2–5.4.4. Key rulings:

**`scan # of [suit]`**

- Fewer than `#` cards left → look at as many as you can.
- No cards of that suit remaining in the Market **and** its deck → **no effect**.
- Multiple suits → choose **one deck to look at**; **no switching after you have looked**, and
  the **other suits' faceup cards are off-limits**.
- Unselected looked-at cards go to the **bottom** of the deck, in any order.
- `scan including the Junk` → after looking at `#` cards, you may **also** search the whole Junk
  pile; choose from all three sources.

**`scan for [trait]`**

- Market first; then a chosen deck, revealing until found; then another deck; …
- Found-in-deck → gain it and **shuffle the other revealed cards back** into that deck.
- **Not found in any of the four suits → gain nothing, receive 2 Glory instead.**
- Multiple traits → choose one; **you cannot change your mind once you start looking through a
  Market deck**.
- `scan including the Junk` → check the Junk **after the Market but before the decks**. You may
  take a matching Junk card; declining proceeds to the decks as normal.

**Both:** selecting a faceup Market card also gives you its resource tokens, then the slot refills.

> **REACTIONs worded "when you gain a [particular card]" DO trigger from a `scan`.**

---

## `secured` · `id: QUERY_SECURED`

A neutral `LOCATION` is **secured by you** as long as you have:

- **≥ 3 tokens** (Away Teams + Ship tokens combined) there, **and**
- **≥ 2 more tokens than your opponent** there.

Relevant to the **Control Step** and to a small number of card effects that let you take control
of a secured Location immediately.

---

## `send / remove [away team]` · `id: SEND_AWAY_TEAM`, `REMOVE_AWAY_TEAM`

Add Away Team tokens to, or take them off, a target `LOCATION` (**neutral or controlled**) —
as many as the effect says.

- **You do not need a Ship token there** unless the effect explicitly requires it.
- **Away Teams are blocked from any Location at which the opponent's Ship tokens outnumber
  yours.** (Ties are fine. Some cards explicitly override this.)
- If you run out of Away Team tokens and want to place more, **freely remove them from other
  cards**.
- Away Teams removed for any reason (Location logged, an opponent's attack, …) return to your
  **personal pool on your Captain card**.
- **Your total Away Team count is never reduced during play.**

---

## `spend resources` · `id: SPEND_RESOURCE`

Return the indicated tokens from your pool to the supply.

- **Cannot pay → cannot resolve the operation.**
- **Glory substitution:** 1 Glory = **1 Latinum**, or 1 Glory = **2 Dilithium**. **No change
  is given.**
- **No other conversions** unless a card explicitly permits it.

---

## `steal [dilithium / latinum / glory]` · `id: STEAL`

Take the indicated type and amount from your opponent.

- Opponent has fewer → **steal only as much as you can** (possibly none).
- **You cannot steal a different type instead.**
- **Stealing is not gaining** — REACTIONs on gaining a resource do **not** fire.

---

## `take [a card]` · `id: TAKE`

The named card goes **straight to your hand** (`gain`/`scan` work differently).

Common uses: **take an `INCIDENT`** (top of the Incident deck, unseen); **take the top
`DISCOVERY`** (or look at 2 and take one).

- **REACTIONs worded "when you gain a [particular card]" do NOT fire on a `take`.**
- An `ATTACK` making your opponent take an `INCIDENT` → the Incident deck's top card goes
  straight to **their** hand.

---

## `take control` · `id: TAKE_CONTROL`

Always refers to a `LOCATION`.

**If it is a neutral LOCATION:**

1. **Dismiss all Ships present** and **remove all Away Teams**.
2. **Your opponent gains 1 Glory for each of _their_ tokens removed/dismissed.**

**Then, in all cases:** 3. **Move the card into your Location Area.** 4. **Resolve its CONTROL operation.** This **counts as putting the card into play** for REACTION
purposes.

Routes: the **Control Step**; **playing a LOCATION from hand** (its PLAY operation performs the
above); or an effect granting control **directly from the Location deck**.

---

## `token` · `id: TOKEN`

Collective term for **Away Team tokens and Ship tokens**. See `send/remove [away team]` and `warp`.

---

## `trigger [a LOCATION's CONTROL operation]` · `id: TRIGGER_CONTROL`

Run the **CONTROL operation** of the chosen `LOCATION` (normally one you already control) again,
exactly as it would resolve on gaining control.

- For REACTIONs, **no control was taken** — this is not a take-control event.
- **Tokens (Ships, Away Teams) and beamed cards at the Location are unaffected.**
- If the Location also has a PLAY operation (i.e. it is from a Crew deck, not the Location deck),
  **still only resolve the CONTROL operation**.
- **Triggering does not require spending an action** unless the text explicitly says so.

---

## `warp` · `id: WARP`

Place or move a deployed `SHIP`'s Ship token to **a `LOCATION` you control** or **a `LOCATION`
in the Neutral Zone**.

- A SHIP may warp **from one Location to another**.
- **No limit** on Ship tokens at one Location.
- **Staying in place is not warping.**
- **A Ship token never goes back onto its SHIP card** after leaving it — short of the SHIP being
  dismissed/recalled, then played and deployed anew.
- A SHIP at a Location takes **all cards beamed to it** along; the Location is "that ship's
  `LOCATION`".
- Some cards reference **the Badlands**, a Location **not present in this box**.
