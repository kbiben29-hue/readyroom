# TODO 03 — Card schema & ID enums

**Depends on:** `01`. **Blocks:** `04`, `11`, `12`, `13`.
**Estimate:** 3–4 h.

---

## 1. ID enums — transcribe from `rules/09-icon-reference.md`

- [ ] `src/data/ids.ts`, using `as const` arrays so you get both the union type and a runtime list
      (the authoring tool needs the runtime list to build dropdowns):
  ```ts
  export const SUITS = [
  	'PERSON',
  	'CARGO',
  	'SHIP',
  	'ALLY',
  	'ENCOUNTER',
  	'INCIDENT',
  	'LOCATION',
  	'DIRECTIVE',
  	'CAPTAIN',
  	'STATUS',
  	'MISSION',
  ] as const
  export type Suit = (typeof SUITS)[number]
  export const MARKET_SUITS = ['PERSON', 'CARGO', 'SHIP', 'ALLY'] as const

  export const SPECIES_TRAITS = [
  	'ALIEN',
  	'AENAR',
  	'ANDORIAN',
  	'ANDROID',
  	'BAJORAN',
  	'BETAZOID',
  	'BORG',
  	'BREEN',
  	'CARDASSIAN',
  	'CHANGELING',
  	'FERENGI',
  	'HUMAN',
  	'JEM_HADAR',
  	'KELPIEN',
  	'KLINGON',
  	'ORION',
  	'PAKLED',
  	'REMAN',
  	'ROMULAN',
  	'SYNTHETIC',
  	'TELLARITE',
  	'TRANSCENDENT',
  	'TRILL',
  	'VORTA',
  	'VULCAN',
  	'XB',
  	'XINDI',
  ] as const

  export const REGULAR_TRAITS = [
  	'AMBASSADOR',
  	'ANOMALY',
  	'AUGMENT',
  	'BEVERAGE',
  	'BUSINESS',
  	'CLOAK',
  	'COMMUNICATION',
  	'CREATURE',
  	'DOCTOR',
  	'DOMINION',
  	'ENGINEER',
  	'HELMET',
  	'HOLOGRAM',
  	'IMPERIAL',
  	'MIND_CONTROL',
  	'OPS',
  	'PILOT',
  	'MAQUIS',
  	'SCIENTIST',
  	'SECURITY',
  	'SHADY',
  	'SPY',
  	'STARBASE',
  	'STARFLEET',
  	'TELEPATH',
  	'TIME_TRAVEL',
  	'WEAPON',
  ] as const

  export const GAMEPLAY_TRAITS = [
  	'ATTACK',
  	'ONGOING',
  	'SURPRISE',
  	'WILDCARD',
  ] as const

  export const TRAITS = [
  	...SPECIES_TRAITS,
  	...REGULAR_TRAITS,
  	...GAMEPLAY_TRAITS,
  ] as const
  export type TraitId = (typeof TRAITS)[number]

  export const SPECIALTIES = ['RESEARCH', 'INFLUENCE', 'MILITARY'] as const
  export const RESOURCES = ['DIL', 'LAT', 'GLO'] as const
  export const DECKS = [
  	'COMMON',
  	'PICARD',
  	'SISKO',
  	'SELA',
  	'SHRAN',
  	'BURNHAM',
  	'KOLOTH',
  ] as const
  export const START_POSITIONS = [
  	'AVAILABLE',
  	'RESERVE',
  	'DEVELOPMENT',
  	'DISCARD',
  	'DEPLOYED',
  	'CONTROLLED_LOCATION',
  	'INCIDENT_DECK',
  ] as const
  export const OPERATION_TYPES = [
  	'PLAY',
  	'ACTIVATION',
  	'PASSIVE',
  	'REACTION',
  	'RESUPPLY',
  	'CLEANUP',
  	'CONTROL',
  	'ENDGAME',
  	'SPECIAL',
  ] as const
  ```
- [ ] Mark the box-unused IDs so the validator can warn, not error
      (`rules/12` §12.30): `JEM_HADAR`, `VORTA`, `XB`, `HELMET`, `MIND_CONTROL`, `MISSION` suit,
      `SURPRISE` trait (solo only).
  ```ts
  export const NOT_IN_THIS_BOX = new Set([
  	'JEM_HADAR',
  	'VORTA',
  	'XB',
  	'HELMET',
  	'MIND_CONTROL',
  ])
  ```
- [ ] `isSpecies(t)`, `isGameplayTrait(t)` helpers — `DIFFERENT_SPECIES` logic needs them.

## 2. Zod schemas

