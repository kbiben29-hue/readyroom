# Data Model

## 1. Card definition (static, from JSON)

```ts
type CardDefId = string // stable, e.g. "COMMON.PERSON.zephram-cochrane"

interface CardDef {
	id: CardDefId
	cardId: string | null // the small printed ID on the card, if any
	name: string
	suit: Suit // PERSON | CARGO | SHIP | ALLY | ENCOUNTER | INCIDENT
	// | LOCATION | DIRECTIVE | CAPTAIN | STATUS
	deck: DeckId // COMMON | PICARD | SISKO | SELA | SHRAN | BURNHAM | KOLOTH
	traits: TraitId[]
	skills: SkillIcon[] // max 3; SKILL_RESEARCH|INFLUENCE|MILITARY|ANY|VARIABLE
	variableSkill?: VariableSkillSpec // when skills includes SKILL_VARIABLE
	focus: FocusIcon | null // FOCUS_RESEARCH | FOCUS_INFLUENCE | FOCUS_MILITARY
	vp: number // printed VP; 0 if none
	vpAsterisk: boolean // if true, the SPECIAL operation defines scoring
	startPosition: StartPosition | null // AVAILABLE | RESERVE | DEVELOPMENT | DISCARD
	// | DEPLOYED | CONTROLLED_LOCATION | INCIDENT_DECK
	developmentCost: Effect | null // black strip; a cost tree, not just resources
	operations: Operation[]
	sprite: SpriteRef // { atlas: 'common-0', x, y, w, h }

	// suit-specific
	shipToken?: string // SHIP: the named token, e.g. "U.S.S. Enterprise-D"
	awayTeams?: number // CAPTAIN: starting Away Team count
	locationTier?: 'STARTING' | 'ADVANCED' // common LOCATION only
	cannotBePlayed?: boolean // "THIS CARD CANNOT BE PLAYED"
}

interface Operation {
	type: OperationType // PLAY | ACTIVATION | PASSIVE | REACTION | RESUPPLY
	// | CLEANUP | CONTROL | ENDGAME | SPECIAL
	costsAction: boolean // the [action] prefix
	isAttack: boolean // the ATTACK prefix
	requires?: SpecialtyReq // { specialty: 'RESEARCH', min: 4 }
	trigger?: TriggerSpec // REACTION only
	effect: Effect // the DSL tree — see docs/effect-dsl.md
	text: string // the printed English, for the UI and for diffing
}
```

### Why `developmentCost` is an `Effect`, not a number

Rulebook p.14: a Development cost can be "2 Dilithium **and** take an INCIDENT". Costs are
arbitrary effect trees. Same for `SpecialtyReq` — but that one really is just a threshold.

### Why `text` is stored

1. The UI shows the real card text (people play from the text, not from your DSL).
2. When you fix a transcription bug, the diff shows both the text and the tree.
3. It is the ground truth you validate the tree against by hand.

## 2. Card instances (runtime)

A `CardDef` is a template. A **`CardInstance`** is a specific physical card in a zone.

```ts
type CardInstanceId = string // e.g. "p0#0042"

interface CardInstance {
	iid: CardInstanceId
	def: CardDefId
	owner: Seat | null // null for common cards not yet gained
	zone: ZoneRef
	exhausted: boolean
	actionTokens: number // reminder counters only
	beamedTo: CardInstanceId | null
	resourceTokens: Partial<Record<ResourceId, number>> // Glory sitting on a Market card
	shipTokenAt: LocationRef | null // where this SHIP's token is: on-card | a Location | supply
	wildcardAs: TraitId | null // transient, cleared after each operation
}
```

> **Why instance IDs and not object references:** the state must be JSON-serialisable for
> save/replay/undo, and the same `CardDef` can exist as many physical copies (e.g. multiple
> Incidents). Everything in the state refers to `iid`.

## 3. Zones

```ts
type Seat = 0 | 1

type ZoneRef =
	// shared
	| { k: 'MARKET_DECK'; suit: MarketSuit }
	| { k: 'MARKET_OFFER'; suit: MarketSuit }
	| { k: 'ENCOUNTER_DECK' }
	| { k: 'INCIDENT_DECK' }
	| { k: 'LOCATION_DECK' }
	| { k: 'NEUTRAL_ZONE'; slot: 0 | 1 | 2 }
	| { k: 'JUNK' }
	| { k: 'STARDATE_PILE' }
	| { k: 'BOX' } // destroyed / unused
	// per-player
	| { k: 'HAND'; seat: Seat }
	| { k: 'DRAW'; seat: Seat }
	| { k: 'DISCARD'; seat: Seat }
	| { k: 'RESERVE'; seat: Seat }
	| { k: 'DEVELOPMENT'; seat: Seat }
	| { k: 'LOG'; seat: Seat }
	| { k: 'STAGING'; seat: Seat }
	| { k: 'FLEET'; seat: Seat }
	| { k: 'LOCATION_AREA'; seat: Seat }
	| { k: 'DUTY_OFFICER'; seat: Seat }
	| { k: 'CAPTAIN'; seat: Seat }
	| { k: 'STATUS'; seat: Seat }
	| { k: 'BEAMED'; host: CardInstanceId }
```

