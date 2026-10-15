// tools/lint_trees.ts — structural lint over effect trees vs. records (todo/11
// §4). Mechanical checks that need no card understanding; each maps a record
// text heuristic to a tree requirement:
//
//   " to " (cost/benefit join)        → PAY_THEN present (not a bare SEQ)
//   "may"                             → MAY node present
//   "either" / " OR "                 → CHOOSE_ONE present
//   {ACTION} / costsAction            → impl.costsAction matches
//   {REQ_*} / requires                → impl.requires matches specialty+min
//   text starts ATTACK / isAttack     → impl.isAttack matches
//   "Log this card"                   → LOG target:'THIS' as the last step
//   a number N in the text            → some Amount literal == N in the tree
//   every {ICON}                      → a corresponding node param exists
//   REACTION operation                → impl.trigger present
//
// A violation is a transcription error worth a human look. Reports zero
// violations on implemented cards today (only scratch demos exist; the real
// corpus lands with todo/12/13). Exit code is non-zero iff violations exist,
// but unlike the schema gate this is advisory.
//
//   tsx tools/lint_trees.ts                          # src/data/cards (empty today)
//   tsx tools/lint_trees.ts --implemented <dir>      # demo over scratch cards

import type { Effect, Operation } from '../src/engine/resolver/nodes'
import type { CardDef } from '../src/data/schema'

import {
	DEFAULT_IMPLEMENTED_DIR,
	DEFAULT_RECORDS_DIR,
	defMatchesRecord,
	loadImplemented,
	loadRecords,
	numbersInText,
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
} {
	const implementedDirs: string[] = []
	let recordsDir = DEFAULT_RECORDS_DIR
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (a === '--implemented') implementedDirs.push(argv[++i] ?? '')
		else if (a === '--records') recordsDir = argv[++i] ?? DEFAULT_RECORDS_DIR
		else throw new Error(`unknown argument ${a}`)
	}
	return { recordsDir, implementedDirs }
}

// ---------------------------------------------------------------------------
// Tree walking
// ---------------------------------------------------------------------------

/** All effect nodes in the tree, including nested children. */
function flattenTree(node: Effect): Effect[] {
	const out: Effect[] = [node]
	const push = (e: Effect): void => {
		out.push(...flattenTree(e))
	}
	switch (node.k) {
		case 'SEQ':
			for (const s of node.steps) push(s)
			break
		case 'MAY':
		case 'OPPONENT':
		case 'FORCE':
			push(node.body)
			break
		case 'CHOOSE_ONE':
			for (const o of node.options) push(o.body)
			break
		case 'PAY_THEN':
			push(node.cost)
			push(node.body)
			break
		case 'IF':
			push(node.then)
			if (node.else !== undefined) push(node.else)
			break
		case 'REPEAT':
		case 'FOR_EACH':
		case 'LET':
			push(node.body)
			break
		default:
			break
	}
	return out
}

const hasKind = (tree: Effect[], k: Effect['k']): boolean =>
	tree.some((n) => n.k === k)

/** The last primitive in execution order (the outermost final step). */
function lastPrimitive(node: Effect): Effect {
	switch (node.k) {
		case 'SEQ': {
			const last = node.steps[node.steps.length - 1]
			return last === undefined ? node : lastPrimitive(last)
		}
		case 'MAY':
		case 'OPPONENT':
		case 'FORCE':
		case 'REPEAT':
			return lastPrimitive(node.body)
		case 'PAY_THEN':
			return lastPrimitive(node.body)
		case 'IF':
			return lastPrimitive(node.else ?? node.then)
		case 'CHOOSE_ONE': {
			const last = node.options[node.options.length - 1]
			return last === undefined ? node : lastPrimitive(last.body)
		}
		case 'FOR_EACH':
		case 'LET':
			return lastPrimitive(node.body)
		default:
			return node
	}
}

/** Every integer Amount literal anywhere in the tree. */
function amountLiterals(node: Effect, out: number[] = []): number[] {
	const collect = (a: unknown): void => {
		if (typeof a === 'number') out.push(a)
	}
	switch (node.k) {
		case 'PAY_THEN':
			amountLiterals(node.cost, out)
			amountLiterals(node.body, out)
			break
		case 'SEQ':
			for (const s of node.steps) amountLiterals(s, out)
			break
		case 'MAY':
		case 'OPPONENT':
		case 'FORCE':
			amountLiterals(node.body, out)
			break
		case 'CHOOSE_ONE':
			for (const o of node.options) amountLiterals(o.body, out)
			break
		case 'IF':
			amountLiterals(node.then, out)
			if (node.else !== undefined) amountLiterals(node.else, out)
			break
		case 'REPEAT':
		case 'FOR_EACH':
		case 'LET':
			amountLiterals(node.body, out)
			break
		case 'COST_RESOURCE':
		case 'GAIN_RESOURCE':
		case 'SPEND_RESOURCE':
		case 'STEAL':
		case 'GAIN_ACTION':
		case 'ADVANCE_SPECIALTY':
		case 'RECRYSTALLIZE':
		case 'PLACE_RESOURCE_ON_MARKET':
		case 'SCAN_N':
		case 'SEND_AWAY_TEAM':
		case 'REFRESH':
		case 'SCORE_VP':
		case 'DRAW':
			collect((node as { amount?: unknown }).amount)
			if (node.k === 'DRAW') collect((node as { count?: unknown }).count)
			break
		case 'COST_DISCARD':
		case 'COST_PUT':
		case 'COST_TAKE_INCIDENT':
		case 'COST_REMOVE_AWAY_TEAM':
		case 'COST_DISMISS':
		case 'DISCARD':
		case 'DRAW_FROM_DISCARD':
		case 'TAKE':
		case 'REMOVE_AWAY_TEAM':
		case 'BEAM':
			collect((node as { count?: unknown }).count)
			break
		default:
			break
	}
	return out
}

