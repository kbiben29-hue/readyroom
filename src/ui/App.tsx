// Root app shell (todo/14). Three screens:
//   - SetupScreen  — pick two decks / board sides / seed, start a game
//   - GameScreen   — board + areas + hand + log + choice panel, hot-seat flow
//   - EndScreen    — the full scoring breakdown incl. focusSuppressed (todo/10)
// plus the overlay hosts (CardDetail, PileBrowser, Rules drawer, Card List).
//
// Components never read the raw state — everything renders `useProjected()`.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GameState } from '../engine/state'
import type { SetupConfig } from '../engine/setup'
import type { DeckId } from '../data/ids'
import type { Seat } from '../engine/resolver/queries'
import { availableDecks } from './browserCatalog'
import {
	useProjected,
	useGameStore,
	useCatalog,
	useViewerSeat,
	useSession,
	undoPolicyLabel,
} from './store'
import { CardDetailHost, PileBrowserHost, CardZoom } from './cards'
import { Icon } from './icons'
import { RulesDrawer, CardListPanel } from './rules'
import { DeckReview } from './deckReview'
import { LogPanel } from './log'
import { ChoicePanel } from './choice'
import {
	Hand,
	CrewBoard,
	PlayerArea,
	StardateTrack,
	Market,
	NeutralZone,
	JunkIncidentBar,
	PlayerDeckPiles,
	ActionTray,
} from './board'
import { FlightLayer } from './flight'
import { isDesktop, openCardDatabase } from '../desktop/bridge'
import { seatLabel, phaseLabel, RESOURCE_LABEL } from './format'
import { SavedGamesPanel } from './load'
import { RecoverableErrorBoundary } from './errorScreen'
import { ReplayHost, openReplay } from './replay'
import { useShell, type Shell } from './mobile/shell'
import { OnlineLobby, useOnlineRoute } from './online/OnlineLobby'
import { RecapView } from './online/Recap'
import { ShorthandGuide } from './guide/ShorthandGuide'
import { useDefIndex } from './defs'
import { MobileShell } from './mobile/MobileShell'
import { LayoutSwitch } from './mobile/LayoutSwitch'
import { deckLabel } from '../data/cardNames'

function useRuleAnchor(): [string | null, (a: string | null) => void] {
	const [anchor, setAnchor] = useState<string | null>(null)
	useEffect(() => {
		const listener = (e: Event) => {
			const v = (e as CustomEvent<string>).detail
			setAnchor(typeof v === 'string' ? v : null)
		}
		window.addEventListener('codex:open-rule', listener)
		return () => window.removeEventListener('codex:open-rule', listener)
	}, [])
	return [anchor, setAnchor]
}

function ErrorBanner() {
	const error = useGameStore((s) => s.error)
	const clear = useGameStore((s) => s.clearError)
	if (error === null) return null
	return (
		<div className="error-banner" role="alert">
			<strong>⚠ {error}</strong>
			<button type="button" className="btn micro" onClick={clear}>
				dismiss
			</button>
		</div>
	)
}

/** Informational (non-blocking) notice — resume warnings, undo refusals,
 *  autosave failures (todo/17 §1/§2). Dismissible like the error banner. */
