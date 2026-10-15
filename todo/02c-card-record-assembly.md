# TODO 02c — Assembling the canonical card records

**Depends on:** `02a`, `02b`. **Blocks:** `12`, `13`.
**Estimate:** half a day.

This step produces **the artefact the rules-implementing LLM actually works from**: one complete,
self-describing text record per card. After this, no further access to the images is needed.

---

## 1. The record format

One JSON file per card, `cards/records/<CARD_ID>.json`:

```json
{
	"cardId": "1PIC08/24",
	"key": "630391_00",
	"name": "Deanna Troi",
	"deck": "PICARD",
	"suit": "PERSON",
	"traits": ["HUMAN", "TELEPATH", "BETAZOID", "STARFLEET"],
	"skills": ["SKILL_INFLUENCE"],
	"focus": null,
	"vp": 2,
	"vpAsterisk": false,
	"startPosition": "DEVELOPMENT",
	"developmentCostText": "{DIL} x2",
	"shipToken": null,
	"copies": 1,
	"operations": [
		{
			"type": "PLAY",
			"costsAction": true,
			"isAttack": false,
			"requires": null,
			"text": "‹printed operation text with icon tokens, e.g. … 1 {GLO} …›"
		},
		{
			"type": "PASSIVE",
			"costsAction": false,
			"isAttack": false,
			"requires": null,
			"text": "‹printed operation text, e.g. … {SUIT:INCIDENT} INCIDENT …›"
		}
	],
	"provenance": {
		"nameSource": "ocr+cyclopedia",
		"startPositionSource": "cyclopedia",
		"iconConfidence": { "min": 0.91, "unknowns": 0 },
		"needsReview": false,
		"reviewReasons": []
	}
}
```

- [ ] `provenance` is not decoration. When a card plays wrong three weeks from now, it tells you
      whether to distrust the OCR, the icon classifier or your DSL tree.

## 2. Merge rules — which source wins

From `docs/tts-assets.md` §8. **Follow this table rather than improvising per field.**

| Field             | Authority                              | Cross-check                          | On conflict                                   |
| ----------------- | -------------------------------------- | ------------------------------------ | --------------------------------------------- |
| `cardId`          | OCR, repaired against the known ID set | uniqueness                           | **stop** — a duplicate ID is a real bug       |
| `name`            | Cyclopedia                             | OCR                                  | prefer Cyclopedia spelling; flag if unmatched |
| `suit`            | OCR                                    | suit glyph (`02b`)                   | flag                                          |
| `traits`          | OCR                                    | Cyclopedia trait sections            | union, flag disagreements                     |
| `startPosition`   | **Cyclopedia Deck Lists**              | OCR bottom indicator                 | prefer Cyclopedia                             |
| `deck`            | card ID prefix                         | `card_map` deckkey, `inventory` bags | prefer the ID prefix                          |
| `skills`, `focus` | icon classifier                        | Cyclopedia                           | flag                                          |
| `vp`              | OCR @3×                                | —                                    | flag if absent                                |
| operation `text`  | OCR + spliced icon tokens              | —                                    | flag any `{UNKNOWN}`                          |
| `costsAction`     | icon detection                         | the stray `/`                        | prefer detection                              |
| `requires`        | icon detection                         | —                                    | flag if `Requires` present but unclassified   |
| `shipToken`       | `inventory.json`                       | card name                            | prefer inventory                              |

## 3. Set filtering

- [ ] Split records into `cards/records/core/` and `cards/records/expansion/` using the card ID
      and the Cyclopedia's `CORE SET` sections.
- [ ] **Only Core Set is in scope** for `todo/12`/`todo/13`. Keep the expansion records — they
      cost nothing and the data model already has a `deck` discriminator
      (`docs/open-questions.md` Q5).
- [ ] Known expansion content in this dump: sheet `037782` (deckkeys 115–118), including
      `Whale Probe Incursion` with its `SURPRISE (Bot only)` operation.

## 4. Completeness validation — the real acceptance test

