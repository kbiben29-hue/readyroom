// todo/15 §1 — the full headless Cadet Training game (rules/10). Driven end to
// end through reduce() with the REAL catalog: the human (seat 0) answers only
// their OWN pending choices; every choice owned by the virtual opponent
// (seat 1) is auto-resolved by the cadet pilot in intents.ts. Two scripted
// scenarios:
//
//   * win path  — a "no-play" driver that just passes each ACTION phase:
//     the Cadet Stardate cards drive the fixed timeline (rules/10 §10.3) —
//     card 1 empties during turn 5 clean-up, card 2 during turn 10, the
//     Resolution budget is exactly one more turn, and the game scores after
//     turn 11 with the human (seat 0) as the sole participant.
//   * burn path — the human plays a test-only INCIDENT-taking card; the single
//     play empties the Incident deck and the Burn fires mid-game. Because the
//     virtual opponent is a query interceptor (there is no real player to
//     out-score), the human LOSES (rules/10 §10.2 #5) — `cadetLoss`, no winner.
//
// Both are byte-identical replays: same seed + same intent script twice →
// identical JSON.

import { describe, expect, it } from 'vitest'
import type { CardDef } from '../data/schema'
import type { Effect, Operation } from './resolver/nodes'
import type { GameState } from './state'
import { setup, type CardCatalog, type SetupConfig } from './setup'
import { reduce, type Intent } from './intents'
import { validateChoice, type PendingChoice } from './resolver/choices'
import { assertSerialisable } from './invariants'
import { loadCatalog } from '../data/catalog'
import type { CardInstanceId } from './ids'

// ---------------------------------------------------------------------------
// The real catalog, including the two real Cadet Training Stardate cards
// (SD06/SD07 "SOLO CADET PRACTICE", rules/10 §10.1: both print 5 Glory) —
// setup() picks them by mode and boxes the rest.
// ---------------------------------------------------------------------------

async function makeCatalog(): Promise<CardCatalog> {
	return loadCatalog()
}

function config(seed: number): SetupConfig {
	// The virtual opponent (seat 1) borrows the SHR board — it never takes a
	// turn and every rule about it is answered by the interceptor, so its real
	// (inert) cards are never read.
	return {
		mode: 'CADET',
		players: [
			{ deck: 'PIC', boardSide: 'BASIC' },
			{ deck: 'SHR', boardSide: 'BASIC' },
		],
		seed,
	}
}

// ---------------------------------------------------------------------------
// Burn-loss catalog: the real game plus one test card whose PLAY op forces the
// (human) player to take every INCIDENT — the only way the deck can empty in
// Cadet mode (forced INCIDENTs on the *opponent* substitute to Glory, rules/10
// §10.2 #4 — so the deck would otherwise last forever). The single play empties
// the deck and the Burn fires immediately. startPosition AVAILABLE + seed 7
// puts it in the opening hand.
// ---------------------------------------------------------------------------

const burnOp: Operation = {
	type: 'PLAY',
	costsAction: false,
	isAttack: false,
	effect: { k: 'TAKE', deck: 'INCIDENT', count: 6 } as Effect,
	text: 'Test card — take every INCIDENT (cadet burn probe)',
}

function burnCard(id: string): CardDef {
	return {
		id,
		cardId: null,
		name: id,
		suit: 'PERSON',
		deck: 'PIC',
		traits: [],
		skills: [],
		variableSkill: undefined,
		focus: null,
		vp: 0,
		vpAsterisk: false,
		startPosition: 'AVAILABLE',
		developmentCost: null,
		operations: [burnOp],
	}
}

async function makeBurnCatalog(): Promise<CardCatalog> {
	const catalog = await makeCatalog()
	catalog.defs = [...catalog.defs, burnCard('1PIC31-24')]
	;(catalog as CardCatalog & { burnIds: string[] }).burnIds = ['1PIC31-24']
	return catalog
}

// ---------------------------------------------------------------------------
// Driver — the m1-exit idiom from pic-shr-game.test.ts: every reduce
// passes assertSerialisable (with the stack-frame JSON fallback), every
// RESOLVE_CHOICE is validated first, and the run loop answers ONLY seat-0
// choices (seat-1 choices are auto-piloted inside reduce).
// ---------------------------------------------------------------------------

