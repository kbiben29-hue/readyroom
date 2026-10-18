# Architecture

## 0. The one decision that matters

**Do not write card effects as code.** With ~300 card faces, each carrying 1–4 operations, a
hand-written `switch (cardId)` becomes unmaintainable at around card 40 and untestable
throughout.

Instead: **card effects are data** — trees of typed operation nodes — interpreted by a single
**effect resolver**. Adding a card becomes adding a JSON object, not adding a branch. The
resolver is ~2000 lines you write once and test hard; the cards are ~300 data objects you
transcribe.

This one choice drives everything below.

## 1. Layers

```
┌──────────────────────────────────────────────────────────────┐
│  UI (React)                                                  │
│  - renders GameState (read-only)                             │
│  - dispatches Intents                                        │
│  - renders the current PendingChoice as interactive affordances│
└───────────────▲──────────────────────────┬───────────────────┘
                │ GameState, PendingChoice │ Intent
┌───────────────┴──────────────────────────▼───────────────────┐
│  Session layer                                               │
│  - holds the action log (the real source of truth)           │
│  - replay(log) -> GameState                                  │
│  - undo = truncate log + replay                              │
│  - save/load, seeded RNG                                     │
└───────────────▲──────────────────────────┬───────────────────┘
                │                          │
┌───────────────┴──────────────────────────▼───────────────────┐
│  ENGINE (pure TypeScript, zero deps, zero I/O)               │
│  - GameState: plain serialisable data                        │
│  - reduce(state, intent) -> {state, events}                  │
│  - the effect resolver (a stack machine)                     │
│  - the turn-phase state machine                              │
│  - query layer (counts, predicates, legality)                │
└───────────────▲──────────────────────────────────────────────┘
                │ reads
┌───────────────┴──────────────────────────────────────────────┐
│  CARD DATA (JSON, schema-validated at build time)            │
│  cards/common/*.json  cards/crew/picard.json  ...            │
│  + sprite atlas manifest                                     │
└──────────────────────────────────────────────────────────────┘
```

### Hard rules

1. **The engine imports nothing from the UI.** It must run in Node under `vitest` with no DOM.
2. **`GameState` is JSON-serialisable.** No class instances, no `Map`/`Set`, no functions, no
   circular references. Cards are referenced by **instance ID**, never by object identity.
3. **All randomness goes through a seeded PRNG stored _in_ the state.** Same seed + same intent
   log ⇒ byte-identical state. This gives you replays, deterministic tests and undo for free.
4. **The engine never asks questions synchronously.** When it needs a decision it _halts_ and
   publishes a `PendingChoice`. See §3.

## 2. Tech stack (recommended)

| Concern       | Choice                                     | Why                                                               |
| ------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| Language      | **TypeScript**, `strict: true`             | discriminated unions are exactly right for an effect DSL          |
| Build         | **Vite**                                   | fast, trivial static deploy                                       |
| UI            | **React 19**                               | your state is a plain object; React's job is only rendering it    |
| State binding | **Zustand** (or `useSyncExternalStore`)    | you already have a reducer; don't bring Redux                     |
| Schema        | **Zod**                                    | one schema for both build-time card validation and runtime parse  |
| Tests         | **Vitest**                                 | same TS config, fast                                              |
| Card data     | **JSON** + generated TS types              | editable by the authoring tool, diffable in git                   |
| Sprites       | **CSS `background-position`** on the atlas | no canvas needed; crisp, cacheable, zoomable                      |
| Persistence   | **IndexedDB** (via `idb-keyval`) for saves | action logs are small; IndexedDB avoids the 5 MB localStorage cap |
| Animation     | **Framer Motion** (optional, last)         | card movement between zones                                       |

Deliberately **not** used: a game framework (Phaser/PixiJS), an ECS, a server. This is a
turn-based card game with no real-time requirements. DOM + CSS is the right renderer.

## 3. The halting resolver — the core pattern

A card says: _"Spend 2 Dilithium: scan 2 of CARGO or SHIP; then beam a card from your hand to a
deployed SHIP."_

That needs **four** player decisions mid-effect. A synchronous `resolve(effect, state)` cannot
express that without either blocking or callback hell.

**Solution: the resolver is a stack machine that halts.**

```ts
type EngineStatus =
	| { kind: 'idle' } // awaiting a top-level Intent
	| { kind: 'awaitingChoice'; choice: PendingChoice }
	| { kind: 'gameOver'; result: GameResult }

// The engine runs until it either finishes or needs input.
function step(state: GameState): GameState // advances the effect stack one frame
function reduce(state: GameState, intent: Intent): GameState // push work, then run to halt
```

`GameState.stack` is an array of **frames** (serialisable!). Each frame is a node of an effect
tree plus an instruction pointer and locally-bound variables. The loop is:

```
while (stack is non-empty && no pending choice) {
  pop/advance the top frame
  execute one primitive, possibly pushing child frames
  if a primitive needs a decision -> write state.pendingChoice and break
}
```

The UI answers with `{ type: 'RESOLVE_CHOICE', choiceId, selection }`; the engine validates the
selection against the published option set, writes it into the waiting frame's bindings, clears
`pendingChoice`, and resumes the loop.