function WarningBanner() {
	const warning = useGameStore((s) => s.warning)
	const clear = useGameStore((s) => s.clearWarning)
	if (warning === null) return null
	return (
		<div className="warning-banner" role="status">
			<strong>ℹ {warning}</strong>
			<button type="button" className="btn micro" onClick={clear}>
				dismiss
			</button>
		</div>
	)
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
	const catalog = useCatalog()
	const loadCatalog = useGameStore((s) => s.loadCatalog)
	const [ruleAnchor, setRuleAnchor] = useRuleAnchor()
	const inGame = useGameStore((s) => s.state !== null && s.session !== null)
	const online = useGameStore((s) => s.online !== null)
	// phone / phone-wide / tablet / console (docs/ui-mobile.md §2)
	const { shell: chosen } = useShell()
	// the LCARS console plays local games; an online game on a wide screen
	// uses the tablet shell, which reads only the seat view
	const shell: Shell = online && chosen === 'console' ? 'tablet' : chosen
	const route = useOnlineRoute()

	useEffect(() => {
		loadCatalog()
	}, [loadCatalog])
	// going to Hails or New (a link, a bookmark, the back button) leaves the
	// open online game; an invite link switches games itself
	useEffect(() => {
		if ((route === 'hails' || route === 'new') && online)
			useGameStore.getState().newGame()
	}, [route, online])

	return (
		<div className="app">
			{route !== null && catalog !== null ? (
				<OnlineLobby key={route} route={route} />
			) : online ? (
				<OnlineGame shell={shell} />
			) : !inGame ? (
				<SetupScreen catalogReady={catalog !== null} />
			) : (
				<GameFlow shell={shell} />
			)}
			<Overlays
				ruleAnchor={ruleAnchor}
				setRuleAnchor={setRuleAnchor}
				shell={shell}
			/>
		</div>
	)
}

/** An open online game: connecting, then "Previously on…" when there is news
 *  from the other captain, then the bridge (docs/ui-mobile.md §5). */
function OnlineGame({ shell }: { shell: Shell }) {
	const online = useGameStore((s) => s.online)
	const error = useGameStore((s) => s.error)
	const dismissRecap = useGameStore((s) => s.dismissRecap)
	const defs = useDefIndex()
	if (online === null) return null
	const view = online.view
	if (view === null || (online.recap === null && !online.recapSeen))
		return (
			<main className="ol-screen">
				<p className="ol-sub">Connecting to the game server…</p>
				{error !== null && (
					<>
						<p className="ol-alert" role="alert">
							{error}
						</p>
						<button
							type="button"
							className="ol-pill"
							onClick={() => {
								useGameStore.getState().newGame()
								window.location.hash = 'hails'
							}}
						>
							Back to Hails
						</button>
					</>
				)}
			</main>
		)
	if (!online.recapSeen && online.recap !== null)
		return (
			<RecapView
				recap={online.recap}
				names={[
					view.players[0].name ?? view.players[0].deckName,
					view.players[1].name ?? view.players[1].deckName,
				]}
				defs={defs}
				defOfIid={(iid) => view.state.cards[iid]?.def ?? null}
				onContinue={dismissRecap}
			/>
		)
	return <GameFlow shell={shell} />
}

function Overlays({
	ruleAnchor,
	setRuleAnchor,
	shell,
}: {
	ruleAnchor: string | null
	setRuleAnchor: (a: string | null) => void
	shell: Shell
}) {
	const rulesOpen = useGameStore((s) => s.rulesOpen)
	const cardListOpen = useGameStore((s) => s.cardListOpen)
	const deckReviewOpen = useGameStore((s) => s.deckReviewOpen)
	const setRulesOpen = useGameStore((s) => s.setRulesOpen)
	const setCardListOpen = useGameStore((s) => s.setCardListOpen)
	const setDeckReviewOpen = useGameStore((s) => s.setDeckReviewOpen)
	const guide = useGameStore((s) => s.guide)
	const openGuide = useGameStore((s) => s.openGuide)
	const closeGuide = useGameStore((s) => s.closeGuide)
	return (
		<>
			{/* the phone shells draw the same detail as a Rosetta sheet */}
			{shell === 'console' && <CardDetailHost />}
			<PileBrowserHost />
			<ReplayHost />
			{rulesOpen && (
				<RulesDrawer
					openAnchor={ruleAnchor}
					onClose={() => {
						setRulesOpen(false)
						setRuleAnchor(null)
					}}
				/>
			)}
			{cardListOpen && <CardListPanel onClose={() => setCardListOpen(false)} />}
			{deckReviewOpen && (
				<DeckReview onClose={() => setDeckReviewOpen(false)} />
			)}
			{guide !== null && (
				<ShorthandGuide
					section={guide}
					onSection={openGuide}
					onClose={closeGuide}
				/>
			)}
		</>
	)
}

