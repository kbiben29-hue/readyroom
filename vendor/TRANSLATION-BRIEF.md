# STCC card text → game DSL — translation brief (read this FIRST)

You are reconstructing the **effect tree** (`operations[].effect`) of card definitions in
`src/data/cards/**` so the tree faithfully implements the **confirmed card text** stored in
`vendor/stcc/*.json` (the community STCC card database, fetched locally). The STCC text is the
**single source of truth** for what each card does. The existing effect trees were written in a
previous run and contain MANY errors — your job is to correct them.

You NEVER copy the printed wording into the JSON. The definition carries **mechanics only**
(suit, traits, skills, VP, and effect trees). The printed text is joined at runtime from
`vendor/stcc/`. Do NOT add any `text` field to an operation — the publish audit forbids printed
card text in the definitions.

## How to review ONE card

1. Print its worksheet. It shows the STCC confirmed text, the STCC text split into operations,
   our current effect tree, its `describe()` rendering, and the hard/soft misses:
   ```
   npx tsx /tmp/fidelity-stcc.ts --card 1PIC08/24
   npx tsx /tmp/fidelity-stcc.ts --file src/data/cards/common/person.json   # whole file
   ```
2. Read the STCC text carefully. Split it into operations yourself (Play / Activation / Passive /
   Reaction / Resupply / Cleanup / Control / Endgame / Special — each `Xxx:` header starts a new
   operation; `[action] Xxx:` means `costsAction: true`; `Attack Xxx:` means `isAttack: true`).
3. Rewrite `operations` (type, costsAction, isAttack, requires, trigger, effect) so that
   `describe()` of every operation renders essentially the SAME tokens as the STCC text.
   `describeOperation()` is the round-trip check — see `src/engine/describe.ts` and
   `docs/effect-dsl.md` §7 (worked examples).
4. Validate: `npx tsx tools/validate-cards.ts  # must stay 0 errors`.
5. Re-run the worksheet; every `❌ HARD MISS` for your cards should be gone.
6. Format the edited file: `npx prettier --write src/data/cards/<your-file>.json`.

## Where the confirmed text lives

- `vendor/stcc/box1.json`, `box2.json`, `box3.json`, `promo1.json`, `promo2.json` — arrays of
  card records. Find yours by `card_number` (e.g. `1PIC08/24`). **Canonical record**: search
  box1 → box2 → box3 → promo1 → promo2 in that order; the first box that prints the number
  wins; within the same box an `"updated"` variant beats `"original"`.
- Each record: `name`, `suit`, `glory` (VP), `position_indicator`, `species_traits`,
  `regular_traits`, `other_traits`, `icons` (Skill/Focus × Research/Influence/Military),
  `away_team`, and `text.{cost,hand,table,goal,reward}`.
- The `hand` section = played-from-hand effects; `table` = operations while in play; `goal` =
  typically the CAPTAIN's Endgame; `reward` = Resupply; `cost` = the development cost (black
  strip) — model it as `developmentCost`, not an operation.

## {{token}} dictionary (STCC [[x]] → meaning)

| [[x]] token | DSL meaning |
|---|---|
| `[[action]]` | `Operation.costsAction: true` |
| `[[dilithium]]` / `[[latinum]]` / `[[glory]]` | resource `DIL` / `LAT` / `GLO` (COST_RESOURCE or GAIN_RESOURCE) |
| `[[military]]` / `[[influence]]` / `[[research]]` | specialty (COST? no — advance/gain specialty via ADVANCE_SPECIALTY; or a requirement) |
| `[[mil3]]` / `[[inf4]]` / `[[res5]]` (N in 1..9) | requirement `requires: {specialty, min}` on the operation (e.g. mil3 → {MILITARY,3}) |
| `[[away team]]` | away-team token → SEND_AWAY_TEAM / REMOVE_AWAY_TEAM |
| `[[ship]]` / `[[location]]` / `[[person]]` / `[[cargo]]` / `[[ally]]` / `[[encounter]]` / `[[incident]]` / `[[directive]]` / `[[captain]]` / `[[mission]]` | suit `SHIP` / `LOCATION` / … (used in filters, GAIN_CARD suits, zones) |
| `[[mil-skill]]` `[[res-skill]]` `[[inf-skill]]` `[[wild-skill]]` | Skill icon (Research/Influence/Military/Any) — on THIS card it is `skills` on the def, not ops text; in text it means "gain N MILITARY/RESEARCH/INFLUENCE" (ADVANCE_SPECIALTY) |
| `[[mil-focus]]` etc. | Focus icon — on THIS card it is `focus` on the def |
| `[[mil-restriction]]` etc. | restriction icon (rare, only on ops-restricted cards) |
| `[[1vp]]` `[[2vp]]` `[[-1vp]]` `[[?vp]]` | literal VP gain/loss (GAIN_VP — see how existing cards do it) |
| traits (klingon, starfleet, engineer, doctor, …) | `TRAIT_ID` in CardFilter (traits / allTraits), e.g. ENGINEER, STARFLEET |
| `[[1vp]]`, `[[?vp]]`, `[[vp]]` | VP |

