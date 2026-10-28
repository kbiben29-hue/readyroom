// UI-side persistence seam (todo/17 §1/§3). Owns the singleton SessionStore the
// store autosaves through, plus the file/clipboard helpers that surface the
// session layer's export/import as UI actions:
//   - browser  → IndexedDB via idb-keyval (createIdbStorage)
//   - headless → InMemoryStorage, so jsdom UI tests get a real store without a
//     browser (the same vtable seam src/session/persistence.test.ts uses)
//
// A save IS the Session (seed + setup + intent log + meta); the GameState is
// never serialised — load + replay recomputes it byte-exactly (session/log.ts).

import type { CardCatalog } from '../engine/setup'
import type { Session } from '../session/log'
import { checkCardData } from '../session/log'
import { syncSessionTo } from '../session/remote'
import type { Storage } from '../session/persistence'
import {
	createIdbStorage,
	InMemoryStorage,
	SessionStore,
	exportSession,
	importSession,
} from '../session/persistence'

let store: SessionStore | null = null

function buildStorage(): Storage {
	return typeof indexedDB !== 'undefined'
		? createIdbStorage()
		: new InMemoryStorage()
}

/** The singleton save-store the store autosaves through (todo/17 §1). */
export function getSessionStore(): SessionStore {
	if (store === null) store = new SessionStore(buildStorage())
	return store
}

/** Test seam: drop the singleton so a test runs against a fresh storage. */
export function resetSessionStoreForTests(): void {
	store = null
}

/** Card-data drift check for a save vs the live catalog (todo/17 §1): returns
 *  ok=false when the saved log may replay under different card data — the load
 *  screen labels those saves instead of silently replaying wrong. */
export function cardDataDrift(
	session: Session,
	catalog: CardCatalog,
): { ok: boolean; stored: string; current: string } {
	return checkCardData(session, catalog)
}

/** Dev server only: PUT the session to the Vite plugin in vite.config.ts,
 *  which writes `.debug/games/<id>.json` for `npm run game`. Fire-and-forget;
 *  a no-op in builds and tests. */
export function mirrorToDevServer(session: Session): void {
	if (!import.meta.env.DEV || import.meta.env.MODE === 'test') return
	void fetch(`/__debug/games/${encodeURIComponent(session.id)}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(session),
	}).catch(() => {})
}

/** Trigger a `<a download>` for the session JSON — the shareable bug-report
 *  format (todo/17 §3). */
export function downloadSession(session: Session): void {
	const blob = new Blob([exportSession(session)], { type: 'application/json' })
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = `${session.id}.session.json`
	document.body.appendChild(a)
	a.click()
	a.remove()
	URL.revokeObjectURL(url)
}

/** Copy the session JSON to the clipboard, with a legacy-textarea fallback for
 *  browsers without the async clipboard API. */
export async function copySession(session: Session): Promise<void> {
	const text = exportSession(session)
	if (
		typeof navigator !== 'undefined' &&
		navigator.clipboard?.writeText !== undefined
	) {
		await navigator.clipboard.writeText(text)
		return
	}
	const ta = document.createElement('textarea')
	ta.value = text
	document.body.appendChild(ta)
	ta.select()
	if (typeof document.execCommand === 'function') {
		document.execCommand('copy')
	}
	ta.remove()
}

/** Read a picked `.json` file back into a Session. Throws on malformed JSON or
 *  a foreign/unknown session version (importSession). */
export async function readSessionFile(file: File): Promise<Session> {
	return importSession(await file.text())
}

/** Default sync target — the local dev backend (`npm run server`). */
export const DEFAULT_SYNC_URL = 'http://127.0.0.1:8787'
/** localStorage key to override the backend URL (e.g. a friend's server). */
export const SYNC_URL_KEY = 'ready-room:sync-url'

/** Resolve the configured backend URL: localStorage override, else default. */
export function syncServerUrl(): string {
	const stored =
		typeof localStorage !== 'undefined'
			? localStorage.getItem(SYNC_URL_KEY)
			: null
	return stored !== null && stored.trim() !== ''
		? stored.trim()
		: DEFAULT_SYNC_URL
}

export type SyncOutcome =
	{ ok: true; server: string } | { ok: false; server: string; error: string }

/** "Sync to server": PUT this session to the backend. Never throws — a failure
 *  (server down, network, rejected payload) is reported in the outcome so the
 *  button can show it inline. `fetchImpl` is a test seam. */
export async function syncSession(
	session: Session,
	fetchImpl?: typeof fetch,
): Promise<SyncOutcome> {
	const server = syncServerUrl()
	try {
		await syncSessionTo(
			server,
			session,
			fetchImpl === undefined ? {} : { fetchImpl },
		)
		return { ok: true, server }
	} catch (err) {
		return { ok: false, server, error: (err as Error).message }
	}
}

export { exportSession, importSession }
export type { Session }
