// Zustand store for the game flow (todo/14 §1). Owns:
//   - the session adapter (SetupConfig + intent log + incremental GameState)
//   - the derived *projection* the components actually render (hot-seat)
//   - the legality snapshot (what the active player may do right now)
//   - cross-component interaction state (in-situ selection rings, detail
//     overlay, hover) and the UI shell flags (log filter, drawers).
//
// The UI never mutates GameState. Every state change goes through
// `SessionAdapter.dispatch`/`settle` (which validate against `legalIntents` /
// `validateChoice` and throw on illegal intents), then the store re-snapshots
// `projected` + `legal` for subscribers. The session log remains the source of
// truth for undo/save/load (todo/17 §1).

import { create } from 'zustand'
import { registerCards } from '../engine/cards'
import type { SeatCredentials, StandingPolicy } from '../session/online'
import type { GuideSection } from './guide/ShorthandGuide'
import { createOnlineController, type OnlineState } from './online/controller'

import type { GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import type { CardCatalog, SetupConfig } from '../engine/setup'
import type { PendingChoice } from '../engine/resolver/choices'
import type { CardInstanceId } from '../engine/ids'
import type { Seat } from '../engine/resolver/queries'
import { createSession, checkCardData, type Session } from '../session/log'
import { SessionAdapter } from '../session/adapter'
import { project, HIDDEN_DEF, type ProjectedState } from './projection'
import { poolDiff } from '../engine/fx'
import { residualChanges, type Motion } from './flow'
import { loadBrowserCatalog } from './browserCatalog'
import { getSessionStore } from './persistence'
import {
	singleLegalAction,
	type SingleLegalAction,
} from '../engine/queries/legality'

export type LogFilter = 'ALL' | 'MINE' | 'THEIRS'

/** Autosave cadence (todo/17 §1): save ~1 s after the last intent settles. */
export const AUTOSAVE_DEBOUNCE_MS = 1000

// ---------------------------------------------------------------------------
// Undo policy (todo/17 §2, choice (a)). Solo (CADET) undoes freely; hot-seat
// (TWO_PLAYER) limits take-backs to the active player's own turn — the undo
// button is disabled the moment the *last committed intent is a turn boundary*
// (START / PASS / END_TURN), so an opponent's turn (or a completed turn) is
// never rewound with the information it revealed. The adapter itself remains
// unrestricted (byte-exact truncate + replay); this is purely the UI gate.
// ---------------------------------------------------------------------------

export interface UndoPolicy {
	allowed: boolean
	reason: string | null
}

export function undoPolicy(session: Session | null): UndoPolicy {
	if (session === null)
		return { allowed: false, reason: 'No game in progress.' }
	const last = session.log[session.log.length - 1]
	if (last === undefined)
		return { allowed: false, reason: 'Nothing to undo yet.' }
	if (session.setup.mode === 'CADET') {
		return { allowed: true, reason: 'Solo — take-backs enabled, undo freely.' }
	}
	if (last.t === 'START' || last.t === 'PASS' || last.t === 'END_TURN') {
		return {
			allowed: false,
			reason:
				"Hot-seat take-backs stop at your turn's end — the opponent's turn is never rewound.",
		}
	}
	return { allowed: true, reason: 'Take-backs enabled within your own turn.' }
}

/** Short label shown next to the Undo control (todo/17 §2 "state it in the UI"). */
export function undoPolicyLabel(
	mode: Session['setup']['mode'] | undefined,
): string {
	return mode === 'CADET'
		? 'Take-backs enabled — free undo (solo).'
		: 'Take-backs: undo within your own turn — stops at a turn boundary.'
}

/** The single live adapter (one game at a time). Kept out of the store object
 *  so only the derived snapshots drive React renders; the adapter itself is
 *  mutable and owns the incremental state. */
let adapter: SessionAdapter | null = null

/**
 * Click vs double-click disambiguation for cards. A plain single click opens
 * the card detail view; a double-click is the fast path that runs a card's
 * one legal action. A single click must not open the detail before a possible
 * second click (the modal backdrop would swallow it), so the detail-open is
 * deferred by this window when the card currently has a single legal action —
 * a second click on the same card within the window cancels the pending open
 * and runs the action instead.
 */
export const DETAIL_CLICK_WINDOW_MS = 300

let pendingDetail: {
	iid: CardInstanceId
	timer: ReturnType<typeof setTimeout>
} | null = null

function cancelPendingDetail(): void {
	if (pendingDetail !== null) {
		clearTimeout(pendingDetail.timer)
		pendingDetail = null
	}
}

/** Schedule the detail view to open for `iid` once the double-click window
 *  has passed (i.e. the click really was a single click). */
function scheduleDetailOpen(iid: CardInstanceId): void {
	pendingDetail = {
		iid,
		timer: setTimeout(() => {
			pendingDetail = null
			const st = useGameStore.getState()
			// Guard against the window spanning a game/lifecycle transition.
			if (st.state === null) return
			if (st.state.cards[iid] === undefined) return
			if (st.state.pendingChoice !== null) return
			st.setDetail(iid)
		}, DETAIL_CLICK_WINDOW_MS),
	}
}

/** Dispatch the card's single legal action, but only if the store's legality
 *  snapshot still offers it (mirrors the same gate the detail row uses, so a
 *  stale probe can never flash an error). */
function runSingleAction(iid: CardInstanceId, action: SingleLegalAction): void {
	const s = useGameStore.getState()
	const intent: Intent =
		action.kind === 'PLAY'
			? { t: 'PLAY_CARD', iid, operationIndex: action.operationIndex }
			: { t: 'ACTIVATE', iid, operationIndex: action.operationIndex }
	const isLegal = s.legal.some(
		(it) =>
			it.t === intent.t &&
			it.iid === iid &&
			'operationIndex' in it &&
			it.operationIndex === intent.operationIndex,
	)
	if (!isLegal) return
	s.dispatch(intent)
}

export interface GameStore {
	catalog: CardCatalog | null
	session: Session | null
	/** Raw immutable GameState kept for legality/pending-choice logic — the
	 *  components must NOT read this directly; render through `projected`. */
	state: GameState | null
	projected: ProjectedState | null
	legal: Intent[]
	pendingChoice: PendingChoice | null
	viewerSeat: Seat
	// interaction
	selected: CardInstanceId[] // current choice's in-progress selection (in-situ rings)
	detailIid: CardInstanceId | null
	hoverIid: CardInstanceId | null
	/** Option/Alt is down: hovering a card zooms it centre stage. Held-key
	 *  state, not a toggle — released or blurred, it is false. */
	zoomHeld: boolean
	destinationDefault: 'DECK_TOP' | 'DISCARD' | null
	// shell flags
	rulesOpen: boolean
	cardListOpen: boolean
	deckReviewOpen: boolean
	logFilter: LogFilter
	error: string | null
	/** Dismissible informational notice (resume card-data drift, undo refusal,
	 *  autosave failure) — distinct from `error`, which is reserved for real
	 *  failures that block the current action. */
	warning: string | null
	/** Whether the undo button may act right now (undoPolicy). */
	canUndo: boolean
	/** Token movement of the last dispatch/settle, for the flight layer and
	 *  delta badges (flow.ts). Null after anything that is not play — undo,
	 *  passing the device, loading — so those never animate. */
	motion: Motion | null
	/** Debug escape hatch (todo/15 §2): when on, the projection shows every
	 *  card — no hiding. Behind a DEV flag in the UI. */
	revealAll: boolean
	/** The open online game (docs/ui-mobile.md §7), or null for local play.
	 *  While set, `projected` / `legal` / `pendingChoice` / `viewerSeat` /
	 *  `canUndo` come from the server's seat view and `state` / `session` stay
	 *  null: there is no local engine state to read. */
	online: OnlineState | null
	/** The Shorthand guide's open section, or null (src/ui/guide). */
	guide: GuideSection | null
	/** Phase B: when off (default), cards show their printed card art; when
	 *  on, they render the full text card (name/traits/ops). In-memory only —
	 *  a deliberate preference, not part of a save. */
	showCardDetails: boolean
	// actions
	loadCatalog: () => void
	newGame: () => void
	startGame: (config: SetupConfig) => void
	resumeGame: (session: Session) => void
	dispatch: (intent: Intent) => void
	settle: (selection: unknown) => void
	undo: () => void
	setViewer: (seat: Seat) => void
	cardClicked: (iid: CardInstanceId) => void
	setSelected: (iids: CardInstanceId[]) => void
	clearSelection: () => void
	setDetail: (iid: CardInstanceId | null) => void
	setHoverIid: (iid: CardInstanceId | null) => void
	setZoomHeld: (held: boolean) => void
	setDestinationDefault: (d: 'DECK_TOP' | 'DISCARD') => void
	setRulesOpen: (b: boolean) => void
	setCardListOpen: (b: boolean) => void
	setDeckReviewOpen: (b: boolean) => void
	setLogFilter: (f: LogFilter) => void
	setRevealAll: (b: boolean) => void
	setShowCardDetails: (b: boolean) => void
	clearError: () => void
	clearWarning: () => void
	openGuide: (section?: GuideSection) => void
	closeGuide: () => void
	// online play (src/ui/online/controller.ts)
	openOnline: (creds: SeatCredentials) => void
	closeOnline: () => void
	setStandingOrder: (cardDef: string, policy: StandingPolicy) => void
	showRecap: () => void
	dismissRecap: () => void
}

type SnapshotFields = Pick<
	GameStore,
	| 'state'
	| 'session'
	| 'projected'
	| 'legal'
	| 'pendingChoice'
	| 'canUndo'
	| 'motion'
>

/** Re-derive the projection + legality + undo gate from the adapter (cheap:
 *  one deep copy + the legality probe + the undo policy). Components only ever
 *  subscribe to these. */
function snapshot(viewerSeat: Seat): SnapshotFields {
	if (adapter === null) {
		return {
			state: null,
			session: null,
			projected: null,
			legal: [],
			pendingChoice: null,
			canUndo: false,
			motion: null,
		}
	}
	const revealAll = useGameStore.getState().revealAll
	return {
		state: adapter.state,
		session: adapter.session,
		projected: project(adapter.state, viewerSeat, revealAll),
		legal: adapter.legalIntents,
		pendingChoice: adapter.state.pendingChoice,
		canUndo: undoPolicy(adapter.session).allowed,
		motion: null,
	}
}

let motionSeq = 0

/** What one dispatch moved: the fx entries it appended (a source card hidden
 *  from the viewer is redacted to null) and the phase bookkeeping no entry
 *  explains. Null when nothing moved. */
function motionOf(
	before: GameState,
	after: GameState,
	projected: ProjectedState | null,
): Motion | null {
	if (before === after) return null
	const hidden = (iid: string) => projected?.cards[iid]?.def === HIDDEN_DEF
	const fx = after.fx.slice(before.fx.length).map((e) => ({
		source: e.source !== null && hidden(e.source) ? null : e.source,
		changes: e.changes.filter(
			(c) => c.pool.k !== 'CARD' || !hidden(c.pool.iid),
		),
	}))
	const residual = residualChanges(poolDiff(before, after), fx).filter(
		(c) => c.pool.k !== 'CARD' || !hidden(c.pool.iid),
	)
	if (fx.every((e) => e.changes.length === 0) && residual.length === 0)
		return null
	return {
		seq: ++motionSeq,
		fx,
		residual,
		logFrom: before.log.length,
	}
}

/** Autosave hook (todo/17 §1): a rejected save must never crash the game or
 *  leave an unhandled rejection — surface it as a dismissible notice instead. */
function saveQuiet(session: Session): void {
	void getSessionStore()
		.save(session)
		.catch(() => {
			useGameStore.setState((prev) =>
				prev.warning === null
					? { warning: 'Autosave failed — this game is not being persisted.' }
					: {},
			)
		})
}

/** Build the adapter wired for autosave. Persists immediately (so a fresh game
 *  shows in the load list right away) and debounced after every commit via the
 *  adapter's own timer. */
function makeAdapter(session: Session, catalog: CardCatalog): SessionAdapter {
	return new SessionAdapter({
		session,
		catalog,
		persist: (s) => saveQuiet(s),
		autosaveDebounceMs: AUTOSAVE_DEBOUNCE_MS,
	})
}

export const useGameStore = create<GameStore>((set) => ({
	catalog: null,
	session: null,
	state: null,
	projected: null,
	legal: [],
	pendingChoice: null,
	viewerSeat: 0,
	selected: [],
	detailIid: null,
	hoverIid: null,
	zoomHeld: false,
	destinationDefault: null,
	rulesOpen: false,
	cardListOpen: false,
	deckReviewOpen: false,
	logFilter: 'ALL',
	error: null,
	warning: null,
	canUndo: false,
	motion: null,
	revealAll: false,
	showCardDetails: false,
	online: null,
	guide: null,

	loadCatalog: () => {
		if (useGameStore.getState().catalog !== null) return
		try {
			const catalog = loadBrowserCatalog()
			set({ catalog })
		} catch (e) {
			set({ error: (e as Error).message })
		}
	},

	newGame: () => {
		cancelPendingDetail()
		onlineController.close()
		adapter?.dispose()
		adapter = null
		set({
			online: null,
			session: null,
			state: null,
			projected: null,
			legal: [],
			pendingChoice: null,
			canUndo: false,
			motion: null,
			selected: [],
			detailIid: null,
			hoverIid: null,
			rulesOpen: false,
			cardListOpen: false,
			deckReviewOpen: false,
			error: null,
			warning: null,
		})
	},

	startGame: (config) => {
		cancelPendingDetail()
		onlineController.close()
		set({ online: null })
		try {
			let catalog = useGameStore.getState().catalog
			if (catalog === null) {
				catalog = loadBrowserCatalog()
			}
			const session = createSession(config, catalog)
			adapter?.dispose()
			adapter = makeAdapter(session, catalog)
			// The device starts with whoever goes first (hot-seat "pass the device"
			// flow; docs/ui-spec.md §1).
			const viewerSeat: Seat = adapter.state.startingSeat
			set({
				catalog,
				viewerSeat,
				selected: [],
				detailIid: null,
				hoverIid: null,
				destinationDefault: null,
				error: null,
				warning: null,
				...snapshot(viewerSeat),
			})
			// Persist right away so the session is on the load list even before the
			// player's first intent (todo/17 §1 "the load screen is browsable").
			saveQuiet(adapter.session)
		} catch (e) {
			set({ error: (e as Error).message })
		}
	},

	resumeGame: (session) => {
		cancelPendingDetail()
		onlineController.close()
		set({ online: null })
		try {
			let catalog = useGameStore.getState().catalog
			if (catalog === null) {
				catalog = loadBrowserCatalog()
			}
			adapter?.dispose()
			adapter = makeAdapter(session, catalog)
			// Continue wherever the save left off (hot-seat: the viewer follows the
			// active seat; docs/ui-spec.md §1).
			const viewerSeat: Seat = adapter.state.activeSeat
			let warning: string | null = null
			const drift = checkCardData(session, catalog)
			if (!drift.ok) {
				warning =
					'Card data has changed since this save was made — the log may replay differently than the original game.'
			}
			set({
				catalog,
				viewerSeat,
				selected: [],
				detailIid: null,
				hoverIid: null,
				destinationDefault: null,
				error: null,
				warning,
				...snapshot(viewerSeat),
			})
			saveQuiet(adapter.session)
		} catch (e) {
			set({ warning: null, error: (e as Error).message })
		}
	},

	dispatch: (intent) => {
		if (onlineController.active()) {
			onlineController.submit(intent)
			if (intent.t !== 'PLAY_CARD' && intent.t !== 'ACTIVATE')
				set({ selected: [] })
			return
		}
		if (adapter === null) return
		const viewerSeat = useGameStore.getState().viewerSeat
		try {
			const before = adapter.state
			adapter.dispatch(intent)
			const snap = snapshot(viewerSeat)
			set({
				...snap,
				motion: motionOf(before, adapter.state, snap.projected),
			})
			if (
				intent.t === 'RESOLVE_CHOICE' ||
				intent.t === 'START' ||
				intent.t === 'PASS' ||
				intent.t === 'END_TURN'
			) {
				set({ selected: [] })
			}
		} catch (e) {
			set({ error: (e as Error).message })
		}
	},

	settle: (selection) => {
		if (onlineController.active()) {
			onlineController.settle(selection)
			set({ selected: [] })
			return
		}
		if (adapter === null) return
		const viewerSeat = useGameStore.getState().viewerSeat
		try {
			const before = adapter.state
			adapter.settle(selection)
			const snap = snapshot(viewerSeat)
			set({
				...snap,
				motion: motionOf(before, adapter.state, snap.projected),
				selected: [],
			})
		} catch (e) {
			set({ error: (e as Error).message })
		}
	},

	undo: () => {
		if (onlineController.active()) {
			onlineController.undo()
			set({ selected: [], detailIid: null })
			return
		}
		if (adapter === null) return
		const viewerSeat = useGameStore.getState().viewerSeat
		const policy = undoPolicy(adapter.session)
		if (!policy.allowed) {
			// The button is disabled when !canUndo, so this is a programmatic guard
			// (keyboard / test) — reflect the refusal instead of silently no-op'ing.
			set({ warning: policy.reason })
			return
		}
		if (!adapter.undo()) return
		set({
			...snapshot(viewerSeat),
			selected: [],
			detailIid: null,
			error: null,
			warning: null,
		})
	},

	setViewer: (seat) => {
		cancelPendingDetail()
		// online, this device is its seat
		if (adapter === null || onlineController.active()) return
		set({ viewerSeat: seat, selected: [], detailIid: null, ...snapshot(seat) })
	},

	cardClicked: (iid) => {
		const { selected, state, viewerSeat, pendingChoice } =
			useGameStore.getState()
		const choice: PendingChoice | null = pendingChoice
		if (choice !== null) {
			switch (choice.k) {
				case 'CHOOSE_CARDS':
					if (choice.candidates.includes(iid)) {
						const max = choice.max
						const next = selected.includes(iid)
							? selected.filter((c) => c !== iid)
							: max === 1
								? [iid]
								: selected.length < max
									? [...selected, iid]
									: selected
						set({ selected: next })
					}
					break
				case 'CHOOSE_LOCATION':
					if (choice.candidates.includes(iid)) set({ selected: [iid] })
					break
				default:
					set({ detailIid: iid })
			}
			return
		}
		// online there is no engine state to probe: a click opens the detail
		if (state === null) {
			set({ detailIid: iid })
			return
		}
		// No pending choice. A plain single click opens the detail view; the
		// second click of a double-click runs the card's *single* legal action.
		// Only disambiguate when the card actually has a single legal action for
		// the viewer's turn right now — everything else (blocked, multi-route,
		// not your turn) opens the detail immediately, no delay.
		const actionable =
			state.phase.k === 'ACTION' && state.activeSeat === viewerSeat
		const unique = actionable ? singleLegalAction(state, viewerSeat, iid) : null
		if (unique === null) {
			cancelPendingDetail()
			set({ detailIid: iid })
			return
		}
		if (pendingDetail !== null && pendingDetail.iid === iid) {
			// Second click inside the double-click window → run the one action.
			cancelPendingDetail()
			runSingleAction(iid, unique)
			return
		}
		cancelPendingDetail()
		scheduleDetailOpen(iid)
	},

	setSelected: (iids) => set({ selected: iids }),
	clearSelection: () => set({ selected: [] }),
	setDetail: (iid) => set({ detailIid: iid }),
	setHoverIid: (iid) => set({ hoverIid: iid }),
	setZoomHeld: (held) => set({ zoomHeld: held }),
	setDestinationDefault: (d) => set({ destinationDefault: d }),
	setRulesOpen: (b) => set({ rulesOpen: b, cardListOpen: false }),
	setCardListOpen: (b) => set({ cardListOpen: b, rulesOpen: false }),
	setDeckReviewOpen: (b) => set({ deckReviewOpen: b }),
	setLogFilter: (f) => set({ logFilter: f }),
	setRevealAll: (b) => {
		const viewerSeat = useGameStore.getState().viewerSeat
		set({ revealAll: b, ...snapshot(viewerSeat) })
	},
	setShowCardDetails: (b) => set({ showCardDetails: b }),
	clearError: () => set({ error: null }),
	clearWarning: () => set({ warning: null }),

	openGuide: (section = 'learn') => {
		useGameStore.getState().loadCatalog()
		set({ guide: section })
	},
	closeGuide: () => set({ guide: null }),

	openOnline: (creds) => {
		cancelPendingDetail()
		adapter?.dispose()
		adapter = null
		// engine helpers (scoring, tile legality, describe) look cards up in the
		// engine registry, which local play fills in setup(); online there is
		// no local setup, so register the catalogue here (idempotent per id)
		let catalog = useGameStore.getState().catalog
		try {
			if (catalog === null) {
				catalog = loadBrowserCatalog()
				set({ catalog })
			}
			registerCards([...catalog.defs, ...catalog.stardates.map((st) => st.def)])
		} catch (e) {
			set({ error: (e as Error).message })
			return
		}
		set({ detailIid: null, hoverIid: null, destinationDefault: null })
		onlineController.open(creds)
	},
	closeOnline: () => useGameStore.getState().newGame(),
	setStandingOrder: (cardDef, policy) =>
		onlineController.setStandingOrder(cardDef, policy),
	showRecap: () => onlineController.refreshRecap(),
	dismissRecap: () => onlineController.dismissRecap(),
}))

/** The online half of the store: it writes the seat view into the same fields
 *  local play fills (src/ui/online/controller.ts). */
const onlineController = createOnlineController({
	set: (patch) => useGameStore.setState(patch as Partial<GameStore>),
	online: () => useGameStore.getState().online,
	pendingChoice: () => useGameStore.getState().pendingChoice,
})

// ---------------------------------------------------------------------------
// Component hooks
// ---------------------------------------------------------------------------

/** The projected state for the current viewer — the ONLY thing components
 *  render. Stable reference between actions (zustand selector safety). */
export function useProjected(): ProjectedState | null {
	return useGameStore((s) => s.projected)
}

/** The real (un-projected) engine state — for legality queries (canPlay /
 *  canActivate) that must see every card def, never the hidden-info view.
 *  The projection is for rendering only (src/ui/projection.ts). */
export function useRealState(): GameState | null {
	return useGameStore((s) => s.state)
}

export function usePendingChoice(): PendingChoice | null {
	return useGameStore((s) => s.pendingChoice)
}

export function useLegal(): Intent[] {
	return useGameStore((s) => s.legal)
}

export function useSession(): Session | null {
	return useGameStore((s) => s.session)
}

export function useCatalog(): CardCatalog | null {
	return useGameStore((s) => s.catalog)
}

export function useViewerSeat(): Seat {
	return useGameStore((s) => s.viewerSeat)
}

export function useSelected(): CardInstanceId[] {
	return useGameStore((s) => s.selected)
}

/** The iid whose def + instance the detail overlay should show. */
export function useDetailIid(): CardInstanceId | null {
	return useGameStore((s) => s.detailIid)
}

export function useHoverIid(): CardInstanceId | null {
	return useGameStore((s) => s.hoverIid)
}

export function useZoomHeld(): boolean {
	return useGameStore((s) => s.zoomHeld)
}

/** Named export for module-level callers (cards.tsx CardDetailHost). */
export function setDetail(iid: CardInstanceId | null): void {
	useGameStore.getState().setDetail(iid)
}

/** Resolve + dispatch a choice with the current store selection. */
export function confirmChoice(selection: unknown): void {
	const choice = useGameStore.getState().pendingChoice
	if (choice === null) return
	useGameStore.getState().settle(selection)
}
