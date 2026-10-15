# LCARS visual design — Ready Room

Visual layer for [`docs/ui-spec.md`](ui-spec.md), implemented by
[`todo/14-ui-shell.md`](../todo/14-ui-shell.md). The spec decides _what_ is on screen and why;
this file decides what it looks like. **Where the two disagree, `ui-spec.md` wins** — every rule
below exists to serve "legality and legibility, not animation" (§1).

Implemented in `src/ui/ui.css` (component dress) over `src/ui/lcars.css` (tokens + bar geometry).
The class names are the ones the components already used, so the restyle changed no component
tree and no test.

---

## 1. The thesis

LCARS is not a skin of coloured rectangles. Its actual grammar is **a frame that reports system
state around content that stays still.** That maps onto this game better than any table-felt
theme would:

> **The frame carries state. The table never moves.**

- Everything coloured is **chrome**: the rail, the elbows, the top/bottom bars, section headers,
  the context bar. Chrome may recolour, pulse, or switch label at any time.
- Everything playable sits on the **black ground** and never moves for a cosmetic reason. A card
  moves only when the rules move it. This is what makes a 5–7/10 complexity board readable after
  looking away mid-turn.

Two consequences worth stating, because they're the ones that get eroded later:

1. **No modal ever contains a copy of a card.** Selection happens in situ (`ui-spec` §4). The
   context bar at the bottom of the frame is the prompt; the candidates ring where they live.
2. **No animation moves a card between zones in v1.** The log is the record of movement.

**The one deliberate exception: tokens fly.** Resources and action tokens travel from where
they came from to where they went — out of the passive that produced them, into the card
they paid for, from the opponent's pool into yours — and every counter they leave or reach
floats its `+n` / `−n` (`src/ui/flow.ts`, `flight.tsx`, `delta.tsx`). Cards still never move.
Undo, passing the device and loading a save never animate; `prefers-reduced-motion` keeps
the delta badges and drops the flights.

## 2. Colour — one hue per system, not per mood

| Token                    | Hue          | Owns                                                   |
| ------------------------ | ------------ | ------------------------------------------------------ |
| `--orange` `#ff9c00`     | LCARS orange | the frame itself, turn control, the active choice ring |
| `--sunflower` `#ffcc66`  | amber        | Market and everything commercial                       |
| `--periwinkle` `#9c9cff` | blue-violet  | Neutral Zone, contested space, reactions               |
| `--lilac` `#cc99cc`      | lilac        | Stardate track, Glory, VP — the time/score axis        |
| `--ice` `#99ccff`        | ice blue     | **you**, seat 0                                        |
| `--salmon` `#cc6666`     | salmon       | **opponent**, seat 1                                   |
| `--mars` `#ff4141`       | red          | alert only: the Burn, ATTACK, illegal                  |

The ground is `#05050a` — near-black pulled slightly blue, so the chrome's warm hues read as lit
rather than pasted on. Neutrals are `#0e0e16` / `#171722` / `#2a2a3a`.

The seat colours are the load-bearing pair: once _ice = you, salmon = Shran_ holds everywhere —
token pips at a Location, log entries, the crew board, the secured badge — the player stops
reading labels to work out whose tokens those are. Never spend ice or salmon on anything else.

Specialties keep the printed red/blue/yellow (`--research` / `--influence` / `--military`) and,
per `ui-spec` §8, **always** appear as hue + `.glyph` letter + text label. Colour never carries
a specialty on its own.

`--mars` is reserved. If red appears anywhere that isn't an alert, the alert stops working.

## 3. Type

- **Antonio** — all chrome, labels, numerals, card names, buttons. Ultra-condensed grotesque; the
  closest free stand-in for the Swiss 911 the 1987 art department used. Uppercase, `.09em`
  tracking, `tabular-nums` wherever digits line up.
- **Barlow** — card rules text, log messages, reasons. LCARS never had to render four lines of
  conditional rules text; forcing condensed caps on it would be cosplay at the cost of the one
  thing the UI exists to do.

The split is itself informational: **condensed caps = system chrome, normal-width = game text.**

## 4. Layout

