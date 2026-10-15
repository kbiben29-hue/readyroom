// tools/check_fidelity.ts — token-level fidelity review queue (todo/11 §3).
//
// For every implemented card (its CardDef JSON with effect trees — today only
// the scratch demos; src/data/cards/** lands with todo/12/13):
//   1. render describeOperation(effect) for each operation;
//   2. normalise both it and the record text (lowercase + strip punctuation);
//   3. compute token-level recall of the RECORD's significant tokens (numbers,
//      {ICON} tokens, suit/trait names, keyword verbs) in the description.
//
// Cards whose tree drops a significant token land in a ranked review queue,
// sorted worst-first, written to cards/fidelity-queue.md and printed to stdout.
// Missing tokens caused by intentional paraphrase are flagged *informational*,
// not fatal — this is a review queue, not a gate (exit code always 0).
//
//   tsx tools/check_fidelity.ts                       # records + src/data/cards
//   tsx tools/check_fidelity.ts --implemented <dir>   # extra implemented dir
//   tsx tools/check_fidelity.ts --records <dir>       # alternate records dir
//   tsx tools/check_fidelity.ts --stdout-only         # don't rewrite the queue file

import { writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

import { describeOperation } from '../src/engine/describe'
import type { Operation } from '../src/engine/resolver/nodes'
import type { CardDef } from '../src/data/schema'

import {
	DEFAULT_IMPLEMENTED_DIR,
	DEFAULT_RECORDS_DIR,
	compoundRecordText,
	defMatchesRecord,
	loadImplemented,
	loadRecords,
	significantTokens,
	type CardRecord,
	type ImplementedCard,
} from './lib/corpus'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
	recordsDir: string
	implementedDirs: string[]
	stdoutOnly: boolean
} {
	const implementedDirs: string[] = []
	let recordsDir = DEFAULT_RECORDS_DIR
	let stdoutOnly = false
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (a === '--implemented') {
			implementedDirs.push(argv[++i] ?? '')
		} else if (a === '--records') {
			recordsDir = argv[++i] ?? DEFAULT_RECORDS_DIR
		} else if (a === '--stdout-only') {
			stdoutOnly = true
		} else {
			throw new Error(`unknown argument ${a}`)
		}
	}
	return { recordsDir, implementedDirs, stdoutOnly }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface OpFidelity {
	opIndex: number
	type: string
	recordText: string
	description: string
	recall: number // 0..1 over the record's significant tokens
	missing: string[]
	/** tokens that MUST match or the tree is wrong: numbers, {ICON}s, suit/
	 *  trait/specialty names. A paraphrase cannot explain losing one. */
	missingHard: string[]
	/** paraphrase-able misses: keyword verbs / free-play-style rewording. */
	missingSoft: string[]
}

export interface CardFidelity {
	cardId: string
	name: string
	file: string
	score: number // worst op recall
	totalMissing: string[]
	ops: OpFidelity[]
	severity: 'info' | 'review'
}