/** Does some node param hold this resource/suit/… token? */
function treeContains(node: Effect, needle: string): boolean {
	const flat = flattenTree(node)
	return JSON.stringify(flat).toUpperCase().includes(needle.toUpperCase())
}

// ---------------------------------------------------------------------------
// Rules (todo/11 §4)
// ---------------------------------------------------------------------------

export interface LintViolation {
	rule: string
	message: string
}

const BENEFIT_VERBS =
	/ to (gain|beam|warp|send|take|draw|scan|play|log|junk|dismiss|discard|put|promote|deploy|destroy|recall|refresh|exhaust|free|return|enlist|find|place|steal|recrystallize)\b/i

function lintOperation(
	recordOp: CardRecord['operations'][number],
	impl: Operation,
): LintViolation[] {
	const v: LintViolation[] = []
	const text = recordOp.text ?? ''
	const tree = flattenTree(impl.effect)

	// 1. " to " joining a cost and a benefit expects PAY_THEN, not a bare SEQ
	if (
		BENEFIT_VERBS.test(text) &&
		!/^(attack|force)/i.test(text.trim()) &&
		!hasKind(tree, 'PAY_THEN')
	) {
		v.push({
			rule: 'to→PAY_THEN',
			message: `record joins clauses with " to " but the tree has no PAY_THEN (has a bare ${impl.effect.k})`,
		})
	}

	// 2. "may" ⇒ MAY
	if (/\bmay\b/i.test(text) && !hasKind(tree, 'MAY')) {
		v.push({
			rule: 'may→MAY',
			message: 'record says "may" but the tree has no MAY node',
		})
	}

	// 3. "either" / " OR " ⇒ CHOOSE_ONE
	if (/\beither\b/i.test(text) || /\b OR \b/i.test(text)) {
		if (!hasKind(tree, 'CHOOSE_ONE')) {
			v.push({
				rule: 'either→CHOOSE_ONE',
				message:
					'record offers a choice ("either"/"OR") but the tree has no CHOOSE_ONE',
			})
		}
	}

	// 4. {ACTION} / costsAction flag must be preserved
	if (recordOp.costsAction !== impl.costsAction) {
		v.push({
			rule: '{ACTION}',
			message: `record costsAction=${recordOp.costsAction} but tree costsAction=${impl.costsAction}`,
		})
	}

	// 5. isAttack must be preserved
	if (recordOp.isAttack !== impl.isAttack) {
		v.push({
			rule: 'ATTACK',
			message: `record isAttack=${recordOp.isAttack} but tree isAttack=${impl.isAttack}`,
		})
	}

	// 6. {REQ_*} ⇒ operation.requires matches
	if (recordOp.requires !== null && recordOp.requires !== undefined) {
		const rec = recordOp.requires
		const imp = impl.requires
		if (imp === undefined || imp.specialty !== rec.specialty) {
			v.push({
				rule: '{REQ_*}→requires',
				message: `record requires ${rec.specialty} but tree requires=${imp?.specialty ?? 'none'}`,
			})
		} else if (rec.min !== null && imp.min !== rec.min) {
			v.push({
				rule: '{REQ_*}→requires',
				message: `record requires ${rec.specialty} ${rec.min}+ but tree requires min=${imp.min}`,
			})
		}
	}

	// 7. record starts ATTACK ⇒ isAttack
	if (/^\s*\[?attack/i.test(text) && !impl.isAttack) {
		v.push({
			rule: 'starts-ATTACK',
			message: 'record text starts ATTACK but tree isAttack=false',
		})
	}

	// 8. "Log this card" ⇒ LOG target:'THIS' as the LAST step
	if (/\blog this card\b/i.test(text)) {
		const last = lastPrimitive(impl.effect)
		const ok = last.k === 'LOG' && last.target === 'THIS'
		if (!ok) {
			v.push({
				rule: 'log-this-last',
				message:
					'record says "Log this card" but LOG target THIS is not the last step',
			})
		}
	}

	// 9. every number N in the record appears as an Amount literal
	const numbers = numbersInText(text).filter((n) => n >= 1)
	if (
		recordOp.requires !== null &&
		recordOp.requires !== undefined &&
		recordOp.requires.min !== null
	) {
		const idx = numbers.indexOf(recordOp.requires.min)
		if (idx >= 0) numbers.splice(idx, 1) // covered by rule 6 (requires.min)
	}
	const literals = amountLiterals(impl.effect)
	for (const n of [...new Set(numbers)]) {
		if (!literals.includes(n)) {
			v.push({
				rule: 'number→Amount',
				message: `record mentions ${n} but no Amount literal equals ${n} (amounts: ${[...new Set(literals)].join(', ') || 'none'})`,
			})
		}
	}

	// 10. every {ICON} maps to a node param / flag
	const icons = [...significantTokens(recordOp.text ?? '')].filter((tok) =>
		tok.includes('{'),
	)
	for (const icon of icons) {
		if (!iconMapped(icon, impl)) {
			v.push({
				rule: 'icon',
				message: `record icon ${icon} has no matching node param`,
			})
		}
	}

	// 11. REACTION operation ⇒ trigger present
	if (recordOp.type === 'REACTION' && impl.trigger === undefined) {
		v.push({
			rule: 'REACTION→trigger',
			message: 'record is a REACTION but the tree has no trigger',
		})
	}

	return v
}

/** Map an {ICON} token to a tree/flag presence. */
function iconMapped(icon: string, impl: Operation): boolean {
	const upper = icon.toUpperCase()
	if (upper === '{DIL}' || upper === '{LAT}' || upper === '{GLO}') {
		const res = upper.slice(1, -1)
		return treeContains(impl.effect, `"res":"${res}"`)
	}
	if (upper.startsWith('{SUIT:')) {
		const suit = upper.slice(6, -1)
		return (
			treeContains(impl.effect, `"suits":[`) &&
			treeContains(impl.effect, `"${suit}"`)
		)
	}
	if (upper.startsWith('{REQ_')) {
		const spec = upper.slice(5, -1)
		return impl.requires?.specialty === spec
	}
	if (upper === '{ACTION}') {
		return (
			impl.costsAction ||
			treeContains(impl.effect, 'COST_ACTION') ||
			treeContains(impl.effect, 'GAIN_ACTION')
		)
	}
	if (upper === '{VP}') {
		return (
			treeContains(impl.effect, 'SCORE_VP') ||
			treeContains(impl.effect, '"minVp"')
		)
	}
	if (upper === '{AWAY_TEAM}') {
		return (
			treeContains(impl.effect, 'SEND_AWAY_TEAM') ||
			treeContains(impl.effect, 'REMOVE_AWAY_TEAM') ||
			treeContains(impl.effect, 'COST_REMOVE_AWAY_TEAM')
		)
	}
	return true // unknown icon — cannot judge
}

// ---------------------------------------------------------------------------
// Card-level lint
// ---------------------------------------------------------------------------

export interface CardLint {
	cardId: string
	name: string
	file: string
	violations: LintViolation[]
}

export function lintCard(
	def: CardDef,
	file: string,
	record: CardRecord,
): CardLint {
	const violations: LintViolation[] = []
	def.operations.forEach((impl, i) => {
		const rec = record.operations[i]
		if (rec === undefined) return
		violations.push(
			...lintOperation(rec, impl).map((vv) => ({
				...vv,
				message: `op[${i}] ${rec.type}: ${vv.message}`,
			})),
		)
	})
	return { cardId: record.cardId, name: record.name, file, violations }
}

export async function runLint(
	records: CardRecord[],
	implemented: ImplementedCard[],
): Promise<CardLint[]> {
	const out: CardLint[] = []
	for (const { def, file } of implemented) {
		const record = records.find((r) => defMatchesRecord(def, r))
		if (record === undefined) continue
		out.push(lintCard(def, file, record))
	}
	return out.sort(
		(a, b) =>
			b.violations.length - a.violations.length ||
			a.cardId.localeCompare(b.cardId),
	)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const { recordsDir, implementedDirs } = parseArgs(process.argv.slice(2))
	const records = await loadRecords(recordsDir)
	const dirs = [DEFAULT_IMPLEMENTED_DIR, ...implementedDirs]
	const implemented: ImplementedCard[] = []
	for (const dir of dirs) implemented.push(...(await loadImplemented(dir)))

	const results = await runLint(records, implemented)
	let violations = 0
	for (const card of results) {
		if (card.violations.length === 0) continue
		violations += card.violations.length
		console.log(`${card.cardId} — ${card.name}`)
		for (const v of card.violations)
			console.log(`  LINT [${v.rule}] ${v.message}`)
	}
	const checked = results.filter((c) => c.violations.length > 0).length
	console.log(
		`LINT: ${results.length} implemented card(s) checked, ${checked} with violations (${violations} rule hits)`,
	)
	if (violations > 0) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) void main()
