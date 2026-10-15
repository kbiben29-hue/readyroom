# Session backend + online games

A tiny, dependency-free Node server with two halves:

- **Sessions** (`/sessions`) — a debug/sync store for local games: **one
  pretty-printed JSON file per game** you can read and debug as plain JSON. A
  session is seed + setup + intent log + meta, so anyone holding one can
  replay it, hidden decks included — fine for hot-seat saves, not for
  opponents.
- **Online games** (`/games`) — the authoritative async two-player service
  (docs/ui-mobile.md §7): the server holds the seed and the full state, runs
  the engine, and gives each phone only its own seat's view.

| What     | How                                                    |
| -------- | ------------------------------------------------------ |
| run it   | `npm run server`                                       |
| debug    | open `http://127.0.0.1:8787/` (list → click a session) |
| raw JSON | `curl http://127.0.0.1:8787/sessions/game-xxxx`        |

## Run it

```sh
npm run server              # http://127.0.0.1:8787
npm run server -- --port 9000 --data ./my-data --games ./my-games
tsx server/main.ts --host 0.0.0.0   # reachable from other devices on the LAN
tsx server/main.ts --public --static dist   # hosted: serves the app, no /sessions, rate limits
```

Hosting it publicly: [`docs/deploy.md`](../docs/deploy.md).

No install step: it only uses node built-ins + the repo's own `tsx` (and the
repo's card catalog for the game engine).

## Sessions API

| Method | Path            | Body         | Result                                                    |
| ------ | --------------- | ------------ | --------------------------------------------------------- |
| GET    | `/health`       | —            | `{ ok: true, store }`                                     |
| GET    | `/`             | —            | debug page (list + upsert-from-JSON)                      |
| GET    | `/sessions`     | —            | `[{ id, meta }]` summaries, newest first                  |
| GET    | `/sessions/:id` | —            | the full session JSON, `404` if missing                   |
| PUT    | `/sessions/:id` | session JSON | `{ ok: true, id }` (upsert — autosave does this per move) |
| POST   | `/sessions/:id` | session JSON | alias of PUT                                              |
| DELETE | `/sessions/:id` | —            | `{ ok: true, id, removed }`                               |

The body's `id` must match the path id (or be absent — it is filled in).
CORS is open, so the Vite app (`http://localhost:5173`) and any LAN client can
call it directly. Sessions are stored under `server/data/sessions/` by
default (gitignored).

### Using it from the game

The session layer already speaks a tiny `Storage` interface
(`get/set/del/keys`). The backend implements that same interface over HTTP —
wire it in exactly where `InMemoryStorage`/IndexedDB go today:

```ts
import { createRemoteSessionStore } from '@session/remote'

const store = createRemoteSessionStore('http://127.0.0.1:8787')
await store.save(session) // → PUT /sessions/:id
await store.list() // → GET /sessions
await store.load(id) // → GET /sessions/:id
```

`src/session/remote.ts` (`createHttpStorage`) is the raw adapter; it is
covered by tests against a mocked fetch.

In the app itself, the Replay modal's **Sync to server** button pushes the
current session to the backend (default `http://127.0.0.1:8787`; override the
target by setting `localStorage['ready-room:sync-url']`).

## Online games API

Every game route except create and summaries authenticates with
`Authorization: Bearer <seat token>`; the event stream also accepts
`?token=` (EventSource cannot send headers). Types for every payload live in
`src/session/protocol.ts`.

| Method | Path                 | Body                                           | Result                                               |
| ------ | -------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| POST   | `/games`             | `CreateGameRequest` \| `CreateOpenGameRequest` | `201 { gameId, tokens: [seat0, seat1], version }`    |
| POST   | `/games/summaries`   | `{ games: [{gameId, token}] }`                 | `{ summaries: GameSummary[], errors }` — the inbox   |
| GET    | `/games/:id`         | —                                              | `GameView` for the token's seat                      |
| GET    | `/games/:id/lobby`   | —                                              | `GameLobby` — open invite or started game            |
| POST   | `/games/:id/join`    | `JoinGameRequest`                              | `{ token, view }` — the invite's seat starts it      |
| POST   | `/games/:id/intents` | `{ intent, version }`                          | the new `GameView`                                   |
| POST   | `/games/:id/undo`    | `{ version }`                                  | the new `GameView`                                   |
| PUT    | `/games/:id/orders`  | `{ cardDef, policy }`                          | the `GameView` (policy `ask` \| `always` \| `never`) |
| GET    | `/games/:id/recap`   | `?since=<seq>` (optional)                      | `Recap` — "Previously on…"                           |
| GET    | `/games/:id/events`  | `?token=<seat token>`                          | `text/event-stream`: `hello`, `version`, `presence`  |

