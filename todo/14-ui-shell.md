# TODO 14 — UI shell

**Depends on:** `07` (choices), `02` (atlas). Start only after the **M1 exit test** passes.
**Estimate:** 3–4 days.

Implements `docs/ui-spec.md`. Visual layer: `docs/ui-lcars.md` + `src/ui/lcars.css`.

---

## 1. State binding

- [ ] `src/ui/store.ts` — a Zustand store holding `{ session, state, viewerSeat }`.
- [ ] `dispatch(intent)` → `session.log.push(intent)`, `state = reduce(state, intent)`.
- [ ] **The UI never mutates `GameState`.** Everything goes through `dispatch`. Enforce by
      exporting the state as `Readonly<GameState>` (`DeepReadonly` if you want to be strict).
- [ ] `useProjected()` returns `project(state, viewerSeat)` (`docs/architecture.md` §5) —
      components read **only** this, never the raw state. That's what makes hot-seat hidden
      information work without a second implementation.

## 2. Card rendering

- [ ] `CardSprite` per `todo/02` Stage 5. Three sizes: `micro` / `board` / `hand`.
- [ ] `CardOverlay` — exhausted rotation, action-token chips, resource pips, the
      candidate-highlight ring, the illegal-dimming (`docs/ui-spec.md` §3).
- [ ] `CardDetail` — the hover/click overlay: full-resolution image plus a text sidebar listing
      each operation with its type, action cost, and **`canPlay().reasons`** when it isn't
      currently usable. This one panel removes most "why can't I do this?" confusion.
- [ ] `CardStack` — a deck/pile: the back sprite, a count badge, and click-to-browse for the
      piles that are public (`docs/ui-spec.md` §5).

## 3. Board components

- [ ] `<StardateTrack>` — the current card, its remaining Glory as pips, the count of Stardates
      left, and a clear **"Resolution triggered"** banner when the flag is set.
- [ ] `<Market>` — 4 deck backs with counts + 4 offer slots. Render resource tokens on offer
      cards. **Handle the empty-slot case** — it's legal and permanent.
- [ ] `<NeutralZone>` — 3 Location slots. Each shows both players' Away Team counts and named
      Ship chips, plus a **"secured by you"** badge when `isSecured` is true. The secured badge is
      what turns the Control Step from a chore into a decision.
- [ ] `<JunkPile>`, `<IncidentDeck>` — counts; the Incident deck gets a **warning colour when ≤2
      remain** (the Burn is imminent — `rules/03` §3.1).
- [ ] `<PlayerArea seat>` — the three rows from `rules/02` §2.3: Duty Officer + Location Area;
      Captain + Fleet Area; Draw deck + Staging Area + Discard.
- [ ] `<CrewBoard seat>` — 3 tracks with markers and **visible multiplier positions**; missions
      with a live **goal-met indicator** and a **Complete** button when completable.
- [ ] `<Hand>` — fanned, always readable, illegal cards dimmed with a tooltip reason.

## 4. The choice panel

One component per `PendingChoice` kind (`docs/state-machine.md` §4). Key behaviours:

- [ ] **Select in situ.** Highlight candidates where they physically are — in hand, in the
      Market, at a Location. **Do not** open a modal containing copies; the player loses spatial
      context and it becomes impossible to see _why_ a card is a candidate.
- [ ] Always show: the prompt, the **source card** that raised the choice, `min`/`max`, a live
      selection count, and a **Decline/Skip** button when optional.
- [ ] Render `disabled` candidates greyed **with their reason** (`todo/07` §5) — a candidate that
      looks eligible but isn't reads as a bug unless you explain it.
- [ ] `CHOOSE_DESTINATION` — a two-button inline prompt with the gained card shown large. This
      fires constantly; make it one click. Offer a session-level default with a modifier key to
      override (`docs/ui-spec.md` §4).
- [ ] `OPTIONAL_TRIGGERS` — a list with `[Use]` per reaction and `[Skip all]`, highlighting the
      card on the board on hover.
- [ ] `ORDER_OPERATIONS` — drag-to-order, plus **`[Auto]`** when the engine proved independence.
- [ ] **Route by `choice.seat`.** When `choice.seat !== viewerSeat` in hot-seat, show the
      pass-the-device interstitial first. REACTIONs make this common, not exotic.

## 5. Turn controls

- [ ] Top bar: phase name, turn number, **action pips** (`●●○`), Undo, menu.
- [ ] Context-sensitive primary button: _Take Control_ / _Skip_ / _End Action Step_ /
      _Continue_. One obvious next action at all times.
- [ ] **Warn before ending the Action Step with unused actions** — they're lost
      (`rules/03` §3.5.1) and new players burn turns learning that.
- [ ] Show completable missions as a **persistent nudge**, not a modal: completing one is free
      and forgetting it can cost the whole Focus block (`rules/12` §12.27).

## 6. Log panel

- [ ] Render `state.log` grouped turn → phase → operation, per `docs/ui-spec.md` §6.
- [ ] Clicking an entry highlights the involved cards.
- [ ] Show `SKIPPED` and `AUTO` entries — that's how a player learns why nothing happened.
- [ ] A filter for "my actions / opponent's actions / all".

## 7. Rules drawer

- [ ] Ship `rules/*.md` as app assets, rendered with a markdown component.
- [ ] Every keyword in card text links to its `rules/08` anchor.
- [ ] A **Card List** reference panel (filter by suit/trait/skill, showing what's left in each
      Market deck). The physical box includes this sheet and its contents are explicitly **public
      information** (`rules/04` §4.5) — withholding it would make the digital version harder than
      the real game.

## 8. Accessibility

- [ ] Full keyboard navigation of candidates (`Tab` / `Enter` / `Esc`).
- [ ] **Never colour alone** — the three Specialties are red/blue/yellow; always pair with the
      icon glyph and a text label.
- [ ] Respect `prefers-reduced-motion`.
- [ ] 44px minimum interactive target.

## 9. Explicitly deferred

Animations, sound, themes, 3D flips. None of them make the game playable.

---

## Definition of Done

- [ ] A complete Cadet Training game is playable start to finish **without opening the rulebook
      PDF**.
- [ ] Every `PendingChoice` kind has a renderer; none falls through to a raw JSON dump.
- [ ] Illegal cards in hand are dimmed **and** state why.
- [ ] Every public pile is browsable; the opponent's hand and Log are not.
- [ ] The final score screen shows the full breakdown from `todo/10` §4, including the
      `focusSuppressed` explanation.
- [ ] Keyboard-only play is possible through a whole turn.
