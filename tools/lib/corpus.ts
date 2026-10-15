// Shared reading/tokenizing helpers for the todo/11 verification CLIs
// (tools/check_fidelity.ts, tools/lint_trees.ts, tools/dryrun.ts).
//
// The card RECORDS (cards/records/core/*.json) are the ground-truth text; the
// IMPLEMENTED card trees are CardDef JSON (src/data/cards/** today; the scratch
// demos under tools/scratch/ live there too). Records are OCR-derived and carry
// extra fields (provenance…) — parse leniently. Implemented defs are validated
// with the real schema where possible.

import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { CardDef } from '../../src/data/schema'
import { CardArraySchema } from '../../src/data/schema'
import { SPECIALTIES, SUITS, TRAITS } from '../../src/data/ids'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
export const DEFAULT_RECORDS_DIR = join(repoRoot, 'cards', 'records', 'core')
export const DEFAULT_IMPLEMENTED_DIR = join(repoRoot, 'src', 'data', 'cards')
export const SCRATCH_DIR = join(repoRoot, 'tools', 'scratch')

// ---------------------------------------------------------------------------
// Record JSON (loose typed — records carry provenance/OCR extra fields)
// ---------------------------------------------------------------------------

export interface RecordRequires {
	specialty: string
	min: number | null
}

export interface RecordOperation {
	type: string
	costsAction: boolean
	isAttack: boolean
	requires: RecordRequires | null
	trigger: { on: string } | null
	text: string
}

export interface CardRecord {
	cardId: string
	name: string
	deck: string
	suit: string
	operations: RecordOperation[]
}

export async function findJsonFiles(dir: string): Promise<string[]> {
	const found: string[] = []
	const walk = async (d: string): Promise<void> => {
		let entries
		try {
			entries = await readdir(d, { withFileTypes: true })
		} catch {
			return
		}
		for (const entry of entries) {
			const path = join(d, entry.name)
			if (entry.isDirectory()) await walk(path)
			else if (entry.isFile() && entry.name.endsWith('.json')) found.push(path)
		}
	}
	await walk(dir)
	return found.sort()
}