`CreateGameRequest` = `{ players: [{ deck, boardSide, name? }, …], settings?:
{ deadlineMs } }` (deadline default 12 h, 1 min – 30 days). Creating a game
applies the opening START, so the starting seat opens on its turn.

**Invites.** `CreateOpenGameRequest` = `{ host: { deck, boardSide, name? },
settings? }` creates an _open_ game: the host holds seat 0 (`tokens[0]`), the
invite link carries `tokens[1]`. Nothing is set up yet — the stored document
holds only the host, the settings and the token hashes, and every game route
but `lobby`, `join`, `summaries` and `events` answers `409 NOT_STARTED`. The
invite's holder `POST`s `/join` with `{ deck, boardSide, name? }` (not the
host's crew): the server draws the seed, sets the game up with seat 1 as the
agreed first player (`startingSeat`, kept in the public document so replays
agree), applies START, and answers `{ token, view }`. The invite token is
retired there and then — `token` is the guest's seat from now on — because
the host has seen the link. Open streams get the usual `version` event, so a
host waiting on the invite screen sees the answer live. `/games/summaries`
lists unanswered invites under `open` (`GameLobby[]`).

Errors are `{ ok: false, code, error }`:

| Status | Code                | When                                                         |
| ------ | ------------------- | ------------------------------------------------------------ |
| 400    | `BAD_REQUEST`       | malformed body / unknown crew / not a reaction card          |
| 401    | `UNAUTHORIZED`      | missing or wrong seat token                                  |
| 403    | `NOT_YOUR_DECISION` | the other seat decides now                                   |
| 404    | `NOT_FOUND`         | no such game                                                 |
| 409    | `STALE_VERSION`     | the `version` you sent is not current (body has `version`)   |
| 413    | `TOO_LARGE`         | body over 256 KB                                             |
| 422    | `ILLEGAL_INTENT`    | not in `legalIntents` / the selection fails `validateChoice` |
| 422    | `UNDO_REFUSED`      | not your turn, not your last intent, or past an undo floor   |
| 422    | `GAME_OVER`         | the game has ended                                           |
| 409    | `NOT_STARTED`       | an open invite: the guest has not picked a captain yet       |
| 409    | `ALREADY_STARTED`   | `join` on a game that has started                            |

### How a move is processed

One lock per game; every read and write goes: load the game document →
authenticate the token → apply any expired interrupt deadline → check
`version` (409 if stale) → check it is this seat's decision (the pending
choice's seat, else the active seat) → map the seat's card aliases back to
real ids → validate against `legalIntents` / `validateChoice` → `reduce` →
append to the intent log → let standing orders answer any interrupt they
cover → record the pending interrupt and its deadline → bump `version` →
save atomically → push `version` to open event streams.

**Undo floor.** An intent is a floor when it consumed randomness (a shuffle —
`rngDraws`, which discounts the counter bump every published choice makes),
made any card face visible to the acting seat (`revealedCards`: a draw, scan,
look, Market refill…), handed the turn over, raised an interrupt on the other
seat, ended the game, or was not the mover's own decision (standing order,
timeout, the server's START). Undo removes the last intent only when it is the
requesting seat's own non-floor intent on its own turn, so it never crosses a
floor. A reveal only to the _opponent_ (playing a card from your hand) does not
block your undo.