Multi-trait/suit alternation `[[communication]]/[[doctor]]` or `either X, Y, or Z` = a
`traits` list (OR within the list) — one filter/target that accepts any of them.

## Effect DSL quick reference

Read **`docs/effect-dsl.md`** in full (407 lines). Read **`docs/data-model.md`** §1 for the
CardDef/Operation shape, §3 for zones. `src/engine/describe.ts` shows how each node renders —
that is your round-trip contract. Key nodes you'll use constantly:

- Control: `SEQ`, `MAY`, `CHOOSE_ONE`, `PAY_THEN`(cost→benefit), `IF`, `REPEAT`, `FOR_EACH`,
  `LET`, `OPPONENT` (via FORCE), `NOOP`.
- Costs: `COST_RESOURCE{res,amount}`, `COST_ACTION`(=[action]), `COST_DISCARD{filter?,count}`,
  `COST_PUT`, `COST_EXHAUST`, `COST_DISMISS`, `COST_LOG`, `COST_TAKE_INCIDENT`.
- Movement: `BEAM{from?,filter?,to,count,bound?}` (Location never beamed), `DEPLOY` (SHIP/ONGOING),
  `WARP{ship,to}`, `DISCARD`, `DRAW`, `DRAW_FROM_DISCARD`, `RECALL`, `LOG`('THIS'), `DISMISS`,
  `PROMOTE`, `JUNK`, `PUT_INTO_STAGING`.
- Acquisition: `GAIN_CARD{suits,includeJunk?}`, `SCAN_N{n,suits}`, `SCAN_FOR_TRAIT{traits}`,
  `TAKE{deck,count}`, `FIND{filter,zones,bind?}`, `RETURN_INCIDENT`, `ENLIST_DEVELOPMENT{free?}`.
- Board: `SEND_AWAY_TEAM{count,target,ignoreBlocking?}`, `REMOVE_AWAY_TEAM`,
  `TAKE_CONTROL{target}` (`target:'THIS'` for "take control of this location"), `TRIGGER_CONTROL`, `EXHAUST`, `REFRESH`, `PLACE_RESOURCE_ON_MARKET`,
  `WIPE_MARKET`, `WIPE_NEUTRAL_ZONE`.
- Resources/actions: `GAIN_RESOURCE`, `STEAL`, `GAIN_ACTION`, `ADVANCE_SPECIALTY{specialty,amount}`.
- Meta: `FREE_PLAY{filter,from?,bound?}`, `FORCE{body}`, `DUPLICATE`.

Queries/filters/predicates: `docs/effect-dsl.md` §5. Zones: `ALL_OWNED`, `IN_PLAY`, `HAND`,
`DISCARD`, `FLEET`, `LOCATION_AREA`, `STAGING`, `NEUTRAL_ZONE{slot}`, `MARKET_OFFER`,
`MARKET_DECK{suit}`, `INCIDENT_DECK`, `ENCOUNTER_DECK`, `JUNK`, `LOG`, `RESERVE`. "Controlled
LOCATION" = a LOCATION in your `LOCATION_AREA` (check how clean cards in the same file phrase
it). "a LOCATION you have in play / a controlled LOCATION" and "the card's CONTROL operation" =
`TRIGGER_CONTROL` targeting it.

The full node vocabulary is in `docs/effect-dsl.md` (§2–§5) and the strict Zod schema is in
`src/data/schema.ts` (every key must be exactly right — `.strict()`).

