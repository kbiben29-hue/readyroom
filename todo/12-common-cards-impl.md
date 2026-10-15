# TODO 12 — Implementing the common cards

**Depends on:** `02c` (card records), `11` (workflow). **Blocks:** `15` (playable).
**Estimate:** 2–3 days.

This is the "implement each individual card so the game understands its rules" work, for the
shared cards. Crew decks are `todo/13`.

**Scope: 128 Core Set cards** — 25 PERSON, 16 CARGO, 13 SHIP, 13 ALLY, 20 LOCATION,
8 ENCOUNTER, 6 INCIDENT, 27 STARDATE.

> **Your source is [`cards/records/ALL.md`](../cards/records/ALL.md), not the images.** By the
> time you get here, `todo/02a`–`02c` have turned every card into a complete text record with
> inline icon tokens (`{DIL}`, `{ACTION}`, `{REQ_RESEARCH}`, `{SUIT:SHIP}`, …). If a record is
> incomplete or carries `{UNKNOWN}`, **fix the pipeline — do not guess the card.**

---

## The per-card procedure

For every card. ~3–5 minutes once warmed up.

1. **Read the record block** in `cards/records/ALL.md` — name, suit, traits, skills, focus, VP,
   start position, and each operation's type and text.
2. **Confirm the metadata is already correct.** Suit, traits, skills, focus, VP and
   `startPosition` come from `02c` and are cross-validated against the Cyclopedia. You are
   **not** re-deriving them; you are writing the `effect` trees.
3. For each operation, note `type`, `costsAction` (the `{ACTION}` token) and `requires`
   (the `{REQ_*}` token) — these are already decided by icon detection. Don't second-guess them
   from the prose.
4. **Build the effect tree** from the operation text.
5. **Run `describe()`** and compare it to the record text. This is your substitute for looking at
   the card (`todo/11` §2).
6. **Run the fidelity checker and the structural lint** (`todo/11` §§3–4).
7. **Dry-run** the card (`todo/11` §5).
8. **Mark `verified: true`.**

### The three questions that catch most errors

- **Is this a cost or a benefit?** "Spend X **to** do Y" / "Discard a card **to** …" → `PAY_THEN`.
  "Do X **and** Y" / "Do X. Do Y." → `SEQ`. Getting this wrong breaks `rules/12` §12.1 and the
  bug is invisible until the resource runs out.
- **Is it optional?** Any "may" → wrap in `MAY`. No "may" → mandatory, **even when bad for you**.
- **Does the card log/deploy/promote itself?** Then it does **not** stay in the Staging Area, and
  its traits stop counting the moment it moves (`rules/12` §12.4).

---

## Recommended order

Smallest and most structurally distinct first, so DSL gaps surface early and cheaply.

### Pass 1 — ENCOUNTER (8 cards) · ~45 min

- [ ] All 8. These are "major unique findings" — expect large one-shot effects, some with
      `ONGOING` (deployed by their PLAY operation).
- [ ] Their records are the smallest in the corpus, so DSL gaps surface here cheaply.
- [ ] **Stop and review:** did you need any node that doesn't exist? Add it to
      `docs/effect-dsl.md` and `todo/04` **now**, before doing 120 more cards.

### Pass 2 — INCIDENT (6 cards) · ~30 min

- [ ] All 6. These are the "get rid of me" cards: their PLAY operations have **requirements you
      must meet**, and typically end with `RETURN_INCIDENT` (to the **bottom** of the Incident
      deck — `rules/08`).
- [ ] Some INCIDENTs may carry `cannotBePlayed` — verify against `rules/03` §3.5.4.
- [ ] **Critical:** the Incident deck is the Burn clock (`rules/12` §12.11). Double-check every
      `TAKE`/`RETURN_INCIDENT` node.

### Pass 3 — STARDATE (27 cards) · ~1 h

These aren't playable cards; they're a schedule. Give them their own lightweight shape:

