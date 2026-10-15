# TODO 04 — Effect DSL & resolver core

**Depends on:** `03`. **Blocks:** `05`–`10`, `12`, `13`.
**Estimate:** 2 days. This is the heart of the project.

Read `docs/effect-dsl.md` and `docs/state-machine.md` §3 first.

---

## 1. Node type definitions

- [ ] `src/engine/resolver/nodes.ts` — the full `Effect` union from `docs/effect-dsl.md`
      §§2–4. One discriminated union keyed on `k`.
- [ ] `src/engine/resolver/queries.ts` — `Predicate`, `Query`, `CardFilter`, `Amount`.
- [ ] Keep node definitions **data-only**. No methods, no classes. The behaviour lives in
      `primitives/`, dispatched by `k`.

## 2. The primitive registry

- [ ] `src/engine/resolver/primitives/index.ts`:
  ```ts
  export interface Primitive<N extends Effect> {
    /** Can this node be fully resolved right now? Used by cost pre-validation and probe mode. */
    canResolve(state: GameState, node: N, ctx: EffectCtx): boolean;
    /** Advance one step. May push frames, may set pendingChoice, may emit events. */
    execute(state: GameState, node: N, ctx: EffectCtx, frame: Frame): GameState;
    /** true if this node is a cost (pre-validated before any mutation). */
    isCost: boolean;
  }
  export const PRIMITIVES: { [K in Effect['k']]: Primitive<Extract<Effect, {k: K}>> } = { ... };
  ```
- [ ] The mapped type above means **TypeScript fails the build if you add a node kind without a
      primitive.** Rely on that; don't use a `Record<string, ...>`.
- [ ] One file per primitive: `beam.ts`, `gainCard.ts`, `scan.ts`, `warp.ts`, … Each file gets
      its own `.test.ts` next to it.

## 3. The stack machine

- [ ] `src/engine/resolver/stack.ts`:
  ```ts
  export function pushEffect(state, node: Effect, ctx: EffectCtx): GameState
  export function run(state: GameState): GameState // the loop from docs/state-machine.md §3
  function executeOne(state: GameState): GameState // advance exactly ONE primitive
  ```
- [ ] **Invariant: `executeOne` advances at most one primitive.** Enforce it with a step counter
      in dev builds. If a primitive resolves its own children inline, REACTION windows can no
      longer open between them and `rules/12` §12.24 breaks.
- [ ] **Loop guard:** cap `run()` at e.g. 10 000 iterations and throw with a stack dump. A
      malformed card (a `REPEAT` with a negative amount, a self-triggering REACTION) will
      otherwise hang the tab.
- [ ] `SEQ` is implemented with an instruction pointer on the frame (`frame.ip`), not by
      recursion — so a choice mid-sequence can halt and resume.

## 4. Cost pre-validation

Implements `rules/12` §12.1 — _the_ most commonly-violated rule in card-game engines.

- [ ] `canPayAll(state, costTree, ctx): boolean` — walks the cost subtree, calls each cost
      primitive's `canResolve`, ANDs the results.
- [ ] `PAY_THEN.execute`:
  ```
  if (!canPayAll(state, node.cost, ctx)) -> this operation is not resolvable; fail upward
  push body frame
  push cost frame            // executes first (stack)
  ```
- [ ] **Crucially:** for a cost with a selection ("discard a WEAPON"), `canResolve` must verify
      **at least one legal selection exists** — not merely that the player holds cards.
- [ ] For the `Operation.costsAction` flag, treat it as an implicit `COST_ACTION` prepended to
      the effect.

## 5. Benefit skipping

- [ ] Non-cost primitives whose `canResolve` is `false` are **skipped silently** and the sequence
      continues (`rules/12` §12.1). Log a `LogEntry` of kind `SKIPPED` so the player can see why
      nothing happened.
- [ ] **Test:** `PAY_THEN(spend 2 DIL, SEQ[gain CARGO, draw 1])` with the CARGO deck **and**
      offer empty → the Dilithium is still spent and the card is still drawn.

## 6. `CHOOSE_ONE` resolvability filtering

- [ ] Before emitting the choice, run `canResolve` on each option's body and mark it
      `enabled: false` with a `reason` if not.
- [ ] For an `isAttack` operation resolved by the **opponent**, **hard-filter** disabled options
      out: `rules/03` §3.5.3 limits their pick to options they can carry out in full.
- [ ] If **no** option is resolvable: skip the node (benefit) or fail (cost).

## 7. `DUPLICATE` — the trickiest primitive

Implements `rules/08` → duplicate and `rules/12` §12.13.

