// Token flights (docs/ui-lcars.md §1 — tokens may fly, cards never move).
//
// The engine's `fx` trail (src/engine/fx.ts) records every EFFECT step's net
// token changes and the card that caused them. This module turns one dispatch's
// worth of that trail into *waves* of flights — one wave per step, in order,
// so "pay the cost, then the benefit lands" reads as cause → effect:
//
//   - within a step, what one pool lost and another gained is a transfer
//     (a steal: their pool → yours; Market glory: the card → your pool);
//   - a gain nobody lost flies OUT of the source card (a passive's Dilithium);
//   - a loss nobody gained flies INTO the source card (the cost of playing it);
//   - with no source card, the supply stands in.
//
// Changes made outside any effect (Resupply refill, the Clean-up action reset)
// arrive as `residual` and form one last wave to/from the supply.
//
// Pure data → data; the DOM side lives in flight.tsx.

import type { TokenFx, TokenPool } from '../engine/state'
import type { CardInstanceId } from '../engine/ids'
import type { ResourceId } from '../data/ids'
import type { Seat } from '../engine/resolver/queries'

export type TokenKind = ResourceId | 'ACTION'

/** One dispatch's token movement, captured by the store (store.ts `motion`). */
export interface Motion {
	seq: number
	/** fx entries appended by this dispatch (hidden sources already redacted). */
	fx: TokenFx[]
	/** net changes not covered by `fx` — phase bookkeeping. */
	residual: TokenFx['changes']
	/** first log index this dispatch added (log.tsx highlights from here). */
	logFrom: number
}

/** A place a token can fly from / to: a `data-anchor` key plus fallbacks,
 *  tried in order (a card in the opponent's compact area has no element). */
export type AnchorChain = string[]

export interface Flight {
	kind: TokenKind
	n: number
	from: AnchorChain
	to: AnchorChain
	/** pool keys whose counters get a delta badge (null = not a counter). */
	fromPool: string | null
	toPool: string | null
	/** the card whose effect caused this flight — glows as it fires. */
	source: CardInstanceId | null
}

export const SUPPLY = 'supply'

export function poolKey(pool: TokenPool): string {
	switch (pool.k) {
		case 'PLAYER':
			return `player:${pool.seat}:${pool.res}`
		case 'CARD':
			return `card:${pool.iid}:${pool.res}`
		case 'STARDATE':
			return 'stardate'
	}
}

function poolKind(pool: TokenPool): TokenKind {
	return pool.k === 'STARDATE' ? 'GLO' : pool.res
}

function poolSeat(pool: TokenPool): Seat | null {
	return pool.k === 'PLAYER' ? pool.seat : null
}

function poolAnchor(pool: TokenPool, fallbackSeat: Seat | null): AnchorChain {
	const tail =
		fallbackSeat !== null ? [`seat:${fallbackSeat}`, SUPPLY] : [SUPPLY]
	switch (pool.k) {
		case 'PLAYER':
			return [`player:${pool.seat}:${pool.res}`, `seat:${pool.seat}`, SUPPLY]
		case 'CARD':
			return [`card:${pool.iid}`, ...tail]
		case 'STARDATE':
			return ['stardate', SUPPLY]
	}
}

function sourceAnchor(
	source: CardInstanceId | null,
	fallbackSeat: Seat | null,
): AnchorChain {
	const tail =
		fallbackSeat !== null ? [`seat:${fallbackSeat}`, SUPPLY] : [SUPPLY]
	return source !== null ? [`card:${source}`, ...tail] : [SUPPLY]
}

/** Plan one step's flights (see the module comment for the pairing rule). */
export function planWave(
	changes: TokenFx['changes'],
	source: CardInstanceId | null,
): Flight[] {
	const flights: Flight[] = []
	const kinds = new Set(changes.map((c) => poolKind(c.pool)))
	for (const kind of kinds) {
		const mine = changes.filter((c) => poolKind(c.pool) === kind)
		const losses = mine
			.filter((c) => c.delta < 0)
			.map((c) => ({ pool: c.pool, n: -c.delta }))
		const gains = mine
			.filter((c) => c.delta > 0)
			.map((c) => ({ pool: c.pool, n: c.delta }))

		// transfers: what one pool lost, another gained
		let li = 0
		let gi = 0
		while (li < losses.length && gi < gains.length) {
			const l = losses[li]!
			const g = gains[gi]!
			const n = Math.min(l.n, g.n)
			flights.push({
				kind,
				n,
				from: poolAnchor(l.pool, poolSeat(g.pool)),
				to: poolAnchor(g.pool, poolSeat(l.pool)),
				fromPool: poolKey(l.pool),
				toPool: poolKey(g.pool),
				source,
			})
			l.n -= n
			g.n -= n
			if (l.n === 0) li++
			if (g.n === 0) gi++
		}
		// unpaired gains fly out of the source card; unpaired losses into it
		for (; gi < gains.length; gi++) {
			const g = gains[gi]!
			flights.push({
				kind,
				n: g.n,
				from: sourceAnchor(source, poolSeat(g.pool)),
				to: poolAnchor(g.pool, null),
				fromPool: null,
				toPool: poolKey(g.pool),
				source,
			})
		}
		for (; li < losses.length; li++) {
			const l = losses[li]!
			flights.push({
				kind,
				n: l.n,
				from: poolAnchor(l.pool, null),
				to: sourceAnchor(source, poolSeat(l.pool)),
				fromPool: poolKey(l.pool),
				toPool: null,
				source,
			})
		}
	}
	return flights
}

/** All waves of one dispatch, in resolution order. */
export function planFlights(motion: Motion): Flight[][] {
	const waves = motion.fx
		.map((e) => planWave(e.changes, e.source))
		.filter((w) => w.length > 0)
	const tail = planWave(motion.residual, null)
	if (tail.length > 0) waves.push(tail)
	return waves
}

/** The net changes of `total` that no fx entry explains (phase bookkeeping). */
export function residualChanges(
	total: TokenFx['changes'],
	fx: readonly TokenFx[],
): TokenFx['changes'] {
	const explained = new Map<string, number>()
	for (const e of fx)
		for (const c of e.changes)
			explained.set(
				poolKey(c.pool),
				(explained.get(poolKey(c.pool)) ?? 0) + c.delta,
			)
	const out: TokenFx['changes'] = []
	for (const c of total) {
		const delta = c.delta - (explained.get(poolKey(c.pool)) ?? 0)
		if (delta !== 0) out.push({ pool: c.pool, delta })
	}
	return out
}
