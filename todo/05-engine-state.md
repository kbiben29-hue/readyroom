# TODO 05 — Engine state, zones, RNG & queries

**Depends on:** `03`, `04`. **Blocks:** `06`–`10`.
**Estimate:** 1 day.

---

## 1. RNG

- [ ] `src/engine/rng.ts` — counter-based, stateless-per-call:
  ```ts
  export function next(rng: Rng): [number, Rng] {
  	// [0,1)
  	const c = rng.counter + 1
  	let z = (rng.seed + c * 0x9e3779b9) >>> 0
  	z ^= z >>> 16
  	z = Math.imul(z, 0x21f0aaad)
  	z ^= z >>> 15
  	z = Math.imul(z, 0x735a2d97)
  	z ^= z >>> 15
  	return [(z >>> 0) / 4294967296, { ...rng, counter: c }]
  }
  export function shuffle<T>(items: T[], rng: Rng): [T[], Rng] // Fisher–Yates, in-order
  ```
- [ ] **Never** return a mutable generator. The RNG state lives in `GameState.rng` and every
      consumer threads it through. This is what makes replay exact.
- [ ] Test: `shuffle` with the same seed+counter yields the same permutation, 1000×.

## 2. Zones

- [ ] `src/engine/state.ts` — `ZoneRef` union from `docs/data-model.md` §3.
- [ ] `zoneKey(ref): string` — a canonical, stable serialisation (e.g. `HAND:0`,
      `MARKET_OFFER:CARGO`, `BEAMED:p0#0042`). **Must be injective.** Test it.
- [ ] `zoneProps(ref): ZoneProps` — the table in `docs/data-model.md` §3:
  ```ts
  interface ZoneProps {
  	inPlay: boolean
  	traitsCount: boolean
  	skillsCount: boolean
  	tableOps: boolean
  	ordered: boolean
  	visibleTo: 'ALL' | 'OWNER' | 'NONE'
  }
  ```
- [ ] **Write one test per row of that table.** These are the rules of `rules/08` → _in play_ and
      `rules/12` §12.3 / §12.5, and getting `BEAMED.skillsCount = false` wrong is a bug you will
      chase for hours.

## 3. Card movement — one function, no exceptions

- [ ] `moveCard(state, iid, toZone, opts?): GameState` — the **only** way a card changes zone.
      It must:
  1. remove the iid from its current zone array;
  2. append (or insert at index, for "top of deck") into the target;
  3. update `CardInstance.zone`;
  4. **apply cascade rules** — if the card had beamed cards and the destination is out of play,
     move them too (`rules/12` §12.6);
  5. **clear state that doesn't survive the move**: `exhausted` when leaving play,
     `wildcardAs` always, `resourceTokens` when leaving the Market offer;
  6. **handle Action tokens** per `rules/12` §12.7 — they move or are set aside, and are **never
     refunded**;
  7. **handle a LOCATION leaving play** — dismiss Ships present, return Away Teams
     (`rules/08` → log / destroy);
  8. emit the appropriate `GameEvent`s.
- [ ] Having exactly one mover is what keeps the cascade rules from being re-implemented (wrongly)
      in nine primitives. **Grep for direct `zones[...].push(` in review; there should be none
      outside `moveCard` and `setup.ts`.**

## 4. Deck cycling

- [ ] `drawCards(state, seat, n): GameState`, implementing `rules/04` §4.1 and `rules/12` §12.22:
  ```
  repeat n times:
    if draw deck empty:
      if discard is empty AND reserve is empty AND no affordable development: STOP
      shuffle discard -> draw deck
      if reserve non-empty: enlist reserve (top of draw)
      else: offer ENLIST_DEVELOPMENT as an optional choice (MAY)
    if draw deck still empty: STOP
    move top card -> hand
  ```
- [ ] **Multiple cycles in one call must each enlist.** Test drawing 6 from a 1-card deck with 3
      Reserve cards.
- [ ] The Development offer is a `MAY` → a real `PendingChoice`. This means `drawCards` can
      **halt mid-draw**; implement it as a primitive with a resumable frame, not a plain loop.
- [ ] Also triggered by "interact with the top card of your deck" (look/discard), not just draw
      (`rules/04` §4.1).

## 5. Queries

- [ ] `src/engine/queries/inPlay.ts`:
  ```ts
  export function inPlayCards(state, seat): CardInstanceId[]
  export function isInPlay(state, iid): boolean
  ```
  Drive both from `zoneProps`, not from a hand-written zone list.