class Driver {
	s: GameState
	readonly seed: number
	constructor(seed: number, catalog: CardCatalog) {
		this.seed = seed
		this.s = setup(config(seed), catalog)
		this.check(this.s)
		if (this.s.startingSeat !== 0)
			throw new Error('cadet: human must start (seat 0)')
	}
	private check(state: GameState): void {
		try {
			assertSerialisable(state)
		} catch (err) {
			const msg = (err as Error).message
			if (!msg.startsWith('cycle at $.stack')) throw err
			const text = JSON.stringify(state)
			if (text === undefined)
				throw new Error('cadet: state is not JSON-serialisable')
			JSON.parse(text)
		}
	}
	go(intent: Intent): GameState {
		const r = reduce(this.s, intent)
		this.s = r.state
		this.check(this.s)
		return this.s
	}
	c(kind?: PendingChoice['k']): PendingChoice {
		const c = this.s.pendingChoice
		if (c === null) throw new Error('cadet: expected a pendingChoice, got none')
		if (kind !== undefined && c.k !== kind)
			throw new Error(`cadet: expected ${kind}, got ${c.k}`)
		if (c.seat !== 0)
			throw new Error(`cadet: driver must not answer seat ${c.seat}'s choice`)
		return c
	}
	settle(selection: unknown, kind?: PendingChoice['k']): GameState {
		const c = this.c(kind)
		const v = validateChoice(this.s, c.id, selection)
		if (!v.ok)
			throw new Error(`cadet: scripted selection is ILLEGAL: ${v.reason}`)
		return this.go({ t: 'RESOLVE_CHOICE', choiceId: c.id, selection })
	}
}

/** The human's choice policy — a deterministic, defensible script (the same
 *  spirit as the Cadet's own): decline every optional, take the first legal
 *  alternative otherwise. */
function humanChoice(choice: PendingChoice): unknown {
	switch (choice.k) {
		case 'CONFIRM':
			return false
		case 'CHOOSE_OPTION': {
			const enabled = choice.options.find((o) => o.enabled) ?? choice.options[0]
			return enabled === undefined ? null : { key: enabled.key }
		}
		case 'CHOOSE_CARDS': {
			const disabled = new Set((choice.disabled ?? []).map((d) => d.iid))
			const legal = choice.candidates.filter(
				(iid: CardInstanceId) => !disabled.has(iid),
			)
			return legal.slice(0, choice.min)
		}
		case 'CHOOSE_LOCATION':
			return choice.candidates[0]
		case 'CHOOSE_SUIT':
			return choice.suits[0]
		case 'CHOOSE_TRAIT':
			return choice.traits[0]
		case 'CHOOSE_SPECIALTY':
			return choice.specialties[0]
		case 'CHOOSE_DESTINATION':
			return choice.options[0] ?? 'DECK_TOP'
		case 'CHOOSE_AMOUNT':
			return choice.min
		case 'ORDER_OPERATIONS':
			return choice.pending
		case 'OPTIONAL_TRIGGERS':
			return [] // no REACTIONs
		case 'CHOOSE_WITNESS':
			return choice.sets[0]
		case 'CHOOSE_WILDCARD_AS':
			return choice.traits[0]
		case 'ORDER_CARDS':
			return choice.cards
	}
}

/** Resolve every outstanding seat-0 choice (declining / first legal). */
function settleChoices(D: Driver): void {
	while (D.s.pendingChoice !== null) {
		const selection = humanChoice(D.s.pendingChoice)
		D.settle(selection)
	}
}

/** The win-path driver: no cards played — the game is driven entirely by the
 *  Stardate clean-ups. Returns the final COMPLETE state. */
function runWinGame(D: Driver): GameState {
	D.go({ t: 'START' })
	while (D.s.result === null) {
		if (D.s.pendingChoice !== null) {
			settleChoices(D)
			continue
		}
		if (D.s.phase.k !== 'ACTION')
			throw new Error(`cadet win: stalled in phase ${D.s.phase.k}`)
		D.go({ t: 'END_TURN' })
	}
	return D.s
}

/** The burn-path driver: plays the INCIDENT-taking test card from hand once
 *  (draining the whole Incident deck — the Burn fires mid-play). */
function runBurnGame(D: Driver, burnIds: Set<string>): GameState {
	D.go({ t: 'START' })
	while (D.s.result === null) {
		if (D.s.pendingChoice !== null) {
			settleChoices(D)
			continue
		}
		if (D.s.phase.k !== 'ACTION')
			throw new Error(`cadet burn: stalled in phase ${D.s.phase.k}`)
		const hand = D.s.zones['HAND:0'] ?? []
		const burn = hand.find((iid: CardInstanceId) =>
			burnIds.has(D.s.cards[iid]!.def),
		)
		if (burn !== undefined) {
			D.go({ t: 'PLAY_CARD', iid: burn, operationIndex: 0 })
			break
		}
		D.go({ t: 'END_TURN' })
	}
	return D.s
}

// ---------------------------------------------------------------------------

