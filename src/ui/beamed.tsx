// Beamed cards: a card beamed onto a ship or a Location goes into its host's
// BEAMED zone (`BEAMED:<host iid>`), which no board area draws. These chips
// list what a host carries — under the ship or Location on the board and in
// its card detail — and each opens the beamed card's detail.

import type { MouseEvent } from 'react'
import type { CardInstanceId } from '../engine/ids'
import { zoneKey } from '../engine/state'
import { HIDDEN_DEF } from './projection'
import { useProjected, setDetail } from './store'
import { useDefIndex } from './defs'
import { cardName } from '../data/cardNames'
import { Gl } from './tile/glyph'

/** The cards beamed onto `host`, in the order they were beamed. */
export function useBeamed(host: CardInstanceId): readonly CardInstanceId[] {
	const projected = useProjected()
	return projected?.zones[zoneKey({ k: 'BEAMED', host })] ?? []
}

/** How to head what is beamed to a host: a ship carries it aboard, a Location
 *  holds it there. */
export function beamedHeading(host: { zone: { k: string } } | undefined) {
	const k = host?.zone.k
	return k === 'LOCATION_AREA' || k === 'NEUTRAL_ZONE'
		? 'Beamed here'
		: 'Beamed aboard'
}

/** "Beamed onto <ship>" for a beamed card's detail; the ship's name opens it. */
export function BeamedOnto({ host }: { host: CardInstanceId }) {
	const projected = useProjected()
	const index = useDefIndex()
	const d = projected?.cards[host]?.def
	const label =
		d === undefined || d === HIDDEN_DEF
			? 'a ship'
			: (cardName(index.get(d)) ?? host)
	return (
		<>
			Beamed onto{' '}
			<button
				type="button"
				className="beamed-chip"
				onClick={() => setDetail(host)}
			>
				<span className="beamed-name">{label}</span>
			</button>
		</>
	)
}

/** One chip per beamed card. `placement` picks the row under a board card
 *  (`board`) or an inline row in the card detail (`inline`). */
export function BeamedChips({
	host,
	placement,
}: {
	host: CardInstanceId
	placement: 'board' | 'inline'
}) {
	const projected = useProjected()
	const index = useDefIndex()
	const beamed = useBeamed(host)
	if (projected === null || beamed.length === 0) return null
	const heading = beamedHeading(projected.cards[host])
	return (
		<div className={`beamed-chips beamed-${placement}`}>
			{beamed.map((b) => {
				const d = projected.cards[b]?.def
				const label =
					d === undefined || d === HIDDEN_DEF
						? 'face-down card'
						: (cardName(index.get(d)) ?? b)
				return (
					<button
						key={b}
						type="button"
						className="beamed-chip"
						title={`${heading}: ${label}`}
						aria-label={`${heading}: ${label}`}
						onClick={(e: MouseEvent) => {
							e.stopPropagation()
							setDetail(b)
						}}
					>
						<Gl g="BEAM" />
						<span className="beamed-name">{label}</span>
					</button>
				)
			})}
		</div>
	)
}
