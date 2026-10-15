// Line states of a <CardTile> (docs/ui-mobile.md §3): which lines show where
// the card is, and lit / dim / later against the viewer's legal intents (the
// only legality input; the real state adds reasons when there is one). Runs
// on real games through the session adapter (the same path the store takes).

import { beforeAll, describe, expect, it } from 'vitest'
import type { CardCatalog } from '../../engine/setup'
import type { CardInstanceId } from '../../engine/ids'
import type { GameState } from '../../engine/state'
import type { Seat } from '../../engine/resolver/queries'
import { cardDef } from '../../engine/cards'
import { legalIntents, type Intent } from '../../engine/intents'
import { createSession } from '../../session/log'
import { SessionAdapter } from '../../session/adapter'
import { loadBrowserCatalog } from '../browserCatalog'
import { project } from '../projection'
import { contextOf, intentOffered, tileLines, turnBlock } from './lines'

let catalog: CardCatalog

beforeAll(() => {
	catalog = loadBrowserCatalog()
})

function game(seed = 7): SessionAdapter {
	return new SessionAdapter({
		session: createSession(
			{
				mode: 'TWO_PLAYER',
				players: [
					{ deck: 'PIC', boardSide: 'BASIC' },
					{ deck: 'SHR', boardSide: 'BASIC' },
				],
				seed,
			},
			catalog,
		),
		catalog,
	})
}

const inZone = (s: GameState, key: string, def: string): CardInstanceId => {
	const iid = (s.zones[key] ?? []).find((i) => s.cards[i]!.def === def)
	if (iid === undefined) throw new Error(`${def} not in ${key}`)
	return iid
}

/** The viewer's legal list, as the store hands it to a tile: the active
 *  seat's legalIntents, nothing for the other captain. */
const legalFor = (s: GameState, viewer: Seat): Intent[] =>
	s.activeSeat === viewer ? legalIntents(s) : []

/** Local play: the view is the state itself and reasons come from it. */
const linesFor = (
	s: GameState,
	iid: CardInstanceId,
	viewer: Seat = 0,
	show: 'zone' | 'all' = 'zone',
) =>
	tileLines({
		def: cardDef(s.cards[iid]!.def),
		iid,
		view: s,
		legal: legalFor(s, viewer),
		viewer,
		real: s,
		show,
	})