```
┌ cap ┬ TITLE BAR  turn · phase · actions · primary action ──────────────┐
├─────┴───────────────────────────────────────────────────────────────────┤
│ CONSOLE STRIP  undo · replay · rules · card list · details · new game   │
├───────────────────────────────────────────────┬─────────────────────────┤
│ ops strip   Stardate · Junk · Incidents · deck │  opponent (compact)    │
│ shared row  Market ×4         Neutral Zone ×3  │  log                   │
│ own row     your area         crew board       │                        │
│                              ┌──────────────────────────────────────────┤
│                              │ HAND — overlay, bottom-right             │
├──────────────────────────────┴──────────────────────────────────────────┤
│ cap │ STATUS BAR  viewing · stardates · incidents · resolution          │
```

There is no left rail. LCARS' vertical rail is its most recognisable shape, but at this
complexity the board needs the width more than the chrome does: 150px down the full height of the
screen bought nothing the head could not carry in 30px. What survives is the other half of the
LCARS grammar — **capped bars**: a thick rounded block butted against a square-ended bar, every
bar `--bar-h` tall, every block `--gap: 4px` from the next.

The layout follows what a turn needs, not the rulebook's table picture:

- **Counters are not cards.** Stardate, Junk, Incidents and your deck are six numbers; they get
  one 68px strip of chips, not four card-sized slots. They cost 160px before this.
- **Market and Neutral Zone share one row**, so all seven shared card slots are visible at once.
- **The opponent lives in the side column.** They are reference, not your decision, and a
  permanent 300px column for them was the most expensive thing on the screen.
- **The main column is three bands with one scroll**, so your own in-play area is always on
  screen — the second-most-used zone after your hand should never be below the fold.
- **Zoom is held, not hovered.** Hovering a card does nothing on its own;
  hold **Option** and the hovered card lifts to the middle of the screen at 3× the board size
  (360×504), over a dimmed board. A preview that fired on every pointer move was noise on a board
  this dense, and it cost a permanent side-column panel for something wanted a few times a turn —
  the log took that space. The overlay sits on top of everything — above the choice bar, the
  drawers and the modals — because reading a card is usually exactly what you are doing while a
  choice is pending, and a prompt covering the zoom defeats it. That is safe only because it is
  `pointer-events: none`: it never intercepts a click, so whatever is underneath stays operable.
  Releasing the key, leaving the window or hiding the tab all drop it, so Option-Tab cannot
  strand it open.
- **The hand floats over the bottom-right corner.** It shrink-wraps its cards rather than taking
  a full-width row, so the board stays readable to its left and the bands above reclaim the
  ~270px the strip used to reserve (your own area went from 190px of visible height to 485px).
  Right-alignment falls out of the shrink-wrap — the panel is exactly as wide as the cards and
  pinned to the right edge, which beats `justify-content: flex-end` on the row, since that clips
  the first card once the hand overflows. Below 1080px it rejoins the flow instead of covering a
  one-column board. Hand cards run 156px rather than 200: still read at a glance, and worth
  ~70px of everybody else's space.
- **The player area is one grid**, carrying the printed three rows (`rules/02` §2.3): Duty
  Officer + Location Area, Captain + Fleet Area, then the Staging Area spanning the full width
  from column 1. Every cell steps on the same 94px + 6px rhythm, so Duty Officer, Captain and the
  first Staging card share a column and no card sits half a slot out of line. Zone labels go
  _above_ their cards for the same reason — a label between two cards would break the rhythm. Reserve, Development and the Captain's Log are counts rather than
  cards you act on, so they sit under the Crew board header as chips — which is also where the
  rulebook draws them, and keeps them clear of the hand overlay.

Breakpoints: ≤1240px the crew board drops under your area; ≤1080px the side column moves below the
board; ≤900px the console stops being one screen and the page scrolls normally, the caps drop and
the bars become full pills. Below 1080px the phone and tablet shells take over
([`ui-mobile.md`](ui-mobile.md)); this console stays the desktop layout.

## 5. Cards

The face is the printed sprite from the atlas, with the text card (name, `SUIT · traits`,
operation blocks) behind the **Details** toggle. Sizes follow `ui-spec` §3 — `micro` / `board` /
`hand` — but only the hand runs at hand size: the shared board packs seven slots into one row at
104px and your in-play rows run 94px. Cards away from your hand are read at a glance and clicked
for detail; five zone rows at hand size would never fit a laptop.

**State is drawn over the face, never baked into it** — exhausted rotation, action-token chips,
resource pips, the candidate ring, the illegal hatch. That holds whether the face underneath is
the sprite or the text fallback.

