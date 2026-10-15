# UI Specification

## 1. Guiding constraint

> The visual layer that implements this spec is [`ui-lcars.md`](ui-lcars.md) (tokens in
> [`src/ui/lcars.css`](../src/ui/lcars.css)). This file stays the authority on _what_ is on
> screen and why.

At complexity 5–7/10 with ~300 unique cards, **the UI's job is legality and legibility, not
animation.** Every affordance should answer: _what can I do right now, and why not that?_

## 2. Screen layout (desktop, ≥1280px)

```
┌────────────────────────────────────────────────────────────────────────┐
│ TOP BAR: phase · turn · actions ●●○ · [End Step] · undo · menu         │
│ [CHOICE panel — fixed overlay at top while a decision is pending]      │
├──────────────┬─────────────────────────────────────────┬───────────────┤
│ OPPONENT     │  SHARED BOARD                           │  GAME LOG     │
│ - specialty  │  ┌─ Stardate: #3, ◆◆◆◆ (4 glory) ──┐    │  (scrolling,  │
│   tracks     │  │ Market:  [P] [C] [S] [A]        │    │   filterable) │
│ - resources  │  │ Junk ▸ 12   Incident ▸ 4  ⚠     │    │               │
│ - hand: 5 ▮▮ │  └─────────────────────────────────┘    │               │
│ - areas      │  Neutral Zone: [L1] [L2] [L3]           │               │
│   (compact)  │     tokens shown per Location            │               │
├──────────────┴─────────────────────────────────────────┴───────────────┤
│ YOUR AREA                                              │               │
│  [Duty Officer] [ Location Area ──────────────────► ]  │               │
│  [ Captain    ] [ Fleet Area ─────────────────────► ]  │               │
│  [ Draw 12    ] [ Staging Area ─────► ]    [Discard 8] │               │
│  Crew board: R ●──8  I ●─3  M ●──────12   Missions ○●○ │               │
├────────────────────────────────────────────────────────┴───────────────┤
│ HAND (fanned, large, always readable)                                  │
└────────────────────────────────────────────────────────────────────────┘
```

Below 1280px: collapse the log into a drawer. Below 900px: stack the opponent area into a
summary strip. Phones and tablets get their own shells (the Pocket Bridge), specified in
[`ui-mobile.md`](ui-mobile.md).

## 3. Card rendering

Cards come from the spritesheets (`todo/02-sprite-pipeline.md`).

```tsx
<CardSprite def={def} size="hand" />
```

- Implemented as a `<div>` with `background-image: url(atlas.webp)` and
  `background-position: -Xpx -Ypx`, scaled with `background-size`.
- **Three sizes:** `micro` (≈60px wide, for stacks/counts), `board` (≈120px), `hand` (≈200px).
  Use one atlas at the largest needed resolution; scale down in CSS.
- **Single click → detail overlay** at full resolution with a **rules-text sidebar** listing
  each operation, its type, whether it costs an action, and — critically — **whether you can
  currently resolve it and why not**. This is where `canPlay(...).reasons` surfaces. Hover also
  shows a quick magnified preview; the full detail (with working action buttons) opens on click.
  A double click is the _fast path_: it runs the card's single legal action directly (see §4).

### Overlays drawn on top of the sprite

The sprite is the printed card; the _state_ is drawn over it:

| State                        | Visual                                                    |
| ---------------------------- | --------------------------------------------------------- |
| exhausted                    | rotate 90°, desaturate slightly                           |
| action token(s) on card      | small chip badges, bottom-left                            |
| beamed cards                 | fanned edge behind the host showing only the trait strip  |
| resource tokens (Market)     | token pips on the card's corner                           |
| ship token at a Location     | the named standee chip at the Location                    |
| illegal to play              | 55% opacity + no pointer cursor + tooltip with the reason |
| currently a choice candidate | animated accent ring                                      |

## 4. The choice panel — the heart of the UI

One component per `PendingChoice` variant (`docs/state-machine.md` §4). Contract:

- **Placement:** while a choice is pending, the panel is a `position: fixed` overlay
  centered at the top of the viewport and covers the board, top bar and pass bar. It
  renders nothing (and disappears) as soon as the choice is resolved.
