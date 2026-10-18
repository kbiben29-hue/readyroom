# House AI

The opponents in `src/bot/`. This is a house AI. It is not the official solo Bot, which needs the
separate solo rulebook (`docs/open-questions.md` Blocker B2). Every level is a `Bot`
(`src/bot/types.ts`): a pure `decide(state, seat, legal) → Intent` under a no-cheat contract.
Hidden information is read only through `determinize`, and randomness is seeded from
`seedFromView`.

| Level         | Implementation                                                          |
| ------------- | ----------------------------------------------------------------------- |
| `first-legal` | the deterministic fuzz driver (`autoPlay.ts`)                           |
| `easy`        | the heuristic with softmax noise                                        |
| `normal`      | the heuristic (`heuristic.ts`): one decision of lookahead over 2 worlds |
| `hard`        | ISMCTS (`ismcts.ts`, below)                                             |

Compare bots with `npx tsx tools/arena.ts --a <spec> --b <spec> --games N --jobs J` (specs:
`src/bot/registry.ts`).

## ISMCTS (the Hard level)

`src/bot/ismcts.ts` implements single-observer Information-Set MCTS (SO-ISMCTS; Cowling, Powley &
Whitehouse 2012), with PUCT selection guided by the heuristic's priors.

### One iteration

1. **Determinize.** Take a world from a pool of `worlds` determinizations of the root seat's
   information set. They are drawn with `determinizeWith`, seeded from
   `seedFromView(state, seat)` and a salt. Iteration _i_ uses world _i_ mod `worlds`, so each tree
   node memoises its state per world. A node's state in a world is a pure function of the world and
   the path, so revisits cost nothing, and so do leaf values, which are memoised too.
2. **Descend.** At each node, the decider is the pending choice's seat, else the active seat. Its
   options are `candidates()` _in this world_. Only these options are eligible, and each eligible
   edge's **availability** count is incremented. This is the ISMCTS correction: the exploration
   term uses how often an edge was available, not how often its parent was visited. **Progressive
   widening** keeps only the top-k available edges by prior, with
   k = max(2, ⌊widenK · (n + 1)^widen⌋).
3. **Select** the edge that maximises `Q̂ + c · P · √avail / (1 + n)`.
   - P is the softmax (temperature `temp`, in VP) of the edges' prior scores over the eligible set.
   - Q̂ is the edge's mean value from its decider's side, min-max normalised over every value
     backed up in this search. The values are small VP-margin differences, so a fixed c would not
     fit them otherwise.
   - An unvisited edge counts at its parent's mean value (first-play urgency).
4. **Expand.** The first edge without a child creates a node, and that node is the leaf. These are
   leaves too:
   - a finished game;
   - a state past the horizon, which by default is the end of the current turn. `turns` sets how
     many turn hand-overs the tree may cross.
5. **Evaluate** the leaf. The value is always from the root seat's view, in [−1, 1].
   - A finished game is worth ±0.9 + 0.1 · tanh(margin / scale).
   - Any other state first gets a heuristic `settle`, which ends the turn owner's turn with the
     cheap policies. With `leaf=rollout`, up to `rolloutDepth` rollout decisions come first. Each
     one completes a completable mission if there is one. Otherwise `rollout=cheap` plays the
     playable hand card with the best `cardValuePrior`, and `rollout=greedy` takes the best
     one-step `evaluate` gain plus the rule prior while that is positive (about 5× dearer).
   - The settled state is then scored as `tanh(evaluate / scale)`, or by the `value` hook.
6. **Back up.** Each edge accumulates the value from its own decider's side: +v for the root seat,
   −v for the opponent.

