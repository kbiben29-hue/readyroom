// Hail another captain (docs/ui-mobile.md §7). The host picks only their own
// captain; the server returns the host's seat token and an invite token, and
// the invite link carries the latter in its URL fragment, which browsers never
// send to a server. Whoever opens the link picks a captain (AnswerHail.tsx)
// and takes the first turn — they are the one at the screen right then.

import { useEffect, useState } from 'react'
import type { DeckId } from '../../data/ids'
import type {
	CreatedInvite,
	OnlineGameClient,
	SeatCredentials,
} from '../../session/online'
import { inviteLink } from '../../session/online'
import { copyText } from './SeatLink'
import './online.css'

type Side = 'BASIC' | 'ADVANCED'

export const DEADLINE_HOURS = [1, 4, 12, 24, 48] as const

export interface NewOnlineGameProps {
	client: OnlineGameClient
	decks: DeckId[]
	deckLabel: (deck: DeckId) => string
	/** the page an invite link opens */
	appUrl: string
	/** the invite exists: keep `created.host` (and the link) on this device */
	onCreated: (created: CreatedInvite, link: string) => void
	/** the guest answered: open the game */
	onOpen: (seat: SeatCredentials) => void
	onCancel: () => void
}

export function NewOnlineGame(props: NewOnlineGameProps) {
	const { decks } = props
	const [mine, setMine] = useState<DeckId | ''>(decks[0] ?? '')
	const [mySide, setMySide] = useState<Side>('BASIC')
	const [myName, setMyName] = useState('')
	const [hours, setHours] = useState<number>(12)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [created, setCreated] = useState<{
		invite: CreatedInvite
		link: string
	} | null>(null)

	if (created !== null)
		return (
			<Invite
				client={props.client}
				host={created.invite.host}
				link={created.link}
				onOpen={() => props.onOpen(created.invite.host)}
				onBack={props.onCancel}
			/>
		)

	const create = async () => {
		if (mine === '') return
		setBusy(true)
		setError(null)
		try {
			const invite = await props.client.createInvite({
				host: {
					deck: mine,
					boardSide: mySide,
					...(myName.trim() !== '' ? { name: myName.trim() } : {}),
				},
				settings: { deadlineMs: hours * 3_600_000 },
			})
			const link = inviteLink(props.appUrl, invite.invite)
			props.onCreated(invite, link)
			setCreated({ invite, link })
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setBusy(false)
		}
	}

	return (
		<form
			className="ol-screen ol-form"
			onSubmit={(e) => {
				e.preventDefault()
				void create()
			}}
		>
			<header className="ol-top">
				<button type="button" className="ol-back" onClick={props.onCancel}>
					‹ Hails
				</button>
				<h1 className="ol-title">Hail a captain</h1>
				<p className="ol-sub">
					Pick your captain and send the link. Your opponent picks theirs when
					they open it, and takes the first turn.
				</p>
			</header>
			<SeatFields
				legend="You"
				tone="you"
				decks={decks}
				deckLabel={props.deckLabel}
				deck={mine}
				onDeck={setMine}
				side={mySide}
				onSide={setMySide}
				name={myName}
				onName={setMyName}
				idPrefix="ol-me"
			/>
			<DeadlineField hours={hours} onHours={setHours} />
			{error !== null && (
				<p className="ol-alert" role="alert">
					Couldn&apos;t create the invite: {error}
				</p>
			)}
			<div className="ol-actions">
				<button
					type="submit"
					className="ol-pill ol-primary"
					disabled={mine === '' || busy}
				>
					{busy ? 'Creating…' : 'Create invite'}
				</button>
			</div>
		</form>
	)
}

function DeadlineField(p: { hours: number; onHours: (h: number) => void }) {
	return (
		<fieldset className="ol-fieldset">
			<legend className="ol-label">
				Time to answer on the other&apos;s turn
			</legend>
			<div className="ol-seg" role="group">
				{DEADLINE_HOURS.map((h) => (
					<button
						key={h}
						type="button"
						aria-pressed={p.hours === h}
						onClick={() => p.onHours(h)}
					>
						{h} h
					</button>
				))}
			</div>
			<p className="ol-muted">
				When a reaction or forced choice waits longer, the game takes the safe
				default (skip, or the first legal option) and moves on.
			</p>
		</fieldset>
	)
}

