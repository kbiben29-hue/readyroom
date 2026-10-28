// The Orders drawer: every legal move right now in one list — play a card,
// activate one, complete a mission — grouped by where the card is, the
// desktop twin of the phone's Orders sheet (mobile/sheets.tsx). It reads the
// viewer's legal intents, so a row is listed iff the engine would accept it.

import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { GameState } from '../engine/state'
import { OpBlock, OpText, OrderOp } from './cards'
import { missionView, orderGroups } from './mobile/facts'
import {
	useGameStore,
	useProjected,
	useRealState,
	useViewerSeat,
} from './store'
import { useViewerLegal } from './tile/legal'

const WHERE: Record<string, string> = {
	HAND: 'in hand',
	CAPTAIN: 'Captain',
	DUTY_OFFICER: 'Duty Officer',
	FLEET: 'Fleet',
	LOCATION_AREA: 'Location Area',
	STATUS: 'Status',
}

export function OrdersPanel({ onClose }: { onClose: () => void }) {
	const legal = useViewerLegal()
	const projected = useProjected()
	const realState = useRealState()
	const viewer = useViewerSeat()
	const view = projected as unknown as GameState | null
	const groups = useMemo(
		() => (view !== null ? orderGroups(legal, view) : []),
		[legal, view],
	)
	const n = groups.reduce((sum, g) => sum + g.rows.length, 0)
	const actions = view?.players[viewer]?.actions.available ?? 0
	// portalled: opened from the top bar, it must not inherit the bar's colours
	return createPortal(
		<div className="drawer-backdrop" onClick={onClose}>
			<aside
				className="drawer orders-drawer"
				onClick={(e) => e.stopPropagation()}
				aria-label="Orders: every legal move"
			>
				<div className="drawer-head">
					<strong>Orders · {n}</strong>
					<button type="button" className="btn" onClick={onClose}>
						Close
					</button>
				</div>
				<div className="orders-body">
					<p className="muted small">
						Every legal move right now, wherever the card is. You have {actions}{' '}
						action{actions === 1 ? '' : 's'} left.
					</p>
					{view === null || realState === null || groups.length === 0 ? (
						<p className="orders-empty">
							{view?.pendingChoice != null
								? 'Answer the open choice first.'
								: view !== null && view.activeSeat !== viewer
									? 'It is not your turn.'
									: view !== null && view.phase.k !== 'ACTION'
										? 'Nothing to order outside your Action step — continue to move on.'
										: 'No legal moves left. End the step when you are ready.'}
						</p>
					) : (
						groups.map((g) => (
							<section key={g.label} className="orders-group">
								<h3 className="nav-label">{g.label}</h3>
								{g.rows.map((it, i) => {
									if (it.t === 'COMPLETE_MISSION') {
										const m = missionView(view, viewer, it.index, [it])
										if (m === null) return null
										return (
											<OpBlock
												key={i}
												blocked={false}
												run={{
													label: 'Complete',
													idle: null,
													onRun: () => {
														onClose()
														useGameStore.getState().dispatch(it)
													},
												}}
											>
												<div className="op-detail-head">
													<strong>{m.title}</strong>
													<span className="muted small">goal met</span>
												</div>
												<p className="op-text">
													<OpText text={m.rewardEnglish} />
												</p>
											</OpBlock>
										)
									}
									if (it.t !== 'PLAY_CARD' && it.t !== 'ACTIVATE') return null
									const zone = view.cards[it.iid]?.zone.k
									return (
										<OrderOp
											key={i}
											intent={it}
											state={realState}
											where={zone !== undefined ? (WHERE[zone] ?? '') : ''}
											onDone={onClose}
										/>
									)
								})}
							</section>
						))
					)}
				</div>
			</aside>
		</div>,
		document.body,
	)
}
