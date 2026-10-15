# TODO 15 — Opponent modes

**Depends on:** `06`, `12`, `13`, `14`.
**Estimate:** Cadet ½ day · hot-seat 1 day · Bot **blocked**.

---

## 1. Cadet Training mode — ship this first

Fully specified in `rules/10`. **No opponent AI required.**

- [ ] `mode: 'CADET'` setup: the two `CADET` Stardate cards (5 Glory each).
- [ ] **All Glory from the supply, always** (`rules/10` §10.2 rule 1).
- [ ] **Ignore** effects that remove Glory from a Stardate card outside your Clean-up Step
      (rule 2).
- [ ] **The virtual opponent** (rule 3) — implement as a **query interceptor**, not a fake player:
  ```ts
  // In CADET mode, any query about opponent-owned quantities:
  opponentResource(res)        -> 1
  opponentAwayTeamsAt(loc)     -> 1
  opponentShipTokensAt(loc)    -> 0      // the one explicit exception
  opponentCardsInPlay(filter)  -> 1
  opponentHandSize()           -> 1
  ```
  - So "remove up to 2 opponent Away Teams for 1 Glory each" yields **1** Glory.
  - "Steal 3 Dilithium" steals **1**.
  - **Securing still needs 3 of your tokens** (they have 1 Away Team there, so 3 ≥ 3 and
    3 ≥ 1+2 ✓).
- [ ] **Opponent forced to take an INCIDENT → skip it, you gain 1 Glory** (rule 4). Important:
      this means **the Incident deck does not deplete from your attacks** in Cadet mode.
- [ ] **The Burn = you lose** (rule 5).
- [ ] Clean-up gains an extra substep **before** Glory placement: **wipe one Market card of your
      choice** (`rules/10` §10.3).
- [ ] The fixed timeline (`rules/10` §10.3): Stardate 1 empties on turn 5; turn 6 Clean-up begins
      with a full Market + Neutral Zone wipe and refills Stardate 2 with 5 Glory from the supply;
      Stardate 2 empties on turn 10; game ends after turn 11.
      **Implement this as the natural consequence of the Stardate rules, then assert the timeline
      in a test** — if a normal game with these cards doesn't produce that schedule, something
      else is wrong.
- [ ] **Burnham variant:** place **1** Dilithium, not 2 (`rules/10` §10.3, `rules/11` §11.6.1 #9).
- [ ] Show the benchmark bands at the end: ≥70 / ≥100 / >120.

## 2. Hot-seat two-player

- [ ] `viewerSeat` follows `activeSeat`, with a **pass-the-device interstitial** on change.
- [ ] `project(state, viewerSeat)` hides: the opponent's hand, facedown deck order, the
      opponent's Captain's Log contents (`rules/04` §4.5).
- [ ] **REACTION windows belonging to the inactive player need the interstitial too** — they fire
      on the active player's turn (`rules/08` → REACTION). This is the fiddly part of hot-seat:
      handle `choice.seat !== viewerSeat` as a first-class flow, not an edge case.
- [ ] A "reveal everything" debug toggle behind a dev flag.

## 3. The Bot — **blocked**

> **Blocker B2 (`docs/open-questions.md`):** the solo Bot rules are **not in this rulebook**.
> The box contains 12 Automated Command cards and 2 Solo cards, but their rules are in a separate
> solo rulebook. The `SURPRISE` trait and the `botActions` field on Stardate cards are solo-only.

When you obtain the solo rulebook:

- [ ] Transcribe the 12 Automated Command cards + 2 Solo cards (they already have a data file
      stub in `docs/data-model.md` §8).
- [ ] The Bot is a **deterministic card-driven automaton**, not a search AI — it draws an
      Automated Command card and follows it. That fits the existing engine: implement it as a
      `ChoicePolicy` that resolves `PendingChoice`s from the Bot's current command card.
  ```ts
  type ChoicePolicy = (state: GameState, choice: PendingChoice) => Selection
  ```
- [ ] The `botActions` count on Stardate cards throttles the Bot's turn — already captured in the
      Stardate data (`todo/12` Pass 3).
- [ ] The `SURPRISE` trait becomes live.
- [ ] Implement the solo-only **Directive** cards (STCC position "Solo Campaign" / "Solo
      Challenge"; they need the Bot and its Reinforcement pile). Use the latest STCC errata —
      the vendored Conspiracy text predates it:
  - [ ] `1DIR01/2` CONSPIRACY
  - [ ] `1DIR02/2` REINFORCE
  - [ ] `2DIR01` / `2DIR02` (box 2)

## 4. A heuristic opponent (optional, later)

If you want a two-player game without a second human and without the Bot rules:

- [ ] Implement a `ChoicePolicy` with simple heuristics: prefer gaining cards with Skill icons
      matching your best track; take control when secured; never spend Glory if any other payment
      exists (it's 1 VP); complete any completable mission immediately.
- [ ] **This is a house AI, not the game's Bot.** Label it clearly in the UI so you don't confuse
      it with the official solo mode.
- [ ] The `autoPlay` fuzz policy from `todo/07` §6 is the skeleton — a heuristic policy is the
      same interface with better choices.

---

## Definition of Done

- [ ] A Cadet Training game completes in exactly the `rules/10` §10.3 timeline (asserted by test).
- [ ] In Cadet mode, "steal 3 Dilithium" steals exactly 1; "remove up to 2 opponent Away Teams"
      yields exactly 1 Glory.
- [ ] In Cadet mode, an attack that would give the opponent an INCIDENT gives **you 1 Glory** and
      **does not** deplete the Incident deck.
- [ ] In Cadet mode, triggering the Burn produces a **loss**.
- [ ] Hot-seat hides the opponent's hand and Log, and handles an inactive-player REACTION window
      with a correct interstitial.
- [ ] Bot mode is either absent or clearly marked "requires the solo rulebook".
