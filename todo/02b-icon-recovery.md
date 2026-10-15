# TODO 02b — Recovering the icons OCR drops

**Depends on:** `02a`. **Blocks:** `02c`, `12`, `13`.
**Estimate:** 1 day. **This is the hardest and most important step in the data pipeline.**

---

## Why this exists

OCR reads the words and **silently discards every icon**. The icons carry load-bearing rules
meaning, so the text alone is not implementable:

| Printed                        | OCR gives                             | What's lost                                       |
| ------------------------------ | ------------------------------------- | ------------------------------------------------- |
| `discard it to gain 1 {GLORY}` | `discard it to gain 1` … `OR log it.` | **which resource**                                |
| `DEV. COST: {DIL} x2`          | `DEV. COST:` … `X2`                   | **which resource**                                |
| `PLAY: Requires {RESEARCH} 4`  | `PLAY: Requires` … `4`                | **which Specialty gates this**                    |
| `{ACTION} PLAY: Put a card…`   | `/ PLAY: Put a card…`                 | **the action cost** — and a stray `/` is injected |

Skill icons, Focus icons, Away-Team counts and suit glyphs inside text are likewise invisible.

**Without this step every card is ambiguous.** With it, each card becomes a complete text record
that a non-visual LLM can implement directly.

---

## Two verified traps

1. **The `[action]` icon is a blue slanted bar; Vision renders it as a literal `/`.**
   Any operation line matching `^\s*[/|1l]\s*(PLAY|ACTIVATION|REACTION|CONTROL):` is an
   **action-cost operation**. You must both set `costsAction` and strip the stray character.
   Confirm each case against detection — don't rely on the `/` alone, since it is also a real
   character in text like `Spend 1/2/3`.
2. **`Requires` is always followed by a Specialty restriction icon.** The number OCRs fine; the
   track does not. Verified example: `Organians` → blue atom glyph on a dark plate =
   **Research** restriction. Mis-classifying this silently mis-gates an operation
   (`rules/07` §7.1.2).

---

## Approach: gap detection → crop → classify

Verified viable by cropping real gaps and identifying the icons
(`docs/tts-assets.md` §5).

### Stage 1 — Find the gaps

- [ ] `tools/find_icon_gaps.py`. For each card, group OCR lines into **text rows** by `y`
      overlap. Within a row, sort boxes by `x0` and measure inter-box gaps.
- [ ] Estimate the card's normal space width from the median intra-row gap.
- [ ] A gap **> ~2.5× the median** is an icon slot. Also treat as slots:
  - the region **before the first box** on a row (leading `[action]` icon);
  - the region **after the last box** where the panel continues.
- [ ] Emit `cards/gaps/<KEY>.json`: `{ row, x0, x1, y0, y1, before, after }` where `before`/
      `after` are the neighbouring text — **the context is what makes classification checkable.**

### Stage 2 — Build the template library

- [ ] Crop ~40 gap regions spanning the icon vocabulary and save to `icons/templates/`.
- [ ] **Naming these requires looking at them once.** Options, in order:
  1. Ask a human (or a vision-capable model) to label the ~40 templates. This is a one-time,
     ~20-minute task and makes everything downstream deterministic.
  2. Bootstrap from unambiguous context (below) and label clusters by majority vote.
- [ ] Target vocabulary, from `rules/09-icon-reference.md`:
      `DIL` `LAT` `GLO` `VP` `ACTION` `AWAY_TEAM` ·
      `SKILL_RESEARCH` `SKILL_INFLUENCE` `SKILL_MILITARY` `SKILL_ANY` `SKILL_VARIABLE` ·
      `FOCUS_RESEARCH` `FOCUS_INFLUENCE` `FOCUS_MILITARY` ·
      `REQ_RESEARCH` `REQ_INFLUENCE` `REQ_MILITARY` ·
      the eight suit glyphs · the trait glyphs.

### Stage 3 — Classify

- [ ] Icons are **strongly colour-coded** (verified), so start simple:
  - downscale the crop to 16×16, convert to Lab;
  - feature vector = colour histogram + the downscaled pixels;
  - nearest-neighbour against the templates, with a **distance threshold**.
