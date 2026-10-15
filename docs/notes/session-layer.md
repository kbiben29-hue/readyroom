# Session layer — headless core (todo/17)

Owned by: `src/session/`. The UI task (todo/14) drives this; nothing here
imports React or a DOM, and everything works under `node`/vitest.

## What a session is

A save is the **Session**, never a `GameState`:

```json
{ "version": 1, "id": "game-…", "setup": { …, "seed": 25 },
  "log": [ …Intent[]… ], "meta": { …load-screen summary… } }
```

- `replay(session, catalog)` = `setup(setup, catalog)` then `reduce(each intent)`.
  Byte-deterministic per engine invariant (`src/engine/rng.ts`, `assertSerialisable`).
- No card object or instance reference is ever serialised; the persistence test
  asserts the stored payload carries none of the state-only field names.
- `meta` = deck names (from the captain cards), board sides, turn number, phase,
  a **score estimate** (glory + specialties + printed VP of public owned cards —
  a load-screen convenience, not final scoring) and a **card-data hash**. A hash
  mismatch when loading (`checkCardData`) warns that an old log may replay under
  different card data — it does not block the load.

## Adapter

`SessionAdapter` (`src/session/adapter.ts`) is the UI seam:

- `dispatch(intent)` — validates via `legalIntents` / `validateChoice`, appends
  to the log, reduces the live state, refreshes meta.
- `settle(selection)` — validated `RESOLVE_CHOICE`.
- `undo()` — truncates the last player-visible intent + replays; illegal or
  unhelpful cases return `false`. Undoing back into a mid-effect
  `PendingChoice` is free (replay restores the suspended stack).
- `persist` option = autosave hook, debounced ~1 s via `autosaveDebounceMs`;
  `dispose()` cancels a pending autosave.
- `SessionStore` (`persistence.ts`) wraps the `Storage` (IndexedDB via
  idb-keyval in the browser, `InMemoryStorage` in tests) with save/load/list/remove.

## Undo policy (todo/17 §2, choice (a) — recommended)

Undo across hidden information leaks what you saw. Adopt:

- **Solo**: undo freely.
- **Hot-seat**: allow undo only "within your own turn, before any reveal"
  (a scan, a gain from a deck top). The adapter is UI-agnostic — the hot-seat
  screen enforces the cut-off, e.g. by hiding an "undo" affordance once a reveal
  intent is committed, or by replay-projecting the pre-reveal state.

State the choice in the UI ("Take-backs enabled" label if you pick (b)).

## UI follow-ups to build in todo/14 (not here)

- **Replay viewer** (todo/17 §3): the log is the replay — step through
  `log[0..i]` and render `replay` at each point; export via `exportSession`.
- **Error boundary**: on an engine throw, show the recoverable-error screen with
  `exportSession(session)` + a copy button.
- **Autosave wiring / load screen**: `listSessions` gives browsable summaries
  (no replay needed); wire the adapter's `persist` to `SessionStore.save`.
- Performance (todo/17 §4) only if profiling demands: replay is well under
  50 ms for full games, so no snapshot cache was added.

## Card-data hash caveat

`cardDataHash` is a two-pass 64-bit drift detector over defs + stardates +
crew boards, canonically keyed. It is not cryptographic; it exists to catch a
card-data edit between sessions, not collisions. Stardate cards are part of the
harness per session (the `tools/` catalog is the source of record); if real
Stardate data lands, re-hash the catalog at boot and warn against old saves.
