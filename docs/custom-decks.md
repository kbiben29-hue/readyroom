# Custom crew decks

Fan-made crew decks that are not part of the published game. They use only the
existing rules: the same suits, traits, keywords, triggers and DSL nodes as the
box-1 decks, so the engine and the UI play them without any new code.

The first one is **MAL**, a Firefly crew captained by Malcolm Reynolds.

## Where the pieces live

| What                                       | Where                               | In git?         |
| ------------------------------------------ | ----------------------------------- | --------------- |
| Card mechanics (ids only, like STCC decks) | `src/data/cards/crew/mal.json`      | yes             |
| Crew board (tracks, 3 missions)            | `src/data/cards/boards/mal.json`    | yes             |
| Names, printed text, flavor (our own)      | `src/data/custom/firefly.json`      | yes             |
| Card template                              | `tools/custom/card-template.html`   | yes             |
| Art sources + art direction                | `tools/custom/firefly-art.json`     | yes (URLs only) |
| Downloaded art, your overrides             | `vendor/custom/firefly/`            | **no**          |
| Rendered faces, blank template             | `public/custom/firefly/`            | **no**          |
| Card number → face map                     | `vendor/custom/firefly.images.json` | **no**          |
| ChatGPT prompt kit                         | `vendor/custom/firefly/prompt-kit/` | **no**          |

The pack file uses the STCC record shape, so `addCustomPacks` (`src/data/stcc.ts`)
joins it to the same index the STCC data fills: names, printed text and faces
appear wherever STCC cards show them, and `tools/crosscheck-stcc.ts` checks the
pack against the card defs (suit, traits, VP, position, icons, missions). The
publish audit checks names against the real STCC data only. Custom cards
never replace an STCC record. Code-only builds (desktop, hosted) ship the names
but not the rendered faces (`vite.config.ts` drops `dist/custom`).

## Card art

```bash
npm run custom-cards        # download art, render 25 faces + template-blank.jpg
npm run custom-cards:kit    # build the ChatGPT prompt kit from the rendered faces
tools/custom/codex-art.sh 01 02 03   # paint those cards' art with Codex (your ChatGPT login)
npm run custom-cards        # re-render with the painted art
```

The renderer needs the fetched STCC icons (`npm run fetch-cards`) and Chrome or
Chromium (`CHROME_PATH` to override). Art sources in the manifest:
`commons:File:…` (freely licensed, credited on the card), `enwiki:File:…` and
`tmdb:<image id>` and `file:<path under vendor/custom/firefly/>` (stills from
the series: local use only, never published). `crop` pre-crops a download to a
face; `subject` and `notes` are the art direction the prompts use, and
`likeness: false` paints a card from its description alone (when the only
reference would mislead, like a real spacecraft for a fictional one).

To replace art, drop an image as `vendor/custom/firefly/override/<art key>.png`
(the keys are in the manifest); a whole finished face goes in
`override/faces/1MAL01-25.jpg`. Re-run `npm run custom-cards`.

The prompt kit holds, per card, an art-only prompt (recommended: our renderer
adds the exact rules text) and a whole-card prompt, with the card's text, our
rendered layout, the likeness still and printed cards as style reference.

`tools/custom/codex-art.sh` runs prompt A through the Codex CLI that ships with
the ChatGPT app (`codex exec` with OpenAI image generation, signed in with your
ChatGPT account), one card at a time, and saves each result as
`override/<art key>.png`. Character art is drawn chest-up with the face clear of
the name plates and trait badges; painted art fills the whole card behind the
text boxes, like the print. Each run counts against your ChatGPT plan, and its
log goes to `vendor/custom/firefly/codex-logs/`.

## The MAL deck (25 cards)

