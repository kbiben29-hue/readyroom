# TODO 07 — Choice system

**Depends on:** `04`, `05`. **Blocks:** `14`, `15`.
**Estimate:** half a day.

Implements `docs/state-machine.md` §4–§5.

---

## 1. Choice types

- [ ] `src/engine/resolver/choices.ts` — the `PendingChoice` union from
      `docs/state-machine.md` §4. Every variant carries `id`, `seat`, `prompt`, and
      `sourceCard: CardInstanceId | null`.
- [ ] `choice.id` = a deterministic hash of `(stack depth, frame index, node kind, turn)`.
      **Not a counter and not a UUID** — it must survive a replay unchanged, or
      `RESOLVE_CHOICE` intents from a saved log won't match.

## 2. Emission

- [ ] `emitChoice(state, choice): GameState` — sets `state.pendingChoice`, halting `run()`.
- [ ] **Auto-resolution rules** — apply these aggressively; each one you skip is a click the
      player makes hundreds of times:
  | Situation                                                                     | Auto-resolve to |
  | ----------------------------------------------------------------------------- | --------------- |
  | exactly 1 candidate and `min === max === 1`                                   | that candidate  |
  | `max === 0`                                                                   | empty selection |
  | `CHOOSE_AMOUNT` where `min === max`                                           | that amount     |
  | `UP_TO` on a pure benefit with no cost                                        | `max`           |
  | `CHOOSE_OPTION` with exactly 1 enabled option **and the node is not a `MAY`** | that option     |
  | `ORDER_OPERATIONS` where the engine proves order-independence                 | listed order    |
  - [ ] **Do not** auto-resolve a `MAY` — declining is always meaningful.
  - [ ] **Do not** auto-resolve `CHOOSE_DESTINATION` (top of deck vs Discard) — it is genuinely
        strategic every single time. Instead, offer a session-level "default, ask again with a
        modifier key" in the UI (`docs/ui-spec.md` §4).
  - [ ] Put auto-resolutions in the log as `AUTO` entries, so a player can see what was decided
        for them.

## 3. Resolution & validation

- [ ] `resolveChoice(state, choiceId, selection): GameState`:
  1. `choiceId` must match `state.pendingChoice.id` — else throw.
  2. **Re-validate the selection against the published candidate set.** Never trust the caller.
     A replayed log or a future network client could present anything.
  3. Cardinality: `min <= selection.length <= max`.
  4. No duplicates in a `CHOOSE_CARDS` selection unless the choice explicitly allows it.
  5. Write the selection into the waiting frame's `ctx.bindings`.
  6. Clear `pendingChoice`; `run()`.
- [ ] Throw a typed `IllegalSelectionError` with the reason, so `todo/16` can assert on it.

## 4. Legality API for the UI

- [ ] `src/engine/queries/legality.ts`:
  ```ts
  export function legalIntents(state, seat): Intent[]
  export function canPlay(
  	state,
  	seat,
  	iid,
  ): { ok: boolean; operations: number[]; reasons: string[] }
  export function canActivate(
  	state,
  	seat,
  	iid,
  	opIndex,
  ): { ok: boolean; reason?: string }
  export function completableMissions(state, seat): number[]
  ```
- [ ] `canPlay` must **probe** each PLAY operation (`todo/04` §11) because legality depends on
      resolvable costs, not static properties (`rules/12` §12.2).
- [ ] **Produce human `reasons`.** Worth doing properly:
  - `"Requires Military 3 (you have 1)"`
  - `"Costs 2 Dilithium (you have 1 Dilithium, 0 Glory)"`
  - `"No CARGO remaining in the Market"`
  - `"You have no available actions"`
  - `"This card cannot be played"`
  - `"No legal card to discard"`
    At this rules weight, a greyed-out card with no explanation is a support ticket.
- [ ] **Cache** `canPlay` results per `(stateHash, seat)` — it runs for every card in hand on
      every render. Invalidate on any state change; a simple `state.revision` counter suffices.

## 5. Choice context for the UI

- [ ] Every choice should carry enough to render itself without the UI re-deriving rules:
  ```ts
  { id, seat, kind, prompt, sourceCard,
    candidates: CardInstanceId[],       // already filtered to legal
    disabled?: { iid: CardInstanceId; reason: string }[],  // shown greyed with a tooltip
    min, max, optional: boolean }
  ```
- [ ] Include `disabled` entries for candidates that _look_ eligible but aren't — otherwise the
      player assumes a bug. (Example: an `ATTACK` forcing a dismissal where a `WILDCARD` card is
      deliberately **not** a legal target — `rules/12` §12.12.)

## 6. A choice-driving test harness

- [ ] `src/engine/testing/scripted.ts`:
  ```ts
  export function playScript(state, script: (Intent | Selection)[]): GameState
  ```
  Feeds intents, and whenever a choice is pending, consumes the next `Selection` from the script.
  Throws with a readable dump if the script and the engine disagree about what's pending —
  including the prompt, the candidates and the stack.
- [ ] Add `autoPlay(state, policy)` for fuzzing: a policy that picks the first legal option
      everywhere. Run 1000 random seeds through a full game in CI and assert **no throw, no hang,
      game reaches `GAME_OVER`**. This finds more bugs than any hand-written test.

---

## Definition of Done

- [ ] Every `PendingChoice` variant has an emit path and a resolve path.
- [ ] `resolveChoice` rejects: a stale `choiceId`; an out-of-set candidate; a cardinality
      violation — each with a distinct error.
- [ ] Auto-resolution fires for the single-candidate case and **does not** fire for `MAY` or
      `CHOOSE_DESTINATION`.
- [ ] `canPlay` returns a useful `reason` for each of the six cases in §4.
- [ ] `playScript` produces a readable diagnostic when a script desyncs.
- [ ] The 1000-seed fuzz run completes with no throws and no hangs.
