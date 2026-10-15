// "In play" zone-membership rules (rules/08 → `in play`, rules/12 §12.3/§12.5,
// todo/05 §5). The canonical implementation lives in state.ts and is driven
// purely by `zoneProps` (never by a hand-written zone list): Location Area,
// Fleet, Duty Officer, Captain, Status, Staging and beamed cards are in play
// for their owner; hand/decks/discard/Reserve/Development/Log are not.
//
// This module is the query surface setup/phases import from — it owns the
// membership semantics so nothing reaches down into state for zone lists.
export { inPlayCards, isInPlay, owned } from '../state'
export type { GameState } from '../state'
