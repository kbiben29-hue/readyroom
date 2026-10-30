// The house AI's moves made visible (todo/15 §4), on the LCARS console and
// the phone shells alike. Three pieces, all fed by the store's `botLog`
// (src/ui/botMoves.ts):
//
//   - BotTicker: one line under the bot bar for the latest move of the AI's
//     running burst, in plain English ("House AI (Hard) played ‹card› → +2
//     Dilithium · sent an Away Team to ‹location›"). Moves are queued: each
//     stays up for a dwell time that follows the spectator speed; a backlog
//     (or the Instant speed) skips to the latest, and "+N more" opens the
//     history. It stays until a human decides. aria-live="polite".
//   - BotHistory: the recent moves (newest first), each expandable into the
//     card it played or activated, its steps and log notes, with the "Why?"
//     panel of the bot's decisions.
//   - BotHighlight: briefly marks the cards a move involved (the card played
//     or activated, the Location or market card it picked) by iid, like the
//     flight layer's source glow; a static outline with prefers-reduced-motion.
//
// Card names come from the fetched STCC data at render time: every phrase
// names cards with `[[card:<def id>]]` tokens that OpText expands. What the
// human may not see was masked when the move was recorded.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Seat } from '../engine/resolver/queries'
import {
	BOT_LEVEL_LABEL,
	botLabel,
	hasBots,
	isSpectator,
} from '../session/opponents'
import { cardDef } from '../engine/cards'
import { CardFace, OpText } from './cards'
import { seatLabel, shortSeat } from './format'
import {
	botTurns,
	moveHeadline,
	phraseText,
	type BotMove,
	type BotTurn,
	type DecisionView,
	type OptionView,
} from './botMoves'
import { useGameStore, type BotSpeed } from './store'
import { useEscape } from './console/useShortcut'

/** How long one move stays in the ticker before the next queued one. */
export const TICKER_DWELL_MS: Record<BotSpeed, number> = {
	slow: 4000,
	normal: 2500,
	fast: 1200,
	instant: 0,
}

/** Queued moves beyond this are skipped: the ticker jumps to the latest. */
const MAX_BACKLOG = 2

/** How long a highlight stays on a card. */
export const HIGHLIGHT_MS = 1800

function reducedMotion(): boolean {
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	)
}

const now = () => performance.now()

/** Who made the move: the level, plus the seat in a spectator game. */
function who(move: BotMove, spectator: boolean): string {
	return spectator
		? `${seatLabel(move.seat)} · ${botLabel(move.botId)}`
		: botLabel(move.botId)
}

/** The phone's short form: "P2 · Hard", "AI · Hard". */
function whoShort(move: BotMove, spectator: boolean): string {
	return `${spectator ? shortSeat(move.seat) : 'AI'} · ${BOT_LEVEL_LABEL[move.botId]}`
}

/** The other seat, as the headline names it ("you" for the human). */
function otherName(move: BotMove, viewer: Seat, spectator: boolean): string {
	const other: Seat = move.seat === 0 ? 1 : 0
	return !spectator && other === viewer ? 'you' : seatLabel(other)
}

function useTickerContext() {
	const opponents = useGameStore((s) => s.session?.opponents)
	const local = useGameStore((s) => s.online === null)
	const viewer = useGameStore((s) => s.viewerSeat)
	return {
		enabled: local && hasBots(opponents),
		spectator: isSpectator(opponents),
		viewer,
	}
}

// ---------------------------------------------------------------------------
// the ticker
// ---------------------------------------------------------------------------

