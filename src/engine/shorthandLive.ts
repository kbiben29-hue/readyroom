// Live values for Shorthand lines (docs/shorthand.md §5, docs/ui-mobile.md §9
// step 5): "+1 CARD / #SCIENTIST" is more useful as "+1 CARD / #SCIENTIST ×3"
// when three SCIENTISTs are in play, and "IF ≥1 #ENGINEER → +1 ACT" reads
// faster when the condition already shows whether it holds.
//
// The compiler keeps each counted amount (`per.source`) and each condition
// (`if.pred`) on its token; this evaluates them against a state, for the card
// that owns the line, with the engine's own evalAmount / evalPredicate — so a
// live value can never disagree with what resolving the operation would do.
//
// Only context-free parts are evaluated. Anything that reads a binding made
// while the operation resolves ("the discarded card", "the chosen specialty",
// "if you did") has no value before it runs and is left alone.

import type { GameState, EffectCtx } from './state'
import type { CardInstanceId } from './ids'
import type { Amount, Predicate, Seat } from './resolver/queries'
import { evalAmount, evalPredicate } from './queries/resolveQuery'
import type { ShorthandLine, Tok } from './shorthand'

/** Kinds whose value exists only while the operation resolves. */
const BOUND_KINDS = new Set([
	'ICON_COUNT',
	'TRAIT_COUNT',
	'SHARED_TRAITS',
	'DID',
	'BOUND_IS',
	'BOUND_SHARES_TRAIT',
	'LOG_LEGAL',
])
/** Keys that point into the resolving operation's bindings. */
const BOUND_KEYS = new Set(['bind', 'bound', 'atBound'])

/** Can this amount / predicate be evaluated before the operation runs? */
export function isContextFree(node: Amount | Predicate): boolean {
	let free = true
	const walk = (v: unknown): void => {
		if (!free) return
		if (Array.isArray(v)) {
			for (const x of v) walk(x)
			return
		}
		if (v === null || typeof v !== 'object') return
		const o = v as Record<string, unknown>
		if (typeof o['k'] === 'string' && BOUND_KINDS.has(o['k'])) free = false
		if (o['k'] === 'SKILL_ICONS' && o['specialty'] === 'CHOSEN') free = false
		for (const [key, x] of Object.entries(o)) {
			if (BOUND_KEYS.has(key)) free = false
			walk(x)
		}
	}
	walk(node)
	return free
}

/** A copy of `line` with `per.live` and `if.holds` filled in for the card
 *  `source` owned by `seat`, on `state`. Tokens that can't be evaluated are
 *  returned unchanged; a throw in evaluation leaves that token unchanged. */
export function withLiveValues(
	line: ShorthandLine,
	state: GameState,
	seat: Seat,
	source: CardInstanceId,
): ShorthandLine {
	const ctx: EffectCtx = { actor: seat, source, bindings: {} }
	const mapToks = (toks: Tok[]): Tok[] => toks.map(mapTok)
	const mapTok = (t: Tok): Tok => {
		switch (t.k) {
			case 'per': {
				const next: Tok = { ...t, body: mapToks(t.body), per: mapToks(t.per) }
				if (t.source === undefined || !isContextFree(t.source)) return next
				try {
					return { ...next, live: evalAmount(state, t.source, ctx) }
				} catch {
					return next
				}
			}
			case 'if': {
				const next: Tok = {
					...t,
					then: mapToks(t.then),
					...(t.else !== undefined ? { else: mapToks(t.else) } : {}),
				}
				if (t.pred === undefined || !isContextFree(t.pred)) return next
				try {
					return { ...next, holds: evalPredicate(state, t.pred, ctx) }
				} catch {
					return next
				}
			}
			case 'cost':
			case 'may':
			case 'opp':
			case 'qual':
			case 'steal':
			case 'is':
			case 'not':
				return { ...t, body: mapToks(t.body) }
			case 'or':
				return { ...t, options: t.options.map(mapToks) }
			case 'did':
				return { ...t, then: mapToks(t.then) }
			case 'repeat':
				return { ...t, body: mapToks(t.body) }
			default:
				return t
		}
	}
	return { ...line, body: mapToks(line.body) }
}
