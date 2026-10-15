// File store for authoritative online games (server/README.md, docs/ui-mobile.md
// §7 "Server storage"). One pretty-printed JSON document per game in its own
// directory (never the /sessions directory, so the session debug routes can
// never serve it), written atomically (temp file + rename) like storage.ts.
//
// The document is split into a public part and a secret part:
//
//   game    — ids, seats, settings, version, status, the pending interrupt,
//             standing orders and the intent log (the source of truth, stored
//             with who/when/how each intent was decided)
//   secret  — the RNG seed and the SHA-256 hashes of the two seat tokens
//
// An invite that nobody has answered yet is an OpenGameDoc instead: only the
// host's captain is chosen, so there is no seed, no setup and no log — just
// the host, the settings and both token hashes. Answering the invite (POST
// /games/:id/join) replaces it, under the same id, with a full GameDoc.
//
// Neither part is ever served as-is: clients only receive seat views built by
// server/games.ts. Keeping the secret apart makes that boundary explicit and
// lets a debug dump print `game` without thinking.

import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Intent } from '../src/engine/intents'
import type { Seat } from '../src/engine/resolver/queries'
import type { SetupPlayer } from '../src/engine/setup'
import type {
	GameSettings,
	GameStatus,
	PendingDecision,
	SeatInfo,
	StandingOrders,
	SubmittedBy,
} from '../src/session/protocol'

export const GAME_DOC_SCHEMA = 1 as const

/** One entry of the append-only intent log. */
export interface LoggedIntent {
	/** 1-based position in the log */
	seq: number
	/** the seat whose decision this was */
	seat: Seat
	by: SubmittedBy
	/** ISO time it was applied */
	at: string
	/** turn number and active seat before it was applied */
	turn: number
	active: Seat
	/** this intent is an undo floor: it revealed something to the acting seat,
	 *  drew randomness, handed the turn over, raised an interrupt, or was not
	 *  the mover's own free decision — undo never removes it */
	floor: boolean
	intent: Intent
}

/** The stored interrupt: the wire PendingDecision plus the real source card
 *  (the view masks it per seat). */
export interface StoredPending extends PendingDecision {
	sourceCard: string | null
}

export interface PublicGame {
	id: string
	/** the seat that opens (an answered invite: the guest). Absent in games
	 *  created with both captains: the seed's draw decides (§2.1 #17). */
	startingSeat?: Seat | undefined
	createdAt: string
	updatedAt: string
	version: number
	status: GameStatus
	mode: 'TWO_PLAYER'
	/** SetupConfig minus the seed */
	setupPlayers: [SetupPlayer, SetupPlayer]
	players: [SeatInfo, SeatInfo]
	settings: GameSettings
	pending: StoredPending | null
	orders: [StandingOrders, StandingOrders]
	/** card-data hash the game was created against (drift detection) */
	cardDataHash: string
	log: LoggedIntent[]
}

export interface GameSecret {
	seed: number
	/** hex SHA-256 of each seat's token */
	tokenHashes: [string, string]
}

export interface GameDoc {
	schema: typeof GAME_DOC_SCHEMA
	game: PublicGame
	secret: GameSecret
}

/** An invite waiting for its guest (docs/ui-mobile.md §7): the host is
 *  seat 0; whoever answers takes seat 1 and opens the game. */
export interface OpenGame {
	id: string
	createdAt: string
	updatedAt: string
	status: 'OPEN'
	mode: 'TWO_PLAYER'
	host: SetupPlayer
	hostInfo: SeatInfo
	settings: GameSettings
}

export interface OpenGameDoc {
	schema: typeof GAME_DOC_SCHEMA
	open: OpenGame
	/** no seed yet — it is drawn when the guest answers */
	secret: Pick<GameSecret, 'tokenHashes'>
}

export type StoredGameDoc = GameDoc | OpenGameDoc

export const isOpenDoc = (doc: StoredGameDoc): doc is OpenGameDoc =>
	'open' in doc

export const docId = (doc: StoredGameDoc): string =>
	isOpenDoc(doc) ? doc.open.id : doc.game.id

/** Game ids are `game-<uuid>`; the same tight, URL- and path-safe set as
 *  session ids so an id can never escape the data directory. */
const GAME_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function validGameId(id: string): boolean {
	return GAME_ID_RE.test(id) && !id.includes('..') && !id.startsWith('.')
}

export class FileGameStore {
	constructor(public readonly dir: string) {}

	private path(id: string): string {
		if (!validGameId(id)) throw new Error(`invalid game id "${id}"`)
		return join(this.dir, `${id}.json`)
	}

	async save(doc: StoredGameDoc): Promise<void> {
		await mkdir(this.dir, { recursive: true })
		const file = this.path(docId(doc))
		const tmp = `${file}.tmp`
		await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
		await rename(tmp, file)
	}

	async get(id: string): Promise<StoredGameDoc | null> {
		if (!validGameId(id)) return null
		try {
			return JSON.parse(await readFile(this.path(id), 'utf8')) as StoredGameDoc
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
			throw err
		}
	}

	/** Every stored game id (for the deadline index at startup). */
	async ids(): Promise<string[]> {
		await mkdir(this.dir, { recursive: true })
		const entries = await readdir(this.dir, { withFileTypes: true })
		return entries
			.filter((e) => e.isFile() && e.name.endsWith('.json'))
			.map((e) => e.name.slice(0, -'.json'.length))
			.filter(validGameId)
			.sort()
	}
}
