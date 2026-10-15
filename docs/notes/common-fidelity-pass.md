# Common-card fidelity pass — todo/12 (fixes applied on top of the text-only workflow)

Working set: 101 common cards (`src/data/cards/common/`). The fidelity checker
(`tools/check_fidelity.ts`, `--stdout-only`) ranks implemented cards by token
recall of `describe(effect)` against the OCR record. This pass fixed every
**genuine transcription bug** reachable with the existing DSL — hard-misses
(number/icon/suit tokens missing, wrong seat/zones, dropped clauses) — then
stopped at the DSL/engine boundary described at the bottom. Every change is
`.strict()`-schema-valid (`npm run validate:cards` = 0 errors).

## Before / after (common cards)

| metric                             | before                                                                   | after                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| common cards checked               | 101                                                                      | 101                                                                      |
| REVIEW (any op drops a hard token) | 61                                                                       | 55                                                                       |
| mean op recall                     | 0.720                                                                    | 0.745                                                                    |
| per-file REVIEW                    | person 19, cargo 8, encounter 5, location 6, ship 13, incident 4, ally 6 | person 15, cargo 6, encounter 5, location 6, ship 13, incident 4, ally 6 |

Cards fully cleared out of REVIEW this pass: `1CAR15`, `1CAR03`, `1PER24`,
`1PER02`, `1PER10`, `1PER22`. Overall checker line: `248 implemented card(s)
checked, 186 with a dropped token` (constant 0-1 delta because the 147 crew
cards dominate that count; the common-card recall is the meaningful signal).

## Card → what was wrong → what changed

### person.json

- `1PER23/25` TALOK — `[ATTACK]` prefix missing → `isAttack: true` on op[0].
- `1PER07/25` CAPTAIN DORG — op[2] removed 2 Away Teams in one step and never
  granted the reward → `REPEAT UP_TO 2 { SEQ[ REMOVE_AWAY_TEAM 1 OPPONENT,
GAIN_RESOURCE GLO 1 ] }` so "Gain 1 {GLO} for each removed" renders.
- `1PER08/25` HARRY MUDD — FORCE→LOG zones pointed at seat 0 (your own log)
  in an OPPONENT block → zone `seat: 1` so it logs "from their hand/discard".
- `1PER04/25` AMBASSADOR KAMARAG — `RETURN_INCIDENT` target had no incidental
  filter → `filter: { suits: ['INCIDENT'] }`.
- `1PER21/25` SAKONNA — op[0] missing the "scan for a WEAPON" clause →
  inserted `SCAN_FOR_TRAIT WEAPON` inside the find MAY; op[1] RESUPPLY trailing
  NOOP was the dropped "and you have a WEAPON in play, additionally gain an
  {ACTION}" clause → `IF AND(HAND WEAPON ≥1, HAS_TRAIT_IN_PLAY WEAPON) →
GAIN_ACTION 1`.
- `1PER24/25` TEVRIN KRIT — op[1] `GAIN_RESOURCE LAT {COUNT(CARGO)}` rendered
  without the per-card `1` → `FOR_EACH CARGO in play { GAIN_RESOURCE LAT 1 }`
  ("For each CARGO you have in play, gain 1 {LAT}").
- `1PER09/25` JORET DAL — op[0] "If you do both, gain 1 {GLO}" was a NOOP and
  the conditional couldn't be expressed → nested the second `MAY{ log PERSON →
gain 1 GLO }` inside the put→send MAY so the reward only fires when both
  optional effects were taken (exactly "if you do both").
- `1PER02/25` ADMIRAL NECHEYEV — op[1] RESUPPLY dropped the merged
  "ACTIVATION: Spend 1 {GLO} to warp any number of your ships" clause →
  `SEQ[ draw-per-OPS(min 3), PAY_THEN(COST_RESOURCE GLO 1 → REPEAT UP_TO
COUNT(ships) WARP) ]`.
- `1PER19/25` RIVA — op[0] logged only from hand → `LOG` target extended to
  HAND+DISCARD, and the "gain 1 {GLO}" reward (previously NOOP) added inside
  the MAY.
- `1PER22/25` SU'KAL — op[1] PASSIVE "whenever you take … an INCIDENT, gain
  1 {GLO}" was a NOOP → converted to a `REACTION { on: 'INCIDENT_TAKEN' } →