// ---------------------------------------------------------------------------
// Setup screen
// ---------------------------------------------------------------------------

function SetupScreen({ catalogReady }: { catalogReady: boolean }) {
	const catalog = useCatalog()
	const startGame = useGameStore((s) => s.startGame)
	const error = useGameStore((s) => s.error)
	const savedMode = useGameStore((s) =>
		s.session !== null ? s.session.setup.mode : undefined,
	)
	const decks = useMemo<DeckId[]>(
		() => (catalog !== null ? availableDecks(catalog) : []),
		[catalog],
	)
	const [seat0, setSeat0] = useState<DeckId>('PIC')
	const [seat1, setSeat1] = useState<DeckId>('SHR')
	const [side0, setSide0] = useState<'BASIC' | 'ADVANCED'>('BASIC')
	const [side1, setSide1] = useState<'BASIC' | 'ADVANCED'>('BASIC')
	const [seed, setSeed] = useState(12345)

	useEffect(() => {
		if (decks.length === 0) return
		if (!decks.includes(seat0)) setSeat0(decks[0]!)
		if (!decks.includes(seat1)) setSeat1(decks[Math.min(1, decks.length - 1)]!)
	}, [decks, seat0, seat1])

	const start = () => {
		const config: SetupConfig = {
			mode: 'TWO_PLAYER',
			players: [
				{ deck: seat0, boardSide: side0 },
				{ deck: seat1, boardSide: side1 },
			],
			seed,
		}
		startGame(config)
	}

	return (
		<main className="setup-screen">
			<h1>Ready Room</h1>
			<p className="muted">
				Hot-seat setup — pick the two captains and the seed (reproducible
				games).
			</p>
			{!catalogReady ? (
				<p>Loading cards…</p>
			) : (
				<div className="setup-form">
					<button
						type="button"
						className="btn"
						onClick={() => useGameStore.getState().setDeckReviewOpen(true)}
					>
						Review decks
					</button>
					<DeckPicker
						label="Player 1"
						decks={decks}
						deck={seat0}
						onDeck={setSeat0}
						side={side0}
						onSide={setSide0}
					/>
					<DeckPicker
						label="Player 2"
						decks={decks}
						deck={seat1}
						onDeck={setSeat1}
						side={side1}
						onSide={setSide1}
					/>
					<label className="seed-field">
						Seed
						<input
							type="number"
							value={seed}
							onChange={(e) => setSeed(Number(e.target.value))}
							aria-label="random seed"
						/>
					</label>
					<button
						type="button"
						className="btn btn-primary btn-lg"
						onClick={start}
						disabled={seat0 === seat1}
					>
						Start game
					</button>
					{seat0 === seat1 && (
						<p className="muted small">The two captains must differ.</p>
					)}
					<button
						type="button"
						className="btn btn-lg"
						onClick={() => {
							window.location.hash = 'hails'
						}}
					>
						Play online
					</button>
					<button
						type="button"
						className="btn"
						onClick={() => useGameStore.getState().openGuide()}
					>
						Learn the card glyphs
					</button>
					{isDesktop() && (
						<button type="button" className="btn" onClick={openCardDatabase}>
							Card database
						</button>
					)}
					{error !== null && <p className="error-text">{error}</p>}
				</div>
			)}
			{catalogReady && catalog !== null ? (
				<SavedGamesPanel catalog={catalog} />
			) : null}
			<p className="muted small setup-note">
				Games autosave here as you play (intent log, ~1 s debounce) — refresh
				mid-turn and Continue to resume.{' '}
				<span className="undo-policy-chip">{undoPolicyLabel(savedMode)}</span>
			</p>
		</main>
	)
}

