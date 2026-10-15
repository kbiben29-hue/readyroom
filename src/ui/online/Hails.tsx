// Hails — the inbox of online games (docs/ui-mobile.md §5). Invites waiting
// for you to pick a captain come first, then games waiting on you, then
// decisions you owe on the opponent's turn (with their deadline), then games
// on the opponent's move (with presence), then your own invites nobody has
// answered yet, then finished games. Rows come from POST /games/summaries for the seats this device holds;
// a seat the server no longer knows shows as an error row you can forget.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type {
	GameLobby,
	GameSummary,
	OnlineGameClient,
	SummaryError,
} from '../../session/online'
import { parseInvite } from '../../session/online'
import { shortUpdatedAt } from '../format'
import type { StoredSeat } from './seats'
import './online.css'
import { withCardNames } from '../../data/cardNames'

/** How often the inbox refreshes while it is open (it also refreshes when the
 *  tab becomes visible again). */
export const HAILS_REFRESH_MS = 20_000

export interface HailsProps {
	client: OnlineGameClient
	seats: StoredSeat[]
	onOpen: (seat: StoredSeat) => void
	onNew: () => void
	onJoin: (link: string) => void
	onForget: (token: string) => void
	/** an invite of yours nobody answered: show its link again */
	onShare?: ((seat: StoredSeat) => void) | undefined
	/** an invite to you, kept for later: pick a captain now */
	onAnswer?: ((seat: StoredSeat) => void) | undefined
	/** the server this device talks to, for the footer */
	server: string
	onServer: () => void
}

/** One row per stored seat: the seat this device holds and what the server
 *  says about it. A device may hold both seats of one game (testing, or two
 *  captains on one phone), so rows are keyed by seat, never by game alone. */
type Row = { seat: StoredSeat; summary: GameSummary }
type OpenRow = { seat: StoredSeat; lobby: GameLobby }
type Loaded = {
	rows: Row[]
	open: OpenRow[]
	errors: { seat: StoredSeat; error: SummaryError }[]
}

