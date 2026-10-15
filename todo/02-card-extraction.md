# TODO 02 — Extracting card images from the TTS dump

**Depends on:** `01`. **Blocks:** `02a`, `02b`, `02c`, `14`.
**Estimate:** ~1 h. **The tool is already written and verified.**

> Read [`docs/tts-assets.md`](../docs/tts-assets.md) first. It records geometry, OCR benchmarks
> and field reliability that were measured by **looking at the images**. If you are working
> text-only you cannot re-derive any of it — trust it.

---

## What replaced the spritesheet plan

The card source is `tts/` — a Tabletop Simulator mod dump, not loose spritesheets. It already
carries the grid geometry in `card_map.json`, so the whole grid-detection / gutter-hunting stage
of a normal sprite pipeline **does not apply**. Extraction is exact arithmetic.

## 1. Slice

- [x] `tools/slice_tts.py` — **written and verified.**
- [ ] Run it:
  ```bash
  python3 tools/slice_tts.py
  ```
- [ ] Expect: **301 distinct faces**, ~302 MB in `cards/raw/`, plus `cards/index.json`.
- [ ] Note `card_map.json` has **319 rows** — the extra 18 are duplicate _copies_ of the same
      face. `(ugc, index)` is the face identity; copies are recorded under `occurrences`.

### Why native resolution

`cards/raw/` is stored at **1×**. `tools/ocr_cards.py` upscales **in memory** for OCR. Storing
3× on disk costs 1.6 GB for no benefit.

### Geometry (already handled; recorded for understanding)

```python
cw, ch = sheetW / gridW, sheetH / gridH
row, col = divmod(index, gridW)
box = (round(col*cw), round(row*ch), round((col+1)*cw), round((row+1)*ch))
```

No gutters, no offsets, no trimming. Deck sheets are `10×7` → **~307 × 432 px per card**.
53 faces are `1×1` full-resolution **Captain / oversized cards** (~1450 × 2020).

> ⚠️ `tts/faces.tsv` has a **wrong `gridH` column** (always `1`). Use `card_map.json`.

## 2. Sanity checks

- [ ] `cards/index.json` has 301 entries and `sum(copies) == 319`.
- [ ] No `MISSING local .img` error (the script exits non-zero if a sheet is absent).
- [ ] Cell sizes cluster around `307 × 427..437` for deck sheets. Slight per-sheet height
      variation is expected and correct — sheet heights differ (2992–3058).

## 3. Deck grouping metadata (free, from the dump)

- [ ] Parse `tts/inventory.json` for the object tree. It gives:
  - the six **captain bags** (`Sisko`, `Shran`, `Sela`, `Picard`, `Koloth`, `Burnham`);
  - every **ship figurine name** — `U.S.S. Enterprise-D`, `I.R.W. Valdore`, `Kumari`,
    `Deep Space 9`, … These populate `CardDef.shipToken` (`docs/data-model.md` §1) and are
    **authoritative**; don't OCR them.
  - the named common ship tokens: `U.S.S. Enterprise-B`, `Pakled Freighter`, `Kazon Raider`,
    `D'Kyr Cruiser`, `U.S.S. Reliant`, `K'Tinga Battlecruiser`, `Holographic Drone Ship`,
    `U.S.S. Enterprise-C`, `U.S.S. Pasteur`, `Xindi-Reptillian Battleship`, `Bird of Prey`,
    `Borg Probe`, `Voth Research Vessel`, `Son'a Battlecruiser`.
- [ ] Write `cards/ships.json` mapping ship name → owning deck (from the bag path).

## 4. Scope warning — the mod is not just the Core Set

- [ ] Sheet `037782` (5 cards, deckkeys 115–118) is **promo/expansion** content. One verified
      example: `Whale Probe Incursion`, which has a `SURPRISE (Bot only)` operation and
      a SPECIAL that swaps it into the Incident deck for a random INCIDENT at setup.
- [ ] **Do not assume 301 faces == the Core Set.** Filter by the printed card ID in `02c`
      (`docs/tts-assets.md` §4) before comparing against the `rules/01` §1.3 counts.

## 5. Runtime atlas (defer)

Packing an atlas for the web app is `todo/14`'s concern and is not on the critical path for
rules implementation. When you get there, the inputs are `cards/raw/` + `cards/index.json`, and
the target is 3–5 atlases of ≤2048², keyed by the printed card ID.

---

## Definition of Done

- [ ] `python3 tools/slice_tts.py` completes with exit code 0.
- [ ] `cards/raw/` holds 301 PNGs; `cards/index.json` has 301 entries summing to 319 copies.
- [ ] `cards/ships.json` lists every ship figurine with its owning deck.
- [ ] Re-running the slicer reproduces byte-identical output.
