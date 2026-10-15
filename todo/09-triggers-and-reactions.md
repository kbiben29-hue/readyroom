# TODO 09 — Events, PASSIVEs & REACTIONs

**Depends on:** `04`, `05`, `07`.
**Estimate:** 1 day. Subtle; test heavily.

Implements `rules/08` → REACTION operations, `rules/05` §5.3 and `rules/12` §12.24–12.25.

---

## 1. The event bus

- [ ] `src/engine/resolver/events.ts` — the `GameEvent` union from `docs/effect-dsl.md` §6, each
      carrying `seat` (who caused it) and the relevant `CardInstanceId`s.
- [ ] Events are **appended to `state.eventQueue`** by primitives, never dispatched
      synchronously. `run()` drains the queue **after each primitive**
      (`docs/state-machine.md` §3).
- [ ] Rulings to bake into emission (each gets a test):
  | Action                        | Emits                                                                 |
  | ----------------------------- | --------------------------------------------------------------------- |
  | `gain`/`scan` a card          | `CARD_GAINED`                                                         |
  | `take` a card                 | **no** `CARD_GAINED` (`rules/08` → take)                              |
  | `find` a card                 | **no** `CARD_GAINED`                                                  |
  | `enlist`                      | **no** `CARD_GAINED`                                                  |
  | gain a resource               | `RESOURCE_GAINED`                                                     |
  | **steal** a resource          | **no** `RESOURCE_GAINED` (`rules/04` §4.3.3)                          |
  | play a card                   | `CARD_PLAYED` **then** `PUT_INTO_PLAY` (after the operation)          |
  | take control                  | `PUT_INTO_PLAY` **before** the CONTROL op, then `LOCATION_CONTROLLED` |
  | `TRIGGER_CONTROL`             | **neither**                                                           |
  | promote from hand/discard     | `PUT_INTO_PLAY`                                                       |
  | beam from hand/discard        | `PUT_INTO_PLAY`                                                       |
  | put into Staging by an effect | `PUT_INTO_PLAY`                                                       |

## 2. PASSIVE operations

- [ ] Collect `PASSIVE` operations from **both players'** in-play cards
      (`rules/05` §5.3: they trigger on either player's turn).
- [ ] **PASSIVEs apply even while their card is exhausted** (`rules/12` §12.25).
- [ ] **PASSIVEs are always mandatory**, even when unfavourable.
- [ ] They may trigger **any number of times**.
- [ ] Resolve them automatically, **before** offering any REACTION window for the same event.
- [ ] **Ordering when several PASSIVEs fire on one event:** the rulebook doesn't specify. Take
      the active player's PASSIVEs first, then the inactive player's; within a side, in Location
      → Fleet → Duty Officer → Captain → Status order. **Document this as a house rule in-app**
      and keep it deterministic.
- [ ] **Guard against PASSIVE loops.** A PASSIVE whose resolution re-emits its own trigger will
      spin. Track `(passiveOpRef, eventId)` pairs already resolved within a single drain and
      refuse to re-fire; log a warning if it happens.

## 3. REACTION windows

- [ ] Candidate filter — a REACTION is offerable iff its card is:
  - **in play**, and
  - **not exhausted**, and
  - **not beamed**, and
  - **not in the Staging Area** (`rules/03` §3.5.5: table ops need a table position), and
  - its `trigger` matches the event (incl. `seat` scoping), and
  - it can pay any action cost.
- [ ] Push a `REACTION_WINDOW` frame for the reacting seat. It emits `OPTIONAL_TRIGGERS`.
- [ ] Player may take **any number**, **in any order** (`rules/08` → REACTION). The window stays
      on the stack, re-offering the remaining set after each one, until they decline.
- [ ] Taking a REACTION **exhausts** its card, then pushes its effect **above the interrupted
      frame** so the interrupted operation resumes afterwards (`rules/12` §12.24).
- [ ] REACTIONs fire **on either player's turn** — so a window can open for the inactive player
      mid-way through the active player's operation. The UI must handle that
      (`docs/ui-spec.md` §4).

## 4. Self-triggering REACTIONs

`rules/08` → REACTION: when a card's own PLAY or CONTROL operation satisfies the "after …"
trigger of a REACTION printed on that same card — and that operation is what deployed it or put it
under your control — the REACTION is usable right away.

- [ ] So: a card that deploys itself and has `REACTION: after you deploy a SHIP` **can** react to
      its own deployment.
- [ ] The precondition is that the card **ended up in play** as a result — a card still sitting in
      the Staging Area cannot use its REACTION (its table ops aren't available).
- [ ] Test both: the deploying case (fires) and the stays-in-Staging case (doesn't).

## 5. Ordering multiple REACTIONs across both players

The rulebook doesn't specify cross-player priority. House rule, documented in-app:

- [ ] **The player who caused the event gets their window first**, then the other player.
- [ ] Within a player, the choice of order is theirs (that's what the window does).
- [ ] Keep it deterministic so replays are stable.

## 6. Nesting depth

- [ ] A REACTION can trigger an event that opens another REACTION window. That's legal and
      intended (the rulebook's p.23 example chains Amargosa Observatory → log Riva →
      Memory Alpha).
- [ ] **Cap nesting depth at ~20** and throw a clear diagnostic. A genuine chain is 2–4 deep;
      anything beyond that is a data bug.
- [ ] **Test the rulebook's p.23 chain explicitly** once those cards are transcribed: playing a
      DISCOVERY triggers Amargosa Observatory (gain Glory, log a card from Discard), which
      triggers Memory Alpha's REACTION on logging (gain another Glory).

---

## Definition of Done

- [ ] Every row of the §1 emission table has a passing test.
- [ ] A REACTION interrupting a 3-step `SEQ` resumes at step 2 afterwards.
- [ ] Two cards reacting to one event can be used in **either** order, and the engine offers both.
- [ ] A REACTION on an exhausted card is **not** offered; a PASSIVE on an exhausted card **is**
      applied.
- [ ] A REACTION on a Staging Area card is not offered.
- [ ] A self-deploying card with a matching REACTION can react to its own deployment.
- [ ] `steal` does not fire a "when you gain a resource" REACTION; `gain` does.
- [ ] `take an INCIDENT` does not fire a "when you gain a card" REACTION; `scan` does.
- [ ] A deliberately self-retriggering PASSIVE is caught by the loop guard, not by the browser.
