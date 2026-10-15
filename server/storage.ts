// File-backed session store for the Ready Room backend (server/README.md).
// One pretty-printed JSON file per session in a data directory — the whole
// store is inspectable, greppable and diffable by hand, which is exactly the
// "access its JSON and debug" property the backend exists to provide.
//
// Kept deliberately dependency-free (node built-ins only) so the backend stays
// "little" and runnable with tsx, no install step.

import {
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'

export const SESSION_FILE_EXT = '.json'

export interface StoredSession {
	id: string
	[key: string]: unknown
}

export function sessionFileName(id: string): string {
	return `${id}${SESSION_FILE_EXT}`
}

export class FileSessionStorage {
	constructor(public readonly dataDir: string) {}

	private path(id: string): string {
		return join(this.dataDir, sessionFileName(id))
	}

	private sessionIdFromName(name: string): string {
		return name.slice(0, -SESSION_FILE_EXT.length)
	}

	private async ensureDir(): Promise<void> {
		await mkdir(this.dataDir, { recursive: true })
	}

	/** Atomically upsert a session (write temp file, rename over) so a crash
	 *  mid-save never leaves a truncated session on disk. */
	async save(session: StoredSession): Promise<void> {
		await this.ensureDir()
		const file = this.path(session.id)
		const tmp = `${file}.tmp`
		await writeFile(tmp, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
		await rename(tmp, file)
	}

	async get(id: string): Promise<StoredSession | null> {
		try {
			const raw = await readFile(this.path(id), 'utf8')
			return JSON.parse(raw) as StoredSession
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
			throw err
		}
	}

	async remove(id: string): Promise<boolean> {
		try {
			await rm(this.path(id), { force: true })
			return true
		} catch {
			return false
		}
	}

	/** Every stored session, newest first (by `meta.updatedAt` when present,
	 *  falling back to file-name order so foreign/older payloads still show). */
	async list(): Promise<StoredSession[]> {
		await this.ensureDir()
		const entries = await readdir(this.dataDir, { withFileTypes: true })
		const out: StoredSession[] = []
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(SESSION_FILE_EXT)) continue
			if (entry.name.endsWith('.tmp')) continue
			const session = await this.get(this.sessionIdFromName(entry.name))
			if (session !== null) out.push(session)
		}
		const updatedAt = (s: StoredSession): string =>
			typeof s.meta === 'object' &&
			s.meta !== null &&
			typeof (s.meta as { updatedAt?: unknown }).updatedAt === 'string'
				? (s.meta as { updatedAt: string }).updatedAt
				: ''
		return out.sort((a, b) => updatedAt(b).localeCompare(updatedAt(a)))
	}
}