export function BotTicker({ variant }: { variant: 'console' | 'mobile' }) {
	const { enabled, spectator, viewer } = useTickerContext()
	const log = useGameStore((s) => s.botLog)
	const speed = useGameStore((s) => s.botSpeed)
	const open = useGameStore((s) => s.openBotHistory)
	const burst = useMemo(
		() => (log.live ? log.moves.filter((m) => m.burst === log.burst) : []),
		[log],
	)
	const ids = burst.map((m) => m.id)
	const idsKey = ids.join(',')
	const dwell = TICKER_DWELL_MS[speed]
	const [cursor, setCursor] = useState<{ id: number; at: number } | null>(null)

	useEffect(() => {
		const list = idsKey === '' ? [] : idsKey.split(',').map(Number)
		if (list.length === 0) {
			if (cursor !== null) setCursor(null)
			return
		}
		const latest = list[list.length - 1]!
		const idx = cursor === null ? -1 : list.indexOf(cursor.id)
		if (idx < 0) {
			// a new burst: start at its first move unless it already ran away
			const first =
				dwell === 0 || list.length > MAX_BACKLOG + 1 ? latest : list[0]!
			setCursor({ id: first, at: now() })
			return
		}
		if (cursor!.id === latest) return
		if (dwell === 0 || list.length - 1 - idx > MAX_BACKLOG) {
			setCursor({ id: latest, at: now() })
			return
		}
		const wait = Math.max(0, cursor!.at + dwell - now())
		const t = setTimeout(
			() => setCursor({ id: list[idx + 1]!, at: now() }),
			wait,
		)
		return () => clearTimeout(t)
	}, [idsKey, cursor, dwell])

	if (!enabled) return null
	const move = burst.find((m) => m.id === cursor?.id) ?? burst[burst.length - 1]
	if (move === undefined) return null
	const headline = moveHeadline(move, otherName(move, viewer, spectator))
	const name = who(move, spectator)
	const more = burst.length - 1
	const sentence = `${name} ${phraseText(headline)}`
	return (
		<div
			className={`bot-ticker bot-ticker-${variant}`}
			data-move={move.id}
			key={move.id}
		>
			<p className="bot-ticker-line" aria-live="polite" aria-atomic="true">
				<button
					type="button"
					className="bot-ticker-text"
					onClick={() => open(null)}
					title={sentence}
					aria-label={`${sentence}. Open the House AI move history.`}
				>
					<span className="bot-ticker-who">
						{variant === 'mobile' ? whoShort(move, spectator) : name}
					</span>{' '}
					<OpText text={headline} plain />
				</button>
			</p>
			{more > 0 && (
				<button
					type="button"
					className="btn micro bot-ticker-more"
					onClick={() => open(null)}
					aria-label={`${more} more House AI move${more === 1 ? '' : 's'} — open the history`}
				>
					+{more}
					{variant === 'mobile' ? '' : ' more'}
				</button>
			)}
			{move.steps.some((s) => s.why !== null) && (
				<button
					type="button"
					className="btn micro bot-ticker-why"
					onClick={() => open(move.id)}
					aria-label={`Why did ${name} do that?`}
				>
					Why?
				</button>
			)}
		</div>
	)
}

/** The bot bar's button that opens the history (always reachable, also when
 *  the ticker is idle). */
export function BotHistoryButton({ compact }: { compact: boolean }) {
	const { spectator } = useTickerContext()
	const count = useGameStore((s) => s.botLog.moves.length)
	const open = useGameStore((s) => s.openBotHistory)
	return (
		<button
			type="button"
			className={`btn micro${compact ? ' bot-icon' : ''}`}
			onClick={() => open(null)}
			disabled={count === 0}
			aria-label="House AI move history"
			title="House AI move history"
		>
			{compact ? (
				<svg
					className="bot-glyph"
					viewBox="0 0 16 16"
					width="14"
					height="14"
					aria-hidden="true"
					focusable="false"
				>
					<path
						d="M2 3h12M2 8h12M2 13h8"
						stroke="currentColor"
						strokeWidth="1.8"
						fill="none"
					/>
				</svg>
			) : spectator ? (
				'Moves'
			) : (
				'AI turn'
			)}
		</button>
	)
}

// ---------------------------------------------------------------------------
// the "Why?" panel
// ---------------------------------------------------------------------------