- [ ] `src/engine/queries/traits.ts` — `matchTrait`, `cardTraits`, `differentSpeciesCount`.
- [ ] `src/engine/queries/counting.ts`:
  - `countSkillIcons(state, seat, specialty)` — **excludes beamed cards** (`rules/12` §12.5),
    **includes** Staging Area cards. Handles `SKILL_ANY` (assignable) and `SKILL_VARIABLE`.
  - `countFocusIcons(state, seat, specialty)` — over **all owned cards**, for scoring.
  - `exhibitsSpecialty(def, specialty)` — Skill **or** Focus icon, **never** a restriction icon
    (`rules/07` §7.1.3). One test for the negative case.
- [ ] `src/engine/queries/board.ts`:
  - `tokensAt(state, locIid, seat)` → Away Teams + Ship tokens
  - `isSecured(state, locIid, seat)` → `≥3 && ≥ opp+2` (`rules/08` → secured)
  - `canSendAwayTeam(state, seat, locIid)` → blocked iff neutral **and**
    `oppShips > yourShips` (`rules/12` §12.15)
- [ ] `src/engine/queries/resolveQuery.ts` — evaluate a `Query` node to `CardInstanceId[]`, and
      `evalPredicate`, `evalAmount`.

## 6. `SKILL_ANY` assignment

`SKILL_ANY` "can represent any one Specialty". When `Utilize` counts Research icons and you hold
two `ANY` icons, both can count as Research.

- [ ] Treat `SKILL_ANY` as **matching whichever specialty is being counted**, independently per
      query. Do **not** force a global assignment — the rulebook phrases it per-use.
- [ ] `SKILL_VARIABLE` needs a per-card `variableSkillSpec` evaluated against the state. Make it
      a `Query`-valued field on the `CardDef` so it stays data.

## 7. Rule modifiers

- [ ] `src/engine/modifiers.ts` — a registry keyed by modifier ID; the state stores only
      `{ id, source }` (`docs/data-model.md` §7).
- [ ] Hook points needed now: `handSize`, `onGainResource`, `canSubstituteGlory`, `onStolenFrom`,
      `cleanupGloryPlacement`.
- [ ] Implement `INERT_DILITHIUM` (`rules/11` §11.6.1) **now, while the hooks are fresh**, even
      though Burnham is the last deck you'll transcribe. It is the proof the hook set is adequate.
- [ ] Modifiers detach automatically when `source` leaves play — hook this into `moveCard`.

## 8. Resource operations

- [ ] `gainResource(state, seat, res, amount)` — routes Glory through the Stardate pile
      (`rules/04` §4.3.1) including the **mid-effect handoff** (`rules/12` §12.9); respects
      `resolutionTriggered`; passes through `onGainResource` modifiers.
- [ ] `spendResource(state, seat, res, amount)` — with Glory substitution
      (1 GLO = 1 LAT, 1 GLO = 2 DIL, **no change given**), gated by `canSubstituteGlory`.
  - **Payment planning:** when both native and Glory payment are possible, this is a **player
    choice** — emit one. Don't auto-spend Glory: it is 1 VP each at game end, so spending it is
    never neutral.
- [ ] `steal(state, from, to, res, amount)` — clamps to available; **emits no `RESOURCE_GAINED`
      event** (`rules/04` §4.3.3); routes through `onStolenFrom`.

---

## Definition of Done

- [ ] `zoneProps` has a passing test per row of the `docs/data-model.md` §3 table.
- [ ] `moveCard` is the only zone mutator outside `setup.ts` (verified by grep).
- [ ] Cascade test: beam 2 cards to a SHIP, dismiss the SHIP → all 3 in the Discard pile, the
      Ship token back in the supply.
- [ ] Cascade test: beam a card to a SHIP, dismiss **the beamed card** → the SHIP is untouched.
- [ ] Deck-cycling test: draw 6 from a 1-card deck with 3 Reserve cards → 3 enlists happen, in
      order, and the enlisted cards are drawn immediately after each reshuffle.
- [ ] Glory-substitution test: paying a 3-Dilithium cost with 1 DIL + 1 GLO succeeds and **wastes
      the extra Dilithium** (no change).
- [ ] `isSecured` test matrix: (3,0)=✅ (3,1)=✅ (3,2)=❌ (2,0)=❌ (4,2)=✅ (4,3)=❌.
- [ ] `canSendAwayTeam` test: opponent has 2 ships & you have 2 → allowed (tie); opponent 2, you
      1 → blocked; controlled Location → always allowed.
- [ ] `assertSerialisable(state)` passes after every operation in the suite.