Illegal cards get 34% opacity **plus** a red diagonal hatch **plus** the reason: on hover, and
spelled out per operation in the detail overlay ("Why not: Activations only run in the ACTION
phase"). Opacity alone reads as "loading".

## 6. Icons

The cards print resources and suits as marks, not words, and so does the board: a Glory count
beside a blue crystal is read at a glance where "GLO 4" is read letter by letter.

`tools/extract-icons.ts` lifts them off the card art. The icon-recovery pass (`todo/02b`) already
located every icon on every card, so the tool is not looking at pixels blind: for each label it
measures every occurrence, splits the crop into connected components, and picks the glyph by
**consensus** — the component closest to the most others, since an icon looks the same in all its
dozens of occurrences and the text scraps sharing its gaps do not. The winner is re-cropped from
one of the eight full-size card scans where one exists.

Shipped in `public/icons/`, rendered by `src/ui/icons.tsx`: `DIL` (pink crystal), `GLO` (blue
crystal — they differ in hue, not shape), `LAT`, `ACTION`, `AWAY_TEAM`, and the seven suit pills,
which print as icon-plus-word and are used whole, the way the cards use them.

Not extracted, deliberately: `VP` (11 occurrences, no stable cluster), the three `REQ_*` badges
(the printed gem is fused to its threshold digit, so the digit would bake into the asset — and a
photographic gem is mush at 16px), and `SUIT:CAPTAIN` (3 occurrences, all clipped). Specialties
stay hue + glyph + label, which `ui-spec` §8 requires anyway and which recolours cleanly.

Icons are decorative in the accessibility tree: the count or label beside them is the content, so
each is `alt=""` with its name on `title`.

## 7. The context bar

Bottom of the frame, full width, left stripe in the colour of the system the choice concerns —
so the eye is already pointed at the right zone before the prompt is read. It always carries:
the choice kind, the prompt, **the source card**, min/max with a live count, and Decline when
optional. One renderer per `PendingChoice` kind (`docs/state-machine.md` §4):

| Kind                 | Treatment                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `CHOOSE_CARDS`       | rings in situ; disabled candidates greyed **with their reason**; live `n selected · min–max`              |
| `CHOOSE_DESTINATION` | the gained card large in the bar + two pill buttons; session default toggle, ⇧ to override                |
| `OPTIONAL_TRIGGERS`  | Use / Skip all, highlighting the source card where it sits in play                                        |
| `ORDER_OPERATIONS`   | drag list + **Auto** when the engine proved independence                                                  |
| Control Step         | the secured Location ringed, with the price (opponent's Glory, cleared tokens) stated _before_ the button |

With no choice pending the same bar is the turn control: phase, one obvious primary action, and
the unused-action warning (`todo/14` §5).

## 8. Alert

The frame — title bar, cap, status bar — turns `--mars` in exactly two cases: the Burn is one
Incident away (`GameFlow` sets `.frame-alert` at one Incident left), and you are the target of an ATTACK.
It pulses at 1.6s unless `prefers-reduced-motion`. Nothing else in the UI is allowed to recolour the frame, which is what
makes it mean something.

The Incident deck also carries its own warning colour at ≤2 (`todo/14` §3) — a module-level
warning, distinct from the frame-level alarm.

## 9. Accessibility

- Candidates are real `<button>`s: Tab walks them, Enter selects, Esc declines — no roving
  tabindex needed.
- Minimum 44px on every control (`.btn`); `micro` cards are display-only and never clickable.
- Focus is a 2px orange ring at 2px offset, on the dark ground — visible on every surface here.
- `prefers-reduced-motion` kills every animation including the candidate ring, which then falls
  back to its static 2px ring and outer glow.
- Hidden information is drawn as an explicit lock chip ("Log 4 · contents hidden"), never as an
  absence. A player must be able to see that something is hidden, not just fail to find it.

## 10. Using it

- [`src/ui/lcars.css`](../src/ui/lcars.css) — tokens and the bar-cap geometry, imported by
  [`src/ui/ui.css`](../src/ui/ui.css), which dresses the components. No component hard-codes a hex
  value.
- Fonts load from Google Fonts in `index.html`: `Antonio` 400/600/700 + `Barlow` 400/500/600,
  each with a real fallback stack (`Arial Narrow` for Antonio).
- Single-theme by design. There is no light mode — LCARS is a dark console, and a light variant
  would need a second, unrelated design. Every colour is painted explicitly.

## 11. Explicitly not in v1

Card-movement animation (token flights are in — §1), sound, viewscreen chrome, the LCARS boot sequence, 3D flips, and the
vertical rail (§4 — it lost to the board on width). `todo/14`
§9 already defers these; the design does not secretly depend on any of them.