Theme: a smuggler crew that takes risky jobs. Many effects pay with INCIDENTs
(the Alliance and the Reavers), and the crew turns trouble into tempo:
Reynolds gains {DIL} and runs whenever an INCIDENT is taken, Book profits from
returning them, Simon patches them up, and Miranda scores them. The Burn is the
risk: take too many and the opponent wins outright. Reynolds scores every
PERSON beamed to your ships, but the board's missions dismiss the crew they
need, so the two pull against each other.

| #   | Card             | Suit      | Start       | Role                                                        |
| --- | ---------------- | --------- | ----------- | ----------------------------------------------------------- |
| 01  | Malcolm Reynolds | CAPTAIN   | —           | INCIDENT taken → {DIL} + warp; endgame VP per PERSON aboard |
| 02  | Serenity         | SHIP      | Deployed    | flagship; warps for {DIL} or {LAT}                          |
| 03  | River Tam        | PERSON    | Development | draw/filter; attack removes Away Teams                      |
| 04  | Simon Tam        | PERSON    | Development | returns INCIDENTs, Research                                 |
| 05  | Shepherd Book    | PERSON    | Development | returns INCIDENTs; reaction: {GLO} per return               |
| 06  | Mr. Universe     | ALLY      | Development | Influence + Research, logs itself (3 VP)                    |
| 07  | Miranda          | LOCATION  | Development | take INCIDENT → 2 {GLO}; endgame VP per INCIDENT            |
| 08  | Vera             | CARGO     | Development | ongoing weapon; attack removes Away Teams                   |
| 09  | Lassiter         | CARGO     | Development | 2 {LAT}, then INCIDENT or discard (3 VP)                    |
| 10  | Niska's Skyplex  | LOCATION  | Development | jobs: INCIDENT → CARGO + {LAT}                              |
| 11  | Inara Serra      | PERSON    | Reserve     | {LAT} or Influence; buys {GLO}                              |
| 12  | Inara's Shuttle  | SHIP      | Reserve     | second ship (mission 3), beams a PERSON                     |
| 13  | Badger           | ALLY      | Reserve     | INCIDENT → CARGO + {LAT}; scan CARGO                        |
| 14  | Saffron          | PERSON    | Reserve     | steals {LAT} / {DIL}                                        |
| 15  | Reavers          | INCIDENT  | Reserve     | return with a WEAPON or 2 {DIL}, then flee                  |
| 16  | Into the Black   | DIRECTIVE | Available   | the deck's Utilize                                          |
| 17  | Signing On       | DIRECTIVE | Available   | the deck's Recruit                                          |
| 18  | Take the Job     | DIRECTIVE | Available   | INCIDENT → CARGO; buy a SHIP                                |
| 19  | Aim to Misbehave | DIRECTIVE | Available   | attack: Away Team + opponent discards                       |
| 20  | Alliance Patrol  | INCIDENT  | Available   | the deck's Red Alert, with a warp                           |
| 21  | Persephone       | LOCATION  | Available   | {LAT} + Influence; Away Team draws                          |
| 22  | Zoe Washburne    | PERSON    | Available   | Away Teams + Military                                       |
| 23  | Hoban Washburne  | PERSON    | Available   | warps 2 ships; reaction: warp → {DIL}                       |
| 24  | Kaylee Frye      | PERSON    | Available   | Research; refreshes ships                                   |
| 25  | Jayne Cobb       | PERSON    | Available   | attack: steal {LAT}; WEAPON → {GLO} + Military              |

Missions (Advanced side; Basic uses the first, 0 VP): **Crew and Cargo** (3+
PERSON on one SHIP and 2+ CARGO in play, 4 VP), **Can't Stop the Signal** (a
TELEPATH, a DOCTOR and a PILOT on one SHIP, 3 VP), **Big Damn Heroes** (2+
deployed SHIPs and Military 6, 3 VP).

Tests: `src/engine/mal-deck.test.ts` covers setup and the triggers no box-1 card
uses (SHIP_WARPED, INCIDENT_RETURNED), the either-resource warp and both
endgame counts. `tools/fuzz.ts` includes MAL in every pairing.
