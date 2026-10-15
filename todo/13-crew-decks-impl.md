# TODO 13 — Implementing the crew decks

**Depends on:** `02c` (card records), `11`, `12`. **Blocks:** `15`.
**Estimate:** 2–4 days (147 cards + 6 Captains + 6 boards × 2 sides).

Follow the per-card procedure in `todo/12`. This file covers what is **different** about crew
cards.

> Source: `cards/records/ALL.md`, filtered by `deck`. The card ID prefix identifies the deck
> directly — `1PIC..` Picard, `1SIS..` Sisko, `1SEL..` Sela, `1SHR..` Shran, `1BUR..` Burnham,
> `1KOL..` Koloth (`docs/tts-assets.md` §4).

---

## What's different about crew cards

| Difference                                       | Consequence                                                                                                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every card has a **deck icon**                   | `deck` — already resolved from the card ID prefix                                                                                                                                  |
| Every card has a **position indicator**          | `startPosition` — already resolved in `02c` from the **Cyclopedia Deck Lists** (pp. 26–30), which state it as plain text per captain. More reliable than OCR; treat it as settled. |
| **Development cards** carry a cost (black strip) | `developmentCost` is an `Effect`, not a number (`rules/04` §4.2)                                                                                                                   |
| **Captain cards** have no position indicator     | plus `awayTeams` and an `ENDGAME` operation                                                                                                                                        |
| **Status cards** have no position indicator      | and usually attach a **rule modifier**                                                                                                                                             |
| **Crew boards** are not cards                    | separate data: 3 tracks, multipliers, missions                                                                                                                                     |
| Decks have **their own LOCATION cards**          | played from hand; their PLAY operation performs `TAKE_CONTROL` on itself                                                                                                           |
| Some cards are marked `INCIDENT DECK`            | they get shuffled into the **shared** Incident deck at setup (`rules/02` §2.1 step 14)                                                                                             |

---

## Order: Picard → Shran → Koloth → Sisko → Sela → Burnham

This is complexity order (`rules/11`), and it is also the order in which the decks stress the
engine. **Do not start with Burnham.**

### Phase A — Picard (24 cards) and Shran (24 cards)

The rulebook states these two have **no** `INCIDENT DECK` cards, **no** `CONTROLLED LOCATION`,
`DEPLOYED` or `DISCARD` starting cards, and **no Status card** — so they only exercise
`AVAILABLE`, `RESERVE` and `DEVELOPMENT` positions. That makes them the right first pair
(`rules/02` §2.2, `rules/11`).

- [ ] **Picard.** Expect: `ALLY`-centric (his ENDGAME scores 1 VP per ALLY you own —
      `rules/07` §7.4.3), Research-leaning. Named cards from the rulebook: Beverly Crusher
      (Reserve, INCIDENT-management), Will Riker (Duty Officer with a RESUPPLY and an ACTIVATION
      recovering a SHIP from the Discard pile), Data, Worf (`ATTACK` trait, Away Teams), Phasing
      Cloak, U.S.S. Bozeman (1PIC10), U.S.S. Enterprise-D, Type 7 Shuttlecraft, Make it So, U.S.S. Pasteur,
      Geordi LaForge, Farpoint Station, Daystrom Institute.
- [ ] **Shran.** Expect: `WEAPON` equipping, Dilithium bartering, Away Teams from both
      lieutenants. Named: Tarah, Talas, Kumari, Andorian Cruiser, Imperial Pride (takes a
      DISCOVERY by spending Away Teams), Andoria, Weytahn, Ambassador Thoris, Confiscate.
      **Shran himself carries the `IMPERIAL` trait** — verify it on the Captain card.
- [ ] **Milestone:** after these 48 cards you should be able to play a full Picard-vs-Shran game.
      **Stop and do that** before transcribing more. Bugs found now are cheap.

### Phase B — Koloth (24) and Sisko (25)

- [ ] **Koloth.** Glory-hungry, `ATTACK`-heavy. Expect: D7 cruisers, Experimental Cloaking
      Device, Arne Darvin (stealing), Rura Penthe (Dilithium engine), Good Day to Die (takes a
      DISCOVERY), Kor, Kang, Tribbles, Mek'leth. **Lots of `ATTACK` operations** → this deck is
      the first real test of `FORCE` and opponent-side choices (`todo/04` §8).