/** One captain's choices: crew, board side, display name. */
export function SeatFields(p: {
	legend: string
	tone: 'you' | 'them'
	decks: DeckId[]
	deckLabel: (d: DeckId) => string
	deck: DeckId | ''
	onDeck: (d: DeckId) => void
	side: Side
	onSide: (s: Side) => void
	name: string
	onName: (n: string) => void
	idPrefix: string
}) {
	return (
		<fieldset className={`ol-fieldset ol-seat-${p.tone}`}>
			<legend className="ol-label">{p.legend}</legend>
			<label className="ol-field" htmlFor={`${p.idPrefix}-deck`}>
				<span>Captain</span>
				<select
					id={`${p.idPrefix}-deck`}
					className="ol-input"
					value={p.deck}
					onChange={(e) => p.onDeck(e.target.value as DeckId)}
				>
					{p.decks.map((d) => (
						<option key={d} value={d}>
							{p.deckLabel(d)}
						</option>
					))}
				</select>
			</label>
			<div
				className="ol-seg"
				role="group"
				aria-label={`${p.legend} board side`}
			>
				{(['BASIC', 'ADVANCED'] as const).map((s) => (
					<button
						key={s}
						type="button"
						aria-pressed={p.side === s}
						onClick={() => p.onSide(s)}
					>
						{s === 'BASIC' ? 'Basic board' : 'Advanced board'}
					</button>
				))}
			</div>
			<label className="ol-field" htmlFor={`${p.idPrefix}-name`}>
				<span>Name (optional)</span>
				<input
					id={`${p.idPrefix}-name`}
					className="ol-input"
					value={p.name}
					maxLength={40}
					onChange={(e) => p.onName(e.target.value)}
				/>
			</label>
		</fieldset>
	)
}

/**
 * The invite link, with copy and share. While it is open it listens on the
 * host's seat: when the guest answers (the game's first version), it offers
 * to open the game.
 */
export function Invite(props: {
	client: OnlineGameClient
	host: SeatCredentials
	link: string
	onOpen: () => void
	onBack: () => void
}) {
	const { client, host, link } = props
	const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no')
	const [answered, setAnswered] = useState(false)
	useEffect(() => {
		if (typeof globalThis.EventSource !== 'function') return
		const sub = client.subscribe(host, (e) => {
			if ((e.type === 'hello' || e.type === 'version') && e.version > 0)
				setAnswered(true)
		})
		return () => sub.close()
	}, [client, host])
	const canShare =
		typeof navigator !== 'undefined' && typeof navigator.share === 'function'
	const copy = () => {
		void copyText(link).then((ok) => {
			setCopied(ok ? 'yes' : 'failed')
			if (ok) return
			const field = document.getElementById('ol-invite-link')
			if (field instanceof HTMLInputElement) field.select()
		})
	}
	return (
		<div className="ol-screen">
			<header className="ol-top">
				<button type="button" className="ol-back" onClick={props.onBack}>
					‹ Hails
				</button>
				<h1 className="ol-title">
					{answered ? 'Your hail was answered' : 'Invite your opponent'}
				</h1>
				<p className="ol-sub">
					{answered
						? 'They picked a captain and have the first move.'
						: 'Anyone with this link answers your hail, so send it only to them. It works once, on any device with a browser.'}
				</p>
			</header>
			{!answered && (
				<>
					<label className="ol-field" htmlFor="ol-invite-link">
						<span>Invite link</span>
						<input
							id="ol-invite-link"
							className="ol-input ol-mono-text"
							value={link}
							readOnly
						/>
					</label>
					<div className="ol-actions">
						<button type="button" className="ol-pill" onClick={copy}>
							{copied === 'yes' ? 'Copied' : 'Copy link'}
						</button>
						{canShare && (
							<button
								type="button"
								className="ol-pill"
								onClick={() => {
									navigator
										.share({ title: 'Ready Room', url: link })
										.catch(() => {})
								}}
							>
								Share…
							</button>
						)}
					</div>
					{copied === 'failed' && (
						<p className="ol-muted">
							Copying isn&apos;t allowed here; the link is selected, copy it by
							hand.
						</p>
					)}
					<p className="ol-muted">The game waits in Hails until they answer.</p>
				</>
			)}
			{answered && (
				<div className="ol-actions">
					<button
						type="button"
						className="ol-pill ol-primary"
						onClick={props.onOpen}
					>
						Take the chair
					</button>
				</div>
			)}
		</div>
	)
}