function vp(score: number): string {
	const r = Math.round(score * 10) / 10
	return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r).toFixed(1)} VP`
}

function kindLine(v: DecisionView): string {
	switch (v.kind) {
		case 'search': {
			const parts = ['Search']
			if (v.iterations !== undefined)
				parts.push(`${v.iterations.toLocaleString('en')} iterations`)
			if (v.ms !== undefined) parts.push(`${(v.ms / 1000).toFixed(2)} s`)
			return parts.join(' · ')
		}
		case 'heuristic':
			return v.ms !== undefined
				? `Look-ahead · ${v.ms} ms`
				: 'Look-ahead over each option'
		case 'forced':
			return 'Forced'
		case 'rule':
			return 'Rule'
	}
}

/** The bar width (0–1) of each option: the visit share for a search, the
 *  score relative to the field otherwise. */
function barWidths(options: OptionView[], search: boolean): number[] {
	if (search) return options.map((o) => o.share ?? 0)
	const scores = options.map((o) => o.score)
	const lo = Math.min(...scores)
	const hi = Math.max(...scores)
	if (!(hi - lo > 1e-9)) return options.map(() => 1)
	return scores.map((s) => 0.15 + (0.85 * (s - lo)) / (hi - lo))
}

export function WhyPanel({
	view,
	title,
}: {
	view: DecisionView
	title: string
}) {
	const search = view.kind === 'search'
	const widths = barWidths(view.options, search)
	return (
		<section className="why-panel" aria-label={`Why: ${phraseText(title)}`}>
			<h5 className="why-head">
				<OpText text={title} plain />
			</h5>
			<p className="why-kind">
				{kindLine(view)}
				{view.note !== undefined && <> — {view.note}</>}
			</p>
			{view.options.length > 0 && (
				<ol className="why-options">
					{view.options.map((o, i) => (
						<li
							key={i}
							className={`why-opt${o.chosen ? ' why-chosen' : ''}${o.masked ? ' why-masked' : ''}`}
						>
							<span className="why-label">
								{o.chosen && (
									<span className="why-mark" aria-label="chosen">
										✓{' '}
									</span>
								)}
								<OpText text={o.phrase} plain />
							</span>
							<span className="why-bar" aria-hidden="true">
								<span
									className="why-fill"
									style={{ width: `${Math.round(widths[i]! * 100)}%` }}
								/>
							</span>
							<span className="why-num">
								{search && o.share !== undefined
									? `${Math.round(o.share * 100)}% · ${vp(o.score)}`
									: vp(o.score)}
							</span>
						</li>
					))}
				</ol>
			)}
		</section>
	)
}

/** Every decision of a move worth explaining. */
function MoveWhy({ move }: { move: BotMove }) {
	const rows = move.steps.filter(
		(s) =>
			s.why !== null && (s.why.options.length > 1 || s.why.note !== undefined),
	)
	if (rows.length === 0)
		return <p className="muted small">No explanation was recorded.</p>
	return (
		<div className="why-list">
			{rows.map((s, i) => (
				<WhyPanel
					key={i}
					view={s.why!}
					title={s.prompt !== undefined ? s.prompt : capitalize(s.phrase)}
				/>
			))}
		</div>
	)
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1)
}

// ---------------------------------------------------------------------------
// the history
// ---------------------------------------------------------------------------

export function BotHistory() {
	const { enabled, spectator, viewer } = useTickerContext()
	const isOpen = useGameStore((s) => s.botHistoryOpen)
	const whyMove = useGameStore((s) => s.whyMove)
	const moves = useGameStore((s) => s.botLog.moves)
	const turns = useMemo(
		() => botTurns(moves, spectator ? null : viewer),
		[moves, spectator, viewer],
	)
	const close = useGameStore((s) => s.closeBotHistory)
	const openWhy = useGameStore((s) => s.openBotHistory)
	const panel = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (isOpen) panel.current?.focus()
	}, [isOpen])
	useEscape(isOpen, close)
	if (!enabled || !isOpen) return null
	const latest = moves[moves.length - 1]?.id
	return (
		<div className="bot-history-backdrop" onClick={close}>
			<div
				className="bot-history"
				role="dialog"
				aria-modal="true"
				aria-label="House AI moves"
				tabIndex={-1}
				ref={panel}
				onClick={(e) => e.stopPropagation()}
			>
				<header className="bot-history-head">
					<h3>House AI moves</h3>
					<button
						type="button"
						className="btn micro"
						onClick={close}
						aria-label="Close the move history"
					>
						Close
					</button>
				</header>
				{turns.length === 0 && (
					<p className="muted small">The House AI has not moved yet.</p>
				)}
				{turns.map((t) => (
					<section
						key={t.turn}
						className="bot-turn"
						aria-label={`Turn ${t.turn}`}
						data-turn={t.turn}
					>
						<h4 className="bot-turn-head">
							Turn {t.turn} · {turnOwner(t, viewer, spectator)}
						</h4>
						{t.hits.length > 0 && (
							<div className="bot-hits">
								<p className="bot-hits-title">What it did to you</p>
								<ul>
									{t.hits.map((h, i) => (
										<li key={i}>
											<OpText text={h.text} plain />
										</li>
									))}
								</ul>
							</div>
						)}
						<ol className="bot-history-list">
							{t.moves.map((m) => (
								<MoveItem
									key={m.id}
									move={m}
									open={
										whyMove === m.id || (whyMove === null && m.id === latest)
									}
									why={whyMove === m.id}
									headline={moveHeadline(m, otherName(m, viewer, spectator))}
									name={who(m, spectator)}
									onWhy={openWhy}
								/>
							))}
						</ol>
					</section>
				))}
			</div>
		</div>
	)
}

/** Whose turn a history section was: "your turn", or the bot's. */
function turnOwner(t: BotTurn, viewer: Seat, spectator: boolean): string {
	if (!spectator && t.active === viewer) return 'your turn'
	const bot = t.moves.find((m) => m.seat === t.active)
	if (bot === undefined) return `${seatLabel(t.active)}'s turn`
	return spectator
		? `${seatLabel(t.active)}'s turn · ${botLabel(bot.botId)}`
		: `${botLabel(bot.botId)}'s turn`
}