export function Hails(props: HailsProps) {
	const { client, seats } = props
	const [data, setData] = useState<Loaded | null>(null)
	const [failure, setFailure] = useState<string | null>(null)

	const refresh = useCallback(async () => {
		try {
			// one request per seat, so every answer is tied to its token
			const answers = await Promise.all(
				seats.map(async (seat) => ({
					seat,
					res: await client.listGames([seat]),
				})),
			)
			const rows: Row[] = []
			const open: OpenRow[] = []
			const errors: Loaded['errors'] = []
			for (const { seat, res } of answers) {
				for (const summary of res.summaries) rows.push({ seat, summary })
				for (const lobby of res.open ?? []) open.push({ seat, lobby })
				for (const error of res.errors) errors.push({ seat, error })
			}
			setData({ rows, open, errors })
			setFailure(null)
		} catch (err) {
			setFailure(err instanceof Error ? err.message : String(err))
		}
	}, [client, seats])

	useEffect(() => {
		void refresh()
		const timer = setInterval(() => void refresh(), HAILS_REFRESH_MS)
		const onVisible = () => {
			if (document.visibilityState === 'visible') void refresh()
		}
		document.addEventListener('visibilitychange', onVisible)
		return () => {
			clearInterval(timer)
			document.removeEventListener('visibilitychange', onVisible)
		}
	}, [refresh])

	const rows = data?.rows ?? []
	const summaries = rows.map((r) => r.summary)
	const seatOf = new Map(rows.map((r) => [r.summary, r.seat]))
	const open = (s: GameSummary) => {
		const seat = seatOf.get(s)
		if (seat !== undefined) props.onOpen(seat)
	}
	const key = (s: GameSummary) => `${s.gameId}:${s.seat}`
	const done = summaries.filter((s) => s.status === 'COMPLETE')
	const live = summaries.filter((s) => s.status !== 'COMPLETE')
	const owed = live.filter((s) => s.pendingOnYou !== null)
	const yours = live.filter((s) => s.pendingOnYou === null && s.yourMove)
	const theirs = live.filter((s) => s.pendingOnYou === null && !s.yourMove)
	const opens = data?.open ?? []
	const toAnswer = opens.filter((o) => o.lobby.seat === 1)
	const unanswered = opens.filter((o) => o.lobby.seat === 0)
	const waiting = yours.length + owed.length + toAnswer.length
	const count = summaries.length + opens.length

	return (
		<div className="ol-screen">
			<header className="ol-top">
				<h1 className="ol-title">Hails</h1>
				<p className="ol-sub">
					{seats.length === 0
						? 'No online games on this device yet.'
						: `${count} game${count === 1 ? '' : 's'} · ${waiting === 0 ? 'nothing waiting on you' : `${waiting} waiting on you`}`}
				</p>
			</header>
			{failure !== null && (
				<p className="ol-alert" role="alert">
					Can&apos;t reach the game server at {props.server}: {failure}
				</p>
			)}
			{toAnswer.length > 0 && (
				<Section title="Hails to answer">
					{toAnswer.map(({ seat, lobby }) => (
						<OpenRowView
							key={seat.token}
							lobby={lobby}
							tone="you"
							onOpen={() => props.onAnswer?.(seat)}
						/>
					))}
				</Section>
			)}
			{yours.length > 0 && (
				<Section title="Your move">
					{yours.map((s) => (
						<GameRow key={key(s)} s={s} tone="you" onOpen={() => open(s)} />
					))}
				</Section>
			)}
			{owed.length > 0 && (
				<Section title="Needs an answer">
					{owed.map((s) => (
						<GameRow key={key(s)} s={s} tone="owed" onOpen={() => open(s)} />
					))}
				</Section>
			)}
			{theirs.length > 0 && (
				<Section title="Their move">
					{theirs.map((s) => (
						<GameRow key={key(s)} s={s} tone="wait" onOpen={() => open(s)} />
					))}
				</Section>
			)}
			{unanswered.length > 0 && (
				<Section title="Waiting for an answer">
					{unanswered.map(({ seat, lobby }) => (
						<OpenRowView
							key={seat.token}
							lobby={lobby}
							tone="wait"
							onOpen={
								seat.invite !== undefined && props.onShare !== undefined
									? () => props.onShare!(seat)
									: undefined
							}
						/>
					))}
				</Section>
			)}
			{done.length > 0 && (
				<Section title="Finished">
					{done.map((s) => (
						<GameRow key={key(s)} s={s} tone="done" onOpen={() => open(s)} />
					))}
				</Section>
			)}
			{(data?.errors ?? []).length > 0 && (
				<Section title="Unavailable">
					{data!.errors.map(({ seat, error: e }) => {
						return (
							<div key={seat.token} className="ol-game ol-error">
								<span className="ol-game-name">Game {e.gameId}</span>
								<span className="ol-muted">{e.error}</span>
								<button
									type="button"
									className="ol-pill"
									onClick={() => props.onForget(seat.token)}
								>
									Forget on this device
								</button>
							</div>
						)
					})}
				</Section>
			)}
			<div className="ol-actions">
				<button
					type="button"
					className="ol-pill ol-primary"
					onClick={props.onNew}
				>
					New online game
				</button>
				<JoinByLink onJoin={props.onJoin} />
			</div>
			<footer className="ol-foot">
				Server {props.server}{' '}
				<button type="button" className="ol-link" onClick={props.onServer}>
					change
				</button>
			</footer>
		</div>
	)
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="ol-section" aria-label={title}>
			<h2 className="ol-sec-h">{title}</h2>
			{children}
		</section>
	)
}

const mono = (deck: string) => deck.slice(0, 3)

/** "11 h left" — the time until an interrupt's default applies. */
export function timeLeft(deadlineIso: string, now = Date.now()): string {
	const ms = new Date(deadlineIso).getTime() - now
	if (Number.isNaN(ms)) return ''
	if (ms <= 0) return 'deadline passed'
	const mins = Math.ceil(ms / 60_000)
	if (mins < 60) return `${mins} min left`
	return `${Math.floor(mins / 60)} h left`
}

