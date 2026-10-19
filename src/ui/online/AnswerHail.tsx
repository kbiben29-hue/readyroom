// Answer a hail (docs/ui-mobile.md §7): an invite link whose game waits for
// its guest. The guest sees who hailed them and with which captain, picks
// their own, and takes the first turn — they are at the screen right now.

import { useState } from 'react'
import type { DeckId } from '../../data/ids'
import type { GameLobby, JoinGameRequest } from '../../session/online'
import { SeatFields } from './NewOnlineGame'
import { deckLabel } from '../../data/cardNames'
import './online.css'

export interface AnswerHailProps {
	lobby: GameLobby
	decks: DeckId[]
	deckLabel: (deck: DeckId) => string
	/** join the game; resolves once it has started (or throws) */
	onAnswer: (req: JoinGameRequest) => Promise<void>
	onCancel: () => void
}

export function AnswerHail(props: AnswerHailProps) {
	const host = props.lobby.players[0]
	const decks = props.decks.filter((d) => d !== host.deck)
	const [deck, setDeck] = useState<DeckId | ''>(decks[0] ?? '')
	const [side, setSide] = useState<'BASIC' | 'ADVANCED'>('BASIC')
	const [name, setName] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const hours = Math.round(props.lobby.settings.deadlineMs / 3_600_000)
	const hostLive = props.lobby.presence[0]

	const answer = async () => {
		if (deck === '') return
		setBusy(true)
		setError(null)
		try {
			await props.onAnswer({
				deck,
				boardSide: side,
				...(name.trim() !== '' ? { name: name.trim() } : {}),
			})
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
			setBusy(false)
		}
	}

	return (
		<form
			className="ol-screen ol-form"
			onSubmit={(e) => {
				e.preventDefault()
				void answer()
			}}
		>
			<header className="ol-top">
				<h1 className="ol-title">Incoming hail</h1>
				<p className="ol-sub">
					<b className="ol-them">{host.name ?? 'A captain'}</b> hails you as{' '}
					<b className="ol-them">{deckLabel(host.deck)}</b> (
					{host.boardSide === 'BASIC' ? 'basic' : 'advanced'} board)
					{hostLive && <span className="ol-presence"> on the bridge</span>}.
					Pick your captain — you take the first turn.
				</p>
			</header>
			<SeatFields
				legend="You"
				tone="you"
				decks={decks}
				deckLabel={props.deckLabel}
				deck={deck}
				onDeck={setDeck}
				side={side}
				onSide={setSide}
				name={name}
				onName={setName}
				idPrefix="ol-guest"
			/>
			<p className="ol-muted">
				When a reaction or forced choice waits for you on their turn, you have{' '}
				{hours} h before the game takes the safe default.
			</p>
			{error !== null && (
				<p className="ol-alert" role="alert">
					Couldn&apos;t answer the hail: {error}
				</p>
			)}
			<div className="ol-actions">
				<button type="button" className="ol-pill" onClick={props.onCancel}>
					Not now
				</button>
				<button
					type="submit"
					className="ol-pill ol-primary"
					disabled={deck === '' || busy}
				>
					{busy ? 'Setting up…' : 'Take the chair'}
				</button>
			</div>
		</form>
	)
}