function DeckPicker({
	label,
	decks,
	deck,
	onDeck,
	side,
	onSide,
}: {
	label: string
	decks: DeckId[]
	deck: DeckId
	onDeck: (d: DeckId) => void
	side: 'BASIC' | 'ADVANCED'
	onSide: (s: 'BASIC' | 'ADVANCED') => void
}) {
	return (
		<div className="deck-picker">
			<strong>{label}</strong>
			<select
				value={deck}
				onChange={(e) => onDeck(e.target.value as DeckId)}
				aria-label={`${label} deck`}
			>
				{decks.map((d) => (
					<option key={d} value={d}>
						{deckLabel(d)}
					</option>
				))}
			</select>
			<div
				className="side-toggle"
				role="group"
				aria-label={`${label} board side`}
			>
				{(['BASIC', 'ADVANCED'] as const).map((s) => (
					<button
						key={s}
						type="button"
						className={`btn micro${side === s ? ' btn-active' : ''}`}
						onClick={() => onSide(s)}
					>
						{s}
					</button>
				))}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// In-game flow
// ---------------------------------------------------------------------------

function GameFlow({ shell }: { shell: Shell }) {
	const projected = useProjected()
	if (projected === null) {
		return (
			<main className="game-screen">
				<p>Loading…</p>
			</main>
		)
	}
	const state = projected as unknown as GameState
	if (state.result !== null && state.result.kind === 'COMPLETE') {
		return <EndScreen onNewGame={() => useGameStore.getState().newGame()} />
	}
	if (shell !== 'console') return <MobileShell shell={shell} />
	// The frame is the only thing allowed to change colour (docs/ui-lcars.md §7):
	// red alert when the Burn is one Incident away.
	const incidentsLeft = state.zones['INCIDENT_DECK']?.length ?? 0
	const alert = incidentsLeft <= 1 && state.result === null
	return (
		<div className={`frame${alert ? ' frame-alert' : ''}`}>
			<div className="frame-head">
				<div className="head-row">
					<span className="head-cap" aria-hidden="true" />
					<TopBar state={state} />
				</div>
				<ConsoleNav />
			</div>
			<div className="frame-body">
				<ErrorBanner />
				<WarningBanner />
				<RecoverableErrorBoundary title="while rendering the board">
					<BoardArea state={state} />
				</RecoverableErrorBoundary>
			</div>
			<div className="frame-foot">
				<span className="foot-cap" aria-hidden="true" />
				<StatusBar state={state} incidentsLeft={incidentsLeft} />
			</div>
			<PassDeviceBar state={state} />
			<ChoicePanel />
			<CardZoom />
			<FlightLayer />
		</div>
	)
}

/** The top bar carries this turn and nothing else: who is acting, in what
 *  phase, with how many actions, and the one obvious next move. Everything
 *  else lives in the rail. */
function TopBar({ state }: { state: GameState }) {
	const session = useSession()
	const [confirmEnd, setConfirmEnd] = useState(false)
	const active = state.players[state.activeSeat]
	const phase = state.phase.k
	const pending = state.pendingChoice !== null
	const budget = session?.meta.scoreEstimate
	// nothing left to spend: the one obvious next move is ending the step
	const outOfActions =
		phase === 'ACTION' && !pending && (active?.actions.available ?? 0) === 0

	const action = useMemo(() => {
		if (pending) return null
		switch (phase) {
			case 'SETUP':
				return { label: 'Start game', kind: 'start' as const }
			case 'RESUPPLY':
				return { label: 'Continue', kind: 'pass' as const }
			case 'CONTROL':
				return { label: 'Continue', kind: 'pass' as const }
			case 'ACTION':
				return { label: 'End Action Step', kind: 'endTurn' as const }
			default:
				return null
		}
	}, [pending, phase])

	const onPrimary = useCallback(() => {
		if (action === null) return
		if (action.kind === 'endTurn' && !confirmEnd) {
			setConfirmEnd(true)
			window.setTimeout(() => setConfirmEnd(false), 4000)
			return
		}
		setConfirmEnd(false)
		const s = useGameStore.getState()
		if (action.kind === 'start') s.dispatch({ t: 'START' })
		else if (action.kind === 'pass') s.dispatch({ t: 'PASS' })
		else s.dispatch({ t: 'END_TURN' })
	}, [action, confirmEnd])

	return (
		<header className="topbar">
			<div className="topbar-left">
				<strong>Ready Room</strong>
				<span className={`phase-chip phase-${phase.toLowerCase()}`}>
					{phaseLabel(state.phase)}
				</span>
				<span className="muted">
					Turn {state.turnNumber} · {seatLabel(state.activeSeat)}
				</span>
				<ActionTray seat={state.activeSeat} size="lg" />
				{active !== undefined && (
					<span
						className="topbar-resources"
						aria-label={`${seatLabel(state.activeSeat)} resources`}
					>
						{(['DIL', 'LAT', 'GLO'] as const).map((r) => (
							<span
								key={r}
								className={`res-pip pip-${r.toLowerCase()}`}
								title={RESOURCE_LABEL[r]}
							>
								<Icon id={r} label={RESOURCE_LABEL[r]} /> {active.resources[r]}
							</span>
						))}
					</span>
				)}
			</div>
			<div className="topbar-actions">
				{action !== null && (
					<button
						type="button"
						className={`btn btn-primary${confirmEnd ? ' btn-warn' : ''}${outOfActions ? ' btn-nudge' : ''}`}
						onClick={onPrimary}
						title={
							action.kind === 'endTurn'
								? 'Unused actions are lost when the Action Step ends.'
								: undefined
						}
					>
						{confirmEnd
							? 'Really end step? Unused actions are lost'
							: action.label}
					</button>
				)}
				{budget !== undefined && (
					<span
						className="score-est"
						title="running score estimate (public info only)"
					>
						{seatLabel(0)} ~{budget[0]} · {seatLabel(1)} ~{budget[1]}
					</span>
				)}
			</div>
		</header>
	)
}

/** The console strip: everything that is not this turn's decision. It runs
 *  across the head, directly under the title bar, so the board keeps the full
 *  width — at this complexity the screen is the scarce resource
 *  (docs/ui-lcars.md §4). */
function ConsoleNav() {
	const undo = useGameStore((s) => s.undo)
	const newGame = useGameStore((s) => s.newGame)
	const canUndo = useGameStore((s) => s.canUndo)
	const session = useSession()
	const setRulesOpen = useGameStore((s) => s.setRulesOpen)
	const setCardListOpen = useGameStore((s) => s.setCardListOpen)
	const setDeckReviewOpen = useGameStore((s) => s.setDeckReviewOpen)
	const revealAll = useGameStore((s) => s.revealAll)
	const setRevealAll = useGameStore((s) => s.setRevealAll)
	const showCardDetails = useGameStore((s) => s.showCardDetails)
	const setShowCardDetails = useGameStore((s) => s.setShowCardDetails)
	const undoLabel = undoPolicyLabel(session?.setup.mode)
	return (
		<nav className="console-nav" aria-label="Console">
			<span className="nav-label">Session</span>
			<button
				type="button"
				className="btn"
				onClick={undo}
				disabled={!canUndo}
				title={undoLabel}
			>
				Undo
				{session !== null && session.log.length > 0 && !canUndo ? (
					<span className="undo-lock"> (turn boundary)</span>
				) : null}
			</button>
			<button
				type="button"
				className="btn"
				onClick={openReplay}
				disabled={session === null}
			>
				Replay
			</button>
			<span className="nav-label">Reference</span>
			<button type="button" className="btn" onClick={() => setRulesOpen(true)}>
				Rules
			</button>
			<button
				type="button"
				className="btn"
				onClick={() => setCardListOpen(true)}
			>
				Card list
			</button>
			<button
				type="button"
				className="btn"
				onClick={() => useGameStore.getState().openGuide()}
				title="Learn the card glyphs"
			>
				Shorthand
			</button>
			<button
				type="button"
				className="btn"
				onClick={() => setDeckReviewOpen(true)}
			>
				Deck review
			</button>
			<button
				type="button"
				className={`btn micro details-toggle${showCardDetails ? ' btn-active' : ''}`}
				onClick={() => setShowCardDetails(!showCardDetails)}
				aria-pressed={showCardDetails}
				title="Phase B: switch between the printed card art (default) and the full text card"
			>
				Details
			</button>
			<DebugReveal revealAll={revealAll} setRevealAll={setRevealAll} />
			<LayoutSwitch />
			<span className="nav-spacer" />
			<span className="nav-num">
				MODE · {session?.setup.mode === 'CADET' ? 'CADET' : 'HOT-SEAT'}
			</span>
			<button type="button" className="btn" onClick={newGame}>
				New game
			</button>
		</nav>
	)
}

/** Foot status bar — the two end conditions, always legible, never a modal. */
function StatusBar({
	state,
	incidentsLeft,
}: {
	state: GameState
	incidentsLeft: number
}) {
	const viewer = useViewerSeat()
	const burnClose = incidentsLeft <= 2
	return (
		<div className="bottombar" role="status">
			<span className="seg">Viewing · {seatLabel(viewer)}</span>
			<span className="seg">⌥ hold + hover to zoom</span>
			<span className="seg">Stardates {state.stardates.pile.length}</span>
			<span className={`seg${burnClose ? ' seg-alert' : ''}`}>
				{burnClose
					? `⚠ The Burn — ${incidentsLeft} Incident${incidentsLeft === 1 ? '' : 's'} left`
					: `Incidents ${incidentsLeft}`}
			</span>
			<span className={`seg${state.resolutionTriggered ? ' seg-alert' : ''}`}>
				{state.resolutionTriggered
					? '⚠ Resolution triggered'
					: 'Resolution not triggered'}
			</span>
		</div>
	)
}

/** todo/15 §2 residue: a "reveal everything" debug toggle behind a dev flag
 *  (the projection otherwise hides the opponent's hand / facedown decks).
 *  Deliberately a dev/authoring tool — off by default. */
function DebugReveal({
	revealAll,
	setRevealAll,
}: {
	revealAll: boolean
	setRevealAll: (b: boolean) => void
}) {
	if (!import.meta.env.DEV && !import.meta.env.VITE_REVEAL_ALL) return null
	return (
		<button
			type="button"
			className={`btn micro debug-reveal${revealAll ? ' btn-active' : ''}`}
			onClick={() => setRevealAll(!revealAll)}
			title="dev/debug: show every card (including hidden zones)"
		>
			Reveal all
		</button>
	)
}

function BoardArea({ state }: { state: GameState }) {
	void state
	const viewer = useViewerSeat()
	const opponent: Seat = viewer === 0 ? 1 : 0
	// Layout follows what a turn actually needs (docs/ui-lcars.md §4):
	//   · counters (Stardate, Junk, Incidents, your deck) are a thin strip — they
	//     are numbers, not cards, and were wasting card-sized slots;
	//   · Market and Neutral Zone share one row, so all seven shared card slots
	//     are visible at once without scrolling;
	//   · the opponent moves into the side column. They are reference, not your
	//     decision, and a permanent 300px column for them cost the board width.
	return (
		<main className="board-grid">
			<div className="main-col">
				<div className="ops-strip">
					<StardateTrack />
					<JunkIncidentBar />
					<PlayerDeckPiles />
				</div>
				<div className="shared-row">
					<Market />
					<NeutralZone />
				</div>
				<div className="own-row">
					<PlayerArea seat={viewer} />
					<CrewBoard seat={viewer} />
				</div>
			</div>
			<aside className="side-col">
				<div className="opp-block">
					<PlayerArea seat={opponent} compact />
					<CrewBoard seat={opponent} compact />
				</div>
				<LogPanel />
			</aside>
			<div className="hand-strip">
				<Hand seat={viewer} />
			</div>
		</main>
	)
}

function PassDeviceBar({ state }: { state: GameState }) {
	const viewer = useViewerSeat()
	const setViewer = useGameStore((s) => s.setViewer)
	if (state.result !== null) return null
	const needOpponent =
		state.pendingChoice === null && state.activeSeat !== viewer
	if (!needOpponent) return null
	return (
		<div className="pass-bar" role="status">
			<span>
				It&apos;s {seatLabel(state.activeSeat)}&apos;s turn — pass the device.
			</span>
			<button
				type="button"
				className="btn btn-primary"
				onClick={() => setViewer(state.activeSeat)}
			>
				I&apos;m {seatLabel(state.activeSeat)}
			</button>
		</div>
	)
}

// ---------------------------------------------------------------------------
// End screen
// ---------------------------------------------------------------------------

function EndScreen({ onNewGame }: { onNewGame: () => void }) {
	const projected = useProjected()
	const state = projected as unknown as GameState | null
	const scoreboard =
		state !== null && state.result !== null && state.result.kind === 'COMPLETE'
			? state.result.scoreboard
			: null
	if (scoreboard === null) {
		return (
			<main className="end-screen">
				<h1>Game over</h1>
				<button type="button" className="btn btn-primary" onClick={onNewGame}>
					New game
				</button>
			</main>
		)
	}
	return (
		<main className="end-screen">
			<h1>Final score</h1>
			<p className="muted">
				{scoreboard.cadetLoss
					? 'Cadet Training — the Burn is a loss.'
					: `Winner${scoreboard.winners.length > 1 ? 's' : ''}: ${scoreboard.winners.map((w) => seatLabel(w)).join(', ')}`}
			</p>
			<div className="score-grid">
				{([0, 1] as const).map((seat) => (
					<ScoreColumn
						key={seat}
						seat={seat}
						b={scoreboard.breakdown[seat]}
						label={seatLabel(seat)}
					/>
				))}
			</div>
			<button
				type="button"
				className="btn btn-primary btn-lg"
				onClick={onNewGame}
			>
				New game
			</button>
		</main>
	)
}

function ScoreColumn({
	seat,
	b,
	label,
}: {
	seat: Seat
	b: Extract<
		GameState['result'],
		{ kind: 'COMPLETE' }
	>['scoreboard']['breakdown'][number]
	label: string
}) {
	void seat
	const endgameVp = b.endgame.reduce((a, e) => a + e.vp, 0)
	const printedVp = b.printedVp.reduce((a, p) => a + p.vp, 0)
	const missionVp = b.missions.reduce((a, m) => a + m.vp, 0)
	return (
		<section className="panel score-col" aria-label={`${label} score`}>
			<h3>{label}</h3>
			<table className="score-table">
				<tbody>
					<tr>
						<td>Glory</td>
						<td>{b.glory}</td>
					</tr>
					<tr>
						<td>Tokens on neutral Locations</td>
						<td>
							{b.neutralTokens.count} tokens → {b.neutralTokens.vp}
						</td>
					</tr>
					<tr>
						<td>Endgame operations</td>
						<td>{endgameVp}</td>
					</tr>
					<tr>
						<td>Printed VP</td>
						<td>{printedVp}</td>
					</tr>
					<tr>
						<td>Focus × multiplier</td>
						<td>
							{b.focus
								.map(
									(f) => `${f.specialty.charAt(0)}×${f.multiplier}(${f.cards})`,
								)
								.join(', ')}
						</td>
					</tr>
					<tr>
						<td>Completed missions</td>
						<td>
							{b.missionsCompleted} → {missionVp}
						</td>
					</tr>
					<tr className="score-total">
						<td>Total</td>
						<td>{b.total}</td>
					</tr>
				</tbody>
			</table>
			{b.focusSuppressed && (
				<p className="muted small focus-suppression" title="rules/12 §12.27">
					Focus suppressed (rules/12 §12.27): your Focus icons score only ×1
					because your specialty tracks never reached a multiplier step — so the
					Focus row above contributes its base value.
				</p>
			)}
		</section>
	)
}