export async function loadRecords(
	dir = DEFAULT_RECORDS_DIR,
): Promise<CardRecord[]> {
	const files = await findJsonFiles(dir)
	const out: CardRecord[] = []
	for (const file of files) {
		try {
			const raw = JSON.parse(await readFile(file, 'utf8')) as CardRecord
			out.push(raw)
		} catch (err) {
			console.warn(
				`WARN  ${file}: unreadable record (${(err as Error).message})`,
			)
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// Implemented CardDef JSON
// ---------------------------------------------------------------------------

export interface ImplementedCard {
	def: CardDef
	file: string
}

/** Parse a file that is either a CardDef array or a single CardDef. Errors are
 *  reported as warnings and the card skipped — this is a review tool, not a
 *  gate; the schema validator (validate-cards) is the gate. */
export async function loadImplemented(dir: string): Promise<ImplementedCard[]> {
	const files = await findJsonFiles(dir)
	const out: ImplementedCard[] = []
	for (const file of files) {
		let raw: unknown
		try {
			raw = JSON.parse(await readFile(file, 'utf8'))
		} catch (err) {
			console.warn(`WARN  ${file}: unreadable JSON (${(err as Error).message})`)
			continue
		}
		if (raw === null || typeof raw !== 'object') continue
		const arr = Array.isArray(raw) ? raw : [raw]
		const parsed = CardArraySchema.safeParse(arr)
		if (!parsed.success) {
			console.warn(
				`WARN  ${file}: does not match CardDef[] — skipped for tree checks (${parsed.error.issues.length} issue(s))`,
			)
			continue
		}
		for (const def of parsed.data) out.push({ def, file })
	}
	return out
}

// ---------------------------------------------------------------------------
// Matching / normalisation
// ---------------------------------------------------------------------------

/** "1PIC24/24" and "1pic24-24" both normalise to "1PIC2424". */
export function normalizeId(id: string): string {
	return id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

/** Does an implemented def correspond to this record? Matches on cardId or id
 *  (id is the deck-unique slug, cardId is the corpus id — both supported). */
export function defMatchesRecord(def: CardDef, record: CardRecord): boolean {
	const want = normalizeId(record.cardId)
	if (normalizeId(def.cardId ?? '') === want) return true
	return normalizeId(def.id) === want
}

// ---------------------------------------------------------------------------
// Significant-token vocabulary (todo/11 §3 — keep in sync with the vocab
// in src/engine/describe.test.ts)
// ---------------------------------------------------------------------------

const SUIT_SET = new Set<string>(SUITS)
const TRAIT_SET = new Set<string>(TRAITS)
const SPEC_SET = new Set<string>(SPECIALTIES)

export const KEYWORD_VERBS = [
	'beam',
	'deploy',
	'destroy',
	'discard',
	'dismiss',
	'draw',
	'recall',
	'log',
	'promote',
	'junk',
	'put',
	'gain',
	'scan',
	'take',
	'find',
	'return',
	'enlist',
	'send',
	'warp',
	'remove',
	'refresh',
	'exhaust',
	'duplicate',
	'recrystallize',
	'steal',
	'free',
	'play',
	'spend',
	'attack',
	'control',
	'place',
	'wipe',
	'advance',
	'force',
	'may',
]
const VERB_SET = new Set<string>(KEYWORD_VERBS)

/**
 * Significant tokens of a card text, per todo/11 §3: {ICON} tokens, numbers,
 * suit/trait/specialty names, and the rules/08 keyword verbs. Non-significant
 * filler ("the", "of", "you", "card"…) is ignored so paraphrase does not flood
 * the queue. Icon tokens are expanded to their vocabulary:
 *   {SUIT:CARGO} → CARGO · {REQ_MILITARY} → MILITARY · {ACTION} → action
 *   {AWAY_TEAM} → away, team · {VP} → VP · {DIL}/{LAT}/{GLO} → unchanged
 */
export function significantTokens(text: string): Set<string> {
	const out = new Set<string>()
	const t = text.toLowerCase()
	for (const m of t.match(/\{[^}]+\}/g) ?? []) {
		const u = m.toUpperCase()
		if (u === '{DIL}' || u === '{LAT}' || u === '{GLO}') out.add(u)
		else if (u.startsWith('{SUIT:')) out.add(u.slice(6, -1))
		else if (u.startsWith('{REQ_')) out.add(u.slice(5, -1))
		else if (u === '{VP}') out.add('VP')
		else if (u === '{ACTION}') out.add('action')
		else if (u === '{AWAY_TEAM}') {
			out.add('away')
			out.add('team')
		} else out.add(u)
	}
	const words = t
		.replace(/[^a-z0-9]/g, ' ')
		.split(/\s+/)
		.filter((w) => w !== '')
	for (const w of words) {
		const up = w.toUpperCase()
		if (/^\d+$/.test(w)) out.add(w)
		else if (w === 'vp') out.add('VP')
		else if (w === 'action') out.add('action')
		else if (SUIT_SET.has(up) || TRAIT_SET.has(up) || SPEC_SET.has(up))
			out.add(up)
		else if (VERB_SET.has(w)) out.add(w)
	}
	return out
}

/** Compound record text for an operation: derived prefixes ({ACTION}, ATTACK,
 *  Requires {REQ_X} N) plus the printed text — mirrors how ALL.md renders. */
export function compoundRecordText(op: RecordOperation): string {
	const parts: string[] = []
	if (op.costsAction) parts.push('{ACTION}')
	if (op.isAttack) parts.push('ATTACK')
	if (op.requires !== null && op.requires !== undefined) {
		parts.push(
			`Requires {REQ_${op.requires.specialty}} ${op.requires.min ?? ''}`,
		)
	}
	if (op.text !== undefined && op.text !== '') parts.push(op.text)
	return parts.join(' ')
}

/** Numbers mentioned in a record text (used by the structural lint). */
export function numbersInText(text: string): number[] {
	const out: number[] = []
	for (const m of text.match(/\d+/g) ?? []) {
		const n = Number(m)
		if (Number.isInteger(n)) out.push(n)
	}
	return out
}
