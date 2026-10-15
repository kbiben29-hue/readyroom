# TODO 10 — Endgame detection & final scoring

**Depends on:** `05`, `06`, `09`.
**Estimate:** half a day.

Implements `rules/03` §3.1, `rules/07` §7.4 and `rules/12` §12.9–12.11, §12.27–12.29.

---

## 1. The Burn

- [ ] Check after **every primitive**, inside `run()` (`rules/12` §12.11):
      `if (zones['INCIDENT_DECK'].length === 0) -> burn`.
- [ ] `burn(state)`:
  ```
  count[seat] = INCIDENT cards owned by seat in: HAND + DISCARD + DRAW + LOG
                (explicitly NOT Reserve — rules/03 §3.1)
  if count[0] !== count[1]: winner = argmin(count); result = { kind: 'BURN', winner }
  else: goto finalScoring()
  ```
- [ ] **The Burn overrides a pending Resolution**, including during the extra turns.
- [ ] **Cadet mode: the Burn means you lose** (`rules/10` §10.2).
- [ ] Note that INCIDENT cards in the **Incident deck itself** and in the **Junk pile** aren't
      owned by anyone; don't count them.

## 2. Resolution

- [ ] Set `resolutionTriggered = true` when the **last** Stardate card empties.
- [ ] From that moment: **all Glory comes from the supply** (`rules/12` §12.10) — including
      Clean-up Glory placement. One global flag, checked in `gainResource` and in the Clean-up
      `GLORY_PLACEMENT` substep.
- [ ] The final Stardate card is **not** handed over and **not** refilled (`rules/03` §3.6.4).
- [ ] Extra-turn budget (`docs/state-machine.md` §6):
  ```
  extraTurns = (turnsTaken[0] === turnsTaken[1] ? 0 : 1) + 2
  ```
  Decrement at each turn end; at 0 → final scoring.
- [ ] Three tests: triggered on the starting player's turn; on the second player's turn; and a
      Burn occurring **during** the extra turns (Burn wins).

## 3. Final scoring

- [ ] `src/engine/scoring.ts` — `score(state, seat): ScoreBreakdown`.
- [ ] **Step 0:** remove all cards in the **Reserve deck** and **Development pile** from
      consideration (`rules/07` §7.4).
- [ ] Then sum, **in this order** (so the breakdown reads well in the UI):

  | #   | Component                                        | Source                                            |
  | --- | ------------------------------------------------ | ------------------------------------------------- |
  | 1   | Glory tokens in pool                             | 1 VP each                                         |
  | 2   | Away Team + Ship tokens on **neutral** Locations | 1 VP each. **Neutral only** — not controlled ones |
  | 3   | `ENDGAME` operations on **in-play** cards        | resolve each                                      |
  | 4   | Printed VP on **all owned cards**                | hand, deck, discard, log, in play, beamed         |
  | 5   | Focus icons × track multiplier                   | **0 if no mission completed**                     |
  | 6   | Completed mission VP                             | **Advanced board side only**                      |

- [ ] **Step 3 gotcha:** a card **not in play** (logged, still in the deck) contributes its
      **printed VP** but its `ENDGAME` operation is **not evaluated** (`rules/12` §12.28).
- [ ] **Asterisk VP:** if `vpAsterisk`, the card's `SPECIAL` operation defines its value, and it
      applies **even out of play**. Resolve those in step 4.
- [ ] **Step 5:** `highestMultiplierReached(track) × countFocusIcons(seat, specialty)`. Use the
      **multiplier value**, not the step index (`rules/07` §7.1.4). **Skip the entire step if
      `completedMissions === 0`** (`rules/12` §12.27).
- [ ] **`WILDCARD` counts as no trait during scoring** — call every trait query with
      `allowWildcard: false` (`rules/12` §12.12).
- [ ] Higher total wins; **on a tie, both players win** (`rules/07` §7.4).

## 4. Score breakdown for the UI

- [ ] Return a structured breakdown, not a number:
  ```ts
  interface ScoreBreakdown {
  	total: number
  	glory: number
  	neutralTokens: { count: number; vp: number }
  	endgame: { card: CardInstanceId; label: string; vp: number }[]
  	printedVp: { card: CardInstanceId; vp: number }[]
  	focus: {
  		specialty: SpecialtyId
  		multiplier: number
  		cards: number
  		vp: number
  	}[]
  	missions: { index: number; vp: number }[]
  	missionsCompleted: number
  	focusSuppressed: boolean // true when missionsCompleted === 0
  }
  ```
- [ ] **Surface `focusSuppressed` prominently** in the end screen — "You completed no missions,
      so 14 Focus icons scored 0 VP" is the single most instructive thing the app can tell a new
      player.

## 5. Cadet Training benchmarks

- [ ] In Cadet mode, show the benchmark band (`rules/10` §10.4): ≥70 / ≥100 / >120.

---

## Definition of Done

- [ ] Burn test: player A has 2 INCIDENTs across hand+discard+deck+log, B has 3 → A wins.
- [ ] Burn test: an INCIDENT sitting in A's **Reserve deck** does **not** count.
- [ ] Burn test: equal counts → falls through to final scoring.
- [ ] Resolution test for each of the three cases in §2.
- [ ] Scoring test: a logged card with an `ENDGAME` operation contributes printed VP but **0**
      from its ENDGAME.
- [ ] Scoring test: `missionsCompleted === 0` → the entire Focus block is 0, and
      `focusSuppressed` is true.
- [ ] Scoring test: tokens on a **controlled** Location score 0; the same tokens on a **neutral**
      Location score 1 each.
- [ ] Scoring test: Basic board side → mission VP is **not** added; Advanced → it is.
- [ ] The rulebook's p.25 worked example reproduces **29 VP** once those cards are transcribed.