### Zone properties table — encode this as a lookup, not as `if`s

| Zone            | In play? | Traits count | Skills count | Table ops | Ordered | Public   |
| --------------- | -------- | ------------ | ------------ | --------- | ------- | -------- |
| `LOCATION_AREA` | ✅       | ✅           | ✅           | ✅        | no      | ✅       |
| `FLEET`         | ✅       | ✅           | ✅           | ✅        | no      | ✅       |
| `DUTY_OFFICER`  | ✅       | ✅           | ✅           | ✅        | no      | ✅       |
| `CAPTAIN`       | ✅       | ✅           | ✅           | ✅        | no      | ✅       |
| `STATUS`        | ✅       | ✅           | ✅           | ✅        | no      | ✅       |
| `STAGING`       | ✅       | ✅           | ✅           | ❌        | no      | ✅       |
| `BEAMED`        | ✅       | ✅           | **❌**       | ❌        | no      | ✅       |
| `HAND`          | ❌       | ❌           | ❌           | ❌        | no      | own only |
| `DRAW`          | ❌       | ❌           | ❌           | ❌        | **yes** | ❌       |
| `DISCARD`       | ❌       | ❌           | ❌           | ❌        | no*     | ✅       |
| `RESERVE`       | ❌       | ❌           | ❌           | ❌        | **yes** | ❌       |
| `DEVELOPMENT`   | ❌       | ❌           | ❌           | ❌        | no      | ✅       |
| `LOG`           | ❌       | ❌           | ❌           | ❌        | no      | own only |

`*` the Discard pile is physically a pile but the rules say order is irrelevant and you may look
through it freely — treat it as an unordered set.

**This table is directly testable.** Write `zoneProps(zone)` and unit-test every row against
`rules/08` → _in play_ and `rules/12` §12.3, §12.5.

## 4. Player state

```ts
interface PlayerState {
	seat: Seat
	deckId: DeckId
	boardSide: 'BASIC' | 'ADVANCED'

	resources: { DIL: number; LAT: number; GLO: number }
	actions: { available: number; spent: number }

	specialties: { RESEARCH: number; INFLUENCE: number; MILITARY: number } // 0..15
	tracks: TrackTable // the board side's multiplier glyphs, copied at setup (§6)

	awayTeamsInPool: number // on the Captain card
	awayTeamsTotal: number // never decreases

	missions: MissionState[] // from the Crew board side
	missionTokens: number // 1 on Basic, 3 on Advanced

	handSize: number // 5, or 6 for Burnham w/ Inert Dilithium
	dutyOfficerLimit: number // 1 by default

	heldStardate: CardInstanceId | null // handed over; resolves in their Clean-up

	modifiers: RuleModifier[] // see §7
}
```

## 5. Board state

```ts
interface GameState {
	version: number
	rng: { seed: number; counter: number }

	mode: 'TWO_PLAYER' | 'CADET'
	cards: Record<CardInstanceId, CardInstance>
	zones: Record<string, CardInstanceId[]> // ZoneRef serialised as a key

	players: [PlayerState, PlayerState]
	activeSeat: Seat
	startingSeat: Seat

	phase: Phase // see docs/state-machine.md
	turnNumber: number

	stardates: {
		pile: CardInstanceId[] // index 0 = topmost/current
		gloryOnTop: number
		glories?: number[] // printed Glory per pile card; the handoff refills from it
	}
	// Stardate faces: src/data/cards/common/stardate.json (SD01–SD32, ids sd-01..sd-32);
	// sequence / printed Glory / modes / solo {level, botActions} per id in
	// src/data/stardate.ts → StardateSpec. TWO_PLAYER = SD01–SD05 (5,7,7,6,5),
	// CADET = SD06–SD07 (5,5); the 25 solo cards have modes [] and are always boxed.

	awayTeamsAt: Record<string, [number, number]> // LocationRef key -> [seat0, seat1]
	// Ship token positions live on the CardInstance (shipTokenAt)

	resolutionTriggered: boolean
	turnsAfterResolution: number

	stack: Frame[] // the effect stack — see docs/state-machine.md
	pendingChoice: PendingChoice | null
	eventQueue: GameEvent[]
	log: LogEntry[] // human-readable; for the UI log panel

	result: GameResult | null
}
```

