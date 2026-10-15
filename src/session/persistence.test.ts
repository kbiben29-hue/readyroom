// todo/17 DoD — save/load round-trips through the in-memory IndexedDB mock,
// the versioned key, the browsable list, and the JSON export/import format.
// The central claim: a save is the Session (seed + setup + log + meta), never
// a GameState — replay recomputes it byte-identically, so no card object or
// instance reference is ever serialised.

import { describe, expect, it, beforeEach } from 'vitest'
import type { GameState } from '../engine/state'
import type { CardCatalog } from '../engine/setup'
import type { Session } from './log'
import { createSession, replay } from './log'
import { SessionAdapter as Adapter } from './adapter'
import { makeCatalog, sessionConfig, playGame } from './playGame'
import {
	InMemoryStorage,
	createIdbStorage,
	saveSession,
	loadSession,
	deleteSession,
	listSessions,
	exportSession,
	importSession,
	sessionKey,
	SESSION_KEY_PREFIX,
	SessionStore,
} from './persistence'

let catalog: CardCatalog
let session: Session

beforeEach(async () => {
	catalog = await makeCatalog()
	const adapter = new Adapter({
		session: createSession(sessionConfig(), catalog, {
			id: 'save-me',
			now: fixedClock,
		}),
		catalog,
		now: fixedClock,
	})
	playGame(adapter)
	session = adapter.session
})

const fixedClock = (): Date => new Date('2026-09-21T10:00:00.000Z')

describe('InMemoryStorage', () => {
	it('get/set/del/keys round-trip and JSON-boundary clones values', async () => {
		const storage = new InMemoryStorage()
		expect(await storage.keys()).toEqual([])
		await storage.set('k', { a: [1, 2, { b: true }] })
		expect(await storage.keys()).toEqual(['k'])
		expect(await storage.get('k')).toEqual({ a: [1, 2, { b: true }] })
		await storage.del('k')
		expect(await storage.get('k')).toBeUndefined()
	})

	it('rejects cyclic values at the storage boundary (real serialisability check)', async () => {
		const storage = new InMemoryStorage()
		const cyclic: Record<string, unknown> = { a: 1 }
		cyclic.self = cyclic
		await expect(storage.set('cycle', cyclic)).rejects.toThrow()
	})
})

describe('versioned keys', () => {
	it('scopes saves under the versioned prefix', () => {
		expect(sessionKey('abc')).toBe(`${SESSION_KEY_PREFIX}:abc`)
		expect(SESSION_KEY_PREFIX).toBe('ready-room:session:v1')
	})
})

describe('todo/17 DoD — save -> load -> replay equals the original', () => {
	it('byte-identical replay after a storage round-trip', async () => {
		const storage = new InMemoryStorage()
		await saveSession(storage, session)
		const loaded = await loadSession(storage, session.id)
		expect(loaded).not.toBeNull()
		expect(loaded!.log).toEqual(session.log)
		expect(loaded!.setup).toEqual(session.setup)
		expect(loaded!.id).toBe(session.id)
		expect(JSON.stringify(loaded!.meta)).toBe(JSON.stringify(session.meta))
		expect(JSON.stringify(replay(loaded!, catalog))).toBe(
			JSON.stringify(replay(session, catalog)),
		)
	})

	it('replaying the loaded session byte-matches the live played state', async () => {
		const storage = new InMemoryStorage()
		await saveSession(storage, session)
		const loaded = (await loadSession(storage, session.id))!
		expect(JSON.stringify(adapterStateFrom(session))).toBe(
			JSON.stringify(replay(loaded, catalog)),
		)
	})

	it('a session saved mid-turn, mid-PendingChoice reloads to the same suspended state', async () => {
		// Drives START + PLAY_CARD 1PIC23 -> the game is suspended on a CHOOSE_CARDS
		// with a live effect stack — the todo/17 "survive a refresh mid-turn"
		// scenario. Save the truncated session, reload, and check the exact
		// suspended state is restored byte-for-byte.
		const adapter = new Adapter({
			session: createSession(sessionConfig(), catalog, {
				id: 'mid-take',
				now: fixedClock,
			}),
			catalog,
			now: fixedClock,
		})
		adapter.dispatch({ t: 'START' })
		const pic23 = adapter.state.zones['HAND:0']!.find(
			(iid) => adapter.state.cards[iid]!.def === '1PIC23-24',
		)!
		adapter.dispatch({ t: 'PLAY_CARD', iid: pic23, operationIndex: 0 })
		const suspended = JSON.stringify(adapter.state)
		expect(adapter.pendingChoice).not.toBeNull()

		const storage = new InMemoryStorage()
		await saveSession(storage, adapter.session)
		const loaded = (await loadSession(storage, adapter.session.id))!
		const restored = replay(loaded, catalog)
		expect(JSON.stringify(restored)).toBe(suspended)
		expect(restored.pendingChoice).not.toBeNull()
		expect(restored.stack.length).toBeGreaterThan(0)
	})

	it('listSessions returns browsable saves newest-first without replaying', async () => {
		const storage = new InMemoryStorage()
		const s2 = createSession(sessionConfig(), catalog, {
			id: 'second',
			now: () => new Date('2026-09-22T10:00:00.000Z'),
		})
		await saveSession(storage, session) // updatedAt 21st
		await saveSession(storage, s2) // updatedAt 22nd -> newest first
		const saved = await listSessions(storage)
		expect(saved.map((s) => s.id)).toEqual(['second', 'save-me'])
		expect(saved[0]!.meta.turnNumber).toBe(1)
		expect(saved[0]!.meta.deckNames).toEqual(s2.meta.deckNames)
	})

	it('deleteSession removes only that save', async () => {
		const storage = new InMemoryStorage()
		const s2 = createSession(sessionConfig(), catalog, { id: 'other' })
		await saveSession(storage, session)
		await saveSession(storage, s2)
		await deleteSession(storage, session.id)
		expect(await listSessions(storage)).toHaveLength(1)
		expect((await listSessions(storage))[0]!.id).toBe('other')
	})
})