## The DSL is a typed tree — copy shapes from working cards

Before inventing anything, find an existing card in the same or a sibling file whose STCC text
looks like your card's text, and copy its tree pattern. Good reference cards (clean, validated):
`1PER02/25`, `1PER10/25`, `1PER22/25`, `1LOC02/20`, `1SHI12/13`, `1ALL05/13`, `1PIC17/24`,
`1PIC15/24`, `1SHR17/24`, `1KOL15/24`, `1SEL09/24`, `1BUR17/26`, `1SIS05/25`, all of
`common/encounter.json` and `common/incident.json`, plus the `docs/effect-dsl.md` §7 worked
examples.

## Common failure modes seen in the previous run (check EVERY card for these)

- **Merged operations**: one `PLAY` node containing two separate `[action] Play:` texts → split
  into two `PLAY` operations. Operation ORDER in the def must follow the printed order so the
  runtime `(type, rank)` join lines up (see `printedOpFor` in `src/data/stcc.ts`).
- **Wrong resource**: GLO written where the text says `[[dilithium]]` (DIL), or LAT vs DIL.
  Double-check every COST_RESOURCE / GAIN_RESOURCE literal.
- **Wrong query/target**: warp/beam/send-away-team targets the wrong zones or wrong ship name;
  "any of your SHIP" vs "this ship" (`names` filter on the resolving card vs all SHIP).
- **Wrong filter**: the trait/suit list differs from the text (too few or too many choices,
  or wrong traits — e.g. text says `[[engineer]]/[[ops]]` but filter has ENGINEER only).
- **Dropped or extra costs/benefits**: text "spend 2 DIL to ... AND gain 1 GLO" missing one half.
- **MAY placement**: `You may …` → wrap that part in `MAY`; "may X to Y" = `MAY(PAY_THEN(X,Y))`.
- **costsAction / isAttack / requires** not set from the `[action]`, `Attack`, `[[mil3]]` prefixes.
- **REACTION trigger wrong**: "After you ..." → `trigger.on`; the trigger event set is in
  `docs/effect-dsl.md` §6. "When you would ..." (prevention) may need a SPECIAL with a trigger
  or may be unmodelable → SKIP.
- **SCORE_VP / ENDGAME**: `vpAsterisk` cards need a `SPECIAL` op with `SCORE_VP`; plain VPs are
  `vp` + no special scoring.

## Skipping a card

If the STCC text **cannot** be faithfully expressed with the existing DSL nodes (after checking
`docs/effect-dsl.md` and copying patterns from reference cards; do not invent new node kinds, do
not paper over with `NOOP` or a wildly-wrong tree), then:
- append the cardId (e.g. `1PIC08/24`) to **`/Users/robert/Development/captain/vendor/skips/<your-batch>.md`**
  (one per line, format: `1PIC08/24 — <one-line reason>`), and leave the card's tree untouched.
- Do NOT edit `vendor/SKIPPED.md` — the coordinator merges skip lists at the end.
- Report the skipped cardIds in your final message.

## Hard constraints

- Only edit the files listed in your task. Write to those files and to
  `/Users/robert/Development/captain/vendor/skips/<batch>.md`. Do not touch anything else.
- Do NOT add, remove or reorder card entries in a JSON array. Do NOT change `id`, `cardId`,
  `deck`, `name`, `suit`, `traits`, `skills`, `focus`, `vp`, `vpAsterisk`, `startPosition`,
  `developmentCost`, `shipToken`, `awayTeams` unless the STCC record is unambiguous about it
  (the fields were already cross-checked; changing them is a red flag).
- You MAY add/remove/reorder **operations** inside a card (that's the point — the shapes were
  wrong), and you MAY add/remove nested effect nodes, as long as validate-cards stays green and
  the (type, rank) alignment with the STCC ops is preserved.
- JSON style is tabs, `"key": value`, arrays on one line when short — match the existing files;
  finish with `npx prettier --write <file>`.
- `npx tsx tools/validate-cards.ts` must print `0 error(s)` when you're done.

## Final report

Reply with: the file(s) you edited; the number of cards fixed; the cardIds you skipped (with
reasons); and the last `validate-cards` + worksheet output summary (e.g. "0 hard misses remain
on my cards").