**Because the stack lives in the state, saving mid-effect Just Works.** So does undo. So does a
bot: the bot is a function `(state, choice) => selection`. (The house AI in `src/bot/` is exactly
that: a pure `decide(state, seat, legal) → Intent`; see `docs/bot.md`. It is not the official solo
Bot.)

See `docs/state-machine.md` for the full frame spec.

## 4. Triggers and REACTIONs

The rulebook requires REACTIONs that **interrupt** a resolving operation and then let it resume
(`rules/08` → REACTION operations; `rules/12` §12.24).

Implementation:

- Every state mutation of interest publishes a **`GameEvent`** (`CARD_PLAYED`, `RESOURCE_GAINED`,
  `LOCATION_CONTROLLED`, `AWAY_TEAM_SENT`, `INCIDENT_TAKEN`, …).
- After each primitive executes, the engine **collects matching REACTION and PASSIVE operations**
  from both players' in-play cards.
- **PASSIVE** matches resolve automatically (mandatory).
- **REACTION** matches produce a `PendingChoice` of kind `OPTIONAL_TRIGGERS` offering the set,
  in any order, to the reacting player — who may take any number, including none.
- Chosen REACTIONs are **pushed onto the stack above** the interrupted frame, so the interrupted
  operation resumes naturally when they pop.

This is why the stack must be explicit data rather than the JS call stack.

## 5. Determinism & hidden information

- `state.rng = { seed: number; counter: number }`. Every shuffle/draw increments `counter`.
  Use a small counter-based PRNG (e.g. `splitmix32`) — no mutable generator objects.
- **Hidden information stays in the state** but the UI receives a **projection**
  (`project(state, viewerSeat)`) that nulls out: the opponent's hand, the order of facedown
  decks, the opponent's Captain's Log contents.
  - For hot-seat play this projection is also what powers the "pass the device" screen.
  - For a future networked build, the projection is what you send over the wire.
- The Discard pile, Junk pile, Development pile and beamed cards are fully public
  (`rules/04` §4.5).

## 6. Package layout

```
src/
  engine/
    state.ts            GameState + all zone types
    ids.ts              CardInstanceId, brands
    rng.ts              splitmix32, shuffle, draw
    setup.ts            central setup + player setup (rules/02)
    phases.ts           Resupply / Control / Action / Clean-up (rules/03)
    intents.ts          the Intent union + reduce()
    resolver/
      stack.ts          frame types, the run loop
      primitives/       one file per effect kind (beam.ts, gain.ts, scan.ts, ...)
      choices.ts        PendingChoice types + validation
      triggers.ts       event bus, REACTION/PASSIVE collection
    queries/
      inPlay.ts         zone membership (rules/08 -> "in play")
      traits.ts         trait matching incl. WILDCARD
      counting.ts       skill icons, focus icons, suits
      legality.ts       canPlay, canActivate, canComplete
    scoring.ts          final scoring (rules/07 §7.4)
    endgame.ts          Resolution & Burn detection
    modifiers.ts        rule-modifier layers (Burnham's Inert Dilithium, etc.)
  data/
    schema.ts           Zod schemas for cards
    cards/              *.json (generated/edited by the authoring tool)
    atlas/              sprite manifests
  session/
    log.ts              intent log, replay, undo
    persistence.ts      IndexedDB save/load
  bot/                  the house AI, not the official solo Bot (docs/bot.md)
    cadet.ts            virtual-opponent interceptor (rules/10)
    heuristic.ts        Easy / Normal: one-decision lookahead over determinized worlds
    ismcts.ts           Hard: ISMCTS search
    evaluate.ts         feature vector + hand-tuned static evaluation
    learned.ts          learned value (MLP over the features; weights/value.json)
    arena.ts            bot-vs-bot schedule and statistics (tools/arena.ts)
  ui/
    App.tsx
    board/              Market, NeutralZone, StardateTrack, PlayerArea
    cards/              CardSprite, CardDetail, CardStack
    choice/             one renderer per PendingChoice kind
    log/                the game log panel
tools/
  slice-sprites.ts      spritesheet -> individual PNGs
  pack-atlas.ts         individual PNGs -> runtime atlas + manifest
  authoring/            the card transcription web tool
  validate-cards.ts     schema + cross-reference validation
```

## 7. Build order (why the todos are ordered as they are)

The temptation is to start with the UI. Don't — you will bake wrong assumptions into the data model.

1. **Sprites first** (`todo/02`) because they tell you how many cards there are and give you the
   images you need to transcribe from.
2. **Schema + DSL** (`todo/03`, `todo/04`) because the authoring tool depends on them.
3. **Engine core** (`todo/05`–`todo/10`) tested headlessly with a handful of hand-written cards.
4. **Authoring tool** (`todo/11`) — then transcribe the 67 common Market cards + 20 Locations.
5. **A playable vertical slice**: Cadet Training with Picard only.
6. **Then** the remaining crew decks, the UI polish, the 2-player mode.

Target the **Picard vs. Shran** matchup first: the rulebook says both have no `INCIDENT DECK`,
`CONTROLLED LOCATION`, `DEPLOYED`, `DISCARD` or Status cards, so they exercise the fewest setup
special cases.
