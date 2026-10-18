// The house-AI strip (todo/15 §4) shown in a local game against the house AI,
// on the LCARS console and the phone shells alike:
//
//   - the "thinking" indicator: which seat's bot is deciding, at what level;
//   - the move speed (per device);
//   - spectator games (both seats bots): Pause / Resume, Step (one bot
//     intent), whose side the view shows, and a reveal-both-hands toggle.
//
// It reads and drives only the store; the bots themselves run in the store's
// BotRunner (src/ui/botRunner.ts).

import type { BotId } from '../bot/types'
import type { Seat } from '../engine/resolver/queries'
import { botLabel, hasBots, isSpectator } from '../session/opponents'
import { seatLabel } from './format'
import { BOT_SPEEDS, useGameStore, type BotSpeed } from './store'

const SPEED_LABEL: Record<BotSpeed, string> = {
	slow: 'Slow',
	normal: 'Normal',
	fast: 'Fast',
	instant: 'Instant',
}

function status(
	thinking: { seat: Seat; botId: BotId } | null,
	botToMove: BotId | null,
	paused: boolean,
	over: boolean,
): string {
	if (over) return 'Game over'
	if (thinking !== null)
		return `${botLabel(thinking.botId)} · ${seatLabel(thinking.seat)} is thinking…`
	if (botToMove !== null)
		return `${botLabel(botToMove)} to move${paused ? ' · paused' : ''}`
	return 'Your move'
}

export function BotBar({ variant }: { variant: 'console' | 'mobile' }) {
	const opponents = useGameStore((s) => s.session?.opponents)
	const local = useGameStore((s) => s.online === null)
	const over = useGameStore((s) => s.state !== null && s.state.result !== null)
	const thinking = useGameStore((s) => s.botThinking)
	const botToMove = useGameStore((s) => s.botToMove)
	const paused = useGameStore((s) => s.botPaused)
	const speed = useGameStore((s) => s.botSpeed)
	const viewer = useGameStore((s) => s.viewerSeat)
	const revealAll = useGameStore((s) => s.revealAll)
	if (!local || !hasBots(opponents)) return null
	const spectator = isSpectator(opponents)
	const store = useGameStore.getState
	return (
		<div
			className={`bot-bar bot-bar-${variant}`}
			role="group"
			aria-label="House AI"
		>
			<span
				className={`bot-status${thinking !== null ? ' bot-thinking' : ''}`}
				role="status"
				aria-live="polite"
			>
				{thinking !== null && <span className="bot-pulse" aria-hidden="true" />}
				{status(thinking, botToMove, paused, over)}
			</span>
			{spectator && (
				<span className="bot-controls">
					<button
						type="button"
						className="btn micro"
						onClick={() => store().setBotPaused(!paused)}
						disabled={over}
					>
						{paused ? 'Resume' : 'Pause'}
					</button>
					<button
						type="button"
						className="btn micro"
						onClick={() => store().stepBot()}
						disabled={!paused || over || botToMove === null}
						title="Play one House AI move"
					>
						Step
					</button>
					<span className="bot-seg" role="group" aria-label="View">
						{([0, 1] as const).map((seat) => (
							<button
								key={seat}
								type="button"
								className={`btn micro${viewer === seat ? ' btn-active' : ''}`}
								aria-pressed={viewer === seat}
								onClick={() => store().setViewer(seat)}
							>
								{seatLabel(seat)}
							</button>
						))}
					</span>
					<button
						type="button"
						className={`btn micro${revealAll ? ' btn-active' : ''}`}
						aria-pressed={revealAll}
						onClick={() => store().setRevealAll(!revealAll)}
						title="Show both captains' hands"
					>
						Reveal hands
					</button>
				</span>
			)}
			<label className="bot-speed">
				<span>Speed</span>
				<select
					value={speed}
					onChange={(e) => store().setBotSpeed(e.target.value as BotSpeed)}
					aria-label="House AI speed"
				>
					{BOT_SPEEDS.map((s) => (
						<option key={s} value={s}>
							{SPEED_LABEL[s]}
						</option>
					))}
				</select>
			</label>
		</div>
	)
}