Everything here is checkable **without seeing a single image**.

- [ ] **ID runs are complete and gapless.** `1PIC01..24` present exactly once, and so on for
      every prefix. Report any gap by exact ID.
- [ ] **Group counts match `rules/01` §1.3**:
      Person 25 · Cargo 16 · Ship 13 · Ally 13 · Location 20 · Encounter 8 · Incident 6 ·
      Stardate 27 · Picard 24 · Sisko 25 · Sela 24 · Shran 24 · Burnham 26 · Koloth 24.
- [ ] **`startPosition` coverage**: every crew card has one; Captain and Status cards have
      `null` (`rules/09` §9.8).
- [ ] **Picard and Shran have no `DEPLOYED`, `CONTROLLED_LOCATION`, `DISCARD` or `INCIDENT_DECK`
      cards and no Status card** — the rulebook states this (`rules/02` §2.2, `rules/11`).
      **If your data disagrees, your data is wrong.** This is the single best free correctness
      check in the whole pipeline.
- [ ] **Burnham has exactly one Status card** (`Inert Dilithium`).
- [ ] **Ship token counts per deck**: Picard 3 · Sisko 3 · Sela 5 · Shran 2 · Burnham 3 ·
      Koloth 3 (`rules/01` §1.3.1).
- [ ] **Away Team counts**: every Captain card has one (Picard is **5** — verified).
- [ ] **Location tiers**: the 20 common Locations split into `STARTING` and `ADVANCED`
      (`rules/02` §2.1 step 8). Setup needs both non-empty; at least 4 Starting Locations are
      required (1 on the deck + 3 in the Neutral Zone).
- [ ] **Stardate modes**: exactly two cards marked Cadet Training, each showing 5 Glory
      (`rules/10` §10.1); the 2-player set sorted by sequence with exactly one final card.
- [ ] **Vocabulary closure**: every trait in every record is in `rules/09` §§9.4–9.6; every suit
      in §9.3; every icon token in §§9.1–9.2. An out-of-vocabulary value is an OCR error, not a
      newly discovered trait.

## 5. The human-readable dump

- [ ] Emit `cards/records/ALL.md` — every card as a readable block:
  ```
  ## 1PIC08/24 — Deanna Troi
  PICARD · PERSON · HUMAN, TELEPATH, BETAZOID, STARFLEET
  skills: SKILL_INFLUENCE · focus: — · VP 2 · start: DEVELOPMENT
  DEV. COST: {DIL} x2

  [PLAY] {ACTION} ‹draw 1; keep it, or discard it for 1 {GLO}, or log it›
  [PASSIVE] ‹any {SUIT:INCIDENT} may use an alternate PLAY: pay a discard to return it,
            and on success draw 2›
  ```
- [ ] **This file is the working document for `todo/12` and `todo/13`.** It should be complete
      enough that the rules can be implemented from it with the images deleted.
- [ ] Sort by card ID so diffs are stable.

## 6. Review queue

- [ ] `cards/records/REVIEW.md` — every record with `needsReview: true`, grouped by reason,
      with the raw OCR lines and the icon slots attached.
- [ ] Reasons worth flagging: unmatched ID · `{UNKNOWN}` icon · trait outside vocabulary ·
      zero operations · OCR/Cyclopedia name mismatch · Specialty `Requires` with no
      classification · suit-glyph disagreement.
- [ ] **Drive this list to empty before starting `todo/12`.** Every unresolved item becomes a
      card the engine will play incorrectly, and you will not notice for weeks.

---

## Definition of Done

- [ ] `cards/records/core/` contains exactly the Core Set, with counts matching `rules/01` §1.3.
- [ ] Every ID run is gapless; no ID is claimed twice.
- [ ] `cards/records/ALL.md` renders every card completely, with no `{UNKNOWN}` tokens.
- [ ] `cards/records/REVIEW.md` is empty.
- [ ] The Picard/Shran "no special start positions" check passes.
- [ ] Every trait, suit and icon token is in the `rules/09` vocabulary.