The move played is the root edge with the most visits. Ties go to the higher Q, then to the
earlier candidate. Two cases return without searching: a decision with a single candidate, and a
completable mission (the heuristic's `missionsFirst` rule).

**SO-ISMCTS.** There is one tree, keyed by decision history. Every edge is
`<decider seat>|intentKey(intent)`, so choice ids are normalised away. The opponent's decisions
inside the tree (interrupts within the turn, and their whole turn when `turns ≥ 1`) are chosen from
that same tree by maximising −value. In effect, the opponent is assumed to know what the root
player's determinization shows. Chance (draws, shuffles, deck tops) is folded into the
determinization: nodes do not split on chance outcomes, and an option that only exists in some
worlds is simply unavailable in the others.

**Priors.** Each edge gets one prior score, computed the first time the edge is seen, in that
iteration's world, and cached on the edge.

| Mode     | Score                                                                                        |
| -------- | -------------------------------------------------------------------------------------------- |
| `bonus`  | `priorBonus` (the heuristic's rule priors)                                                   |
| `step`   | `evaluate` one `reduce` after the intent, plus `priorBonus`                                  |
| `settle` | the heuristic's own candidate score (`simulate`: apply, settle, evaluate), plus `priorBonus` |

The defaults are `rootPrior=settle` and `prior=step`. With `settle` at the root, a tiny budget
reproduces the heuristic's choice, and the search refines it from there.

**Determinism.** With an iteration budget, `decide` is a pure function of the seat's information
set. `ismcts.test.ts` checks that two states differing only in the hidden arrangement give
identical root statistics. A time budget (`timeMs`, with an injected `clock` because `src/bot` is
under the determinism lint) makes the iteration count, and so the answer, machine-dependent. The
tree lives only inside one `decide` call: there is no tree reuse between decisions.

### Parameters

They are set through `makeIsmctsBot(opts)`, or the `ismcts:` arena spec
(`ismcts:iters=200,c=1.5,leaf=settle`).

| Option (spec key)      | Default           | Meaning                                            |
| ---------------------- | ----------------- | -------------------------------------------------- |
| `iterations` (`iters`) | 200               | iteration budget; a cap when `timeMs` is set       |
| `timeMs`, `clock`      | —                 | wall-clock budget; the spec uses `performance.now` |
| `c`                    | 1.5               | PUCT exploration constant                          |
| `widen`, `widenK`      | 0.5, 2            | progressive widening; `widen=0` turns it off       |
| `leaf`                 | `rollout`         | `rollout` (option a) or `settle` (option b)        |
| `rolloutDepth`         | 8                 | decisions per rollout before it settles            |
| `rollout`              | `cheap`           | rollout policy: `cheap` or `greedy`                |
| `rootPrior`, `prior`   | `settle`, `step`  | prior modes (table above)                          |
| `temperature` (`temp`) | 1                 | prior softmax temperature, in VP                   |
| `worlds`               | 16                | determinization pool size                          |
| `turns`                | 0                 | turn hand-overs the tree may cross                 |
| `maxDepth`             | 48                | tree depth cap                                     |
| `scale`                | 15 (`EVAL_SCALE`) | VP scale of the value squash                       |
| `missionsFirst`        | true              | complete a completable mission without searching   |
| `value`                | —                 | learned value hook (below)                         |

`makeBot('hard')` (`src/bot/index.ts`) uses two budgets:

- Without a clock, it runs `HARD_ITERATIONS` = 200 iterations. This is the arena and test budget,
  and it is deterministic.
- With `makeBot('hard', { clock: performance.now })`, it searches for `HARD_TIME_MS` = 1500 ms per
  decision, capped at `HARD_MAX_ITERATIONS` = 3000. This is the UI and worker budget.

### Gate

All runs are `npx tsx tools/arena.ts --a <spec> --b normal --jobs 11` over all 30 pairings, with
seat swaps. The 95 % intervals are Wilson intervals. Times are ms per `decide` call, trivial
decisions included, measured with 11 jobs on 12 cores (roughly 2× slower than one unloaded core).

| Spec (A, vs `normal`)                                               | Seed | Games | A rate     | 95 % CI          | Margin    | ms/decision |
| ------------------------------------------------------------------- | ---- | ----- | ---------- | ---------------- | --------- | ----------- |
| `iters=200,leaf=settle` (first version)                             | 7    | 200   | 67.3 %     | [60.5, 73.4]     | 4.4 ± 0.7 | 459         |
| `iters=200,leaf=settle`                                             | 1    | 100   | 62.1 %     | [52.3, 71.1]     | 3.1 ± 1.1 | 390         |
| `iters=200,leaf=settle,c=0.75`                                      | 1    | 100   | 60.0 %     | [50.2, 69.1]     | 2.3 ± 1.1 | 336         |
| `iters=200,leaf=settle,c=3`                                         | 1    | 100   | 61.0 %     | [51.2, 70.0]     | 4.8 ± 1.1 | 372         |
| `iters=400,leaf=settle`                                             | 1    | 100   | 71.0 %     | [61.5, 79.0]     | 3.9 ± 1.0 | 744         |
| `iters=100,leaf=rollout`                                            | 1    | 100   | 65.0 %     | [55.3, 73.6]     | 5.1 ± 1.1 | 438         |
| `iters=200,leaf=rollout,rolloutDepth=20`                            | 1    | 100   | 72.5 %     | [63.0, 80.3]     | 6.4 ± 1.3 | 773         |
| `iters=200,leaf=rollout,rollout=greedy,rolloutDepth=30` (abandoned) | 1    | —     | —          | —                | —         | ~5× slower  |
| `iters=200,leaf=rollout`                                            | 1    | 100   | 77.0 %     | [67.8, 84.2]     | 7.0 ± 1.2 | 821         |
| **`iters=200`** (= `hard`, the defaults)                            | 7    | 200   | **76.0 %** | **[69.6, 81.4]** | 6.9 ± 0.8 | 883         |

Seed 1 was the tuning seed. The 62.1 % run on seed 1 was the first arena run: one of its games
crashed on an engine bug (fixed, below), so that row covers 99 finished games. The final gate used the
fresh seed 7. The gate needs at least 55 % with the CI's lower bound above 50 %, and it passes: 76.0 %
[69.6, 81.4], 149–45–6. Seat 0 and seat 1 are both 76 %.

Sanity check: `ismcts:iters=200` vs `first-legal` on `--pairings nobur` (60 games, seed 3) won
60 of 60 (100 %, [94.0, 100]), by an average margin of 37.9 VP.

Findings:

- c barely matters (0.75 to 3) once Q is min-max normalised.
- Strength grows with the budget: settle went from 62 % at 200 iterations to 71 % at 400, and
  rollout from 65 % at 100 to 77 % at 200.
- At equal cost, the cheap rollout is slightly ahead of settle (77 % vs 71 % at ~800 ms), so it
  is the default. A settled leaf scores a mid-turn state as "end the turn now". That undervalues a
  hand that can still be played, and the rollout corrects it.
- A deeper rollout (20 decisions) did not help.
- The greedy rollout policy (one `reduce` per option per step) was about 5× slower and was
  dropped before its run finished.

Search cost on one unloaded core, with Action Step decisions of at least 4 candidates:

| Budget                                  | ms per searched decision | Iterations |
| --------------------------------------- | ------------------------ | ---------- |
| `iters=100`                             | 169                      | 100        |
| `iters=200` (arena / `makeBot('hard')`) | 315                      | 200        |
| `iters=400`                             | 598                      | 400        |
| `iters=200,leaf=settle`                 | 193                      | 200        |
| `timeMs=1500` (UI budget)               | 1476                     | ~1450      |

The recommended budgets:

- **UI:** 1.5 s per decision through `makeBot('hard', { clock: performance.now })`, ideally in a
  worker. That is about 7× the arena's iterations, and since strength still grows with the
  budget, it should be at least as strong as the gated configuration. Trivial and
  mission-completing decisions answer at once.
- **Arena:** `iters=200`, about 35 minutes for a 200-game gate on 11 jobs.

### Learned value hook

`opts.value?: (state, seat) => number` replaces `tanh(evaluate / scale)` at **non-terminal
leaves**.

- `state` is a full, **determinized** state. It is the leaf after `settle`, that is, after the turn
  owner has ended the current turn (or, with `leaf=rollout`, after the rollout and then `settle`).
  Usually it is the start of the next player's turn.
- `seat` is always the **root** decider.
- The function must return a value in **[−1, 1] from `seat`'s side**.
- Finished games never reach the hook: they use the real result.
- `features(state, seat)` and `features(state, opponent)` are the natural inputs.
  `src/bot/arena.ts` records the same vectors with the game's outcome (`--records`).
- With the hook set, a leaf value's scale no longer needs to match `evaluate`, because Q is
  min-max normalised. `scale` then only affects the terminal margin term.

### Engine fix found by the arena

The first arena run crashed one game, `answer(sendAwayTeam.target): not answered`. `SEND_AWAY_TEAM`
takes a single legal destination without asking. If the pool is short and several source Locations
can be pulled from, it then asks for the source, and on resuming it read the target from a choice
that was never published. The primitive now remembers the automatic target
(`sendAwayTeam.autoTarget`). The regression test is in `src/engine/todo08.test.ts`. Any bot could
reach this state: the first-legal fallback picks the same source.

### Known limits

- **Strategy fusion** is reduced but not gone. SO-ISMCTS averages over worlds, and the opponent's
  in-tree choices are made as if it could see the root player's sampled world. The opponent's
  private information is not modelled separately, as it would be with MO-ISMCTS.
- **No reveal memory.** `determinize` resamples every hidden card, including cards the seat has
  seen before (revealed cards, cards that passed through play into the opponent's Log). Cards the
  stack or the pending choice reference stay put, so a blind deck-top gain candidate keeps its true
  face. This is the one known leak (`determinize.ts`).
- **No bluffing or inference model.** The opponent's hand is sampled uniformly from its unseen
  cards. Nothing is inferred from what the opponent did or did not play.
- **Short horizon.** With `turns=0`, the tree plans within the current turn only. The opponent's
  next turn is seen only through the evaluation of the post-Clean-up state. Often the in-turn tree
  is exhausted well before 2000 iterations, so extra budget has diminishing returns.
- Repeated zero-value activations are discouraged only by the prior (`PRIORS.repeatActivation`)
  and the tree depth cap.