describe('the save is the Session, not the GameState', () => {
	it('the stored payload is tiny and carries no card/instance/state structures', () => {
		const state = replay(session, catalog)
		const saveJson = JSON.stringify(session)
		const stateJson = JSON.stringify(state)
		expect(saveJson.length).toBeLessThan(stateJson.length / 5)
		for (const needle of [
			'"def"',
			'"zone"',
			'"stack"',
			'"exhausted"',
			'"rng"',
			'"cards"',
			'"HAND:"',
		]) {
			expect(saveJson, `save must not contain ${needle}`).not.toContain(needle)
		}
	})

	it('the saved log contains only intents (seed + setup + log is the whole game)', () => {
		expect(session.log.every((i) => i.t !== undefined)).toBe(true)
		expect(session.log.length).toBeGreaterThan(20)
		expect(session.setup.seed).toBe(25)
	})
})

describe('JSON export / import (bug-report format)', () => {
	it('export -> import is an exact round-trip', () => {
		const imported = importSession(exportSession(session))
		expect(JSON.stringify(imported)).toBe(JSON.stringify(session))
		expect(JSON.stringify(replay(imported, catalog))).toBe(
			JSON.stringify(replay(session, catalog)),
		)
	})

	it('rejects garbage and unsupported versions with a readable error', () => {
		expect(() => importSession('not json')).toThrow(/not valid JSON/)
		expect(() =>
			importSession(JSON.stringify({ ...session, version: 1 })),
		).toThrow(/version 1/)
		expect(() => importSession(JSON.stringify({ hello: 'world' }))).toThrow(
			/unsupported or malformed/,
		)
	})

	it('parseSession treats unknown/absent keys as null, not an error', async () => {
		const storage = new InMemoryStorage()
		// v1 saves predate card ids (decks named by captain) — not loadable
		await storage.set(sessionKey('v1-save'), { ...session, version: 1 })
		expect(await loadSession(storage, 'v1-save')).toBeNull()
		expect(await loadSession(storage, 'missing')).toBeNull()
	})
})

describe('IndexedDB adapter', () => {
	it('is lazy: constructing it never touches indexedDB', () => {
		const storage = createIdbStorage()
		expect(storage).toBeDefined()
	})

	it('throws a descriptive error without indexedDB (headless)', async () => {
		const storage = createIdbStorage()
		await expect(storage.get('x')).rejects.toThrow(/IndexedDB is not available/)
	})
})

describe('SessionStore convenience wrapper', () => {
	it('save/load/list via one object', async () => {
		const store = new SessionStore(new InMemoryStorage())
		await store.save(session)
		expect((await store.load(session.id))!.id).toBe(session.id)
		expect(await store.list()).toHaveLength(1)
		await store.remove(session.id)
		expect(await store.list()).toHaveLength(0)
	})
})

function adapterStateFrom(session: Session): GameState {
	return new Adapter({ session, catalog }).state
}