- [ ] **Sisko.** Influence-centric, 25 cards. Expect: Deep Space 9 (a `STARBASE` SHIP),
      U.S.S. Defiant (1SIS15), U.S.S. Rio Grande, Odo (**has a `DUPLICATE` operation** — the rulebook uses
      him as the duplicate example), O'Brien, Kira, Garak, Bashir (`AUGMENT`), the Wormhole,
      the Orbs (**Orb of Time also duplicates**), Starbase 375, Worf (again — expect a slug
      collision with Picard's Worf; see `todo/02` Stage 3).
- [ ] **These two decks are where `DUPLICATE` gets its real test.** Re-run the three rulebook
      duplicate examples from `todo/04` §7 as integration tests once Odo and Orb of Time exist.

### Phase C — Sela (24)

- [ ] Romulan, `SHADY`, cloaking. Five ship tokens — the most of any deck. Expect: three
      D'Deridex warbirds each with a cloaking device, General Movar, Proconsul Neral, Commander
      Donatra, Valdore, Remans, Praetor Shinzon, Scimitar.
- [ ] The Shinzon/Scimitar branch is a **Development-pile fork** — check the development costs
      carefully; this is the deck most likely to have a multi-part development cost.

### Phase D — Burnham (26) — **do last**

- [ ] 26 cards **plus** the **Inert Dilithium Status card**.
- [ ] Implement the `INERT_DILITHIUM` rule modifier per `rules/11` §11.6.1 (you should have
      written it already in `todo/05` §7 — now wire the card to it).
- [ ] The nine Inert Dilithium rules, each needing a test:
  1. hand size 6 (setup **and** every Clean-up)
  2. Clean-up places **2 Dilithium** on a Market card instead of 1 Glory (and **removes** 1 Glory
     from the Stardate)
  3. gained Dilithium goes **onto the Status card** — **except** Dilithium gained from the Market
  4. **cannot** spend Glory as Dilithium (Glory-for-Latinum still works)
  5. cannot spend Status-card Dilithium; you don't own it for other effects
  6. `recrystallize` moves 1 from the Status card to the pool — **Reno, Tilly, Stamets**
  7. opponent steals **from the Status card first**
  8. Dilithium **you** steal goes to your pool (stealing ≠ gaining)
  9. Cadet mode places **1** Dilithium, not 2
- [ ] **Theta Zeta logs the Status card** → the modifier detaches and all nine rules switch off.
      Test the before/after.

---

## Captain cards (6)

- [ ] `suit: 'CAPTAIN'`, `startPosition: null`, `awayTeams: <printed>`.
- [ ] Each has an `ENDGAME` operation (Picard's: 1 VP per ALLY owned).
- [ ] Most have an `ACTIVATION` — the rulebook's p.22 example shows Shran exhausting to discard a
      card and send an Away Team, costing an action.
- [ ] The Captain card is also the **Away Team pool holder** and the **Captain's Log host** —
      both are engine state, not card data.

## Status cards

- [ ] Only Burnham has one in this box (per `rules/02` §2.2 step 4, the decks suggested for a
      first game come without one). **Verify the other four decks while
      transcribing**; if Sela, Koloth or Sisko has one, it needs its own modifier.
- [ ] `suit: 'STATUS'`, `startPosition: null`, sits **above the Crew board**, is **in play**.

## Crew boards (6 × 2 sides)

Separate data file, `src/data/cards/boards/crew-boards.json`:

```ts
interface CrewBoardSide {
	deck: DeckId
	side: 'BASIC' | 'ADVANCED'
	tracks: {
		specialty: SpecialtyId
		multipliers: { step: number; value: number }[] // e.g. [{step:4,value:2},{step:8,value:3}]
	}[]
	missions: {
		index: number
		goal: Predicate
		reward: Effect
		vp: number
		text: string
	}[]
}
```

- [ ] **Basic side: 1 mission, `vp: 0`** (mission VP scores only on Advanced — `rules/07` §7.4.1).
- [ ] **Advanced side: 3 missions with printed VP.**
- [ ] Transcribe the **multiplier positions** carefully — scoring uses the **highest reached
      multiplier value, not the step index** (`rules/07` §7.1.4), and an off-by-one here silently
      changes every game's score.
- [ ] Mission goals use `Predicate`, including `SAME_SHIP` for "on the same SHIP" goals, which
      counts the SHIP's own icons plus every card beamed to it (`rules/07` §7.2).
- [ ] The rulebook names one: **PEACE NEGOTIATIONS** (Picard) — 3 ALLY on the same SHIP, reward
      "gain 4 Dilithium and draw 4". Use it as your first mission test.

---

## Watch list — cards that will need care

Flag these during transcription; they're the ones most likely to need a new DSL node:

- [ ] **Anything with `DUPLICATE`** (Odo, Orb of Time, Laas) — see `rules/12` §12.13.
- [ ] **Anything that overrides Away Team blocking** (Iconian Gateway) → `ignoreBlocking: true`.
- [ ] **Anything that raises the Duty Officer limit** (`rules/08` → promote) → a rule modifier.
- [ ] **Anything that changes hand size** → the `handSize` hook.
- [ ] **Anything that enlists a Development outside a reshuffle** (`rules/08` → enlist a
      Development) → `ENLIST_DEVELOPMENT free:true`.
- [ ] **Anything referencing "the Badlands"** → unsatisfiable, log once.
- [ ] **Anything with an asterisk VP** → needs a `SPECIAL` operation that scores out of play.
- [ ] **Cards a Location can dismiss/recall itself with** → the escape flag on `DISMISS`/`RECALL`.
- [ ] **`WILDCARD` cards** → make sure the trait is recorded so `matchTrait` can offer it.

---

## Definition of Done

- [ ] `npm run validate:cards` reports the exact counts: Picard 24, Sisko 25, Sela 24, Shran 24,
      Burnham 26, Koloth 24 — **147 total**, plus 6 Captains and 6 boards × 2 sides.
- [ ] Every crew card is `verified`.
- [ ] ID runs are gapless: `1PIC01..24`, `1SIS01..25`, `1SEL01..24`, `1SHR01..24`,
      `1BUR01..26`, `1KOL01..24`, each present exactly once.
- [ ] Every `startPosition` is set, and setup places every card of all six decks without an
      "unclassified card" error.
- [ ] Every SHIP's `shipToken` matches a token in the manifest; every deck's token count matches
      `rules/01` §1.3.1 (Picard 3, Sisko 3, Sela 5, Shran 2, Burnham 3, Koloth 3).
- [ ] The three rulebook `DUPLICATE` examples pass as integration tests with real cards.
- [ ] All nine Burnham Inert Dilithium rules pass as tests, in both attached and detached states.
- [ ] The PEACE NEGOTIATIONS mission completes correctly **and dismisses exactly the beamed
      contributors** (`rules/12` §12.26).
- [ ] The `SCRIPT` escape-hatch count across the whole game is **≤ 5**.
