# 12. Cross-cutting Edge Cases & Rulings

Collected from across the rulebook. Each of these breaks a naive implementation. Each should
have a dedicated unit test — see `todo/16-testing.md`.

## 12.1 Cost vs. benefit

- Every effect in a resolving operation is compulsory; only "may" makes one optional.
- **Unpayable cost → the operation does not resolve at all.**
- **Benefit that cannot happen (a useless benefit) → drop just that part.**

**What counts as a cost:** paying resources · moving cards to a named destination (Discard pile,
top of Draw deck, Staging Area, …) · **the `A` part of any "do `A` to do `B`" sentence** ·
exhausting · discarding.

**Therefore the DSL must tag every node as `cost` or `benefit`**, and the resolver must:

1. **Pre-validate the entire cost set** before mutating anything.
2. **Skip** unresolvable benefits silently and continue.

**Test:** an operation "Spend 2 Dilithium: gain a CARGO and draw a card" with an empty CARGO
deck → still resolves, you still pay, you still draw; the gain is skipped.

## 12.2 Play legality is determined by resolvability

> A card is playable only if **at least one** of its PLAY operations can be resolved.

So `canPlay(card)` = ∃ a PLAY operation whose **costs and Specialty restrictions** are satisfiable.
This requires a **dry-run / simulation** of each PLAY operation's cost chain. It cannot be a
static property.

## 12.3 The Staging Area is a weird zone

| Property                 | Staging Area card                |
| ------------------------ | -------------------------------- |
| In play?                 | ✅ **Yes**                       |
| Suit & traits count?     | ✅ Yes                           |
| Skill icons count?       | ✅ Yes                           |
| Table operations usable? | ❌ **No**                        |
| Can be **dismissed**?    | ❌ **No**                        |
| Fires in **Resupply**?   | ❌ (area is empty then)          |
| Fires in **Clean-up**?   | ✅ **Yes — explicitly included** |
| End of turn              | → Discard pile                   |

## 12.4 Self-logging cards are never "in play" for counting

A card whose PLAY operation ends "Log this card" has **no moment** at which its suit/traits are
countable by another effect: counting happens before it was played, or after it was logged.
**Beam it instead if you want it counted.** (p.21)

## 12.5 Beamed cards: in play, but crippled

Traits ✅ · suit ✅ · **Skill icons ❌** · table operations ❌ · Resupply/Clean-up ❌ ·
public ✅ · **dismissed when they contribute to a mission** ✅.

Compare §12.3: Staging Area cards **do** count Skill icons; beamed cards **do not**. This is a
frequent source of bugs.

## 12.6 Cascade semantics

| Host card is… | Beamed cards… |
| ------------- | ------------- |
| dismissed     | dismissed     |
| recalled      | recalled      |
| logged        | logged        |
| destroyed     | destroyed     |

The reverse never applies: doing something to a beamed card leaves the host alone.

For a `LOCATION` that is **logged** or **destroyed**: Ships present are **dismissed**, Away
Teams **return to their owners' Captain cards**.

## 12.7 Action tokens are reminders, not locks

- A token on a card **never** blocks that card's ACTIVATION or REACTION — **not even one that
  requires an additional action**.
- Dismiss / recall / log / promote **move or set aside** the token; **the action is never refunded**.

## 12.8 "Gain" ≠ "Take" ≠ "Steal" ≠ "Enlist" ≠ "Find"

| Verb               | Source                      | Destination                | Fires "when you gain" REACTIONs? |
| ------------------ | --------------------------- | -------------------------- | -------------------------------- |
| `gain`             | Market (faceup or deck top) | top of deck **or** Discard | ✅                               |
| `scan`             | Market decks (+ Junk)       | top of deck **or** Discard | ✅                               |
| `take`             | Incident / Encounter deck   | **hand**                   | ❌                               |
| `find`             | own zones                   | **hand**                   | ❌                               |
| `enlist`           | Reserve / Development       | **top of deck**            | ❌                               |
| `steal` (resource) | opponent's pool             | your pool                  | ❌ (not a gain)                  |
| `gain` (resource)  | supply / Stardate           | your pool                  | ✅                               |

## 12.9 The Stardate handoff can fire mid-effect

Emptying a Stardate card is checked **continuously**, not at step boundaries. If a single effect
gains 4 Glory and only 2 remain:

1. Gain 2 → card empties.
2. **Hand the card to the inactive player immediately.**
3. Refill the next Stardate card from the supply.
4. **Continue gaining the remaining 2.**

If it was the **last** Stardate card: don't hand it over, don't refill, **continue from the supply**,
and a **Resolution is now triggered**.

## 12.10 Resolution changes the Glory source globally

After a Resolution is triggered, **every** Glory gain — including Clean-up Glory placement —
comes from the **supply**. Model this as a global flag `resolutionTriggered`.

## 12.11 The Burn is an immediate, continuous check

The moment the Incident deck empties, the game is over — even mid-effect, even during the extra
turns after a Resolution. It **overrides** the Resolution.

Winner = fewer owned INCIDENT cards across **hand + Discard + Draw deck + Log**. **Reserve deck
excluded.** Tie → final scoring.

