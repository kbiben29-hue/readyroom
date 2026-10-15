// Routing for online play (docs/ui-mobile.md §5). Online screens live on URL
// fragments so they can be linked and bookmarked: `#hails` (the inbox),
// `#new` (hail a captain), `#join=<gameId>.<token>` (an invite link). An
// invite link asks the server's lobby what it opens: an unanswered hail shows
// the pick-your-captain screen (the token stays in the URL until the guest
// joins — joining retires it for a fresh one), a started game opens straight
// away. A token is taken off the URL as soon as its seat is stored, so it
// doesn't linger in the address bar or history.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DeckId } from '../../data/ids'
import { deckName } from '../../session/log'
import {
	OnlineError,
	parseInvite,
	type GameLobby,
	type SeatCredentials,
} from '../../session/online'
import { availableDecks } from '../browserCatalog'
import { useCatalog, useGameStore } from '../store'
import { AnswerHail } from './AnswerHail'
import { currentOnlineClient } from './controller'
import { Hails } from './Hails'
import { Invite, NewOnlineGame } from './NewOnlineGame'
import {
	addSeat,
	appUrl,
	loadSeats,
	removeSeat,
	serverUrl,
	setServerUrl,
	type StoredSeat,
} from './seats'
import './online.css'

export type OnlineRoute = 'hails' | 'new' | 'join' | null