function GameRow({
	s,
	tone,
	onOpen,
}: {
	s: GameSummary
	tone: 'you' | 'owed' | 'wait' | 'done'
	onOpen: () => void
}) {
	const me = s.players[s.seat]
	const them = s.players[s.seat === 0 ? 1 : 0]
	const theirSeat = s.seat === 0 ? 1 : 0
	const result =
		s.result === null
			? null
			: s.result.winners.length === 2
				? 'Draw'
				: s.result.winners.includes(s.seat)
					? 'You won'
					: 'You lost'
	return (
		<button type="button" className={`ol-game ol-${tone}`} onClick={onOpen}>
			<span className="ol-game-top">
				<span className="ol-mono ol-mono-you">{mono(me.deck)}</span>
				<span className="ol-mono ol-mono-them">{mono(them.deck)}</span>
				<span className="ol-game-name">
					{me.deckName} vs {them.deckName}
				</span>
				{tone === 'owed' && s.pendingOnYou !== null ? (
					<span className="ol-deadline">
						{timeLeft(s.pendingOnYou.deadline)}
					</span>
				) : (
					<span className="ol-age">{shortUpdatedAt(s.lastActivity)}</span>
				)}
			</span>
			<span className="ol-meta">
				{result !== null ? (
					<span>{result}</span>
				) : (
					<>
						<span>Turn {s.turn}</span>
						<span>
							{s.stardate.remaining} Stardate
							{s.stardate.remaining === 1 ? '' : 's'} left
						</span>
					</>
				)}
				<span>
					<b className="ol-you">{s.score[s.seat]}</b> –{' '}
					<b className="ol-them">{s.score[theirSeat]}</b> VP
				</span>
				{them.name !== null && <span>vs {them.name}</span>}
				{s.presence[theirSeat] && (
					<span className="ol-presence">on the bridge</span>
				)}
			</span>
			{tone === 'owed' && s.pendingOnYou !== null && (
				<span className="ol-owed">{withCardNames(s.pendingOnYou.prompt)}</span>
			)}
		</button>
	)
}

/** An invite no one has answered: to you (answer it) or yours (share it). */
function OpenRowView({
	lobby,
	tone,
	onOpen,
}: {
	lobby: GameLobby
	tone: 'you' | 'wait'
	onOpen?: (() => void) | undefined
}) {
	const host = lobby.players[0]
	const mine = lobby.seat === 0
	const body = (
		<>
			<span className="ol-game-top">
				<span className={`ol-mono ${mine ? 'ol-mono-you' : 'ol-mono-them'}`}>
					{mono(host.deck)}
				</span>
				<span className="ol-mono">?</span>
				<span className="ol-game-name">
					{mine
						? `${host.deckName} vs an open chair`
						: `${host.name ?? 'A captain'} hails you as ${host.deckName}`}
				</span>
				<span className="ol-age">{shortUpdatedAt(lobby.createdAt)}</span>
			</span>
			<span className="ol-meta">
				<span>
					{mine
						? onOpen !== undefined
							? 'Invite sent — tap to share the link again'
							: 'Invite sent'
						: 'Pick your captain — you take the first turn'}
				</span>
			</span>
		</>
	)
	if (onOpen === undefined)
		return <div className={`ol-game ol-${tone}`}>{body}</div>
	return (
		<button type="button" className={`ol-game ol-${tone}`} onClick={onOpen}>
			{body}
		</button>
	)
}

function JoinByLink({ onJoin }: { onJoin: (link: string) => void }) {
	const [link, setLink] = useState('')
	const valid = parseInvite(link.trim()) !== null
	return (
		<form
			className="ol-join"
			onSubmit={(e) => {
				e.preventDefault()
				if (valid) onJoin(link.trim())
			}}
		>
			<label className="ol-label" htmlFor="ol-join-link">
				Join by invite link
			</label>
			<div className="ol-join-row">
				<input
					id="ol-join-link"
					className="ol-input"
					value={link}
					placeholder="Paste the link you were sent"
					onChange={(e) => setLink(e.target.value)}
				/>
				<button type="submit" className="ol-pill" disabled={!valid}>
					Join
				</button>
			</div>
		</form>
	)
}