## 12.12 WILDCARD is opt-in and scoped

- Substitutes for **one trait**, for **one operation or one goal**, **owner's choice**.
- Works **in and out of play**.
- Satisfies `find [trait]`.
- **Never compels** you: an attack demanding you dismiss a `CARDASSIAN` cannot force a `WILDCARD`.
- **Counts as nothing at final scoring.**

## 12.13 `duplicate` has three special behaviours

1. **No extra action cost**, even if the target operation shows `[action]`.
2. **Specialty restrictions still apply.**
3. **Self-reference redirects** to the duplicating card ("Log this card" logs the duplicator).
4. **`duplicate` cannot be duplicated** — the nested duplicate is a no-op.
5. Sub-effects impossible for the duplicating card's type are **skipped**, not fatal.

## 12.14 `force` inverts choice ownership

"Dismiss an opponent SHIP" → **you** choose. "**Force** your opponent to dismiss a SHIP" →
**they** choose, and must pick one they can **fully** resolve. Unresolvable at all → ignored.

## 12.15 Away Team placement is blocked by Ship tokens only

Blocked iff `opponentShipTokensAt(loc) > yourShipTokensAt(loc)` **and** the Location is neutral.
Away Teams do not block. **Ties do not block.** Controlled Locations are never blocked.
Some cards explicitly override.

## 12.16 Warping is one-way off the card

Once a Ship token leaves its SHIP card it can **never** return — only dismissing/recalling the
SHIP and replaying + redeploying it resets that. **Staying in place is not warping.**

## 12.17 Taking control: only the opponent is paid

Step 1 of taking control pays **1 Glory per token the opponent had there** — to the opponent.
You are paid nothing for your own losses. Both sides' tokens are cleared.

## 12.18 A Location's RESUPPLY does not fire on the turn you take it

The Control Step comes **after** the Resupply Step. (Explicit in the p.9 example.)

## 12.19 Junking vs. wiping

- **You may never junk a Market card that has resource tokens on it.**
- **A Stardate wipe removes those tokens to the supply and junks the card anyway.**

## 12.20 Neutral Zone wipes spare occupied Locations

A Stardate "wipe the Neutral Zone" junks only Locations with **zero** tokens (Ships **and** Away
Teams, either player's). Occupied Locations survive untouched.

## 12.21 Hand size is not a hand limit

You may hold any number of cards. At Clean-up you draw **up to** hand size; if you're already at
or above it, you draw nothing and discard nothing (discarding is optional).

## 12.22 Deck cycling can happen many times in one draw

Draw 6 from a 1-card deck → draw 1, reshuffle, enlist, draw, possibly reshuffle again, enlist
again… **Each cycle enlists.** Loop until the draw count is satisfied **or** the deck cannot be
refilled (empty Discard **and** empty Reserve **and** no affordable Development) — at which
point drawing simply stops.

## 12.23 Development cost can cost you the draw

If a Development's cost puts a card in your hand (e.g. take an INCIDENT) and that brings you to
hand size, you **don't draw the enlisted card** — it stays on top of your deck. (p.14)

## 12.24 REACTIONs interrupt and nest

- A REACTION interrupts at the point its condition was met, then the interrupted operation resumes.
- A card's own PLAY/CONTROL operation **can** satisfy an "after …" REACTION on that same card,
  if the card is deployed / taken control of as a result.
- Multiple cards reacting to the same condition: resolve **any number**, in **your chosen order**.
- Never mandatory to start; **fully mandatory once started**.

> **Implementation:** this demands a real **effect stack** with resumable continuations, not
> recursive function calls. See `docs/effect-dsl.md` §4.

## 12.25 PASSIVEs are mandatory and unstoppable

PASSIVE operations apply **even when the card is exhausted** and **even when unfavourable to
you**, and can trigger on **either player's turn**, **any number of times**.

## 12.26 Missions consume the beamed cards that enabled them

On completion, **dismiss every beamed card that contributed**. SHIPs, LOCATIONs and Staging Area
cards that contributed are **not** dismissed. Where several sets of beamed cards could satisfy
the goal, the player chooses which set counts.

## 12.27 No missions completed = zero Focus VP

The whole Focus-icon scoring block is skipped. This is typically a 10–25 VP swing.

## 12.28 ENDGAME only fires in play; printed VP always counts

A logged card still contributes its **printed VP** but its **ENDGAME operation is not evaluated**.
A card with an **asterisk VP** uses its `SPECIAL` operation and **does** apply out of play.

## 12.29 Reserve and Development are removed before scoring

Cards left in the Reserve deck and the Development pile **score nothing**. Everything else you
own — including Log and beamed cards — counts.

## 12.30 Unimplemented content

- `DRONE` / `ASSIMILATE` keywords: **no meaning in this box**.
- `SURPRISE` trait: **solo play only**.
- The **Badlands** Location: **not in this box** — any reference is unsatisfiable.
- Icons `BORG_COLLECTIVE`, `BORG_DRONE`, `HELMET`, `MIND_CONTROL`, `JEM_HADAR`, `VORTA`, `XB`,
  suit `MISSION`: **not used in this box**.

Implement these as recognised-but-inert so expansion data doesn't crash the engine.