- [ ] Anything above threshold → `{UNKNOWN}`, **never a guess**. An explicit `{UNKNOWN}` is
      recoverable in review; a confident wrong label silently corrupts a card's rules.
- [ ] Classify the **restriction plate** (dark rounded rectangle behind the glyph) separately
      from the glyph — that's what distinguishes `REQ_RESEARCH` from `SKILL_RESEARCH`, and they
      share a colour.

### Stage 4 — Bootstrap labels from context

Many slots are unambiguous from surrounding text alone. Use these to auto-label templates and to
**validate** the classifier:

| Context                                                                   | Icon must be                                                |
| ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `DEV. COST:` + gap + `x2`                                                 | `DIL` — development costs are Dilithium (`rules/04` §4.2)   |
| `Requires` + gap + digit                                                  | one of the three `REQ_*`                                    |
| gap immediately before `PLAY:`/`ACTIVATION:` at the start of a panel      | `ACTION`                                                    |
| `Score` + gap + digit, in an `ENDGAME:` panel                             | `VP`                                                        |
| `send an` + gap + `to a`                                                  | `AWAY_TEAM`                                                 |
| gap immediately before a suit word (`SHIP`, `PERSON`, `ALLY`, `CARGO`, …) | that suit's glyph                                           |
| `Spend N` / `gain N` + gap                                                | `DIL`, `LAT` or `GLO` — **ambiguous, needs the classifier** |

- [ ] Build the context rules first, run them over the corpus, and use the agreement rate with
      the classifier as your accuracy measure. **Disagreements are your review queue.**

### Stage 5 — Splice tokens back into the text

- [ ] Re-insert each classified icon into the operation text at its position, as a brace token:
      `{DIL}` `{LAT}` `{GLO}` `{VP}` `{ACTION}` `{AWAY_TEAM}` `{REQ_RESEARCH}` `{SKILL_ANY}`
      `{SUIT:SHIP}` `{TRAIT:KLINGON}` `{UNKNOWN}`.
- [ ] Result, for the verified Deanna Troi card:
  ```
  {ACTION} PLAY: ‹draw 1; keep it, or discard it for 1 {GLO}, or log it›
  PASSIVE: ‹any {SUIT:INCIDENT} INCIDENT may use an alternate PLAY:
           pay a discard to return it, and on success draw 2›
  DEV. COST: {DIL} x2
  ```
  **That is an implementable record.** The raw OCR was not.

### Stage 6 — Card-level icons

The same classifier handles the icons OCR never even leaves a gap for:

- [ ] **Skill icons** — upper-left, below the title. Up to 3 (`rules/09` §9.7). Detect by
      position, not by gap.
- [ ] **Focus icon** — bottom-right, beside the VP.
- [ ] **Away Teams** — Captain cards only, left edge, icon + number.
- [ ] **Suit glyph** — beside the suit word; a free cross-check on the OCR'd suit.
- [ ] Cross-check Skill/Focus against the Cyclopedia trait sections where you can identify the
      group headings (`docs/tts-assets.md` §7).

---

## Accuracy target and reporting

- [ ] Emit `cards/icons-report.md`: per card, the slots found, the labels assigned, the
      confidence, and every `{UNKNOWN}`.
- [ ] **Target: zero `{UNKNOWN}` on Core Set cards** before starting `todo/12`. An `{UNKNOWN}`
      inside an operation makes that card unimplementable — resolve it, don't route around it.
- [ ] Report context-rule vs. classifier agreement. Below ~95% means the templates are wrong;
      fix them rather than adding heuristics.

---

## Definition of Done

- [ ] `cards/gaps/` and `cards/icons/` exist for all 301 cards.
- [ ] The template library is labelled and committed under `icons/templates/`.
- [ ] Every `DEV. COST:` slot resolves to `{DIL}`.
- [ ] Every `Requires` slot resolves to one of the three `REQ_*`.
- [ ] Every action-cost operation is detected, and the stray `/` is stripped from its text.
- [ ] Context rules and the classifier agree on ≥95% of overlapping slots; disagreements are
      individually resolved.
- [ ] Zero `{UNKNOWN}` tokens remain inside Core Set operation text.
