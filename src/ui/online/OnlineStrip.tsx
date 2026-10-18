// The online status line under the phone header (docs/ui-mobile.md §5): a
// decision owed on the other captain's turn, with its deadline; otherwise whose
// move it is, whether they are on the bridge, and whether the live link holds.

import { useDefIndex } from '../defs'
import { useGameStore } from '../store'
import { deckLabel } from '../../data/cardNames'
import { PendingNotice } from './Orders'
import './online.css'

export function OnlineStrip() {
	const online = useGameStore((s) => s.online)
	const defs = useDefIndex()
	const view = online?.view ?? null
	if (online === null || view === null) return null
	const names: [string, string] = [
		view.players[0].name ?? deckLabel(view.players[0].deck),
		view.players[1].name ?? deckLabel(view.players[1].deck),
	]
	const them = view.seat === 0 ? 1 : 0
	const link =
		online.stream === 'reconnecting'
			? 'reconnecting…'
			: online.stream === 'closed'
				? 'not live'
				: null
	if (view.pending !== null)
		return (
			<div className="ol-strip">
				<PendingNotice view={view} defs={defs} names={names} />
			</div>
		)
	return (
		<div className="ol-strip ol-strip-line" role="status">
			{view.result !== null ? (
				<span>Game over</span>
			) : view.yourMove ? (
				<span className="ol-you">Your move</span>
			) : (
				<span>Waiting for {names[them]}</span>
			)}
			{view.presence[them] && (
				<span className="ol-presence">{names[them]} is on the bridge</span>
			)}
			{online.busy && <span className="ol-muted">sending…</span>}
			{link !== null && <span className="ol-muted">{link}</span>}
		</div>
	)
}
