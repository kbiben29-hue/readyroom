# 1. Overview & Components

## 1.1 What the game is

An **asymmetric, head-to-head deck-building game** for 1–2 players. Each player is a famous
Star Trek captain with a unique, fixed starting deck. Over the game you buy cards from a shared
Market, take control of Locations, complete Missions, advance three Specialty tracks, and
accumulate Victory Points. Highest VP wins.

Framing: it is the late 32nd century; Starfleet Academy cadets run a historical simulation,
taking the place of a paragon captain.

## 1.2 Win conditions (summary — full detail in `03-turn-structure.md` §3.1)

Two distinct game-end triggers:

| Trigger        | Condition                                  | Resolution                                                                                                                         |
| -------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Resolution** | The last Stardate card is emptied of Glory | Play continues until both players have had an equal number of turns, then **each player takes one more turn**. Then final scoring. |
| **The Burn**   | The Incident deck empties                  | Game ends **immediately**. The player with **fewer INCIDENT cards** they own wins outright — no scoring. Tie → final scoring.      |

The Burn takes priority over a pending Resolution.

For the Burn count, INCIDENT cards in hand, Discard pile, Draw deck and Captain's Log count.
**Reserve deck does not count.**

## 1.3 Components

### 1.3.1 Crew decks (6)

| Captain     | Faction   | Cards | Ship tokens                                                            |
| ----------- | --------- | ----- | ---------------------------------------------------------------------- |
| **Picard**  | Starfleet | 24    | U.S.S. Enterprise-D, U.S.S. Bozeman, Type 7 Shuttlecraft               |
| **Sisko**   | Starfleet | 25    | Deep Space 9, U.S.S. Defiant, U.S.S. Rio Grande                        |
| **Sela**    | Romulan   | 24    | I.R.W. Goraxus, I.R.W. Khazara, I.R.W. Terix, I.R.W. Valdore, Scimitar |
| **Shran**   | Andorian  | 24    | Andorian Cruiser, Kumari                                               |
| **Burnham** | Starfleet | 26    | Book's Ship, U.S.S. Discovery-A, U.S.S. Federation                     |
| **Koloth**  | Klingon   | 24    | I.K.S. Devisor, I.K.S. Gr'oth, I.K.S. Klothos                          |

Each also has **1 Crew board** (double-sided: Basic / Advanced).

Total crew cards: **147**.

### 1.3.2 Common cards

| Group                     | Count        | Notes                                                      |
| ------------------------- | ------------ | ---------------------------------------------------------- |
| **Market cards**          | **67 total** | The four buyable suits                                     |
| — PERSON                  | 25           |                                                            |
| — CARGO                   | 16           |                                                            |
| — SHIP                    | 13           |                                                            |
| — ALLY                    | 13           |                                                            |
| **LOCATION**              | 20           | Split into _Starting_ and _Advanced_ by position indicator |
| **DISCOVERY / ENCOUNTER** | 8            | Taken, not gained                                          |
| **INCIDENT**              | 6            | Base count; crew decks may add more                        |
| **STARDATE**              | 32           | SD01–SD32; sorted by sequence number; mode-filtered (¹)    |

(¹) The rulebook component list says 27; the physical set (card scans in the Tabletop Simulator
mod) has 32: SD01–SD05 "2-PLAYER" (Glory 5, 7, 7, 6, 5 = 30), SD06–SD07 "SOLO CADET PRACTICE"
(5, 5), and five solo-vs-Bot sets of five (SD08–SD32, Ensign / Lieutenant / Commander / Captain /
Admiral, 31 / 30 / 30 / 29 / 27 Glory, each also printing a Bot action count). Full list:
`src/data/stardate.ts`.

### 1.3.3 Tokens & boards

| Component                 | Count                         | Limited?                                                                  |
| ------------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| Common Ship tokens        | 13                            | Yes — supply-limited                                                      |
| Away Team tokens          | 12 (6 per player)             | Yes — per-player pool, but freely reclaimable                             |
| Action tokens             | 9 (3 + 3 per player, 3 spare) | **No** — use proxies                                                      |
| Dilithium tokens          | 30                            | **No**                                                                    |
| Latinum tokens            | 25                            | **No**                                                                    |
| Glory tokens              | 51                            | **No**                                                                    |
| "×5 Resource" tokens      | 10                            | Convenience only                                                          |
| Crew Specialty markers    | 6 (2 red, 2 blue, 2 yellow)   | Yes — 3 per player                                                        |
| Mission Completion tokens | 6 (3 per player)              | Yes                                                                       |
| Starting Player token     | 1                             |                                                                           |
| Market strip              | 1                             |                                                                           |
| Player aids               | 2                             |                                                                           |
| Common card list          | 1                             | Reference sheet — all common cards with suit, traits, skill & focus icons |
| Score pad                 | 1                             |                                                                           |

> **Implementation note.** Action tokens, Dilithium, Latinum and Glory are explicitly _not_
> meant to be limited. Model them as unbounded integers. Ship tokens, Away Teams, Specialty
> markers and Mission Completion tokens **are** bounded and must be modelled as discrete,
> tracked objects.

### 1.3.4 Solo components (not specified in this rulebook)

- 12 Automated Command cards
- 2 Solo cards

These belong to the Bot, whose rules live in a separate solo rulebook. See
`docs/open-questions.md`.

## 1.5 Resource colour / icon IDs

| Resource  | Rulebook icon | Machine ID  |
| --------- | ------------- | ----------- |
| Dilithium | `[dilithium]` | `DIL`       |
| Latinum   | `[latinum]`   | `LAT`       |
| Glory     | `[glory]`     | `GLO`       |
| Action    | `[action]`    | `ACT`       |
| Away Team | `[away team]` | `AWAY_TEAM` |

Glory is dual-purpose: it is a **spendable resource** _and_ **1 VP each at game end**.