### Note on `awayTeamsAt`

Away Teams are **fungible per player** — they have no identity. Store them as counts keyed by
Location instance, not as objects. Ship tokens **do** have identity (each is a named ship bound
to a specific card), so they live on the `CardInstance`.

## 6. Missions

```ts
interface MissionState {
	index: 0 | 1 | 2
	goal: Predicate // a query tree — see docs/effect-dsl.md §5
	reward: Effect
	vp: number // scores only on the ADVANCED side
	completed: boolean
	text: string // "<STCC name> — <goal/reward summary>"
	cardId?: string // the STCC mission record: '1PIC/M1' …
	isAttack?: boolean // "Attack Reward" (1KOL/M3)
}

interface TrackStep {
	step: number // the track step printing the glyph
	value: number // ×N
}
type TrackTable = Record<SpecialtyId, TrackStep[]>
```

**Crew boards** live in `src/data/cards/boards/<crew>.json` (`CrewBoardSide[]`, schema in
`src/data/boards.ts`): one object per side with `tracks` (per specialty, the multiplier
glyphs) and `missions`. Source of truth: the STCC mission records (`1XXX/M1..M3` — name, goal,
reward, `vp`) for the missions; the STCC-hosted photos of the 12 board sides for the glyphs and
for which mission the Basic side prints. Every **Basic** side prints exactly the crew's
mission 1 (0 VP) and a ×1 glyph at step 0; every **Advanced** side prints M1..M3 with the STCC
VP and **no** glyph at step 0. The loader (`addBoardSides`) folds them into
`CardCatalog.boards[deck] = { basic, advanced, tracks: { basic, advanced } }`; setup copies the
chosen side's missions and tracks onto the player. Final scoring multiplies Focus icons by the
highest glyph **value** reached — ×0 below the first glyph (an Advanced track at step 0–1 for
Picard Research scores its Focus icons 0).

Mission goals need a special evaluation mode: besides "is it met?", the engine must know
**which beamed card instances satisfied it**, so that exactly those are dismissed
(`rules/12` §12.26). `witnessSets(state, goal, ctx)` (completeMission.ts) returns the
smallest sets of beamed cards the goal cannot do without (see docs/effect-dsl.md §5 "Mission
goals"). If more than one set exists, raise a `CHOOSE_WITNESS` PendingChoice.

## 7. Rule modifiers

Some rules are not global — they are attached to a card and switch off when that card leaves.
Burnham's Inert Dilithium is the canonical case (`rules/11` §11.6.1), and expansions will add more.

```ts
interface RuleModifier {
	id: string
	source: CardInstanceId // removed when this card leaves play / is logged
	hooks: {
		handSize?: (base: number) => number
		onGainResource?: (
			res: ResourceId,
			amount: number,
			ctx: GainCtx,
		) => Redirect | null
		canSubstituteGlory?: (target: ResourceId) => boolean
		onStolenFrom?: (res: ResourceId, amount: number) => StealSource[]
		cleanupGloryPlacement?: (state, seat) => Effect
	}
}
```

Implement hooks as **named, data-driven modifier IDs** resolved from a registry
(`MODIFIERS['INERT_DILITHIUM']`), so the state stays serialisable — store `{ id, source }` only.

## 8. Card data files

```
src/data/cards/
  common/
    person.json        (25)
    cargo.json         (16)
    ship.json          (13)
    ally.json          (13)
    location.json      (20)
    encounter.json     (8)
    incident.json      (6)
    stardate.json      (32: SD01–SD32 — sequence/Glory/modes/solo in src/data/stardate.ts)
  crew/
    picard.json        (24 + captain + board)
    shran.json         (24 + captain + board)
    koloth.json        (24 + ...)
    sisko.json         (25 + ...)
    sela.json          (24 + ...)
    burnham.json       (26 + status card + ...)
  boards/
    <crew>.json        (per crew: BASIC + ADVANCED side — tracks, multipliers, missions)
  solo/
    automated-command.json  (12)  — blocked, see open-questions.md
    solo-cards.json          (2)  — blocked
```

**Expected total card faces to transcribe: ~300.** (67 Market + 20 Location + 8 Encounter +
6 Incident + 32 Stardate + 147 crew + 6 Captains + 6 Status/board sides + 14 solo.)

Each file is an array of `CardDef`. Validate with Zod at build time
(`tools/validate-cards.ts`) and fail the build on any error.