- **Legality is never silently guessed.** A single click always opens the full card detail — the
  "what can I do right now" view. A **double click** runs the card's _single_ legal action
  (PLAY from the hand, or ACTIVATION on a deployed card) and skips the detail. A card with more
  than one legal operation (e.g. UTILIZE: pay an action for one effect, or a free one) has no
  single legal action — double click does nothing and the player picks from the detail, which
  shows one **Play** button per legal PLAY op; it never silently plays the first one.
- **Always show the prompt**, the **source card** that caused it, and a **Cancel/Decline** button
  when the choice is optional.
- `CHOOSE_CARDS`: candidates get the accent ring **wherever they physically are** — in hand, in
  the Market, at a Location. Do **not** pop a modal with copies of the cards; select in situ.
  Show `min`/`max` and a live count.
- `CHOOSE_DESTINATION` (gain/scan placement): a two-button inline prompt —
  **[Top of deck] [Discard pile]** — with the gained card shown large. This one fires constantly;
  make it one click and consider a "remember my default" toggle (per session, overridable).
- `OPTIONAL_TRIGGERS`: a list of reaction cards with **[Use] / [Skip all]**. Highlight the card
  on the board as you hover.
- `ORDER_OPERATIONS`: drag-to-order list, plus a **[Resolve in this order]** confirm. Offer
  **[Auto — no meaningful choice]** when the engine can prove order-independence (all pending
  operations are non-interacting), which will be the common case.

## 5. Information the player must always be able to reach

| Info                                   | Access                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| Your hand                              | always visible                                                                    |
| Both Discard piles                     | click the pile → scrollable grid                                                  |
| Junk pile                              | click → grid                                                                      |
| Your Development pile & its costs      | always visible as a small stack; click → grid                                     |
| Your Reserve deck **count**            | visible; **contents hidden**                                                      |
| **Your** Captain's Log                 | click your Captain → grid                                                         |
| **Opponent's** Log                     | **count only** — contents hidden (`rules/04` §4.5)                                |
| Common-deck composition                | a "Card List" reference panel — the box includes this sheet, so it is public info |
| Neutral Zone token counts              | rendered directly at each Location                                                |
| Whether a Location is _secured_ by you | a badge on the Location                                                           |

The **Card List panel** is worth building early: filter by suit/trait/skill, showing what remains
in each Market deck. The physical game hands you this sheet; withholding it would make the
digital version _harder_ than the real one.

## 6. Log panel

Every primitive emits a `LogEntry`. Render grouped by turn → phase → operation:

```
▾ Turn 7 — You
   ▾ Action: played Confiscate  [action]
       spent 2 Dilithium
       gained Tribbles (CARGO) → top of deck
   ▾ Action: activated Thy'lek Shran  [action]
       discarded Tribbles
       sent 1 Away Team → Weytahn
   ▾ completed mission "Peace Negotiations"
       gained 4 Dilithium, drew 4
       dismissed Bynars, Bolians, Tamarians (beamed contributors)
```

Clicking an entry highlights the cards involved. This is the single most valuable debugging tool
you will build — and it doubles as the rules-teaching device for players.

## 7. Rules help, inline

Every keyword in a card's text is a link to the matching section in `rules/08`. Ship the rules
markdown as part of the app and render it in a side drawer. At complexity 5+, "what does
_duplicate_ do again?" must be one click, not a PDF search.

## 8. Accessibility & input

- Full keyboard: `Tab` between candidates, `Enter` to select, `Esc` to decline.
- Single vs double click: the detail-open on a single-legal-action card is deferred by ~300 ms
  (`DETAIL_CLICK_WINDOW_MS`) so a second click inside that window can run the action instead.
- **Never rely on colour alone.** The three Specialties are red/blue/yellow — pair every colour
  with its icon glyph and a text label.
- Respect `prefers-reduced-motion`: skip card-movement animations entirely.
- Minimum tap target 44px even on desktop (the `micro` card size is for display, never for input).

## 9. What to build last

Animations, sound, a table-felt theme, 3D card flips. None of these make the game playable.
Get `todo/14-ui-shell.md` to "I can finish a Cadet Training game without opening the PDF" first.
