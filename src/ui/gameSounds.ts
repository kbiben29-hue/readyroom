// Which sound (and red-alert lighting) a committed intent earns. Called from
// the store's shared commit path, so the House AI's moves sound too. Token
// flights make their own swooshes (flight.tsx); plain button presses their
// own clicks (installButtonClicks).

import { cardDef, hasCardDef } from '../engine/cards'
import type { Intent } from '../engine/intents'
import type { Seat } from '../engine/resolver/queries'
import { zonesOf, type GameState } from '../engine/state'
import { cuedRecently, playCue, redAlert } from './sound'

function suitOf(state: GameState, iid: string): string | null {
	const def = state.cards[iid]?.def
	if (def === undefined || !hasCardDef(def)) return null
	return cardDef(def).suit
}

export function cueDispatch(
	before: GameState,
	after: GameState,
	intent: Intent,
	viewer: Seat,
): void {
	if (before === after) return
	let alerted = false
	switch (intent.t) {
		case 'PLAY_CARD':
			if (suitOf(before, intent.iid) === 'INCIDENT') {
				redAlert('alert')
				alerted = true
			} else playCue('play')
			break
		case 'ACTIVATE':
			playCue('activate')
			break
		case 'COMPLETE_MISSION':
			playCue('mission')
			break
		case 'END_TURN':
			playCue('endTurn')
			break
		case 'PASS':
		case 'START':
			playCue('pass')
			break
		case 'RESOLVE_CHOICE':
			break
	}
	// an Incident taken off the deck (a cost, an effect or the Stardate track)
	const incidentsBefore = zonesOf(before, { k: 'INCIDENT_DECK' }).length
	const incidentsAfter = zonesOf(after, { k: 'INCIDENT_DECK' }).length
	if (!alerted && incidentsAfter < incidentsBefore) redAlert('warning')

	// a card beamed aboard, or an Away Team sent down to a Location
	const beamed = (st: GameState) =>
		Object.values(st.cards).filter((c) => c.beamedTo !== null).length
	const away = (st: GameState) =>
		Object.values(st.awayTeamsAt).reduce((n, [a, b]) => n + a + b, 0)
	if (beamed(after) > beamed(before) || away(after) > away(before))
		playCue('beam')

	// any mission completed through an effect, not the button
	if (intent.t !== 'COMPLETE_MISSION') {
		const done = (s: GameState) =>
			s.players.reduce(
				(n, p) => n + p.missions.filter((m) => m.completed).length,
				0,
			)
		if (done(after) > done(before)) playCue('mission')
	}

	if (before.result === null && after.result !== null) {
		const r = after.result
		const won = r.kind === 'COMPLETE' && r.scoreboard.winners.includes(viewer)
		setTimeout(() => playCue(won ? 'victory' : 'defeat'), 450)
	}
}

/** A soft key-tap for every button press that did not already sound a game
 *  cue (a Play button chirps instead). Install once at app start. */
export function installButtonClicks(): void {
	if (typeof document === 'undefined') return
	document.addEventListener('click', (e) => {
		const t = e.target as Element | null
		const btn = t?.closest?.(
			'button, [role="button"], select, [data-anchor^="card:"], [data-iid]',
		)
		if (btn === null || btn === undefined) return
		if ((btn as HTMLButtonElement).disabled) return
		// React handlers ran first (bubbling reached the document last); a
		// commit they made already played its own cue
		if (cuedRecently()) return
		playCue('click')
	})
}