GAIN_RESOURCE GLO 1`. The "or return" half has no `RETURN_INCIDENT` trigger
  (see gaps) — the take half is now realized rather than dropped entirely.

### cargo.json

- `1CAR11/16` PHASERS — op[1] "spend 1 {DIL} to gain an {ACTION}" body was a
  NOOP → `GAIN_ACTION 1`.
- `1CAR05/16` FORCED SINGULARITY — op[0] `FIND` searched only ENGINEER →
  `traits: ['ENGINEER','OPS']`; op[2] (draw two, one goes back on the Draw
  deck) had the put as NOOP → `COST_PUT count 1 to DECK_TOP`.
- `1CAR15/16` TYPE III DISRUPTOR PISTOLS — op[0] "Gain 1 {GLO} for each
  removed" was a NOOP → the optional discard now resolves
  `REPEAT UP_TO 2 { SEQ[ REMOVE_AWAY_TEAM 1 OPPONENT, GAIN_RESOURCE GLO 1 ] }`
  (mirrors DORG).
- `1CAR03/16` CLOAKING DEVICE — op[0] "Refresh up to 3 of your SHIP" kept `3`
  as a REFRESH `count` that describe ignores → wrapped in
  `REPEAT UP_TO 3 { REFRESH }` so the `3` renders.

### encounter.json / ship.json / location.json

- `1ENC07/8` SHA KA REE — `[ATTACK]` prefix missing → `isAttack: true`.
- `1SHI12/13` VOTH RESEARCH VESSEL — op[2] was only "beam a card" → extended
  to `SEQ[ discard → beam, dismiss HUMAN → take ENCOUNTER, log this ]`
  matching the record's three clauses.
- `1LOC19/20` VEREX III — CONTROL "Gain 1 {ACTION}. Log a PERSON to gain 2
  {GLO}" was wrong/duplicated → `SEQ[ GAIN_ACTION, PAY_THEN(COST_LOG PERSON →
GAIN_RESOURCE GLO 2) ]`; the stray duplicate ACTIVATION op was removed.

## DSL / engine gaps (stopped here rather than hacking)

These still drop tokens and need engine or describe work, not card JSON:

1. **Static PASSIVE rules have no card-JSON representation** (currently NOOP):
   `1PER22` ("or return" half), `1PER01` (cannot play/promote with ATTACK +
   additional STARFLEET PERSON on duty), `1PER09` op[1] / `1PER23` op[1] (hand
   size +1), `1CAR05` op[1] (additional PERSON on duty), `1ENC03` (hand size +1,
   scan-includes-Junk — uses `MODIFIER_ATTACH`), `1PER17` (after attacked, put
   self on deck top).
2. **Discarded-card predicates** — "if the discarded card is ROMULAN/BUSINESS"
   (`1PER13` LURSA), "…shares at least one trait with your captain" (`1LOC06`
   CORVAN II), "…has 23/8" (`1INC05` SUBSPACE PHENOMENON), "…is [x]→gain 1"
   (`1SHI01` BIRD-OF-PREY), "…has [blank trait], gain 2 {GLO}" (`1PER07`
   DORG), "…had a trait, discard shares with RIVA" (`1PER19` op[1]). Needs a
   "the card paid/put was X" binding + trait comparison.
3. **Reveal / opponent-hand**: `1CAR09` MEK'LETH (opponent shows their hand, you
   may throw out one ATTACK from it…) needs a REVEAL node
   and an opponent-hand discard zone (only a `discard` from your own hand / seat
   exists). `1PER08` MUDD "if they cannot, they take an INCIDENT" needs an
   else-on-failed-log.
4. **Divisor** — Glory per pair of Log cards, halved and floored
   (`1PER05` op[2]), "draw for every 2 ANOMALY" (`1SHI13` op[1]): `Amount` has
   no halving.
5. **REGENERATE + captain predicates** — `1CAR02` "if your captain has BORG and
   you have 6+ value, regenerate 1…".
6. **Seat-specific triggers** — `1PER04` "after your OPPONENT takes control of a
   location": `LOCATION_CONTROLLED` has no OPPONENT seat.
7. **Systematic `SHIP` paraphrase** — every "deploy/warp this ship" renders the
   ship name, dropping the `{SHIP}` token (all 13 common ship cards stay
   REVIEW, e.g. `1SHI02`, `1SHI05`, `1SHI08`, `1SHI11`…). Fix belongs in
   `describe()` (emit "this ship"), not per card.
8. **Describe misses (semantic-only)** — `includeJunk` on GAIN_CARD/SCAN
   doesn't print "from the Junk" (`1PER05`, `1SHI07`); TAKE's `look` isn't
   printed (`1ALL05`); BEAM ignores `from` zones (`1SHI02` already carries
   `from: HAND+DISCARD` but the text never shows "Discard pile"); GAIN_ACTION
   prints "Gain an {ACTION}." so "gain 1" cards lose the `1` (`1LOC19`).
9. **OCR-junk hard digits are not real card text** and were left alone:
   `51/31/41` (`1ALL11`, `1ALL04`, `1ALL08`, `1SHI11`, `1SHI08`), `88 7`
   (`1SHI04`, `0`/`1`), `3004`/`2002`/`6`/`88039` (`1ENC06`, `1CAR07`),
   `287 363 1000` (`1LOC19`), `2204` (`1INC01`), `0933911` (`1PER06`),
   `28/0831212` (`1INC04`), `0 385 2004 461` (`1INC06`), `06810108 8608301`
   (`1ALL07`), `093089` (`1LOC13`), `2024`/`ARR 1` (`1LOC16`), `8` (`1PER11`),
   `23 8` (`1INC05`), `080 03303` (`1PER04`). Faking amounts would be worse.
10. **Merged-record clauses**: `1PER02`/`1PER10`/`1LOC19` records fold an
    ACTIVATION clause into another op's text; per the "record is the spec"
    convention these were folded into the matching op's effect so the checker
    round-trips. If the record ever gets split into true separate ops, those
    clauses should move into genuine ACTIVATION ops (engine-correct).

## Verification

- `npm run validate:cards` → `CARD VALIDATION: 0 error(s), 3 warning(s)`;
  common counts `25/16/13/13/20/8/6` all present (3 warnings are pre-existing:
  ATTACK-trait-without-isAttack on `1CAR13`, `1SHR21`, and the empty atlas
  manifest).
- `npx tsx tools/check_fidelity.ts --stdout-only` → 55 common REVIEW, mean
  0.745.
- `npx vitest run src/engine/describe.test.ts` → 10/10 pass.

## todo/12 follow-up (this pass) — new engine nodes & what still can't be done

Wired through genuine nodes (see `src/engine/resolver/nodes.ts` /
`src/engine/resolver/queries.ts` + `src/data/schema.ts` keep them in
lock-step, all described in `src/engine/describe.ts`):

- Discarded/gained-card predicates (gap #2): `Predicate { k: 'BOUND_IS' }` and
  `{ k: 'BOUND_SHARES_TRAIT' }` read a `bind` written by `COST_DISCARD` /
  `DISCARD` / `GAIN_CARD` / `SCAN_N`. Now `1PER07` DORG op[0] (discarded is
  WEAPON → gain SHIP), `1PER13` op[1] (ROMULAN/BUSINESS after discard),
  `1LOC06` (shares trait with your CAPTAIN), `1PER19` op[1] (shares a trait
  with RIVA in play), `1KOL12`, `1KOL22`, `1KOL23`.
- Divisor (gap #4): `Amount { k: 'PER'; every; of }` (rounded down) —
  `1PER05` op[2] (1 per 2 Log), `1SHI13` op[1] (1 per 2 ANOMALY, cap 4),
  `1PIC12` DATA, `1BUR10` ENDGAME (1 per 2 {DIL}).
- Reveal / opponent-hand (gap #3): `Effect { k: 'REVEAL' }` plus
  `whose: 'OPPONENT'` on `COST_DISCARD`/`DISCARD` — `1CAR09` MEK'LETH,
  `1KOL22` KORAX.
- Seat-scoped trigger (gap #6): `{ on: 'LOCATION_CONTROLLED', seat: 'OPPONENT' }`
  — `1PER04` KAMARAG.
- Ship paraphrase (gap #7): `describe()` emits "this ship"; the 13 common SHIP
  suit-wide targets were restricted with `filter.suits: ['SHIP']`.
- Log-payoff gate: new `Predicate { k: 'LOG_LEGAL' }` backs `1PIC18` STRANGE
  NEW WORLDS (see the crew pass note).

Still approximated or NOOP this pass:

- `1INC05` SUBSPACE PHENOMENON "has 23/8" — the sub-trait is OCR junk (gap #9),
  no trait to key `BOUND_IS` on (NOOP).
- `1PER07` DORG's "…has [blank trait], gain 2 {GLO}" half is OCR junk — left
  out (op[0] keeps the clean discard→WEAPON→SHIP shape).
- `1PER19` op[1]'s record counts _how many_ shared traits; the engine can only
  test "shares ≥1 trait with a RIVA in play" (approximated as GLO 1).
- `1PER08` MUDD "if they cannot, they take an INCIDENT" (else-on-failed-log)
  has no node yet — unchanged.
- Static PASSIVE rules (gap #1), REGENERATE/captain predicates (gap #5),
  single-zone `COST_LOG.from` (crew gap #10) remain as documented.

Verification after the pass: per-op mean recall common 0.8433 → 0.8875;
per-card worst-op 0.7442 → 0.7920; common REVIEW 55 → 45. `describe.test.ts`
10/10, `validate:cards` 0 errors / 3 pre-existing warnings.

## todo/13 follow-up #2 (final gaps 1–6) — always-on passives and the rest

Gap #1 — static always-on PASSIVE rules now have a real hook. `CardDef.passives:
string[]` attaches scoped modifier ids; `src/engine/modifiers.ts` gained the
registry entries (JORET_DAL_HAND, TALOK_HAND, FORCED_SINGULARITY_HAND,
STARBASE_74_HAND, ADIRA_TAL_HAND, GARAK_HAND, KOVICH_HAND, THETA_ZETA_BLOCK,
PHASING_CLOAK_BLOCK, NI_VAR_ICONS, GUARDIAN_OF_FOREVER, BURNHAM_CLEANUP), and
`activeModifiers()` merges in-play `passives` declarations over the attached
layers (STATUS cards / MODIFIER_ATTACH) so a card leaving play just stops
contributing. Hooks feed `effectiveHandSize`, `canSendAwayTeam`
(`blocksSendsTo` + `ignoresOpponentShips`), `scanIncludesJunk`, and
`cleanupGloryEffect`. The PASSIVE operation still carries a
`MODIFIER_ATTACH { id }` node purely so `describe()` round-trips the OCR
phrase. Cards wired: 1PER09, 1PER23, 1CAR05, 1BUR08, 1SIS09, 1PIC07, 1BUR06,
1PIC05, 1BUR10, 1BUR12, 1ENC03, 1BUR01(0).

Gap #2 — REGENERATE/captain half: new predicates `CAPTAIN_HAS_TRAIT` /
`TOTAL_VP_AT_LEAST` (the "your captain has BORG and you have 6+ value" gate).
`1CAR02` op[1] is modelled as `IF gate THEN MAY SEND_AWAY_TEAM ignoreBlocking`
— the garbled "regenerate 1" OCR tail is left out, the send is a plain MAY.

Gap #3 — at-location away-team count: `AWAY_TEAMS_AT` (you / your opponent /
any, threshold N) keyed off `state.awayTeamsAt`. `1SHR12` WEYTHAN CONTROL now
carries the ruling-026 "if no AWAY TEAM here, dismiss this" gate and the
ENDGAME "score 4 if 2+ here" condition. The LOCATION cannot itself be the
DISMISS target (rules/08 → dismiss excludes Locations), and a true CLEAN-UP
AUTO-trigger for CONTROL is not engine-wired, so the dismissal stays part of
the CONTROL op (a documented approximation).

Gap #4 — `TAKE returnUnpicked`: `TAKE look N count 1` now takes the top card
and returns the other looked-at cards to the BOTTOM of the deck, order
preserved (the unpicked card goes under the deck). Resolution is
deterministic (top-first) so the frozen golden/session/replay scripts that
play STRANGE NEW WORLDS / Imperial Pride keep replaying without an interactive
pick — the "which one" choice stays a UI concern. Cards wired: 1PIC18, 1BUR18,
1SIS11, 1KOL17, 1ALL05.

Gap #5 — `COST_LOG.from` zones: `from` now takes `ZoneSpec | ZoneSpec[]` (the
array is hand-OR-those-zones, mirroring `COST_BEAM.from`). `1BUR22` TILLY
op[1] uses `from: [HAND, DISCARD]`; `describe()` renders "from your hand or
Discard pile".

Gap #6 — targeted control/log conditionals: `LOG` gained a `bind`, and
`Amount { k: 'ICON_COUNT'; bind; kind }` counts the bound card's Skill/Focus
icons. `1SEL07` SCIMITAR op[2] logs an opponent LOCATION with `bind`, gains
1 GLO per logged Skill icon, then dismisses. `1PIC24` RIKER op[0] draws 2 and
offers a GLO-1 pay-then chain (SEND_AWAY_TEAM → `AWAY_TEAMS_AT`-gated
`TRIGGER_CONTROL`) — the controlled-Location target control op still needs to
resolve the chosen Location (approximated).

Verification after the pass: per-op mean recall common 0.8875 → 0.9128; common
REVIEW 45 → 42; `validate:cards` 0 errors / 3 pre-existing warnings;
`describe.test.ts` 10/10 and 69 sample kinds.
