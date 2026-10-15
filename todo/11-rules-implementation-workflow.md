# TODO 11 — The rules-implementation workflow (text-only)

**Depends on:** `02c` (card records), `03` (schema), `04` (DSL).
**Blocks:** `12`, `13`.
**Estimate:** half a day to set up. **Saves days across ~300 cards.**

> This replaces the visual authoring tool from the original plan. The implementing LLM **cannot
> see the cards**, so the workflow is: read `cards/records/ALL.md` → write an effect tree →
> have the machine check it back. Every verification step below is textual.

---

## 1. The loop

For each card:

```
record (text + icon tokens)  →  effect tree (JSON)  →  describe() → English  →  diff vs. record
                                      ↓
                               schema + refinements
                                      ↓
                                  dry-run in a sandbox game
```

**The `describe()` round-trip is the substitute for looking at the card.** If the tree renders
back to something that means what the record says, the tree is probably right. If it doesn't,
it's definitely wrong.

## 2. `describe()` — build this first

- [ ] `src/engine/describe.ts`: `describe(effect: Effect): string`, rendering an effect tree into
      English **using the same vocabulary and icon tokens as the card records**.
- [ ] `PAY_THEN` → `"Spend 2 {DIL} to gain a CARGO."`; `SEQ` → `"Gain a CARGO. Draw a card."`;
      `MAY` → `"You may …"`. The distinction between `to` and `.` is exactly the cost/benefit
      distinction from `rules/12` §12.1, so the round-trip **directly tests the thing most likely
      to be wrong**.
- [ ] Render resources as `{DIL}`/`{LAT}`/`{GLO}` so output is comparable to the records
      character-for-character where possible.
- [ ] `describe()` is reused by the game UI for tooltips (`docs/ui-spec.md` §3) — it is not
      throwaway scaffolding.

## 3. The fidelity checker

- [ ] `tools/check_fidelity.ts` — for every card with an implemented tree:
  1. render `describe(effect)`;
  2. normalise both it and the record text (lowercase, collapse whitespace, strip punctuation);
  3. compute token-level recall of the **record's** significant tokens in the description.
- [ ] Flag any card where a **significant token** in the record is absent from the description:
      numbers, `{ICON}` tokens, suit names, trait names, and the keyword verbs from
      `rules/08` (`beam`, `dismiss`, `log`, `warp`, `scan`, `promote`, `duplicate`, …).
- [ ] This catches the classic failure: the record says `gain 2 {DIL}` and the tree says
      `amount: 1`. No human reading is needed to catch it.
- [ ] It will also produce false positives on paraphrase. That's fine — it's a **review queue**,
      not a gate.

## 4. Structural lint over the trees

Mechanical checks that need no understanding of the card:

- [ ] Record text contains `to` joining two clauses → the tree should contain `PAY_THEN`.
      Warn if it's a bare `SEQ`. (`rules/12` §12.1)
- [ ] Record text contains `may` → the tree should contain `MAY`.
- [ ] Record text contains `either` / `OR` between clauses → expect `CHOOSE_ONE`.
- [ ] Record has `{ACTION}` → `operation.costsAction === true`.
- [ ] Record has `{REQ_*}` → `operation.requires` set to the matching Specialty.
- [ ] Record text starts `ATTACK` → `isAttack === true`.
- [ ] Record mentions `Log this card` → tree contains `LOG target:'THIS'` **as the last step**.
- [ ] Record mentions a number `N` → some `Amount` in the tree equals `N`.
- [ ] Every `{ICON}` in the record maps to a corresponding node parameter.
- [ ] `REACTION` operation → `trigger` present (already in `todo/03`'s schema refinements).

## 5. The sandbox dry-run

- [ ] `tools/dryrun.ts <cardId>`: build a minimal `GameState` (`todo/06` setup with stub decks),
      place the card in the appropriate zone, resolve each operation, and print:
  - every `PendingChoice` raised, with its candidates;
  - the resource/zone delta;
  - the event log.
- [ ] **Catches the unresolvable-operation bug**: an operation whose cost can never be paid, or
      whose target set is always empty, is a transcription error.
- [ ] Assert `canPlay` is true in _some_ constructible state for every PLAY operation
      (`todo/16` §6).

## 6. Working order and batching

- [ ] Implement in **batches of ~10 cards**, then run schema + fidelity + lint + dry-run on the
      batch before moving on. Long unvalidated runs are how 40 silent errors accumulate.
- [ ] Keep `verified: true` in each record once its tree passes all four checks.
- [ ] Track the **`SCRIPT` escape-hatch count** (`docs/effect-dsl.md` §8). Budget **5** for the
      whole game. At 10, stop and generalise the DSL instead.

## 7. When the record is genuinely ambiguous

You cannot look at the card, so when the text underdetermines the rules:

1. **Check the rulebook first.** `rules/08-keywords-reference.md` is authoritative and resolves
   most apparent ambiguity — that's why it was written.
2. **Check the Cyclopedia** for traits/positions.
3. **Check for a sibling card** with near-identical wording already implemented.
4. **If still ambiguous, do not guess.** Add the card to `cards/records/REVIEW.md` with the exact
   question, implement the rest of the batch, and move on. A flagged card is recoverable; a
   confidently wrong one is not.

- [ ] Keep `docs/card-rulings.md` — a log of every interpretation you had to make, with the
      reasoning and the rulebook section relied on. Future-you will re-litigate these otherwise.

---

## Definition of Done

- [ ] `describe()` round-trips all seven worked examples in `docs/effect-dsl.md` §7.
- [ ] `tools/check_fidelity.ts` runs over the whole corpus and produces a ranked review queue.
- [ ] The structural lint in §4 runs and reports zero violations on implemented cards.
- [ ] `tools/dryrun.ts` resolves a `PAY_THEN` card and prints its choices.
- [ ] `docs/card-rulings.md` exists.
