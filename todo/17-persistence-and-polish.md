# TODO 17 — Persistence, undo & polish

**Depends on:** `14`.
**Estimate:** 1–2 days.

---

## 1. Save / load

- [ ] Persist the **`Session`** (`{ seed, setup, log }`), not the `GameState`
      (`docs/state-machine.md` §7). A session is a few KB; a state is hundreds.
- [ ] IndexedDB via `idb-keyval`. Key: a generated game ID. Store alongside it:
      the deck names, the board sides, the turn number, a timestamp and the current score
      estimate — so the load screen is browsable without replaying every save.
- [ ] **Autosave after every intent**, debounced ~1 s.
- [ ] Version the session format (`version: 1`). On a card-data change that alters behaviour,
      old logs may replay differently — detect it by storing a **card-data hash** in the session
      and warning on mismatch rather than silently replaying wrong.

## 2. Undo

- [ ] Undo = drop the last **player-visible** intent (and any trailing auto-resolutions), then
      `replay`.
- [ ] If replay ever gets slow, snapshot the full state every 50 intents and replay forward from
      the nearest snapshot. **Measure before optimising** — a full game is a few hundred intents
      and replay is likely under 50 ms.
- [ ] **Undo across hidden information is a design choice.** In hot-seat, undoing past a point
      where you saw a facedown card (a scan, a gain from a deck top) leaks information. Either:
  - (a) allow it freely in solo, restrict to "undo within your own turn, before any reveal" in
    hot-seat; or
  - (b) allow it everywhere and label it "take-backs enabled".
    Pick one and state it in the UI. **Recommendation: (a)** — it matches how the physical game
    plays.

## 3. Replays

- [ ] A session log **is** a replay. Add a viewer: step forward/back through the intent list,
      rendering the state at each point.
- [ ] Export/import a session as a JSON file — this is also your bug-report format. "Attach the
      session" beats any description.

## 4. Performance

- [ ] Memoise `canPlay` per `(revision, seat)` (`todo/07` §4) — it runs for every card in hand on
      every render.
- [ ] Virtualise long card grids (browsing a 40-card Discard pile).
- [ ] Preload only the atlases in use (commons + the two decks in play), not all of them.
- [ ] Target: a state update renders in under 16 ms. If not, profile before adding `memo()`
      everywhere.

## 5. Error handling

- [ ] An engine throw should show a **recoverable error screen** with the session log and a copy
      button, not a white page. Wrap the board in an error boundary.
- [ ] A card whose data is malformed should render as a text-only card with a warning badge,
      rather than crashing the game.

## 6. Nice-to-haves, in priority order

1. **Turn summary** — "you gained 7 Glory, advanced Research twice, took control of Betazed".
2. **Score estimate during play** — running VP with the breakdown. Hugely instructive, and the
   physical game gives you this information too (everything except hands is public).
3. **Mission progress indicators** — "2 / 3 ALLY on the same SHIP".
4. Card-movement animations.
5. Sound.
6. A themed table background.

## 7. Before any deploy

- [ ] **Re-read `docs/open-questions.md` Q6.** The card art and text are © 2024 WizKids/NECA and
      CBS Studios. Running this locally for your own play is one thing; publishing it with the
      art embedded is redistribution. If it leaves `localhost`, either strip the art (the engine
      and `describe()` can render text-only cards) or get permission.

---

## Definition of Done

- [ ] A game survives a browser refresh mid-turn, including mid-`PendingChoice`.
- [ ] Undo works across a full turn boundary and produces a state identical to never having
      played those intents.
- [ ] A session exports to JSON and re-imports to an identical state.
- [ ] An engine throw shows the error screen with a copyable session, not a blank page.
- [ ] A malformed card renders as a text card with a warning, and the game continues.
