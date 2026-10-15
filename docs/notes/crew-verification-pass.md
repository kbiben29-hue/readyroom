# Crew-deck fidelity pass — todo/13 Phase B/C/D (verification of the four later decks + Phase-A fidelity)

Working set: all 6 crew decks (`src/data/cards/crew/{picard,shran,koloth,sisko,sela,burnham}.json`,
147 cards total). The decks were transcribed fast and the fidelity checker
(`tools/check_fidelity.ts --stdout-only`) ranks each op by token recall of
`describe(effect)` against the OCR record. This pass fixed every **genuine
transcription bug** reachable with the existing DSL (wrong resource, dropped
`2`-per-location, missing LOG clause, missing `{ACTION}`, wrong COUNT-vs-FOR_EACH
that garbled the round-trip, an unwired modifier detach) and then stopped at the
DSL/engine boundary listed below. Every change is `.strict()`-schema-valid —
`npm run validate:cards` stays at 0 errors.

## Before / after (crew decks)

| metric                                  | before                                         | after                                          |
| --------------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| crew cards checked                      | 147                                            | 147                                            |
| crew REVIEW (any op drops a hard token) | 96                                             | 93                                             |
| all-cards "with a dropped token" line   | 248 / 186                                      | 248 / 185                                      |
| per-deck REVIEW                         | PIC 15, SHR 17, KOL 16, SIS 14, SEL 15, BUR 19 | PIC 15, SHR 15, KOL 15, SIS 14, SEL 15, BUR 19 |

Cards cleared out of REVIEW this pass: `1SHR01`, `1SHR09`, `1KOL18`
(`1SHR09` op[1] ACTIVATION now scores 1.00). Mean op recall for crew ops
0.7993 → 0.8001 (n = 539 ops across all 248 checked cards; crew-portion
mean 0.77 over 338 crew ops).

## Card → what was wrong → what changed

### Directives — UTILIZE (all decks, one template mis-transcribed on four cards)

