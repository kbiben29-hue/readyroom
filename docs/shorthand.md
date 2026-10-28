# Shorthand — the card icon language

Shorthand writes each printed operation as one line of glyphs, so a card can be read at a glance
at sizes where its printed text (or our English) cannot: a board slot, a phone tile, the hand dock.

It is **compiled, not authored**. `src/engine/shorthand.ts` walks the same effect trees that
`describe.ts` turns into English, so every card — and every future card — gets its line for free.
`src/ui/shorthand.tsx` draws the tokens; `src/ui/shorthandGlyphs.ts` holds the glyph art (our own
drawings; no printed or STCC artwork).

```
ACTI  {−1 DIL} › WARP                         Spend 1 {DIL} to warp this ship to a LOCATION.
PLAY  ACT  {+1<INCIDENT>} › +ALLY             {ACTION} Take 1 Incident card to gain an ALLY.
REAC  +<INCIDENT> : {−1 CARD} › −1<INCIDENT> +1 GLO
RESU  +1 CARD / #SECURITY max3                Draw 1 per SECURITY in play, up to 3.
```

(The left column is `formatShorthand`, the plain-text form the tests pin.)

## 1. Grammar

1. **Timing comes first.** A shaped square in the printed strip colour: play ▶ (grey), activation
   (exhausts the card) / passive ∞ / reaction ⚡ (blue), Resupply / Clean-up / Control (green),
   endgame 🏁 (red), special ✦ (purple), development cost 🏷 (grey).
2. **The action chip** after the mark means the line spends one of your actions. An ATTACK line
   adds red crossed blades; a specialty requirement adds a padlock with its threshold.
3. **Cost, then `›`, then the payoff.** Everything left of the chevron sits on a darker plate and is
   paid first — if it cannot be paid, the line cannot run (rules/12 §12.1).
4. **Signed amounts are arithmetic on your hand and pool.** `+2 CARD` draws two, `−1 CARD`
   discards one, `−1 DIL` spends, `+1 INCIDENT` takes an Incident, `−1 INCIDENT` returns one.
5. **Dashed outline = you may.** The engine does not offer an optional part that could not change
   anything, and the line says so by existing only when it can.
6. **Hatched salmon frame = the opponent** does it, or it happens to them. Salmon is the opponent's
   seat colour everywhere in the UI.
7. **`or` splits a choice.** Options sit on raised plates; only options you can fully resolve are
   offered (rules/03 §3.5.3).
8. **`/` means per**, with an optional `max N`: `+1 CARD / #SECURITY max3`.
9. **A `?` pill is a condition**, `→` leads to what it unlocks; a green ✓ pill means "if you did".
10. **Traits stay words** (55 of them): condensed caps, species cut-cornered like the printed
    octagons, gameplay traits (ATTACK, ONGOING) in red. Names of specific cards are dotted-underlined.

Colour never carries meaning alone (ui-spec §8): Dilithium is a crystal, Latinum a bar, Glory a
medal; skill icons are boxed and focus icons ringed, as printed.

Where the game prints an icon, the Shorthand shows that icon, from the fetched STCC set (a
prerequisite to run the game; `src/ui/printedIcons.ts`). That covers the resource and action
tokens, VP, the Away Team, ATTACK, the skill and focus icons, and the suits. The suits are shown
as masks, so they keep their suit colour. The drawings below are what the other glyphs look like,
and what those glyphs fall back to when no icon set is loaded, as in the tests.

## 2. Lexicon

