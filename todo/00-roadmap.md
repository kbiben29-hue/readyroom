# Roadmap

Read `docs/architecture.md` first. Each todo file is self-contained and ends with a
**Definition of Done** you can actually check.

## Milestones

### M0 — Foundations (≈1 day)

| Todo                                           | Output                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| [01-project-setup.md](01-project-setup.md)     | Vite + TS + Vitest skeleton, lint rules that protect determinism |
| [02-card-extraction.md](02-card-extraction.md) | TTS dump → 301 individual card PNGs (**tool written**)           |
| [03-card-schema.md](03-card-schema.md)         | Zod schema, ID enums, validator CLI                              |

### M0b — Card data extraction (≈2 days) — _runs in parallel with M1_

| Todo                                                       | Output                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| [02a-ocr-pipeline.md](02a-ocr-pipeline.md)                 | macOS Vision OCR → `cards/ocr/` (**tool written**)                       |
| [02b-icon-recovery.md](02b-icon-recovery.md)               | Recover the icons OCR drops → inline `{DIL}`/`{ACTION}` tokens           |
| [02c-card-record-assembly.md](02c-card-record-assembly.md) | **`cards/records/ALL.md`** — the text corpus everything downstream reads |

### M1 — Engine core (≈4–6 days)

| Todo                                                         | Output                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| [04-effect-dsl-core.md](04-effect-dsl-core.md)               | Effect node types + the resolver stack machine             |
| [05-engine-state.md](05-engine-state.md)                     | `GameState`, zones, RNG, queries                           |
| [06-setup-and-turn-loop.md](06-setup-and-turn-loop.md)       | Setup from `rules/02`; the 4-phase loop from `rules/03`    |
| [07-choice-system.md](07-choice-system.md)                   | `PendingChoice`, validation, probe mode                    |
| [08-market-and-locations.md](08-market-and-locations.md)     | Market, gain/scan, Neutral Zone, control, warp, Away Teams |
| [09-triggers-and-reactions.md](09-triggers-and-reactions.md) | Event bus, PASSIVE, REACTION windows                       |
| [10-scoring-and-endgame.md](10-scoring-and-endgame.md)       | Resolution, Burn, final scoring                            |

**M1 exit test:** a scripted game using ~8 hand-written fake cards plays from setup to final
score, headless, deterministically.

### M2 — Card rules (≈4–7 days)

| Todo                                                                       | Output                                                                                         |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [11-rules-implementation-workflow.md](11-rules-implementation-workflow.md) | `describe()` round-trip, fidelity checker, lint, dry-run. **Build before implementing cards.** |
| [12-common-cards-impl.md](12-common-cards-impl.md)                         | 128 common cards: 67 Market + 20 Location + 8 Encounter + 6 Incident + 27 Stardate             |
| [13-crew-decks-impl.md](13-crew-decks-impl.md)                             | 147 crew cards + 6 Captains + 6 boards, Picard & Shran first                                   |

### M3 — Playable (≈3–5 days)

| Todo                                         | Output                                            |
| -------------------------------------------- | ------------------------------------------------- |
| [14-ui-shell.md](14-ui-shell.md)             | Board, hand, choice panel, log                    |
| [15-opponent-modes.md](15-opponent-modes.md) | Cadet Training, then hot-seat, then (blocked) Bot |

### M4 — Hardening (ongoing)

| Todo                                                         | Output                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| [16-testing.md](16-testing.md)                               | Rules-conformance suite, one test per `rules/12` edge case |
| [17-persistence-and-polish.md](17-persistence-and-polish.md) | Save/load, undo, replays, accessibility                    |

## The critical path

```
01 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → M1 exit test ┐
                                                           ├→ 11 → 12 → 13 → 14 → 15 → playable
01 → 02 → 02a → 02b → 02c → cards/records/ALL.md ──────────┘
```

The **engine track** (`03`–`10`) and the **data track** (`02`–`02c`) are independent and meet at
`11`. If you have a spare pair of hands, that's the split. The data track is the one with the
unknowns in it, so if you're working alone, spike `02a`+`02b` on ~20 cards early to find out how
good the icon classifier is before committing to the schedule.

## Sequencing advice

1. **Do not start the UI before the M1 exit test passes.** Every hour of UI built on a wrong
   state shape costs three to unwind.
2. **Do not implement cards before `02c` is clean.** A record carrying `{UNKNOWN}` is a card the
   engine will play wrong, and you will not notice for weeks. Drive `REVIEW.md` to empty first.
3. **Do not implement cards before `11` exists.** Without the `describe()` round-trip you have no
   way to check a tree against a card you cannot see.
4. **Implement the 8 Encounter and 6 Incident cards first** — smallest sets, most structurally
   distinct, and they smoke out missing DSL primitives before you commit to 67 Market cards.
5. **Keep a running `SCRIPT` escape-hatch count** (`docs/effect-dsl.md` §8). Budget: 5. If you
   pass 10, stop and generalise the DSL.

## Effort estimate

| Milestone | Engineering                  | Transcription                              |
| --------- | ---------------------------- | ------------------------------------------ |
| M0        | 1 d                          | —                                          |
| M0b       | 2 d (OCR + icons + assembly) | —                                          |
| M1        | 4–6 d                        | —                                          |
| M2        | 0.5 d (the harness)          | 3–5 d (~275 Core Set cards @ 3–5 min each) |
| M3        | 3–5 d                        | —                                          |
| M4        | ongoing                      | —                                          |

**Card rules implementation dominates.** Every hour spent making `02b` more accurate and `11`'s
checks sharper pays back several times over — a bad record costs far more than a slow one.