function routeOf(hash: string): OnlineRoute {
	const h = hash.replace(/^#/, '')
	if (h === 'hails') return 'hails'
	if (h === 'new') return 'new'
	if (h.startsWith('join=')) return 'join'
	return null
}

/** The online route in the URL fragment, kept in sync with hashchange. */
export function useOnlineRoute(): OnlineRoute {
	const [route, setRoute] = useState<OnlineRoute>(() =>
		routeOf(globalThis.location?.hash ?? ''),
	)
	useEffect(() => {
		const on = () => setRoute(routeOf(window.location.hash))
		window.addEventListener('hashchange', on)
		return () => window.removeEventListener('hashchange', on)
	}, [])
	return route
}

export function go(route: 'hails' | 'new' | ''): void {
	window.location.hash = route
}

/** Replace the fragment without adding a history entry (drops an invite
 *  token from the address bar and from the back stack). */
function clearFragment(to: 'hails' | '' = ''): void {
	const { pathname, search } = window.location
	window.history.replaceState(
		null,
		'',
		`${pathname}${search}${to === '' ? '' : `#${to}`}`,
	)
	window.dispatchEvent(new HashChangeEvent('hashchange'))
}

/** Open a seat's game on this device (and remember the seat). */
export function openSeat(seat: SeatCredentials): void {
	addSeat(seat)
	clearFragment()
	useGameStore.getState().openOnline(seat)
}

export function OnlineLobby({ route }: { route: Exclude<OnlineRoute, null> }) {
	const catalog = useCatalog()
	const [seats, setSeats] = useState(loadSeats)
	const [server, setServer] = useState(serverUrl)
	const [editServer, setEditServer] = useState(false)
	const client = useMemo(() => currentOnlineClient(), [server])
	/** an unanswered hail to this device, on its pick-your-captain screen */
	const [answering, setAnswering] = useState<{
		seat: SeatCredentials
		lobby: GameLobby
	} | null>(null)
	/** one of this device's unanswered invites, its link shown again */
	const [sharing, setSharing] = useState<StoredSeat | null>(null)
	const decks = useMemo<DeckId[]>(
		() => (catalog !== null ? availableDecks(catalog) : []),
		[catalog],
	)
	const label = useCallback(
		(d: DeckId) => (catalog !== null ? deckName(catalog, d) : d),
		[catalog],
	)

	/** What an invite link (or a kept hail) opens: the answer screen while
	 *  the game waits for its guest, else the game itself. */
	const take = useCallback(
		async (seat: SeatCredentials): Promise<void> => {
			try {
				const lobby = await client.getLobby(seat)
				if (lobby.status !== 'OPEN') openSeat(seat)
				else if (lobby.seat === 1) setAnswering({ seat, lobby })
				else {
					// the host opened their own link: it is for the opponent
					addSeat(seat)
					setSeats(loadSeats())
					clearFragment('hails')
					useGameStore.setState({
						warning:
							'That is your own invite — send the link to your opponent.',
					})
				}
			} catch (err) {
				const spent = err instanceof OnlineError && err.status === 401
				// a spent invite this device answered itself: open that seat
				const held = spent
					? loadSeats().find(
							(s) => s.gameId === seat.gameId && s.token !== seat.token,
						)
					: undefined
				if (held !== undefined) {
					openSeat(held)
					return
				}
				clearFragment('hails')
				useGameStore.setState({
					error: spent
						? 'That invite has already been answered.'
						: `Couldn't open the invite: ${err instanceof Error ? err.message : String(err)}`,
				})
			}
		},
		[client],
	)

	// Read the link once at mount: opening a seat takes the token off the URL,
	// so a second effect run (StrictMode) must not read the now-empty fragment
	// as a bad link.
	const [invite] = useState(() =>
		route === 'join' ? parseInvite(window.location.href) : null,
	)
	useEffect(() => {
		if (route !== 'join') return
		if (invite === null) {
			useGameStore.setState({ error: 'That invite link is not valid.' })
			go('hails')
			return
		}
		if (useGameStore.getState().online?.creds.token === invite.token) return
		void take(invite)
	}, [route, invite, take])

	if (answering !== null)
		return (
			<AnswerHail
				lobby={answering.lobby}
				decks={decks}
				deckLabel={label}
				onAnswer={async (req) => {
					const { seat } = await client.joinGame(answering.seat, req)
					// the invite token is retired; the fresh one is this seat
					removeSeat(answering.seat.token)
					openSeat(seat)
				}}
				onCancel={() => {
					// keep the hail in the inbox, to answer later
					addSeat(answering.seat)
					setSeats(loadSeats())
					setAnswering(null)
					clearFragment('hails')
				}}
			/>
		)

	if (sharing !== null && sharing.invite !== undefined)
		return (
			<Invite
				client={client}
				host={sharing}
				link={sharing.invite}
				onOpen={() => openSeat(sharing)}
				onBack={() => setSharing(null)}
			/>
		)

	if (route === 'join') return <p className="ol-screen">Joining the game…</p>

	if (route === 'new')
		return (
			<NewOnlineGame
				client={client}
				decks={decks}
				deckLabel={label}
				appUrl={appUrl()}
				onCreated={(g, link) => {
					addSeat({ ...g.host, invite: link })
					setSeats(loadSeats())
				}}
				onOpen={openSeat}
				onCancel={() => go('hails')}
			/>
		)

	return (
		<>
			<Hails
				client={client}
				seats={seats}
				onOpen={openSeat}
				onNew={() => go('new')}
				onJoin={(link) => {
					const seat = parseInvite(link)
					if (seat !== null) void take(seat)
				}}
				onShare={setSharing}
				onAnswer={(seat) => void take(seat)}
				onForget={(token) => {
					removeSeat(token)
					setSeats(loadSeats())
				}}
				server={server}
				onServer={() => setEditServer((v) => !v)}
			/>
			{editServer && (
				<form
					className="ol-screen ol-form"
					onSubmit={(e) => {
						e.preventDefault()
						const input = e.currentTarget.elements.namedItem('ol-server')
						if (input instanceof HTMLInputElement) setServerUrl(input.value)
						setServer(serverUrl())
						setEditServer(false)
					}}
				>
					<label className="ol-field" htmlFor="ol-server">
						<span>
							{import.meta.env.PROD
								? 'Game server address (empty for this site)'
								: 'Game server address (empty for this computer, port 8787)'}
						</span>
						<input
							id="ol-server"
							name="ol-server"
							className="ol-input"
							defaultValue={server}
						/>
					</label>
					<div className="ol-actions">
						<button type="submit" className="ol-pill ol-primary">
							Save
						</button>
					</div>
				</form>
			)}
			<div className="ol-screen">
				<button
					type="button"
					className="ol-back"
					onClick={() => useGameStore.getState().openGuide()}
				>
					Learn the card glyphs ›
				</button>
				<button type="button" className="ol-back" onClick={() => go('')}>
					‹ Local game on this device
				</button>
			</div>
		</>
	)
}