| Group        | Glyphs                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Resources    | `DIL` crystal · `LAT` bar · `GLO` star · `ACT` isolinear chip · `VP` trophy · `AWAY` Away Team figure · `STARDATE` hourglass                                       |
| Suits        | PERSON bust · CARGO crate · SHIP arrowhead · ALLY two rings · LOCATION ringed planet · DIRECTIVE chevrons · INCIDENT warning · ENCOUNTER comet · CAPTAIN four pips |
| Hand & decks | `CARD` (± draw/discard) · `DECK` top of deck (− = mill) · `TOP_DECK` · `FIND` · `FROM_DISCARD` · `LOG` · `ENLIST` · `DEVELOP`                                      |
| Market       | `+<suit>` gain · `SCAN` n / trait · `JUNK` · `MARKET` · `WIPE_MARKET` · `DUPLICATE` · `STEAL`                                                                      |
| In play      | `PLAY` · `FREE_PLAY` · `DEPLOY` · `PROMOTE` · `RECALL` · `DISMISS` · `DESTROY` · `EXHAUST` · `REFRESH` · `ENTER`                                                   |
| Space        | `WARP` · `BEAM` · `SEND` · `CONTROL` · `WIPE_NEUTRAL_ZONE` · `ARRANGE`                                                                                             |
| Checks       | `RESEARCH` / `INFLUENCE` / `MILITARY` · any specialty · `LOCK` · `CHECK` · `SHIELD` · `ATTACK` · `MISSION`                                                         |

Each glyph carries its word as a hover title, so the language teaches itself on desktop; the line
as a whole is `role="img"` labelled with the English sentence for screen readers.

## 3. Compiler contract

- **Total.** Every switch is exhaustive over its union (effect nodes, amounts, predicates,
  triggers); a new kind is a compile error until it has a rendering. There is no "unknown" token.
- **Faithful, not complete.** A line is the glanceable summary; the English (`describe`) and the
  printed card remain the reference. Zone details, "this card" targets and binding plumbing are
  dropped on purpose.
- **Compression.** A run of three or more sibling steps that differ only in one suit or trait
  collapses into one `each:` group (1PIC04 TAMARIANS). `CHOOSE_ONE` options that read the same
  ("from your hand" / "from your Discard pile") merge.
- **Words where words are right.** Passive rule changes (`MODIFIER_ATTACH`, `ALT_PLAY`) render as a
  short `§` sentence from the modifier registry — each one is a unique rule, not a pattern.

## 4. Tests and budget

`src/engine/shorthand.test.ts`:

- grammar cases — one small tree per rule above;
- golden — every operation, Development cost and crew-board mission of the catalogue compiles, and
  the whole catalogue is pinned in `__snapshots__/shorthand.test.ts.snap` (review that diff like a
  diff of every card when a tree or the compiler changes);
- readability budget — at least 90% of lines weigh 8 or less (`shorthandWeight`: glyphs 1, words
  1.5, rule sentences 3, separators 0.3, the action chip 1) and the median stays at or under 4.
  At the time of writing: median 3.3, 93% at or under 8, 27 operations with a rule sentence.

`src/ui/shorthand.test.tsx` renders every operation and checks the accessible label.

## 5. Live values

A line can be read against the board it sits on. The compiler keeps each counted amount on its
`per` token (`source`) and each condition on its `if` token (`pred`);
`withLiveValues(line, state, seat, iid)` (`src/engine/shorthandLive.ts`) evaluates them with the
engine's own `evalAmount` / `evalPredicate` for the card that owns the line. The UI then shows
`×3` after "+1 CARD / #SCIENTIST" and turns a condition pill green when it already holds, grey when
it does not. Anything bound to the resolving operation ("the discarded card", "the chosen
specialty", "if you did") has no value before it runs and stays unevaluated. Pass `live` to
`<ShorthandOp>` to turn it on; the desktop detail modal does.

## 6. The guide in the app

`src/ui/guide/` teaches the language inside the game, built from the same code the board draws
with, so it cannot drift:

- **Learn** — a translator cycling real cards (line over English) and the grammar of §1, each rule
  shown on a real card's compiled line (`GRAMMAR` in `glossary.ts` points at card ids).
- **Lexicon** — every glyph with its word; a test fails if the compiler gains a glyph the lexicon
  doesn't list.
- **Cards** — the whole catalogue as tiles; any card opens its Rosetta view.
- **Practice** — a real line and three English sentences of the same timing; pick the one it says.

It opens from the console's **Reference** menu (its Shorthand tab), the phone menu's Reference, the
setup screen and Hails. Every
card detail — the desktop modal and the phone sheet — ends with **Glyphs on this card**, the
legend of the marks its lines use, with a link into the guide.