- [ ] `src/data/schema.ts`. Structure it so the **effect schema is recursive** via `z.lazy`:
  ```ts
  const Effect: z.ZodType<Effect> = z.lazy(() => z.discriminatedUnion('k', [
    SeqNode, MayNode, ChooseOneNode, PayThenNode, IfNode, /* ... */ GainCardNode, BeamNode, ...
  ]));
  ```
- [ ] `OperationSchema`:
  ```ts
  const OperationSchema = z.object({
  	type: z.enum(OPERATION_TYPES),
  	costsAction: z.boolean().default(false),
  	isAttack: z.boolean().default(false),
  	requires: z
  		.object({
  			specialty: z.enum(SPECIALTIES),
  			min: z.number().int().min(1).max(15),
  		})
  		.optional(),
  	trigger: TriggerSchema.optional(),
  	effect: Effect,
  	text: z.string().min(1),
  })
  ```
- [ ] `CardDefSchema` per `docs/data-model.md` §1.
- [ ] **`.strict()` on every object schema.** A typo'd key (`traits` vs `trait`) must be a hard
      error, not a silently ignored field. This is the single highest-value line in this file.

## 3. Cross-field refinements

These catch transcription errors that a plain schema cannot.

- [ ] `trigger` is **required** iff `type === 'REACTION'`, and **forbidden** otherwise.
- [ ] `SCORE_VP` nodes appear **only** inside `ENDGAME` or `SPECIAL` operations.
- [ ] `vpAsterisk: true` ⇒ the card has a `SPECIAL` operation (`rules/07` §7.4.2).
- [ ] `skills.length <= 3` (`rules/09` §9.7).
- [ ] `suit === 'SHIP'` ⇒ `shipToken` is present.
- [ ] `suit === 'CAPTAIN'` ⇒ `awayTeams >= 1` **and** `startPosition === null`.
- [ ] `suit === 'LOCATION' && deck === 'COMMON'` ⇒ `locationTier` is present.
- [ ] `deck === 'COMMON' && MARKET_SUITS.includes(suit)` ⇒ `startPosition === null`
      (Market cards never start in a player's deck).
- [ ] `deck !== 'COMMON' && suit !== 'CAPTAIN' && suit !== 'STATUS'` ⇒ `startPosition` present.
- [ ] `cannotBePlayed: true` ⇒ **no** `PLAY` operation (`rules/03` §3.5.4).
- [ ] `traits.includes('ATTACK')` ⇒ at least one operation with `isAttack: true`
      (`rules/05` §5.2.2) — **warn**, don't error: the trait can exist for a card whose attack
      is conditional.
- [ ] `traits.includes('ONGOING')` ⇒ a `PLAY` operation containing a `DEPLOY` node
      (`rules/05` §5.2.2).
- [ ] A `DUPLICATE` node must not contain another `DUPLICATE` in its reachable subtree
      (`rules/08` → duplicate).
- [ ] `developmentCost` present ⇒ `startPosition === 'DEVELOPMENT'`, and vice versa.

## 4. Validator CLI

- [ ] `tools/validate-cards.ts`:
  1. glob `src/data/cards/**/*.json`
  2. parse each with `CardDefSchema`
  3. collect **all** errors before exiting (don't stop at the first — you want the whole list
     when fixing a transcription session)
  4. cross-reference against `src/data/atlas/manifest.json` **both ways** (`todo/02` Stage 6)
  5. check global ID uniqueness
  6. check **expected counts** from `rules/01` §1.3:
     ```
     COMMON PERSON 25, CARGO 16, SHIP 13, ALLY 13, LOCATION 20, ENCOUNTER 8, INCIDENT 6, STARDATE 27
     PICARD 24, SISKO 25, SELA 24, SHRAN 24, BURNHAM 26, KOLOTH 24
     ```
     Report `actual / expected` per group. **This is how you know when you're done.**
  7. print a coverage summary and exit non-zero on any error
- [ ] Output format: `path:cardId: message`, so editor click-through works.

## 5. Generated types for the authoring tool

- [ ] Export `TRAITS`, `SUITS`, … as runtime arrays (already done via `as const`), so the tool
      builds its dropdowns from the same source of truth as the validator. **Never hand-maintain
      a second list in the UI.**

---

## Definition of Done

- [ ] `npm run validate:cards` runs on an empty card set and reports `0 / 300`.
- [ ] Adding a card with a typo'd key fails validation with a clear path.
- [ ] Adding a `REACTION` operation without a `trigger` fails.
- [ ] Adding a `SHIP` without `shipToken` fails.
- [ ] Nesting `DUPLICATE` inside `DUPLICATE` fails.
- [ ] The count report lists all 14 expected groups with `0 / n`.