describe('tile lines — where the card is', () => {
	it('maps zones to contexts', () => {
		expect(contextOf({ k: 'HAND', seat: 0 })).toBe('hand')
		expect(contextOf({ k: 'FLEET', seat: 1 })).toBe('play')
		expect(contextOf({ k: 'STAGING', seat: 0 })).toBe('staging')
		expect(contextOf({ k: 'MARKET_OFFER', suit: 'PERSON' })).toBe('market')
		expect(contextOf({ k: 'DISCARD', seat: 0 })).toBe('other')
		expect(contextOf(undefined)).toBe('market')
	})

	it('in play: PLAY lines are hidden, ACTIVATION lines are lit on your turn', () => {
		const a = game()
		a.dispatch({ t: 'START' })
		const s = a.state
		const ent = inZone(s, 'FLEET:0', '1PIC02-24') // PLAY + 3 ACTIVATION
		const lines = linesFor(s, ent)
		expect(lines.map((l) => l.line.timing)).toEqual([
			'ACTIVATION',
			'ACTIVATION',
			'ACTIVATION',
		])
		expect(lines.every((l) => l.state === 'lit')).toBe(true)
		expect(lines[0]!.intent).toEqual({
			t: 'ACTIVATE',
			iid: ent,
			operationIndex: 1,
		})
		// the detail asks for every line: the PLAY line is "not from here"
		const all = linesFor(s, ent, 0, 'all')
		expect(all[0]).toMatchObject({ state: 'na', reason: 'Already in play' })
	})

	it('in hand: PLAY lines lit or dim, table lines fade and trail', () => {
		const a = game()
		a.dispatch({ t: 'START' })
		const s = a.state
		const pic24 = inZone(s, 'HAND:0', '1PIC24-24') // PLAY, RESUPPLY, 2× ACTI
		const lines = linesFor(s, pic24)
		expect(lines[0]!.line.timing).toBe('PLAY')
		expect(lines[0]!.state).toBe('lit')
		expect(lines.slice(1).map((l) => l.state)).toEqual([
			'later',
			'later',
			'later',
		])
		expect(lines[1]!.reason).toBe('Works once this card is in play')
	})

	it('before your Action step every PLAY line is dim with the reason', () => {
		const a = game()
		const s = a.state // SETUP: nothing started
		const hand = s.zones['HAND:0'] ?? []
		expect(hand.length).toBeGreaterThan(0)
		for (const iid of hand) {
			for (const l of linesFor(s, iid).filter(
				(x) => x.line.timing === 'PLAY',
			)) {
				expect(l.state).toBe('dim')
				expect(l.reason).toBe('Cards are played in the Action step')
			}
		}
		expect(turnBlock(s, 0, 'ACTIVATION')).toBe(
			'Activations only run in the Action step',
		)
	})

	it('not your turn: your own lines dim; the opponent’s tiles stay plain', () => {
		const a = game()
		a.dispatch({ t: 'START' })
		const s = a.state
		expect(s.activeSeat).toBe(0)
		const shrShip = (s.zones['FLEET:1'] ?? [])[0]!
		const theirs = linesFor(s, shrShip, 0)
		expect(theirs.every((l) => l.state === 'plain')).toBe(true)
		// seat 1 viewing its own fleet on seat 0's turn
		const mine = linesFor(s, shrShip, 1)
		const acti = mine.filter((l) => l.line.timing === 'ACTIVATION')
		expect(acti.length).toBeGreaterThan(0)
		for (const l of acti) {
			expect(l.state).toBe('dim')
			expect(l.reason).toBe('Not your turn')
		}
	})

	it('exhausted dims only its ACTIVATION lines', () => {
		const a = game()
		a.dispatch({ t: 'START' })
		const ent = inZone(a.state, 'FLEET:0', '1PIC02-24')
		const first = linesFor(a.state, ent).find((l) => l.state === 'lit')!
		a.dispatch(first.intent!)
		// settle any choice the activation opened with the engine's first pick
		let guard = 0
		while (a.state.pendingChoice !== null && guard++ < 10) {
			const r = legalIntents(a.state).find((i) => i.t === 'RESOLVE_CHOICE')
			if (r === undefined || r.t !== 'RESOLVE_CHOICE') break
			a.settle(r.selection)
		}
		const s = a.state
		expect(s.cards[ent]!.exhausted).toBe(true)
		const lines = linesFor(s, ent)
		expect(lines.every((l) => l.line.timing === 'ACTIVATION')).toBe(true)
		for (const l of lines) {
			expect(l.state).toBe('dim')
			expect(l.reason).toBe('Exhausted until Clean-up')
		}
		// PIC's REACTION / ENDGAME lines are untouched by exhaustion rules
		const cap = (s.zones['CAPTAIN:0'] ?? [])[0]!
		expect(linesFor(s, cap).every((l) => l.state === 'plain')).toBe(true)
	})

	it('Market cards and bare defs show every line, nothing to press', () => {
		const a = game()
		a.dispatch({ t: 'START' })
		const s = a.state
		const offer = (s.zones['MARKET_OFFER:PERSON'] ?? [])[0]!
		const def = cardDef(s.cards[offer]!.def)
		const lines = linesFor(s, offer)
		expect(lines.length).toBe(def.operations.length)
		expect(lines.every((l) => l.state === 'plain')).toBe(true)
		const bare = tileLines({ def, iid: null, view: null, legal: [], viewer: 0 })
		expect(bare.map((l) => l.key)).toEqual(lines.map((l) => l.key))
	})

	it('the lit lines are exactly the engine’s legal PLAY / ACTIVATE intents', () => {
		for (const seed of [7, 11, 25]) {
			const a = game(seed)
			a.dispatch({ t: 'START' })
			const s = a.state
			const seat = s.activeSeat
			const lit: Intent[] = []
			for (const card of Object.values(s.cards)) {
				if (card.owner !== seat) continue
				for (const l of linesFor(s, card.iid, seat))
					if (l.state === 'lit' && l.intent !== undefined) lit.push(l.intent)
			}
			const legal = legalIntents(s).filter(
				(i) => i.t === 'PLAY_CARD' || i.t === 'ACTIVATE',
			)
			const key = (i: Intent) => JSON.stringify(i)
			expect(lit.map(key).sort()).toEqual(legal.map(key).sort())
			for (const i of lit) expect(intentOffered(legal, i)).toBe(true)
		}
	})

	it('online: lit comes only from the legal list, reasons need the real state', () => {
		const a = game()
		a.dispatch({ t: 'START' })
		const s = a.state
		// the seat view a phone would get: hidden cards stripped, no real state
		const view = project(s, 0) as unknown as GameState
		const legal = legalIntents(s)
		const pic24 = inZone(s, 'HAND:0', '1PIC24-24')
		const ent = inZone(s, 'FLEET:0', '1PIC02-24')
		const online = (iid: CardInstanceId, list: Intent[]) =>
			tileLines({
				def: cardDef(s.cards[iid]!.def),
				iid,
				view,
				legal: list,
				viewer: 0,
			})
		expect(online(pic24, legal)[0]!.state).toBe('lit')
		expect(online(ent, legal).map((l) => l.state)).toEqual([
			'lit',
			'lit',
			'lit',
		])
		// drop one activation from the list: that line dims, with no reason to
		// give (only the real state could say why)
		const fewer = legal.filter(
			(i) => !(i.t === 'ACTIVATE' && i.iid === ent && i.operationIndex === 2),
		)
		const lines = online(ent, fewer)
		expect(lines.map((l) => l.state)).toEqual(['lit', 'dim', 'lit'])
		expect(lines[1]!.reason).toBeUndefined()
		// nothing listed for this viewer: every line of theirs stays unlit
		expect(online(pic24, []).filter((l) => l.state === 'lit').length).toBe(0)
	})

	it('intentOffered rejects what the store no longer offers', () => {
		const legal: Intent[] = [
			{ t: 'PLAY_CARD', iid: 'a' as CardInstanceId, operationIndex: 0 },
		]
		expect(
			intentOffered(legal, {
				t: 'PLAY_CARD',
				iid: 'a' as CardInstanceId,
				operationIndex: 1,
			}),
		).toBe(false)
		expect(
			intentOffered(legal, {
				t: 'ACTIVATE',
				iid: 'a' as CardInstanceId,
				operationIndex: 0,
			}),
		).toBe(false)
		expect(intentOffered(legal, legal[0]!)).toBe(true)
	})
})

