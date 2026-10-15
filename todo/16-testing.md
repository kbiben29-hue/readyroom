# TODO 16 — Testing strategy

**Depends on:** everything it tests. Start at `04`, grow continuously.

---

## 1. The rules-conformance suite — the centrepiece

**One test per numbered edge case in `rules/12-edge-cases-and-rulings.md`.** Name each test after
its section so a failure points straight at the rule:

```ts
// src/engine/__tests__/rules-12.test.ts
describe('rules/12 §12.1 — cost vs benefit', () => {
  it('pays the cost and resolves the rest when a non-cost benefit is impossible', ...);
  it('refuses the whole operation when a cost cannot be paid', ...);
});
describe('rules/12 §12.5 — beamed cards count traits but not skill icons', ...);
describe('rules/12 §12.9 — a Stardate card can empty mid-effect', ...);
// ... all 30 sections
```

- [ ] Write the test **before** or **alongside** the implementation of each rule, not after.
- [ ] A section with no test is a rule you haven't verified. Track coverage as
      `30 / 30 sections`.

## 2. Golden-game tests

- [ ] Record full `Session`s (seed + intent log) as JSON fixtures.
- [ ] Replay them and assert the **final score breakdown**, not just the total — a wrong
      component that cancels out is worse than a wrong total.
- [ ] Add a fixture every time you fix a bug: seed + the intent sequence that exposed it.
- [ ] **Reproduce the rulebook's worked examples** as golden tests once the relevant cards exist:
  | Rulebook                    | Assert                                                                                                       |
  | --------------------------- | ------------------------------------------------------------------------------------------------------------ |
  | p.9 Control example         | opponent gains 1 Glory; Enterprise-D dismissed; Away Teams returned; CONTROL op fires; **RESUPPLY does not** |
  | p.11 Activation example     | Will Riker draws the Enterprise-D from Discard                                                               |
  | p.14 Enlist example         | 2 draws → reshuffle → enlist Beverly Crusher → she is the next card drawn                                    |
  | p.14 Development example    | the INCIDENT taken as a cost fills the hand, so the enlisted card stays on top of the deck                   |
  | p.16 Scan-for-trait example | choosing SHIP then PERSON; the gained card goes to Discard                                                   |
  | p.20 Mission example        | PEACE NEGOTIATIONS completes; the **3 beamed cards are dismissed**, the SHIP is not                          |
  | p.22–23 full Action Step    | the 4-action turn resolves, ending with the Amargosa → Memory Alpha REACTION chain                           |
  | p.25 Scoring example        | **29 VP**                                                                                                    |

## 3. Property-based / fuzz testing

Worth more than any equivalent hand-written effort.

- [ ] `autoPlay(state, policy)` with a first-legal-option policy (`todo/07` §6).
- [ ] In CI: **1000 random seeds × every deck pairing**, asserting for each:
  - no throw, no hang (the `run()` iteration cap never trips);
  - the game reaches `GAME_OVER`;
  - `assertSerialisable(state)` holds after every intent;
  - global invariants (below) hold after every primitive.
- [ ] Any seed that fails gets checked in as a golden-game fixture.

## 4. Invariants — assert these after every primitive in dev/test builds

- [ ] **Card conservation:** every `CardInstanceId` is in exactly one zone; the total never
      changes (except `DESTROY` → `BOX`, which is still a zone).
- [ ] **Away Teams:** `awayTeamsInPool + sum(awayTeamsAt for this seat) === awayTeamsTotal`, and
      `awayTeamsTotal` never decreases (`rules/08` → send/remove).
- [ ] **Ship tokens:** each deployed SHIP's token is in exactly one place — on its card, at a
      Location, or in the supply. Never two.
- [ ] **Actions:** `actions.available + actions.spent === 3 + actionsGainedThisTurn`.
- [ ] **Specialty tracks:** `0 ≤ value ≤ 15`.
- [ ] **Resources:** never negative.
- [ ] **Beamed cards:** `beamedTo` points at a card that exists and is in play; no cycles.
- [ ] **The stack:** never deeper than the nesting cap; never non-empty while `pendingChoice` is
      null **and** the phase is idle.
- [ ] **Serialisability:** `assertSerialisable(state)` (`todo/01` §4).

Put these in `src/engine/invariants.ts` behind an `ASSERT_INVARIANTS` flag, on in tests and dev,
off in production builds.

## 5. Determinism tests

- [ ] `setup(config)` twice with the same seed → deep-equal states.
- [ ] `replay(session)` → deep-equal to the live-played state.
- [ ] **Mid-effect round-trip:** serialise the state while a `PendingChoice` is pending,
      deserialise, resolve the choice → identical result to not round-tripping. This is the test
      that proves the stack really is data.
- [ ] Undo N steps and replay → deep-equal.

## 6. Card data tests

- [ ] Every card in `src/data/cards/**` parses against the schema (this is
      `npm run validate:cards`; also run it as a test so `npm test` catches it).
- [ ] Every card's operations are **reachable**: for each PLAY operation, there exists _some_
      constructible game state in which `canPlay` returns true. A card that can never be played
      is a transcription bug.
- [ ] Every `requires` threshold is ≤ 15.
- [ ] No `DUPLICATE` nested inside a `DUPLICATE`.
- [ ] Group counts match `rules/01` §1.3.

## 7. What not to test

- [ ] Don't snapshot-test React components. They churn and catch nothing.
- [ ] Don't unit-test trivial getters.
- [ ] Don't test the sprite pipeline's pixel output — test the **manifest**
      (`todo/02` Stage 6), which is what the app actually consumes.

---

## Definition of Done

- [ ] All 30 sections of `rules/12` have at least one passing test.
- [ ] All 8 rulebook worked examples reproduce exactly.
- [ ] The 1000-seed fuzz run passes in CI for every deck pairing.
- [ ] All invariants in §4 are asserted and passing.
- [ ] The mid-effect serialise/deserialise round-trip test passes.
- [ ] `npm test` is green and runs in under 60 s.