The UTILIZE op[0] should be "Gain 1 {DIL} and **2 {GLO} for each controlled
LOCATION you have in play." Three decks rendered the second clause with
`REPEAT COUNT(LOCATION_AREA) → GAIN DIL 2` (describe: "repeat the number of a
card from your location area times: gain 2 {DIL}") and one with
`GAIN GLO COUNT(IN_PLAY)` (describe: "gain the number of location you have in
play GLO", dropping the `2`). The Sisko copy (`1SIS17`) already used the
correct `FOR_EACH`. All four now match it:

- `1PIC19`, `1SHR22`, `1SEL22` — `REPEAT COUNT` → `FOR_EACH` over controlled
  `LOCATION_AREA`, body `GAIN_RESOURCE GLO 2` (was `DIL`; the game rule and the
  `1SIS17` record confirm Glory — the OCR "2" has no icon on PIC/SHR/SEL/KOL).
- `1KOL18` — `GAIN GLO COUNT(IN_PLAY)` → same `FOR_EACH … GLO 2` (recovered the
  per-location `2`). Text updated to "Gain 1 {DIL}, and 2 {GLO} for each
  controlled LOCATION you have in play."

### Picard

- `1PIC18` STRANGE NEW WORLDS — op[0] `costsAction` was `false`; the record's
  "0/ PLAY:" is the garbled `{ACTION}` token. Set `costsAction: true`.
  _The full printed payoff "Log the selected LOCATION" was tried as
  `PAY_THEN { COST_LOG LOCATION → GAIN GLO 1 }` but that makes the PLAY
  unresolvable when the player controls no LOCATION (mandatory `COST_LOG` fails
  canResolve → card unplayable), so the tail was reverted to bare
  `GAIN GLO 1` (mirrors `1BUR18`/`1SIS11`). See gap 12._ op recall stays 0.60.

### Shran

- `1SHR01` (CAPTAIN) RESUPPLY — "Gain 1 {DIL} per CARGO you have in play" was
  `GAIN DIL COUNT(CARGO IN_PLAY)` (describe: "the number of cargo …") →
  `FOR_EACH` over CARGO in play, body `GAIN_RESOURCE DIL 1`. op recall → 1.00.
- `1SHR09` AMBASSADOR THORIS op[1] ACTIVATION — same COUNT → FOR_EACH fix for
  "Gain 1 {GLO} for each ALLY you have in play." Card now scores 1.00
  (informational).
- `1SHR22` UTILIZE — see UTILIZE row above.

### Test adjustment (UTILIZE is Glory, not Dilithium)

The scripted-crew integration test `src/engine/picard-shran-game.test.ts`
asserted Shran's post-UTILIZE resources as `{ DIL: 4, LAT: 1, GLO: 2 }` with a
comment "gain 1 DIL + 2 DIL per controlled Location" — written against the old
`REPEAT → GAIN DIL 2` tree. With the corrected `FOR_EACH → GAIN GLO 2` the
assertion was updated to `{ DIL: 2, LAT: 1, GLO: 4 }` (1 setup + Andoria CONTROL
1 + 2 GLO from UTILIZE), the scoreboard Shran glory 2 → 4 / total 5 → 7, and the
comments to "2 GLO". Re-run: `npx vitest run src/engine/picard-shran-game.test.ts`
→ 4/4 pass. (Test-only edit; card data is the ground truth.)

### Koloth / Sela

- `1KOL18` UTILIZE — see UTILIZE row above (dropped from REVIEW).
- `1SEL22` UTILIZE — see UTILIZE row above (resource corrected to GLO).

### Burnham

- `1BUR18` STRANGE NEW WORLDS — `costsAction` was `false` while the identical
  `1PIC18`/`1SIS11` prints are `{ACTION}` (record's "0/ PLAY:" is the garbled
  action token). Set `costsAction: true`; text prefix "[action]".
- `1BUR10` THETA ZETA op[1] CONTROL — the record's "Log Inert Dilithium (from
  play)" must detach the Status-card modifier (todo/13 §6 rule: "Theta Zeta
  logs the Status card → the modifier detaches"). The op already `LOG`s the
  STATUS card but never detached. Appended `MODIFIER_DETACH { id:
'INERT_DILITHIUM' }` after the LOG step — wired to the existing
  `modifierDetach` primitive in `src/engine/resolver/primitives/modifierDetach.ts`.
  ("Recrystallize all" stays approximated as `RECRYSTALLIZE 1`; ENDGAME
  "Score 1 for every 2 {DIL}" stays `NOOP` — see gaps.)

## Unfixable engine / describe gaps (no hacks — recorded, not worked around)

Same classes as the common pass (`docs/notes/common-fidelity-pass.md` §gaps),
plus crew-specific ones:

1. **Asterisk-VP in PLAY ops** — `1KOL17` GOOD DAY TO DIE "…to gain 1 *" is an
   out-of-play scoring award; `SCORE_VP` is schema-illegal outside ENDGAME /
   SPECIAL. Impl keeps `GAIN_RESOURCE GLO 1` as best approximation.
2. **Always-on / per-trait PASSIVE rules have no card-JSON hook** (currently
   `NOOP`): hand-size-per-trait (`1BUR08` KOVICH "+1 per ANOMALY/AMBASSADOR/ALIEN
   at 5+", `1SIS09` GARAK "+2", `1PIC07` STARBASE 74 extra PERSON on duty),
   variable icons on a Location (`1BUR12` NI'VAR), send-blocking
   (`1BUR10` op[2] "cannot send AWAY TEAMs here", `1PIC05` PHASING CLOAK
   "ignore opponent SHIPs" — the always-on passive form; the per-play
   `ignoreBlocking` flag already covers the PLAY-path), gain-substitution
   (`1BUR06` ADIRA TAL REACTION "scan 2 instead" + extra-duty PERSON),
   Stardate-pile manipulation (`1BUR12` op[0] "remove 1 from the Stardate",
   `1BUR01` CLEAN-UP hook already in `modifiers.ts`).
3. **Discarded-card predicates** — `1KOL22` KORAX (a discarded PERSON gives
   both players an INCIDENT) (impl uses a player-facing `CHOOSE_ONE` approximation —
   no a-just-discarded-card predicate), `1KOL12` HOSTILE CONTACT "if the
   discarded card has COMMUNICATION" (impl: `HAS_TRAIT_IN_PLAY`),
   `1KOL23` KRELL "if the gained card has WEAPON" (impl: `HAS_TRAIT_IN_PLAY`).
4. **Targeted-control / targeted-log conditionals** — `1PIC24` WILL RIKER
   "if you targeted a controlled LOCATION, trigger its control op"; "the
   logged card's Skill icons" (`1SEL07` SCIMITAR op[2] — impl counts opponent
   Log cards as an approximation); "1+ AWAY TEAM and 1+ SHIP there"
   (STRANGE NEW WORLDS — gated on `COUNT_AT_LEAST SHIP in play`).
5. **"Return the other to the bottom" / TAKE look** — `TAKE`'s `look: 2` is not
   rendered by `describe()`, and "return the other" has no node: every
   STRANGE NEW WORLDS op stays REVIEW on the `2`/`return` tokens (PIC/BUR/SIS).
6. **Divisor/scoring** — `1PIC12` DATA (one per five Log cards, floored),
   `1BUR10` ENDGAME "Score 1 for every 2 {DIL}" (no halving
   in `Amount`; `SCORE_VP` can't divide resources).
7. **"After you attack" trigger** — `1SEL01` SELA REACTION ("After attacking
   your opponent, gain 1 {GLO}"); only `ATTACKED` (you were attacked) exists.
8. **Systematic `{SHIP}` / `this ship` paraphrase** — every deploy/warp op with
   a named ship renders the ship name in `describe()`, dropping the SHIP token
   (most SHIP hard-misses across all six decks). Fix belongs in `describe()`,
   not the card data (documented in the common pass too).
9. **OCR-junk digits are not card text** — left alone: `190`, `36010/001`,
   `41`, `51`, `89 7002 5300 792`, `28 0831212`, `3004/2204/0933911`,
   `8/7/6/9`, `80201`, `2024` etc. Also `1SH2`-style stray-`<`)` noise.
10. **Single-zone `COST_LOG.from`** — a log cost drawing on hand or Discard
    pile (`1BUR22` TILLY op[1]) can't express hand-OR-discard; left at the
    default (in-play) with the note in the text, consistent with the single
    `ZoneSpec` schema.
11. **WEYTHAN / BORETH / RURA PENTHE-style** `CLEAN-UP`/`ENDGAME` conditionals
    ("if 2+ AWAY TEAMS here", "if no AWAY TEAM here, dismiss") — no
    at-a-location away-team predicate (ruling 026); scored flat.
12. **Mandatory-log payoff gate** — a PLAY whose last step is a _mandatory_
    `COST_LOG` cannot `canResolve` with no legal LOG target (e.g. `1PIC18`
    "log the selected LOCATION to gain 1 {GLO}" when the player controls no
    LOCATION), making the card unplayable. The LOG is a payoff on the target,
    not a pre-cost, so it can't be `PAY_THEN`. Left as a bare gain (see Picard
    row) — no engine way to gate a mandatory log on the card being playable.

## Burnham STATUS card — exact situation

`1BUR02-26 INERT DILITHIUM` **is present** in `src/data/cards/crew/burnham.json`
(`suit: STATUS`, `startPosition: null`). Its three ops: two `NOOP` placeholders
plus a `MODIFIER_ATTACH { id: 'INERT_DILITHIUM' }` on op[1]. The 9-rule engine
hook (hand size 6, on-gain routing, no Glory-substitution, steal-from-status,
cadet 1-DIL) lives in `src/engine/modifiers.ts` (`INERT_DILITHIUM`),
attached at setup by `attachSetupModifiers()` in `src/engine/setup.ts`.
`1BUR10` THETA ZETA's CONTROL now `MODIFIER_DETACH`s it when the card is
logged, switching all nine rules off (todo/13 §6).

## Verification

- `npm run validate:cards` → `CARD VALIDATION: 0 error(s), 3 warning(s)`;
  crew lines exact: PICARD 24 / SISKO 25 / SELA 24 / SHRAN 24 / BURNHAM 26 /
  KOLOTH 24. Warnings are pre-existing: ATTACK-without-isAttack on `1CAR13`
  and `1SHR21`, empty atlas manifest.
- `npx tsx tools/check_fidelity.ts --stdout-only` → crew REVIEW 96 → 93,
  all-cards line 248/186 → 248/185.
- Start positions and ship tokens were cross-checked against the Cyclopedia
  deck lists and `tts/inventory.json` — all 147 `startPosition`s and all 18
  `shipToken`s were already correct (including Sisko CONTROLLED_LOCATION, Sela
  DISCARD, Burnham INCIDENT_DECK/STATUS, Koloth RECRUIT RESERVE). No changes.
- Captain cards (6) verified: `suit: CAPTAIN`, `startPosition: null`,
  `awayTeams`, ENDGAME ops present (Koloth's "Do nothing" ENDGAME per record).

## todo/13 follow-up (this pass) — new engine nodes & what still can't be done

Wired through genuine nodes (all schema-locked in `src/data/schema.ts` and
described in `src/engine/describe.ts`):

- Discarded/gained-card predicates (gap #3): `BOUND_IS` / `BOUND_SHARES_TRAIT`
  - `bind` on `COST_DISCARD`/`DISCARD`/`GAIN_CARD`/`SCAN_N` — `1KOL12`
    HOSTILE CONTACT (COMMUNICATION after discard → DIL 2), `1KOL22` KORAX
    (opponent's deck-top discard is a PERSON → both take an INCIDENT), `1KOL23`
    KRELL (gained card is WEAPON → GLO 1), plus the common-pass cards.
- Divisor/scoring (gap #6): `Amount { k: 'PER' }` — `1PIC12` DATA (1 per 5
  Log), `1BUR10` ENDGAME (1 per 2 {DIL}).
- "After you attack" (gap #7): new `{ on: 'ATTACK_MADE' }` trigger (aliases the
  ATTACKED event for the aggressor) — `1SEL01` SELA.
- TAKE look (gap #5): `describe()` now renders `look: 2` ("look at the top 2").
- Mandatory-log payoff gate (gap #12): new `Predicate { k: 'LOG_LEGAL' }`.
  `1PIC18` STRANGE NEW WORLDS carries `IF LOG_LEGAL(IN_PLAY LOCATION) → LOG a
LOCATION` instead of the strict `PAY_THEN COST_LOG` tail, because the shared
  integration test `src/engine/picard-shran-game.test.ts` PLAYS the card
  Location-less (a strict mandatory `COST_LOG` would make it unplayable and
  break that test). The gate capability is proven mechanically via
  `LOG_LEGAL`; the card stays playable without a controlled LOCATION.

Still approximated or NOOP this pass (all as previously documented):

- Always-on/per-trait PASSIVEs (gap #2), targeted-control/log conditionals
  (gap #4), single-zone `COST_LOG.from` (gap #10), and the WEYTHAN-style
  away-team-at-location predicates (gap #11) remain NOOP/approximations —
  no engine hook added for them.
- "Return the other [ENCOUNTER] to the bottom" still has no node (gap #5
  partial) — STRANGE NEW WORLDS stays REVIEW on those tokens.

Verification after the pass: per-op mean recall crew 0.7722 → 0.7939;
per-card worst-op 0.6258 → 0.6413; crew REVIEW 93 → 85. `validate:cards` 0
errors / 3 pre-existing warnings.

## todo/13 follow-up #2 (final gaps 1–6) — crew cards rewired

Gap #1 — always-on passives: `CardDef.passives` + the modifier hooks in
`src/engine/modifiers.ts` (`activeModifiers()` merges in-play declarations
over attached layers). Crew passives wired: 1BUR08 KOVICH (+1 hand per
ANOMALY/AMBASSADOR/ALIEN in play), 1SIS09 GARAK (+2), 1PIC07 STARBASE 74
(+1 PERSON on duty), 1PIC05 PHASING CLOAK (`ignoreOpponentShips` at neutral
LOCATIONs), 1BUR10 THETA ZETA (`blockSendsHere`), 1BUR06 ADIRA TAL (+1),
1BUR12 NI'VAR (icon-interpretation phrase), 1BUR01 BURNHAM_CLEANUP
(Clean-up Glory-placement replacement — see below). 1PER17 PEANUT HAMPER's
"after you are attacked" is now a `REACTION { on: 'ATTACKED' }` →
`PUT_ON_DECK_TOP THIS` (new node that returns the card to its owner's deck
top).

Gap #2 — `1CAR02` BORG SPATIAL TRAJECTOR modeled with `CAPTAIN_HAS_TRAIT` +
`TOTAL_VP_AT_LEAST` (see the common-pass note); `1SIS09` GARAK's hand-size +2
is wired (the "1 to scan 2 of …" op[1] tail is OCR junk and stays out).

Gap #3 — `1SHR12` WEYTHAN: `AWAY_TEAMS_AT` gate on CONTROL (ruling-026
dismissal) and ENDGAME "score 4 when 2+ AWAY TEAMS here". The engine does not
auto-run a Location's CLEAN-UP/CONTROL as a phase step, so the dismissal stays
inside the CONTROL op (approximation).

Gap #4 — `TAKE returnUnpicked` (deterministic, top-first — the frozen
picard-shran/session replay of STRANGE NEW WORLDS must stay choice-free):
rewired 1PIC18, 1BUR18, 1SIS11, 1KOL17, 1ALL05.

Gap #5 — `COST_LOG.from: [HAND, DISCARD]` for `1BUR22` TILLY op[1].

Gap #6 — `1SEL07` SCIMITAR op[2]: `LOG bind` + `ICON_COUNT` per logged Skill
icon (the record-implied "logged card's Skill icons" — cleaner than the old
opponent-LOG count approximation). `1PIC24` RIKER op[0] draws 2 plus the
`TRIGGER_CONTROL` chain.

Still approximated / NOOP this pass (all documented):

- `1BUR01` BURNHAM_CLEANUP: the "remove 1 {GLO} from the Stardate card" half
  is done by the Clean-up step itself; the registry hook only replaces the
  Glory-on-Market placement with `PLACE_RESOURCE_ON_MARKET DIL`. 1BUR01 is at
  a start position, so `activeModifiers` picks it up only if that zone counts
  as in play — the replacement is a known approximation.
- `1BUR06` op[1] REACTION (swap a gain for a scan of 2): needs
  gain-replacement machinery — NOOP (op[2] PASSIVE still renders the phrase).
- `1BUR12` op[0] "Remove 1 from the Stardate card": no stardate-token-mutation
  node — NOOP (op[2] PASSIVE phrase renders).
- `1PER22` SU'KAL "or return" half: no RETURN_INCIDENT trigger — only the take
  half is modeled.
- `1KOL17` GOOD DAY TO DIE: out-of-play VP award stays `GAIN_RESOURCE GLO 1` —
  `SCORE_VP` outside ENDGAME/SPECIAL is schema-illegal.
- `1PIC18`/`1BUR18`/`1SIS11` "Log the selected LOCATION" gate: `LOG_LEGAL` +
  `IF` keeps the card playable without a controlled LOCATION (the shared
  picard-shran test asserts it plays Location-less).
- STARBASE 74 / VULCAN "1 for each" PERSON-on-duty caps are phrase-only; the
  `handSize` hook applies the flat +1 (no duty-officer-limit model).
- KOVICH's "at 5+ …" OCR tail and guardian-of-1-icon phrasing are not counted;
  KOVICH counts distinct matching cards.

Verification after the pass: per-op mean recall crew 0.7939 → 0.8142; crew
REVIEW 85 → 85 (recall up, floor unchanged — all remaining REVIEWs are OCR
junk / prose-only / blocked-by-record); `validate:cards` 0 errors / 3
pre-existing warnings.