**Interrupts.** When the pending choice belongs to the seat that is not moving
(a reaction window or a FORCE/OPPONENT choice), the game records
`pending { seat, kind, deadline }`. Standing orders (per seat and reaction
card def): `always` takes the reaction and the bot heuristic answers any
choice that card's effect then asks of that seat (a "you may" is accepted);
`never` declines; `ask` (default) waits. Setting an order can answer the window
you already owe. When a deadline passes (checked on every read/write of the
game and by a 60 s timer) the server declines an optional reaction window or
"you may", otherwise takes `firstLegalSelection`, and logs it `by: 'timeout'`;
a follow-up interrupt owed by the same absent seat inherits the expired
deadline. The mover's own decisions have no deadline.

**Presence.** A seat is "on the bridge" while it holds an open event stream;
views and summaries carry `presence` and (in-memory) `lastSeen`.

### Security model

- **Capability links, no accounts.** Creating a game returns one random
  256-bit token per seat; the server stores only their SHA-256 hashes and
  compares in constant time. A token authorises exactly one seat of one game.
  Invite links carry the other seat's token in the URL _fragment_
  (`inviteLink` / `parseInvite` in `src/session/online.ts`), which browsers
  never send to a server.
- **The secret part is never served.** Each game is one JSON document
  (`server/data/games/<id>.json`, atomic temp+rename) split into `game` (seats,
  settings, version, pending, orders, the intent log) and `secret` (the seed
  and the token hashes). Neither is served raw; the games directory is separate
  from `/sessions`, whose routes cannot read it.
- **Seat views only.** A client receives `seatView(state, seat)`
  (`src/engine/seatView.ts`): hidden faces are `__HIDDEN__`, and because card
  instance ids are minted in catalog order (an id names its card), every hidden
  card is renamed to a positional alias (`hidden:HAND:1:3`), the `cards` map is
  re-sorted, history (log, token trail) names hidden cards only as `hidden`,
  and the RNG, effect stack, event queue and the other seat's pending choice
  are dropped. Legal intents, pending-decision prompts, recap entries and error
  messages are masked the same way (a refusal quotes the seat's own alias,
  never the real id). `server/games.test.ts` checks every response of a
  scripted game for hidden ids, hidden-only defs and the seed. Score estimates
  skip cards hidden from the viewer (the opponent's Captain's Log).
- **Tokens in URLs.** Only the event stream takes `?token=`; the server never
  logs URLs. Serve over HTTPS in any real deployment.
- **Known limits.** The engine's seed is 32 bits: a determined client could
  brute-force it from the visible opening (widening it changes every replay,
  an engine decision). A played-then-undone card was briefly visible to the
  opponent. There is no rate limiting, and `/sessions` stays an
  unauthenticated debug store — don't expose it publicly.

### Client

`src/session/online.ts` — `OnlineGameClient` (fetch + EventSource, both
injectable): `createGame`, `joinByInvite`, `getView`, `submitIntent`,
`undo`, `setStandingOrder`, `getRecap`, `listGames(seats)`,
`subscribe(seat, onEvent)` (reconnects with backoff) and `watch(seat, onView)`
(refetches the view on every newer version). Submit aliases back exactly as
the view shows them; derive what is playable from `view.legalIntents`, not
from engine queries on the view.

## Details

- `server/storage.ts` — `FileSessionStorage`: atomic writes (temp+rename),
  clean session ids only (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` — no path
  traversal), newest-first listing.
- `server/gameStore.ts` — `FileGameStore`: the game document (public +
  secret parts), same atomic writes and id rules.
- `server/games.ts` — `GameService`: seats, locks, validation, undo floors,
  standing orders, deadlines + timer, views, summaries, SSE hub.
- `server/recap.ts` — the recap, replayed from the log and masked per seat.
- `server/app.ts` — `createHandler(storage, { games })`: routing, CORS, body
  caps, JSON errors (engine errors on `/games` answer a generic 500, never the
  message), self-contained debug page.
- `server/main.ts` — CLI entry (`--port`, `--host`, `--data`, `--games`).
- Tests boot the real HTTP server on an ephemeral port: `server/app.test.ts`
  (sessions) and `server/games.test.ts` (a scripted two-seat game).
