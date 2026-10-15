// Standing orders and owed decisions (docs/ui-mobile.md §7). A standing order
// answers a reaction card's window on the opponent's turn without waking you:
// ask (the game waits, up to the deadline), always (the server uses it; the
// bot makes any sub-choice), never (it is skipped).

import type { CardDef } from '../../data/schema'
import type { GameView, StandingPolicy } from '../../session/online'
import { HIDDEN_DEF } from '../../engine/projection'
import { timeLeft } from './Hails'
import './online.css'
import { cardName, withCardNames } from '../../data/cardNames'

const POLICY_TEXT: Record<StandingPolicy, string> = {
	ask: 'The game waits for you, up to the deadline.',
	always: 'Used automatically on the opponent’s turn; they never wait.',
	never: 'Skipped automatically; they never wait.',
}

/** Your reaction cards this game (visible to you, deduplicated by card). */
export function reactionCards(
	view: GameView,
	defs: ReadonlyMap<string, CardDef>,
): CardDef[] {
	const out = new Map<string, CardDef>()
	for (const card of Object.values(view.state.cards)) {
		if (card.owner !== view.seat || card.def === HIDDEN_DEF) continue
		const def = defs.get(card.def)
		if (def !== undefined && def.operations.some((o) => o.type === 'REACTION'))
			out.set(def.id, def)
	}
	return [...out.values()].sort((a, b) =>
		cardName(a).localeCompare(cardName(b)),
	)
}

export function StandingOrders({
	view,
	defs,
	onSet,
	busy,
}: {
	view: GameView
	defs: ReadonlyMap<string, CardDef>
	onSet: (cardDef: string, policy: StandingPolicy) => void
	busy?: boolean | undefined
}) {
	const cards = reactionCards(view, defs)
	if (cards.length === 0)
		return (
			<p className="ol-muted">
				None of your cards can react on the opponent’s turn.
			</p>
		)
	return (
		<div className="ol-orders">
			{cards.map((def) => {
				const policy = view.orders[def.id] ?? 'ask'
				return (
					<div key={def.id} className="ol-order">
						<span className="ol-order-name">{cardName(def)}</span>
						<div
							className="ol-seg"
							role="group"
							aria-label={`Standing order for ${cardName(def)}`}
						>
							{(['ask', 'always', 'never'] as const).map((p) => (
								<button
									key={p}
									type="button"
									aria-pressed={policy === p}
									disabled={busy === true}
									onClick={() => onSet(def.id, p)}
								>
									{p === 'ask'
										? 'Ask me'
										: p === 'always'
											? 'Always use'
											: 'Never'}
								</button>
							))}
						</div>
						<p className="ol-muted">{POLICY_TEXT[policy]}</p>
					</div>
				)
			})}
		</div>
	)
}

/** The interrupt banner: what you owe on their turn, or what they owe on yours. */
export function PendingNotice({
	view,
	defs,
	names,
}: {
	view: GameView
	defs: ReadonlyMap<string, CardDef>
	names: [string, string]
}) {
	const p = view.pending
	if (p === null) return null
	const source =
		p.sourceDef !== null ? (cardName(defs.get(p.sourceDef)) ?? null) : null
	const mine = p.seat === view.seat
	const mover = names[p.seat === 0 ? 1 : 0]
	return (
		<div className={`ol-pending${mine ? ' ol-pending-you' : ''}`} role="status">
			<b>
				{mine
					? `${mover}’s turn is paused for your answer`
					: `Waiting for ${names[p.seat]} to answer`}
			</b>
			<span>
				{source !== null ? `${source}: ` : ''}
				{withCardNames(p.prompt)}
			</span>
			<span className="ol-deadline">{timeLeft(p.deadline)}</span>
		</div>
	)
}