function normalizeText(text: string): string {
	return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function describeOp(impl: Operation): string {
	return normalizeText(describeOperation(impl))
}

function rateOperation(
	recordOp: CardRecord['operations'][number],
	impl: Operation,
	opIndex: number,
): OpFidelity {
	const recordText = normalizeText(compoundRecordText(recordOp))
	const description = describeOp(impl)
	const want = [...significantTokens(recordText)]
	const have = [...significantTokens(description)]
	const missing = want.filter((tok) => !have.includes(tok))
	const isHard = (tok: string): boolean =>
		/^\d+$/.test(tok) || tok.includes('{') || /^[A-Z]{3,}$/.test(tok)
	const missingHard = missing.filter(isHard)
	const missingSoft = missing.filter((tok) => !isHard(tok))
	const recall = want.length === 0 ? 1 : 1 - missing.length / want.length
	return {
		opIndex,
		type: recordOp.type,
		recordText,
		description,
		recall,
		missing,
		missingHard,
		missingSoft,
	}
}

/** Rate one implemented card against its record. Returns null when the def has
 *  no matching record (skip silently — not every def is a transcribed card). */
export function rateCard(
	def: CardDef,
	file: string,
	record: CardRecord,
): CardFidelity {
	const ops: OpFidelity[] = []
	def.operations.forEach((impl, i) => {
		const rec = record.operations[i]
		if (rec === undefined) return
		ops.push(rateOperation(rec, impl, i))
	})
	const totalMissing = [...new Set(ops.flatMap((o) => o.missing))]
	const score = ops.length === 0 ? 1 : Math.min(...ops.map((o) => o.recall))
	const hardMiss = ops.some((o) => o.missingHard.length > 0)
	const severity: 'info' | 'review' =
		score === 1 ? 'info' : hardMiss ? 'review' : 'info'
	return {
		cardId: record.cardId,
		name: record.name,
		file,
		score,
		totalMissing,
		ops,
		severity,
	}
}

export async function runFidelity(
	records: CardRecord[],
	implemented: ImplementedCard[],
): Promise<CardFidelity[]> {
	const byId = new Map<string, CardRecord>()
	for (const r of records) byId.set(r.cardId, r)

	const rated: CardFidelity[] = []
	for (const { def, file } of implemented) {
		// find the record: by exact cardId, else by normalised match
		let record: CardRecord | undefined
		for (const r of records) {
			if (defMatchesRecord(def, r)) {
				record = r
				break
			}
		}
		if (record === undefined) continue // no record => nothing to diff against
		rated.push(rateCard(def, file, record))
	}

	// ranked worst-first: lower recall, then more missing tokens, then id
	rated.sort((a, b) => {
		if (a.score !== b.score) return a.score - b.score
		if (a.totalMissing.length !== b.totalMissing.length)
			return b.totalMissing.length - a.totalMissing.length
		return a.cardId.localeCompare(b.cardId)
	})
	return rated
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function formatQueue(
	rated: CardFidelity[],
	recordsDir: string,
	implementedDirs: string[],
): string {
	const lines: string[] = []
	lines.push('# Fidelity review queue — ranked worst-first')
	lines.push('')
	lines.push(
		`> Generated by \`tsx tools/check_fidelity.ts\` (todo/11 §3). Records: \`${relative(process.cwd(), recordsDir)}\`. ` +
			`Implemented: ${implementedDirs.map((d) => `\`${relative(process.cwd(), d)}\``).join(', ') || '(none)'}.`,
	)
	const flagged = rated.filter((c) => c.score < 1)
	lines.push(
		`> ${rated.length} implemented card(s) checked, ${flagged.length} with a dropped token.`,
	)
	lines.push('')
	if (flagged.length === 0) {
		lines.push(
			'_Queue empty — every significant token of every implemented card round-trips._',
		)
		return lines.join('\n')
	}
	for (const card of rated) {
		const mark = card.severity === 'info' ? 'informational' : 'REVIEW'
		lines.push(
			`${card.cardId} — ${card.name}  _(score ${card.score.toFixed(2)}, ${mark})_`,
		)
		const rel = relative(process.cwd(), card.file)
		for (const op of card.ops) {
			const ok =
				op.missing.length === 0 ? '✓' : `✗ missing: ${op.missing.join(', ')}`
			lines.push(
				`- op[${op.opIndex}] ${op.type} recall ${op.recall.toFixed(2)} — ${ok}`,
			)
			if (op.missing.length > 0) {
				if (op.missingHard.length > 0)
					lines.push(
						`  - hard-miss (cannot be paraphrase): ${op.missingHard.join(', ')}`,
					)
				lines.push(`  - record: ${op.recordText}`)
				lines.push(`  - render: ${op.description}`)
			}
		}
		lines.push(`- ${rel}`)
		lines.push('')
	}
	return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const { recordsDir, implementedDirs, stdoutOnly } = parseArgs(
		process.argv.slice(2),
	)
	const records = await loadRecords(recordsDir)
	const dirs = [DEFAULT_IMPLEMENTED_DIR, ...implementedDirs]
	const implemented: ImplementedCard[] = []
	for (const dir of dirs) implemented.push(...(await loadImplemented(dir)))

	const rated = await runFidelity(records, implemented)
	const output = formatQueue(rated, recordsDir, dirs)

	if (!stdoutOnly) {
		const outPath = resolve(process.cwd(), 'cards', 'fidelity-queue.md')
		await writeFile(outPath, `${output}\n`)
		console.log(
			`FIDELITY: ${rated.length} implemented card(s) checked; queue written to cards/fidelity-queue.md`,
		)
		console.log('')
	}
	console.log(output)
}

// allow `import { runFidelity } from './check_fidelity'` in tests without running
if (import.meta.url === `file://${process.argv[1]}`) void main()