describe('live values on tile lines', () => {
	const endgamePer = (lines: ReturnType<typeof tileLines>) => {
		const endg = lines.find((l) => l.line.timing === 'ENDGAME')
		const per = endg?.line.body.find((t) => t.k === 'per')
		return per?.k === 'per' ? per : undefined
	}

	it('counts on the real board: PIC scores 1 VP per ALLY you own', () => {
		const s = game().state
		const pic = inZone(s, 'CAPTAIN:0', '1PIC01-24')
		const owned = Object.values(s.cards).filter(
			(c) => c.owner === 0 && cardDef(c.def).suit === 'ALLY',
		).length
		const per = endgamePer(
			tileLines({
				def: cardDef('1PIC01-24'),
				iid: pic,
				view: s,
				legal: legalFor(s, 0),
				viewer: 0,
				real: s,
			}),
		)
		expect(per?.live).toBe(owned)
	})

	it('shows no live value without the real state (online)', () => {
		const s = game().state
		const pic = inZone(s, 'CAPTAIN:0', '1PIC01-24')
		const per = endgamePer(
			tileLines({
				def: cardDef('1PIC01-24'),
				iid: pic,
				view: project(s, 0) as unknown as GameState,
				legal: [],
				viewer: 0,
			}),
		)
		expect(per).toBeDefined()
		expect(per?.live).toBeUndefined()
	})
})
