// The online half of the game store (docs/ui-mobile.md §7). An online game has
// no local engine state: the server holds it, and this device renders the
// seat view it receives. The controller keeps that view flowing into the same
// store fields every component already reads — `projected`, `legal`,
// `pendingChoice`, `viewerSeat`, `canUndo` — and sends the player's intents,
// undo and standing orders back with the view's version.
//
// Legality is the view's own list (the server's legalIntents for this seat);
// nothing here runs an engine query on a view whose hidden cards are aliases.
//
// Wiring: store.ts builds one controller with its `set`/`get` and routes
// dispatch / settle / undo here while a game is open. The client comes from
// seats.ts; tests swap it with `setOnlineClientFactory`.

import type { Intent } from '../../engine/intents'
import type { PendingChoice } from '../../engine/resolver/choices'
import type {
	GameView,
	OnlineGameClient,
	Recap,
	SeatCredentials,
	StandingPolicy,
	StreamStatus,
	Subscription,
} from '../../session/online'
import { isStaleVersion } from '../../session/online'
import type { ProjectedState } from '../projection'
import { onlineClient } from './seats'

/** What the store shows about the open online game. */
export interface OnlineState {
	creds: SeatCredentials
	/** null until the first view arrives */
	view: GameView | null
	stream: StreamStatus
	/** a submission is in flight */
	busy: boolean
	/** "Previously on…" for this seat, fetched when the game opens */
	recap: Recap | null
	/** the opening recap was read (or there was nothing to read) */
	recapSeen: boolean
}

/** The store fields the controller writes. */
export interface OnlinePatch {
	online?: OnlineState | null
	state?: null
	session?: null
	projected?: ProjectedState | null
	legal?: Intent[]
	pendingChoice?: PendingChoice | null
	viewerSeat?: 0 | 1
	canUndo?: boolean
	motion?: null
	selected?: string[]
	error?: string | null
	warning?: string | null
}

export interface OnlineStoreAccess {
	set: (patch: OnlinePatch) => void
	online: () => OnlineState | null
	pendingChoice: () => PendingChoice | null
}

let clientFactory: () => OnlineGameClient = onlineClient

/** Test seam: the client the controller talks through. */
export function setOnlineClientFactory(
	f: (() => OnlineGameClient) | null,
): void {
	clientFactory = f ?? onlineClient
}

/** The client online screens talk through (the lobby too, so tests can swap
 *  it in one place). */
export function currentOnlineClient(): OnlineGameClient {
	return clientFactory()
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}

export function createOnlineController(store: OnlineStoreAccess) {
	let sub: Subscription | null = null
	let client: OnlineGameClient | null = null
	/** bumps on every open/close, so a late response for an old game is dropped */
	let epoch = 0

	const patchOnline = (p: Partial<OnlineState>) => {
		const cur = store.online()
		if (cur !== null) store.set({ online: { ...cur, ...p } })
	}

	const apply = (view: GameView, mine: number) => {
		if (mine !== epoch) return
		const cur = store.online()
		if (cur === null) return
		const prevChoice = store.pendingChoice()
		const nextChoice = view.state.pendingChoice as PendingChoice | null
		const known = cur.view?.version ?? -1
		if (view.version < known) return
		store.set({
			online: { ...cur, view, busy: false },
			state: null,
			session: null,
			projected: view.state,
			legal: view.legalIntents,
			pendingChoice: nextChoice,
			viewerSeat: view.seat,
			canUndo: view.canUndo,
			motion: null,
			...(prevChoice?.id !== nextChoice?.id ? { selected: [] } : {}),
		})
	}

	/** Refetch after a refusal that means "the game moved on". */
	const resync = async (mine: number) => {
		const cur = store.online()
		if (cur === null || client === null) return
		try {
			apply(await client.getView(cur.creds), mine)
		} catch (err) {
			if (mine === epoch) store.set({ error: message(err) })
		}
	}

	const write = async (
		run: (
			c: OnlineGameClient,
			creds: SeatCredentials,
			version: number,
		) => Promise<GameView>,
	) => {
		const cur = store.online()
		if (cur === null || cur.view === null || client === null) return
		const mine = epoch
		patchOnline({ busy: true })
		try {
			apply(await run(client, cur.creds, cur.view.version), mine)
		} catch (err) {
			if (mine !== epoch) return
			patchOnline({ busy: false })
			if (isStaleVersion(err)) {
				store.set({
					warning:
						'The game moved on while you were deciding; here is the latest.',
				})
				await resync(mine)
			} else store.set({ error: message(err) })
		}
	}

	const close = (): void => {
		epoch++
		sub?.close()
		sub = null
		client = null
	}

	/** Open a seat: watch its view (live over SSE) and fetch its recap. */
	const open = (creds: SeatCredentials): void => {
		close()
		const mine = ++epoch
		const c = clientFactory()
		client = c
		store.set({
			online: {
				creds,
				view: null,
				stream: 'connecting',
				busy: false,
				recap: null,
				recapSeen: false,
			},
			state: null,
			session: null,
			projected: null,
			legal: [],
			pendingChoice: null,
			canUndo: false,
			motion: null,
			selected: [],
			error: null,
			warning: null,
		})
		if (typeof globalThis.EventSource === 'function') {
			sub = c.watch(creds, (view) => apply(view, mine), {
				onStatus: (stream) => {
					if (mine === epoch) patchOnline({ stream })
				},
				onError: (err) => {
					if (mine === epoch && store.online()?.view === null)
						store.set({ error: message(err) })
				},
			})
		} else {
			// no live stream in this runtime (tests, old browsers): fetch once;
			// every write returns the fresh view anyway
			patchOnline({ stream: 'closed' })
			void resync(mine)
		}
		c.getRecap(creds).then(
			(recap) => {
				if (mine !== epoch) return
				// news = something the other captain (or a deadline) did, not the
				// server's opening START
				const theirs = recap.entries.some((e) => !e.yours && e.by !== 'server')
				patchOnline({ recap, recapSeen: !theirs })
			},
			() => {
				if (mine === epoch) patchOnline({ recapSeen: true })
			},
		)
	}

	const submit = (intent: Intent): void => {
		void write((c, creds, version) => c.submitIntent(creds, intent, version))
	}

	return {
		open,
		close,
		active: (): boolean => store.online() !== null,
		submit,
		/** Answer the open choice (the store's `settle`). */
		settle: (selection: unknown): void => {
			const choice = store.pendingChoice()
			if (choice === null) return
			submit({ t: 'RESOLVE_CHOICE', choiceId: choice.id, selection })
		},
		undo: (): void => {
			void write((c, creds, version) => c.undo(creds, version))
		},
		setStandingOrder: (cardDef: string, policy: StandingPolicy): void => {
			void write((c, creds) => c.setStandingOrder(creds, cardDef, policy))
		},
		/** Fetch "Previously on…" again (menu), and show it. */
		refreshRecap: (): void => {
			const cur = store.online()
			if (cur === null || client === null) return
			const mine = epoch
			client.getRecap(cur.creds).then(
				(recap) => {
					if (mine === epoch) patchOnline({ recap, recapSeen: false })
				},
				(err: unknown) => {
					if (mine === epoch) store.set({ error: message(err) })
				},
			)
		},
		dismissRecap: (): void => {
			patchOnline({ recapSeen: true })
		},
	}
}

export type OnlineController = ReturnType<typeof createOnlineController>