```ts
interface StardateDef {
  id: string; sequence: number;
  mode: '2P' | 'CADET' | 'SOLO';
  glory: number;              // Glory seeded onto this card
  botActions?: number;        // solo only — record it, ignore it for now
  effect: 'WIPE_MARKET' | 'WIPE_MARKET_AND_NZ' | 'NONE' | ...;
  isFinal: boolean;           // emptying this triggers the Resolution
  text: string;
}
```

- [ ] Transcribe all 27, **tagging `mode` correctly** — the 2-player game uses only the
      `2-PLAYER` cards, Cadet uses only the two `Cadet Training` cards (`rules/02` §2.1 step 11,
      `rules/10` §10.1).
- [ ] Verify the Cadet cards show **5 Glory** each and that the second one triggers game end
      (`rules/10` §10.3).
- [ ] Verify exactly one 2-player card is `isFinal`.

### Pass 4 — LOCATION (20 cards) · ~1.5 h

- [ ] Record `locationTier: 'STARTING' | 'ADVANCED'` from the position indicator — setup depends
      on it (`rules/02` §2.1 steps 8–10).
- [ ] Locations have **CONTROL** operations (fire on gaining control) and often **ACTIVATION**,
      **REACTION** or **ENDGAME** operations.
- [ ] Watch for Locations that reference their own tokens ("if you have an Away Team here").
- [ ] Known names from the rulebook to expect: Farpoint Station, Andoria, Weytahn, Memory Alpha,
      Archer IV, Betazed, Corvan II, Tulgana IV, Risa, Solum, Ancient Relay Station, Daystrom
      Institute, Rura Penthe, Starbase 375, Amargosa Observatory. (Some of these are crew-deck
      Locations — check the deck icon.)
- [ ] **The Badlands is not in this box** (`rules/12` §12.30) — if a card names it, the query
      yields nothing.

### Pass 5 — ALLY (13) and SHIP (13) · ~1.5 h

- [ ] **SHIP:** every one needs `shipToken` matching a token name exactly. Most have a PLAY
      operation that **deploys** them; many have `ACTIVATION: warp`.
- [ ] Ships are also **beam hosts** — nothing to encode, but it's why their traits matter.
- [ ] **ALLY:** Picard's endgame counts these, so the suit tag matters more than usual.

### Pass 6 — CARGO (16) · ~1 h

- [ ] Look for the `ONGOING` trait → the PLAY operation must contain a `DEPLOY` node
      (`rules/05` §5.2.2). The schema refinement in `todo/03` enforces this.

### Pass 7 — PERSON (25) · ~1.5 h

- [ ] The largest set. **Almost every PERSON has a table operation that is only usable once
      promoted to Duty Officer** (`rules/03` §3.5.6) — so most PERSON cards have both a PLAY
      operation and an ACTIVATION/REACTION.
- [ ] Do **not** mark the table operation as unusable; the engine already refuses table ops
      outside a table position. Just transcribe both.

---

## Card-shape cheat sheet

Recurring patterns, with the tree to reach for:

