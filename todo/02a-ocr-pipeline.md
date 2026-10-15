# TODO 02a — OCR the cards

**Depends on:** `02`. **Blocks:** `02b`, `02c`.
**Estimate:** 2–3 h (the runner is written; the work is repair + validation).

> **You cannot see the cards.** Every judgement here must be made from text, counts and
> cross-references. `docs/tts-assets.md` records what was measured visually — use it instead of
> guessing.

---

## 1. Run the OCR

- [x] `tools/ocr.swift` + `tools/ocr_cards.py` — **written and verified.**
- [ ] Run:
  ```bash
  python3 tools/ocr_cards.py --upscale 3 --jobs 4
  ```
- [ ] Output: `cards/ocr/<KEY>.json`, one per card:
  ```json
  {
  	"key": "630391_00",
  	"width": 307,
  	"height": 432,
  	"upscale": 3,
  	"lines": [
  		{
  			"text": "DEANNA TROI",
  			"conf": 1.0,
  			"x0": 0.032,
  			"y0": 0.042,
  			"x1": 0.285,
  			"y1": 0.083
  		}
  	]
  }
  ```
  Coordinates are **normalised, top-left origin** (the runner flips Vision's bottom-left origin).
  Lines are **re-sorted top→bottom, left→right** — Vision's native order is unreliable.

### Why macOS Vision and not tesseract

Measured on the same crop (`docs/tts-assets.md` §3): tesseract runs the words of an operation
line together and misreads letters (`…acardtoretumn…`), while Vision returns the same line
correctly spaced and spelled. **Do not substitute tesseract.**
`--upscale 3` is the measured sweet spot: at 1× the VP value is missed entirely.

- [ ] Flag any card whose OCR returned **0 lines** — that's a slicing failure, not an OCR failure.

## 2. Field segmentation by position

Card layout is consistent, so fields can be located by normalised coordinates.
**These bands were measured; don't re-guess them.**

| Field              | Measured band (top-left origin) | Notes                                                             |
| ------------------ | ------------------------------- | ----------------------------------------------------------------- |
| Name               | `y0 < 0.09`, `x0 < 0.30`        | largest text, left                                                |
| Suit               | `0.09 < y0 < 0.16`, `x0 < 0.45` | one of the known suit words                                       |
| Traits             | `x0 > 0.52`, `y0 < 0.35`        | **rotated 90°** — see the better test below                       |
| Operation panels   | `0.18 < y0 < 0.93`              | the bulk                                                          |
| `DEV. COST:`       | `0.86 < y0 < 0.93`, `x0 < 0.30` | Development cards only                                            |
| Card ID            | `y0 > 0.94`, `x1 < 0.25`        | least reliable field                                              |
| Position indicator | `y0 > 0.94`, `0.33 < x0 < 0.65` | `AVAILABLE` / `RESERVE` / `DEVELOPMENT` / `STARTING LOCATION` / … |
| VP                 | `y0 > 0.90`, `x0 > 0.85`        | small; needs the 3× upscale                                       |

Measured on `1PIC08/24` (Deanna Troi), whose OCR is reproduced in full in
`docs/tts-assets.md` §3:

```
    y0     y1     x0     x1   cf  text
 0.042  0.081  0.043  0.284 1.00  DEANNA TROI
 0.101  0.138  0.119  0.271 1.00  PERSON
 0.122  0.225  0.555  0.607 1.00  HUMAN
 0.119  0.247  0.659  0.709 1.00  TELEPATH
 0.609  0.657  0.047  0.794 0.50  PLAY: ‹operation text, line 1›
 0.659  0.694  0.048  0.376 1.00  ‹line 2, left of the icon›
 0.659  0.694  0.456  0.632 0.50  ‹line 2, right of the icon›
 0.875  0.918  0.041  0.248 1.00  DEV. COST:
 0.922  0.968  0.898  0.944 1.00  2
 0.945  0.968  0.047  0.156 0.50  1PI008/24
 0.945  0.972  0.403  0.594 1.00  DEVELOPMENT
```

### A better trait test than the x-band

Traits are printed **rotated 90°**, so their boxes are **tall and narrow** while every other
box is wide and short. Use the aspect ratio, not the position:

```
isTrait = (y1 - y0) > (x1 - x0) * 1.5   and   y0 < 0.4
```

Measured: `HUMAN` is 0.052 wide × 0.103 tall; `STARFLEET` is 0.056 × 0.145. Every horizontal
line on the card is at least 2× wider than tall. This is robust across card layouts in a way
that a fixed `x` threshold is not.

### Note the icon gap already visible above

`discard it to gain 1` ends at `x1 = 0.376`; `OR log it.` starts at `x0 = 0.456`. That
**0.08-wide hole is the {GLO} icon** — roughly 4× the median inter-word gap. This is the signal
`todo/02b` keys on, and this card is a good first test case for it.

- [ ] Write `tools/segment_ocr.py` producing `cards/fields/<KEY>.json` with each band's lines.
- [ ] **The Captain / oversized `1×1` cards use the same _relative_ bands** — they are the same
      card design at higher resolution. Normalised coordinates make this free.

## 3. Repairing the card ID — highest-value repair

Format: `1<PREFIX><NN>/<TOTAL>` (`docs/tts-assets.md` §4). The **complete valid ID set is known
in advance** from `rules/01` §1.3:

```
1PIC01..24/24   1SIS01..25/25   1SEL01..24/24
1SHR01..24/24   1BUR01..26/26   1KOL01..24/24
1PER01..25/25   1CAR01..16/16   1SHI01..13/13   1ALL01..13/13
1LOC01..20/20   1ENC01..08/08   1INC01..06/06   1STD01..27/27
```

_(The last four prefixes are inferred from the pattern — confirm the exact letters from OCR
output before locking them in.)_

- [ ] Normalise common OCR confusions **before** matching: `I`→`1`, `O`→`0`, `S`→`5` only in the
      numeric positions, `l`→`1`. Observed real errors:
      `1PIC08/24`→`1PI008/24`, `1SEL17/24`→`ISEL17/24`, `1KOL10/24`→`IKOLLOY24`,
      `1SHR05/24`→`ISHR0S/24`, `1BUR07/26`→`18JR07/26`.
- [ ] Match to the nearest valid ID by edit distance, **rejecting** anything above a small
      threshold rather than forcing a match.
- [ ] **Assign each ID at most once.** Solve it as an assignment problem over all 301 cards
      rather than greedily per card — a globally consistent assignment fixes ambiguous reads.
- [ ] Report unmatched cards and unclaimed IDs. **Both lists should end empty for the Core Set**;
      leftovers are either expansion cards (expected) or failures (fix them).

## 4. Normalising operation text

- [ ] Split each operation panel on the leading keyword — these OCR cleanly:
      `PLAY:` `ACTIVATION:` `PASSIVE:` `REACTION:` `CONTROL:` `ENDGAME:` `SPECIAL:`
      `RESUPPLY:` `CLEAN-UP:` `DEV. COST:` `SURPRISE (Bot only):`
- [ ] Join wrapped lines within a panel: same panel, consecutive `y`, and the previous line does
      not end in `.`.
- [ ] Repair known OCR artefacts in the text:
  - smart quotes → straight quotes
  - `&`, `®`, `€S`, `P` appearing immediately before a suit/trait word are **dropped icons** —
    leave a marker, don't delete (see `02b`)
  - `CED`/`CEHD`/`sHiP`/`SH` → `SHIP`; `INCIDEND`→`INCIDENT`; `WALly`/`MAutr`→`ALLY`;
    `LMALY`→`ALLY`. Build this map empirically from the corpus, **don't invent entries**.
- [ ] **Do not "fix" text you cannot verify.** A flagged uncertainty is recoverable; a confident
      wrong repair is not.

## 5. Confidence triage

- [ ] Every line carries `conf`. Mark a card **needs-review** if any of:
  - its card ID did not match the valid set;
  - an operation line has `conf < 0.5`;
  - its suit is not in the known vocabulary;
  - the number of detected operations is 0.
- [ ] Emit `cards/ocr-report.md`: per-card status, plus totals. This is your progress instrument
      for the rest of the project.

## 6. Cross-check against the Cyclopedia

`STCC-Traits_Cyclopedia_2.1.1.pdf` is **real text**, not scanned (`docs/tts-assets.md` §7).

- [ ] Write `tools/parse_cyclopedia.py` using `pymupdf`.
- [ ] Extract **Common Cards List** (pp. 2–7) and **Deck Lists** (pp. 26–30). Filter to
      `CORE SET`.
- [ ] Deck Lists give card names grouped by **position heading** — `DEPLOYED/CONTROLLED`,
      `RESERVE`, `DEVELOPMENTS`, `AVAILABLE` — per captain. This is `startPosition` **for free**
      and is more reliable than OCR'ing the bottom indicator. Make it the authority.
- [ ] Match OCR names → Cyclopedia names (normalise case, apostrophes, spacing). Report both
      directions:
  - a Cyclopedia name with no OCR match → a card you failed to read;
  - an OCR name with no Cyclopedia match → likely an expansion card, or a bad read.
- [ ] **The Cyclopedia covers expansions too.** Restrict to the `CORE SET` sections or you will
      "match" cards that aren't in this box.

---

## Definition of Done

- [ ] `cards/ocr/` has 301 JSON files, none with zero lines.
- [ ] Every Core Set card ID in the expected set is claimed **exactly once**.
- [ ] Every OCR'd name matches a Cyclopedia Core Set name, or is explicitly listed as expansion.
- [ ] `cards/ocr-report.md` exists and the needs-review list is empty or individually justified.
- [ ] Group counts reconcile with `rules/01` §1.3: 25/16/13/13 Market, 20 Location, 8 Encounter,
      6 Incident, 27 Stardate, and 24/25/24/24/26/24 crew.
