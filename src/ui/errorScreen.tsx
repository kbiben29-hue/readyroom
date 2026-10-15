// Recoverable error boundary (todo/17 §5). An engine throw — mid-replay, a bad
// projection, a malformed card slipping past validation — must never white the
// page. This boundary catches render/effect throws anywhere below it and shows
// a recoverable screen with the session log + a copy button, so the player can
// export the game as JSON before starting over.
//
// Two insertion points:
//   - wraps <GameFlow/> around the board (keeps the top bar usable when the
//     board itself throws), and
//   - wraps the whole <App/> in main.tsx as an outer safety net.

import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import type { GameState } from '../engine/state'
import { useGameStore, useSession } from './store'
import { copySession, downloadSession, exportSession } from './persistence'

interface BoundaryProps {
	children: ReactNode
	/** Optional header context (e.g. "during play"). */
	title?: string | undefined
}

interface BoundaryState {
	error: Error | null
}

/** Class error boundary — React requires class components for these. */
export class RecoverableErrorBoundary extends Component<
	BoundaryProps,
	BoundaryState
> {
	override state: BoundaryState = { error: null }

	static getDerivedStateFromError(error: Error): BoundaryState {
		return { error }
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error(
			'RecoverableErrorBoundary caught an error:',
			error,
			info.componentStack,
		)
	}

	private readonly reset = (): void => {
		this.setState({ error: null })
	}

	override render(): ReactNode {
		if (this.state.error !== null) {
			return (
				<RecoverableErrorScreen
					error={this.state.error}
					title={this.props.title}
					onReset={this.reset}
				/>
			)
		}
		return this.props.children
	}
}

/** The fallback UI. Reads the live session from the store so the copy button
 *  always has the most recent saved log even if the board crashed. */
export function RecoverableErrorScreen({
	error,
	title,
	onReset,
}: {
	error: Error
	title?: string | undefined
	onReset?: (() => void) | undefined
}) {
	const session = useSession()
	const currentState = useGameStore((s) => s.state)
	const phaseLine = phaseOfState(currentState)
	const [copied, setCopied] = useState(false)

	const backToSetup = (): void => {
		useGameStore.getState().newGame()
		onReset?.()
	}

	const doCopy = (): void => {
		if (session === null) return
		void copySession(session).then(() => setCopied(true))
	}

	return (
		<main className="error-screen" role="alert">
			<h1>⚠ The game hit an error{title !== undefined ? ` ${title}` : ''}</h1>
			<p className="error-text">{error.message || String(error)}</p>
			{phaseLine !== null && <p className="muted small">{phaseLine}</p>}

			<section className="panel error-session">
				<div className="session-head">
					<strong>Session log</strong>
					<span className="muted small">
						{session !== null
							? `${session.log.length} intent${session.log.length === 1 ? '' : 's'} · ${session.id}`
							: 'none'}
					</span>
				</div>
				{session !== null ? (
					<>
						<details className="session-json">
							<summary>Preview session JSON (export / bug report)</summary>
							<pre className="rule-code">
								{exportSession(session).slice(0, 4000)}
							</pre>
						</details>
						<div className="error-actions">
							<button
								type="button"
								className="btn btn-primary"
								onClick={doCopy}
							>
								{copied ? 'Copied ✓' : 'Copy session'}
							</button>
							<button
								type="button"
								className="btn"
								onClick={() => downloadSession(session)}
							>
								Download .json
							</button>
						</div>
					</>
				) : (
					<p className="muted small">
						No session in memory — nothing to export.
					</p>
				)}
				<div className="error-actions">
					<button type="button" className="btn" onClick={backToSetup}>
						Back to setup
					</button>
					{onReset !== undefined && (
						<button type="button" className="btn" onClick={onReset}>
							Try again
						</button>
					)}
				</div>
			</section>
		</main>
	)
}

function phaseOfState(state: GameState | null): string | null {
	if (state === null) return null
	const phase = state.phase.k
	const turn = state.turnNumber
	const result = state.result !== null ? ` · result: ${state.result.kind}` : ''
	return `At the time of the error: turn ${turn}, phase ${phase}${result}.`
}