function MoveItem({
	move: m,
	open,
	why,
	headline,
	name,
	onWhy,
}: {
	move: BotMove
	open: boolean
	why: boolean
	headline: string
	name: string
	onWhy: (move: number | null) => void
}) {
	// the card the move played or activated, drawn only while the entry is open
	const [expanded, setExpanded] = useState(open)
	const card = m.steps[0]?.card
	return (
		<li className="bot-history-item" data-move={m.id}>
			<details open={open} onToggle={(e) => setExpanded(e.currentTarget.open)}>
				<summary>
					<span className="bot-ticker-who">{name}</span>{' '}
					<OpText text={headline} plain />
				</summary>
				{expanded && card !== undefined && (
					<div className="bot-move-card">
						<CardFace def={cardDef(card)} size="board" />
					</div>
				)}
				<ol className="bot-steps">
					{m.steps.map((s, j) => (
						<li key={j} className="bot-step">
							{s.prompt !== undefined && (
								<span className="bot-step-prompt">
									<OpText text={s.prompt} plain />
								</span>
							)}
							<span className="bot-step-phrase">
								<OpText text={s.phrase} plain />
							</span>
							{s.notes.map((n, k) => (
								<span
									key={k}
									className={`bot-step-note${n.hit === true ? ' bot-step-hit' : ''}`}
								>
									<OpText text={n.text} plain />
								</span>
							))}
						</li>
					))}
				</ol>
				{why ? (
					<>
						<MoveWhy move={m} />
						<button
							type="button"
							className="btn micro"
							onClick={() => onWhy(null)}
						>
							Hide why
						</button>
					</>
				) : (
					m.steps.some((s) => s.why !== null) && (
						<button
							type="button"
							className="btn micro"
							onClick={() => onWhy(m.id)}
						>
							Why?
						</button>
					)
				)}
			</details>
		</li>
	)
}

// ---------------------------------------------------------------------------
// the card highlight
// ---------------------------------------------------------------------------

function cardEls(iid: string): HTMLElement[] {
	const q = iid.replace(/["\\]/g, '\\$&')
	return [
		...document.querySelectorAll<HTMLElement>(
			`[data-anchor="card:${q}"], [data-iid="${q}"]`,
		),
	]
}

/** Marks the latest move's cards for HIGHLIGHT_MS (re-fires when the move
 *  grows). DOM-imperative, like the flight layer: no re-render per card. */
export function BotHighlight() {
	const { enabled } = useTickerContext()
	const latest = useGameStore((s) =>
		s.botLog.live ? s.botLog.moves[s.botLog.moves.length - 1] : undefined,
	)
	const key =
		latest === undefined
			? ''
			: `${latest.id}:${latest.rev}:${latest.involvedIids.join(',')}`
	useEffect(() => {
		if (!enabled || key === '') return
		const iids = key.split(':')[2]!.split(',').filter(Boolean)
		if (iids.length === 0) return
		const cls = reducedMotion() ? 'bot-hl-static' : 'bot-hl-pulse'
		const marked: HTMLElement[] = []
		for (const iid of iids)
			for (const el of cardEls(iid)) {
				el.classList.remove('bot-hl', 'bot-hl-pulse', 'bot-hl-static')
				// reflow so a repeat restarts the pulse
				void el.offsetWidth
				el.classList.add('bot-hl', cls)
				marked.push(el)
			}
		const t = setTimeout(() => {
			for (const el of marked)
				el.classList.remove('bot-hl', 'bot-hl-pulse', 'bot-hl-static')
		}, HIGHLIGHT_MS)
		return () => {
			clearTimeout(t)
			for (const el of marked)
				el.classList.remove('bot-hl', 'bot-hl-pulse', 'bot-hl-static')
		}
	}, [key, enabled])
	return null
}