- [ ] Emit a `CHOOSE_CARDS` over the legal sources (Market / Discard / Log ∩ specified suits).
- [ ] Emit a `CHOOSE_OPTION` over that card's matching operations.
- [ ] Push the chosen operation's effect with a **modified ctx**:
  ```ts
  { ...ctx, source: duplicatedCardIid, duplicating: ctx.source, noNestedDuplicate: true }
  ```
- [ ] **Skip the action cost** — do not prepend `COST_ACTION` even if `op.costsAction`.
- [ ] **Still check `op.requires`** (the Specialty restriction).
- [ ] **Self-reference redirection:** any node whose target is `'THIS'` resolves to
      `ctx.duplicating` when set (so "Log this card" logs the _duplicator_).
- [ ] **Nested duplicate:** if `ctx.noNestedDuplicate`, `DUPLICATE.execute` is a **no-op**.
- [ ] Sub-effects illegal for the duplicating card's type (`DEPLOY` on a `PERSON`, `PROMOTE` on a
      non-`PERSON`) are **skipped**, not fatal.
- [ ] **Write all five rulebook examples as tests**: Orb of Time × Denobulans (logs Orb of Time);
      Odo × Cloaking Device (deploy ignored, rest resolves); Laas × Orb of Time (only the recall).

## 8. `FORCE` and actor switching

- [ ] `OPPONENT` / `FORCE` push a frame with `ctx.actor` flipped.
- [ ] **Every `PendingChoice` emitted while resolving carries `ctx.actor` as its `seat`** — this
      is how choice ownership inverts (`rules/12` §12.14).
- [ ] If the forced effect is entirely unresolvable for them, **ignore it** (no error).
- [ ] **Test the pair:** "Dismiss an opponent SHIP" → choice seat = you.
      "Force your opponent to dismiss a SHIP" → choice seat = them.

## 9. `WILDCARD` matching

- [ ] `matchTrait(state, iid, trait, { allowWildcard, actorMayOptIn })` per
      `docs/effect-dsl.md` §5.
- [ ] When a `WILDCARD` card is **load-bearing** for a query (i.e. the query succeeds with it and
      fails without it), emit `CHOOSE_WILDCARD_AS` so the player declares the substitution.
      Otherwise resolve silently.
- [ ] Store the declaration in `CardInstance.wildcardAs` and **clear it when the operation ends**
      — it is scoped to one operation or one goal (`rules/12` §12.12).
- [ ] `allowWildcard: false` for: forced dismissals/discards driven by an opponent's `ATTACK`,
      and **all** final scoring.
- [ ] `DIFFERENT_SPECIES`: implement as bipartite matching over
      (cards with species-or-wildcard) × (distinct species). `n < 20`; greedy + backtracking is
      fine. **Test:** 1 BAJORAN + 1 KLINGON + 1 WILDCARD satisfies "3 DIFFERENT SPECIES"
      (`rules/05` §5.2.3).

## 10. `Amount` evaluation

- [ ] `evalAmount(state, amount, ctx): number` for every variant in `docs/effect-dsl.md` §5.
- [ ] `UP_TO` emits a `CHOOSE_AMOUNT` choice — but **auto-resolve to `max` when the effect is a
      pure benefit with no downside**, and to `0` when `max === 0`. Gratuitous "choose 0 to 0"
      prompts destroy the play experience.
- [ ] Clamp `ADVANCE_SPECIALTY` at 15 (`rules/07` §7.1).

## 11. Probe mode

Needed by `canPlay` (`docs/state-machine.md` §5).

- [ ] `probe(state, node, ctx): boolean` — runs the resolver against a **cloned** state with
      `state.probe = true`. In probe mode:
  - any `PendingChoice` resolves to "does at least one valid selection exist?" (pick the first);
  - no events are emitted, no REACTION windows open;
  - depth is capped (probe never needs to go deep).
- [ ] **Probe mode must never mutate the real state.** Deep-clone via `structuredClone` — which
      works precisely because the state is plain JSON (see `todo/01` §4).

---

## Definition of Done

- [ ] `PRIMITIVES` is exhaustive: removing one entry fails `tsc`.
- [ ] `run()` halts on `pendingChoice`, resumes correctly on `RESOLVE_CHOICE`, and produces an
      identical final state whether the choices arrive in one batch or across a serialise/
      deserialise round-trip **mid-effect**.
- [ ] Cost pre-validation test (§5) passes.
- [ ] All three rulebook `DUPLICATE` examples pass as tests.
- [ ] The `FORCE` choice-ownership pair passes.
- [ ] The `WILDCARD` / `DIFFERENT_SPECIES` test passes.
- [ ] A malformed `REPEAT` with a negative count throws a clear error rather than hanging.