| Printed wording                                     | Tree                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| "Gain a PERSON."                                    | `GAIN_CARD suits:[PERSON]`                                         |
| "Gain a PERSON or CARGO."                           | `GAIN_CARD suits:[PERSON, CARGO]` (engine raises `CHOOSE_SUIT`)    |
| "Scan 2 of SHIP."                                   | `SCAN_N n:2 suits:[SHIP]`                                          |
| "Scan for KLINGON."                                 | `SCAN_FOR_TRAIT traits:[KLINGON]`                                  |
| "Spend 2 Dilithium: draw 2."                        | `PAY_THEN(COST_RESOURCE DIL 2, DRAW 2)`                            |
| "Discard a card to gain 1 Glory."                   | `PAY_THEN(COST_DISCARD 1, GAIN_RESOURCE GLO 1)`                    |
| "Draw a card and gain 1 Latinum."                   | `SEQ[DRAW 1, GAIN_RESOURCE LAT 1]`                                 |
| "You may draw a card."                              | `MAY(DRAW 1)`                                                      |
| "Advance Research."                                 | `ADVANCE_SPECIALTY RESEARCH 1`                                     |
| "Advance a Specialty of your choice."               | `ADVANCE_SPECIALTY specialty:'CHOICE' 1`                           |
| "Gain 1 Glory for each ALLY in play."               | `GAIN_RESOURCE GLO { k:'COUNT', query:{filter:{suits:['ALLY']}} }` |
| "If you have 2+ ANOMALY in play, draw."             | `IF(HAS_TRAIT_IN_PLAY ANOMALY 2, DRAW 1)`                          |
| "MILITARY 3+ — …"                                   | `operation.requires = { specialty:'MILITARY', min:3 }`             |
| "[action] …"                                        | `operation.costsAction = true`                                     |
| "ATTACK: your opponent takes an INCIDENT."          | `isAttack:true`, `OPPONENT(TAKE deck:'INCIDENT' count:1)`          |
| "Force your opponent to discard a card."            | `FORCE(DISCARD count:1)` — **they** choose                         |
| "Your opponent discards a card of your choice."     | `OPPONENT(...)` with the choice seat kept as **you**               |
| "Beam a card from your hand to a SHIP you control." | `BEAM from:HAND to:{filter:{suits:['SHIP']}, zones:['FLEET']}`     |
| "Send an Away Team."                                | `SEND_AWAY_TEAM count:1 target:<any legal>`                        |
| "Warp a SHIP."                                      | `WARP ship:<choose> to:<choose>`                                   |
| "Log this card."                                    | `LOG target:'THIS'` — put it **last** in the `SEQ`                 |
| "Promote this card."                                | `PROMOTE from:'STAGING'` targeting `THIS`                          |
| "Deploy this card."                                 | `DEPLOY target:'THIS'`                                             |
| "Take an INCIDENT."                                 | `TAKE deck:'INCIDENT' count:1`                                     |
| "Return an INCIDENT from your hand."                | `RETURN_INCIDENT target:{zones:['HAND']}`                          |
| "Gain an action."                                   | `GAIN_ACTION 1`                                                    |
| "Refresh a SHIP."                                   | `REFRESH target:{zones:['FLEET'], filter:{suits:['SHIP']}}`        |
| "Up to 3 …"                                         | `{ k:'UP_TO', max: 3 }`                                            |

---

## Quality bar

Before marking a card **verified**, confirm — all of these are checkable from text alone:

- [ ] `describe(effect)` means the same as the record text.
- [ ] Every " to " joining two clauses is a `PAY_THEN`, not a `SEQ` (`rules/12` §12.1).
- [ ] Every "may" is a `MAY`.
- [ ] Every "either … OR …" is a `CHOOSE_ONE`.
- [ ] `costsAction` matches the record's `{ACTION}` token.
- [ ] `requires` matches the record's `{REQ_*}` token.
- [ ] Every number in the record appears as an `Amount` in the tree.
- [ ] Every `{ICON}` token maps to a node parameter — no icon is silently dropped.
- [ ] "Log this card" is the **last** step of its `SEQ` (`rules/12` §12.4).
- [ ] The dry-run resolves without an unreachable branch.

## Definition of Done

- [ ] `npm run validate:cards` reports **128 / 128** Core Set common cards, 0 errors.
- [ ] Every common card is marked `verified`.
- [ ] Counts match `rules/01` §1.3 exactly: 25/16/13/13/20/8/6/27.
- [ ] Every common card has a record in `cards/records/core/` and vice versa.
- [ ] The fidelity checker and structural lint report zero unresolved violations.
- [ ] The `SCRIPT` escape-hatch count across all common cards is **≤ 2**.
- [ ] A smoke game with only common cards + stub captains runs setup → Clean-up without throwing.