describe('Cadet Training — full headless game, real catalog (todo/15 §1)', () => {
	it('win path: the fixed 5/10/11-turn timeline drives the game to a solo final score', async () => {
		const catalog = await makeCatalog()
		const D = new Driver(16, catalog)
		D.go({ t: 'START' })

		// Walk the human through each ACTION phase, recording the state at every
		// turn boundary (the driver settles the cleanup choices per turn).
		const atTurnStart: GameState[] = []
		let guard = 0
		while (D.s.result === null && guard++ < 60) {
			if (D.s.pendingChoice !== null) {
				settleChoices(D)
				continue
			}
			if (D.s.phase.k !== 'ACTION')
				throw new Error(`cadet win: stalled in ${D.s.phase.k}`)
			atTurnStart.push(D.s)
			D.go({ t: 'END_TURN' })
		}
		expect(guard).toBeLessThan(60)

		const s = D.s
		if (s.result === null || s.result.kind !== 'COMPLETE')
			throw new Error('expected COMPLETE')

		// The human played turns 1..11 (turnNumber has advanced past 11).
		expect(s.turnsTaken[0]).toBe(11)
		expect(s.turnNumber).toBe(12)

		// Fix the timeline (rules/10 §10.3): card 1 empties on turn 5 (its handoff
		// happens in that clean-up), card 2 empties on turn 10, Resolution is
		// exactly ONE more turn, then final scoring.
		const afterTurn5 = atTurnStart[5]! // the state at the start of ACTION turn 6
		expect(afterTurn5.players[0].heldStardate).not.toBeNull() // SD06 handed over
		expect(afterTurn5.stardates.pile).toHaveLength(1) // SD07 remains
		expect(afterTurn5.stardates.gloryOnTop).toBe(5) // refilled with card 2's printed Glory
		expect(afterTurn5.resolutionTriggered).toBe(false)

		const afterTurn10 = atTurnStart[10]! // the state at the start of ACTION turn 11
		expect(afterTurn10.resolutionTriggered).toBe(true) // card 2 emptied during turn 10's clean-up
		expect(afterTurn10.stardates.gloryOnTop).toBe(0)
		expect(afterTurn10.stardates.pile).toHaveLength(1)

		// The game ended after exactly one Resolution turn (turn 11).
		expect(atTurnStart).toHaveLength(11)

		// Solo final scoring: the human is the sole participant — it "wins" by
		// benchmark band, not by out-scoring the virtual opponent.
		expect(s.result.scoreboard.cadetLoss).toBe(false)
		expect(s.result.scoreboard.winners).toEqual([0])
		// INCIDENTs print −2 VP, so a scripted low-effort game can end below 0.
		expect(Number.isInteger(s.scoreVp[0])).toBe(true)
		expect(s.phase.k).toBe('GAME_OVER')
	})

	it('win path is deterministic: same seed + script replays byte-identically', async () => {
		const catalog = await makeCatalog()
		const a = runWinGame(new Driver(16, catalog))
		const b = runWinGame(new Driver(16, catalog))
		expect(JSON.stringify(a)).toBe(JSON.stringify(b))
		expect(a).toEqual(b)
	})

	it('burn path: emptying the Incident deck mid-game loses the cadet game (rules/10 §10.2 #5)', async () => {
		const catalog = await makeBurnCatalog()
		const burnIds = new Set(
			(catalog as CardCatalog & { burnIds: string[] }).burnIds,
		)
		const D = new Driver(7, catalog)
		const opening = D.s.zones['HAND:0'] ?? []
		expect(
			opening.filter((iid: CardInstanceId) => burnIds.has(D.s.cards[iid]!.def))
				.length,
		).toBeGreaterThanOrEqual(1)

		const s = runBurnGame(D, burnIds)
		if (s.result === null || s.result.kind !== 'COMPLETE')
			throw new Error('expected COMPLETE')
		expect((s.zones['INCIDENT_DECK'] ?? []).length).toBe(0) // the deck is what burned it
		expect(s.result.scoreboard.cadetLoss).toBe(true)
		expect(s.result.scoreboard.winners).toEqual([])
		expect(s.result.scoreboard.incidentCounts).toBeDefined()
		// The burn fired before the 11-turn Resolution schedule.
		expect(s.turnNumber).toBeLessThan(9)
	})

	it('burn path is deterministic: same seed + script replays byte-identically', async () => {
		const catalog = await makeBurnCatalog()
		const burnIds = new Set(
			(catalog as CardCatalog & { burnIds: string[] }).burnIds,
		)
		const a = runBurnGame(new Driver(7, catalog), burnIds)
		const b = runBurnGame(new Driver(7, catalog), burnIds)
		expect(JSON.stringify(a)).toBe(JSON.stringify(b))
		expect(a).toEqual(b)
	})
})

// A note on why we never answer the virtual opponent: in CADET mode every rule
// about seat 1 is answered by the interceptor (src/bot/cadet.ts) and every
// PendingChoice the resolver would emit for seat 1 is auto-resolved by the
// cadet pilot (intents.ts). A headless driver is therefore complete when it can
// answer `seat === 0` choices only — the "no opponent decision-making" promise
// of rules/10 §10.5.
