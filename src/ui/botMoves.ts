// The house AI's recent moves, for the AI move ticker, the move history and
// the "Why?" panel (BotTicker.tsx). Pure data → data, no DOM, no React.
//
// A **BotMove** groups what one bot decision set off: its top-level intent
// (play / activate / complete a mission / end the turn …) plus the bot's own
// follow-up choice answers, until its next top-level decision or a human
// decision. Each intent becomes a **BotStep** carrying a short phrase of what
// was done, the engine LogEntries it produced (the log diff before/after) and
// the bot's DecisionInfo turned into a **DecisionView**: the options it
// weighed, already labelled and masked for the viewer.
//
// Phrases are plain strings that name cards with `[[card:<def id>]]` tokens
// and resources with `{DIL}` / `{LAT}` / `{GLO}`; `OpText` / `phraseText`
// resolve the names from the fetched STCC data at render time, so nothing here
// (or in a test) spells a card name.
//
// **No-cheat masking.** In a game with a human, everything is recorded as the
// human (the viewer) could see it, decided with the engine's projection
// (`hiddenCards`):
//   - a card the viewer could not see before the decision is named only by
//     where it was ("a card from hand", "a face-down card"); an option the bot
//     did NOT choose stays masked;
//   - the chosen option, its step and its log notes are revealed only as far
//     as the move itself revealed them: a card the decision made visible (a
//     played card, a discarded one) is named, a card still hidden stays
//     masked.
// In a spectator game (both seats bots) nothing is masked.

import type { DecisionInfo } from '../bot/explain'
import type { BotId } from '../bot/types'
import type { CardInstanceId } from '../engine/ids'
import type { Intent } from '../engine/intents'
import { hiddenCards } from '../engine/projection'
import type { PendingChoice } from '../engine/resolver/choices'
import type { Seat } from '../engine/resolver/queries'
import { SKIP_CONTROL } from '../engine/phases'
import type {
	GameState,
	LogEntry,
	LogKind,
	OperationRef,
} from '../engine/state'
import { poolDiff } from '../engine/fx'
import { askingNode } from '../bot/heuristic'
import { cardToken, withCardNames } from '../data/cardNames'
import type { ResourceId } from '../data/ids'
import { RESOURCE_LABEL } from './format'

/** How many moves the history keeps. */
export const BOT_HISTORY_MAX = 20

/** One option of a decision as the viewer may see it. */
export interface OptionView {
	/** what the option does ("Play [[card:…]]", "Play a card from hand") */
	phrase: string
	/** expected VP margin (DecisionOption.score) */
	score: number
	/** search visit share, [0, 1] */
	share?: number | undefined
	chosen: boolean
	/** the phrase hides a card the viewer cannot see */
	masked: boolean
}

/** A bot's DecisionInfo, labelled and masked for the viewer. */
export interface DecisionView {
	botId: BotId
	kind: DecisionInfo['kind']
	/** the open choice's prompt (`[[card:…]]` tokens), for a choice answer */
	prompt?: string | undefined
	options: OptionView[]
	iterations?: number | undefined
	ms?: number | undefined
	note?: string | undefined
}

/** One intent of a move. */
export interface BotStep {
	intent: Intent
	/** what was done, past tense ("played [[card:…]]", "gained …") */
	phrase: string
	/** true when the step is worth a place in the ticker's headline */
	headline: boolean
	/** the choice prompt, for a RESOLVE_CHOICE */
	prompt?: string | undefined
	/** the LogEntries this intent produced, humanized (CHOICE entries left
	 *  out) */
	notes: { kind: LogKind; text: string }[]
	why: DecisionView | null
}

export interface BotMove {
	/** unique per store lifetime, increasing */
	id: number
	seat: Seat
	botId: BotId
	/** session log index of `intents[0]` */
	logFrom: number
	/** consecutive moves of one seat between human decisions share a burst */
	burst: number
	intents: Intent[]
	/** the bot's DecisionInfo per intent (null: none, e.g. a fake runner) */
	infos: (DecisionInfo | null)[]
	/** the top-level decision's DecisionInfo */
	info: DecisionInfo | null
	steps: BotStep[]
	/** the LogEntries the intents produced (raw engine entries) */
	logEntries: LogEntry[]
	/** cards the move involved that the viewer may see (highlight targets) */
	involvedIids: CardInstanceId[]
	/** net resource change per seat over the move */
	deltas: [
		Partial<Record<ResourceId, number>>,
		Partial<Record<ResourceId, number>>,
	]
	/** recorded for a human viewer (masked) rather than for a spectator */
	masked: boolean
	/** bumped on every appended intent (the highlight re-fires) */
	rev: number
}

export interface BotMoveLog {
	/** oldest first, at most BOT_HISTORY_MAX */
	moves: BotMove[]
	/** the move a bot choice answer extends, or null */
	openId: number | null
	burst: number
	/** the latest burst is still running (no human decision since) */
	live: boolean
	nextId: number
}

export function emptyBotLog(): BotMoveLog {
	return { moves: [], openId: null, burst: 0, live: false, nextId: 1 }
}

/** Who looks: the human seat, or null in a spectator game (no masking). */
export interface Viewer {
	seat: Seat | null
}

// ---------------------------------------------------------------------------
// phrases
// ---------------------------------------------------------------------------

/** Where a hidden card sits, in words. */
function hiddenWhere(state: GameState, iid: string): string {
	switch (state.cards[iid]?.zone.k) {
		case 'HAND':
			return 'a card from hand'
		case 'LOG':
			return "a card from the Captain's Log"
		default:
			return 'a face-down card'
	}
}

/** Names a card for the viewer: a `[[card:…]]` token, or where it was. */
interface Namer {
	name(iid: string): string
	/** did the last `name` calls mask anything? */
	masked: boolean
}

function namer(state: GameState, visible: (iid: string) => boolean): Namer {
	const n: Namer = {
		masked: false,
		name(iid) {
			const card = state.cards[iid]
			if (card === undefined) return 'a card'
			if (!visible(iid)) {
				n.masked = true
				return hiddenWhere(state, iid)
			}
			return cardToken(card.def)
		},
	}
	return n
}

function list(parts: string[]): string {
	if (parts.length <= 1) return parts[0] ?? ''
	return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function titleCase(s: string): string {
	return s
		.toLowerCase()
		.split('_')
		.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
		.join(' ')
}

/** The answer a selection gives to `choice`, as a short phrase. */
function answerPhrase(
	choice: PendingChoice,
	selection: unknown,
	n: Namer,
): string {
	switch (choice.k) {
		case 'CONFIRM':
			return selection === true ? 'Yes' : 'No'
		case 'CHOOSE_CARDS':
		case 'ORDER_CARDS': {
			const iids = Array.isArray(selection) ? (selection as string[]) : []
			return iids.length === 0 ? 'nothing' : list(iids.map((i) => n.name(i)))
		}
		case 'CHOOSE_LOCATION':
			return selection === SKIP_CONTROL ? 'Skip' : n.name(String(selection))
		case 'CHOOSE_DESTINATION':
			return selection === 'DECK_TOP'
				? 'the top of the deck'
				: 'the discard pile'
		case 'CHOOSE_AMOUNT':
			return String(selection)
		case 'CHOOSE_OPTION': {
			const key = (selection as { key?: string } | null)?.key
			return choice.options.find((o) => o.key === key)?.label ?? 'an option'
		}
		case 'CHOOSE_SUIT':
		case 'CHOOSE_TRAIT':
		case 'CHOOSE_SPECIALTY':
		case 'CHOOSE_WILDCARD_AS':
			return titleCase(String(selection))
		case 'OPTIONAL_TRIGGERS':
		case 'ORDER_OPERATIONS': {
			const refs = Array.isArray(selection) ? (selection as OperationRef[]) : []
			if (refs.length === 0) return 'none'
			return list(refs.map((r) => n.name(r.card)))
		}
		case 'CHOOSE_WITNESS': {
			const iids = Array.isArray(selection) ? (selection as string[]) : []
			return list(iids.map((i) => n.name(i)))
		}
	}
}

/** Past-tense verbs for the DSL nodes whose choice answers read well in the
 *  ticker's headline ("gained …", "sent an Away Team to …"). */
const NODE_VERB: Record<string, string> = {
	GAIN_CARD: 'gained',
	SCAN_N: 'took',
	SCAN_FOR_TRAIT: 'took',
	TAKE: 'took',
	FIND: 'found',
	SEND_AWAY_TEAM: 'sent an Away Team to',
	DISCARD: 'discarded',
	COST_DISCARD: 'discarded',
	DESTROY: 'destroyed',
	DISMISS: 'dismissed',
	BEAM: 'beamed',
	DEPLOY: 'deployed',
	RECALL: 'recalled',
	JUNK: 'junked',
	PROMOTE: 'promoted',
	EXHAUST: 'exhausted',
	REFRESH: 'refreshed',
	PLACE_RESOURCE_ON_MARKET: 'placed tokens on',
	ENLIST_RESERVE: 'enlisted',
	ENLIST_DEVELOPMENT: 'enlisted',
}

/** Imperative label of an option (the "Why?" list) — the same wording the
 *  replay step list uses (replay.tsx `describeIntent`). */
function optionPhrase(
	intent: Intent,
	choice: PendingChoice | null,
	n: Namer,
): string {
	switch (intent.t) {
		case 'START':
			return 'Start the game'
		case 'PASS':
			return 'Continue'
		case 'END_TURN':
			return 'End turn'
		case 'PLAY_CARD':
			return `Play ${n.name(intent.iid)}`
		case 'ACTIVATE':
			return `Activate ${n.name(intent.iid)}`
		case 'COMPLETE_MISSION':
			return `Complete mission ${intent.index + 1}`
		case 'RESOLVE_CHOICE':
			if (choice === null) return 'Answer'
			return capitalize(answerPhrase(choice, intent.selection, n))
	}
}

function capitalize(s: string): string {
	return s.startsWith('[[') ? s : s.charAt(0).toUpperCase() + s.slice(1)
}

/** Past-tense phrase of a step, and whether it belongs in the headline. */
function stepPhrase(
	intent: Intent,
	before: GameState,
	n: Namer,
): { phrase: string; headline: boolean } {
	switch (intent.t) {
		case 'START':
			return { phrase: 'started the game', headline: true }
		case 'PASS':
			return { phrase: 'continued', headline: true }
		case 'END_TURN':
			return { phrase: 'ended the turn', headline: true }
		case 'PLAY_CARD':
			return { phrase: `played ${n.name(intent.iid)}`, headline: true }
		case 'ACTIVATE':
			return { phrase: `activated ${n.name(intent.iid)}`, headline: true }
		case 'COMPLETE_MISSION':
			return {
				phrase: `completed mission ${intent.index + 1}`,
				headline: true,
			}
		case 'RESOLVE_CHOICE': {
			const choice = before.pendingChoice
			if (choice === null) return { phrase: 'answered', headline: false }
			const answer = answerPhrase(choice, intent.selection, n)
			if (
				before.phase.k === 'CONTROL' &&
				choice.k === 'CHOOSE_LOCATION' &&
				choice.candidates.includes(SKIP_CONTROL)
			)
				return intent.selection === SKIP_CONTROL
					? { phrase: 'skipped the Control step', headline: false }
					: { phrase: `took control of ${answer}`, headline: true }
			if (choice.k === 'CHOOSE_DESTINATION')
				return {
					phrase:
						intent.selection === 'DECK_TOP'
							? 'put it on top of the deck'
							: 'put it into the discard pile',
					headline: false,
				}
			const picksCards =
				choice.k === 'CHOOSE_CARDS' || choice.k === 'CHOOSE_LOCATION'
			const verb = picksCards ? NODE_VERB[askingNode(before) ?? ''] : undefined
			const empty = answer === 'nothing' || answer === 'none' || answer === 'No'
			if (verb !== undefined && !empty)
				return { phrase: `${verb} ${answer}`, headline: true }
			return { phrase: `chose ${answer}`, headline: false }
		}
	}
}

/** A log message with card ids replaced: `[[card:…]]` for a card the viewer
 *  may see, its whereabouts otherwise (as Recap.tsx `humanize` does). */
const IID_TOKEN = /[A-Za-z][A-Za-z0-9]*#\d+/g

function humanizeLog(message: string, n: Namer): string {
	return message.replace(IID_TOKEN, (iid) => n.name(iid))
}

function iidsIn(message: string): string[] {
	return message.match(IID_TOKEN) ?? []
}

// ---------------------------------------------------------------------------
// recording
// ---------------------------------------------------------------------------

/** The decision's options as the viewer may see them. */
export function decisionView(
	info: DecisionInfo,
	before: GameState,
	after: GameState,
	viewer: Viewer,
): DecisionView {
	const hiddenBefore =
		viewer.seat === null ? null : hiddenCards(before, viewer.seat)
	const hiddenAfter =
		viewer.seat === null ? null : hiddenCards(after, viewer.seat)
	const choice = before.pendingChoice
	const options = info.options.map((o) => {
		const visible = (iid: string) =>
			hiddenBefore === null ||
			!hiddenBefore.has(iid as CardInstanceId) ||
			(o.chosen && !hiddenAfter!.has(iid as CardInstanceId))
		const n = namer(before, visible)
		const phrase = optionPhrase(o.intent, choice, n)
		return {
			phrase,
			score: o.score,
			...(o.share !== undefined ? { share: o.share } : {}),
			chosen: o.chosen,
			masked: n.masked,
		}
	})
	return {
		botId: info.botId,
		kind: info.kind,
		...(choice !== null ? { prompt: choice.prompt } : {}),
		options,
		...(info.iterations !== undefined ? { iterations: info.iterations } : {}),
		...(info.ms !== undefined ? { ms: info.ms } : {}),
		...(info.note !== undefined ? { note: info.note } : {}),
	}
}

/** One committed bot intent: `before` is the state it was decided in,
 *  `after` the state it led to. */
export interface BotIntentRecord {
	seat: Seat
	botId: BotId
	intent: Intent
	info: DecisionInfo | null
	before: GameState
	after: GameState
	/** session log index of the intent */
	logIndex: number
}

/** The display data of one bot intent. */
export function botStep(
	rec: BotIntentRecord,
	viewer: Viewer,
): {
	step: BotStep
	logEntries: LogEntry[]
	involved: CardInstanceId[]
	deltas: BotMove['deltas']
} {
	const { intent, before, after } = rec
	const hiddenBefore =
		viewer.seat === null ? null : hiddenCards(before, viewer.seat)
	const hiddenAfter =
		viewer.seat === null ? null : hiddenCards(after, viewer.seat)
	// the move reveals what it made visible
	const revealed = (iid: string) =>
		hiddenAfter === null ||
		!hiddenAfter.has(iid as CardInstanceId) ||
		!hiddenBefore!.has(iid as CardInstanceId)
	const shownAfter = (iid: string) =>
		hiddenAfter === null || !hiddenAfter.has(iid as CardInstanceId)
	const n = namer(before, revealed)
	const { phrase, headline } = stepPhrase(intent, before, n)
	const logEntries = after.log.slice(before.log.length)
	const logNamer = namer(after, shownAfter)
	const notes = logEntries
		.filter((e) => e.kind !== 'CHOICE')
		.map((e) => ({ kind: e.kind, text: humanizeLog(e.message, logNamer) }))

	// the cards worth a highlight: the card played / activated, the card or
	// Location a choice picked, and any card a log entry names — if the
	// viewer can see it now
	const involved: string[] = []
	if (intent.t === 'PLAY_CARD' || intent.t === 'ACTIVATE')
		involved.push(intent.iid)
	if (intent.t === 'RESOLVE_CHOICE' && before.pendingChoice !== null) {
		const choice = before.pendingChoice
		const sel = intent.selection
		if (choice.k === 'CHOOSE_LOCATION' && typeof sel === 'string')
			involved.push(sel)
		if (choice.k === 'CHOOSE_CARDS' && Array.isArray(sel))
			involved.push(...(sel as string[]))
	}
	for (const e of logEntries) {
		if (e.kind !== 'EVENT' && e.kind !== 'BENEFIT') continue
		if (e.iid !== undefined) involved.push(e.iid)
		involved.push(...iidsIn(e.message))
	}
	const seen = new Set<string>()
	const involvedIids = involved.filter((iid) => {
		if (seen.has(iid) || iid === SKIP_CONTROL) return false
		seen.add(iid)
		return after.cards[iid] !== undefined && shownAfter(iid)
	}) as CardInstanceId[]

	const deltas: BotMove['deltas'] = [{}, {}]
	for (const c of poolDiff(before, after)) {
		if (c.pool.k !== 'PLAYER' || c.pool.res === 'ACTION') continue
		const d = deltas[c.pool.seat]
		d[c.pool.res] = (d[c.pool.res] ?? 0) + c.delta
	}

	const why =
		rec.info === null ? null : decisionView(rec.info, before, after, viewer)
	const step: BotStep = {
		intent,
		phrase,
		headline,
		...(intent.t === 'RESOLVE_CHOICE' && before.pendingChoice !== null
			? { prompt: before.pendingChoice.prompt }
			: {}),
		notes,
		why,
	}
	return { step, logEntries, involved: involvedIids, deltas }
}

/** A PASS / START that logged nothing: not worth a ticker line. */
function quiet(rec: BotIntentRecord): boolean {
	return (
		(rec.intent.t === 'PASS' || rec.intent.t === 'START') &&
		rec.after.log.length === rec.before.log.length
	)
}

function addDeltas(
	into: BotMove['deltas'],
	from: BotMove['deltas'],
): BotMove['deltas'] {
	const out: BotMove['deltas'] = [{ ...into[0] }, { ...into[1] }]
	for (const seat of [0, 1] as const)
		for (const [res, v] of Object.entries(from[seat]) as [ResourceId, number][])
			out[seat][res] = (out[seat][res] ?? 0) + v
	return out
}

/**
 * Record one committed bot intent. A top-level intent (anything but a
 * RESOLVE_CHOICE) closes the open move and starts a new one — except a quiet
 * PASS / START, which only closes it. A choice answer extends the open move
 * of the same seat, or starts a move of its own.
 */
export function addBotIntent(
	log: BotMoveLog,
	rec: BotIntentRecord,
	viewer: Viewer,
): BotMoveLog {
	const open =
		log.openId === null ? undefined : log.moves.find((m) => m.id === log.openId)
	const extend =
		rec.intent.t === 'RESOLVE_CHOICE' &&
		open !== undefined &&
		open.seat === rec.seat
	if (!extend && rec.intent.t !== 'RESOLVE_CHOICE' && quiet(rec))
		return { ...log, openId: null }
	const { step, logEntries, involved, deltas } = botStep(rec, viewer)
	if (extend) {
		const moved: BotMove = {
			...open,
			intents: [...open.intents, rec.intent],
			infos: [...open.infos, rec.info],
			steps: [...open.steps, step],
			logEntries: [...open.logEntries, ...logEntries],
			involvedIids: [
				...open.involvedIids,
				...involved.filter((i) => !open.involvedIids.includes(i)),
			],
			deltas: addDeltas(open.deltas, deltas),
			rev: open.rev + 1,
		}
		return {
			...log,
			moves: log.moves.map((m) => (m.id === open.id ? moved : m)),
		}
	}
	const last = log.moves[log.moves.length - 1]
	const sameBurst = log.live && last !== undefined && last.seat === rec.seat
	const burst = sameBurst ? log.burst : log.burst + 1
	const move: BotMove = {
		id: log.nextId,
		seat: rec.seat,
		botId: rec.botId,
		logFrom: rec.logIndex,
		burst,
		intents: [rec.intent],
		infos: [rec.info],
		info: rec.info,
		steps: [step],
		logEntries,
		involvedIids: involved,
		deltas,
		masked: viewer.seat !== null,
		rev: 0,
	}
	return {
		moves: [...log.moves, move].slice(-BOT_HISTORY_MAX),
		openId: move.id,
		burst,
		live: true,
		nextId: log.nextId + 1,
	}
}

/** A human decided: the open move and the running burst end. */
export function humanDecided(log: BotMoveLog): BotMoveLog {
	if (log.openId === null && !log.live) return log
	return { ...log, openId: null, live: false }
}

/** Undo truncated the session log to `length` intents: drop what was taken
 *  back (a move's tail too). */
export function trimBotLog(log: BotMoveLog, length: number): BotMoveLog {
	const moves: BotMove[] = []
	for (const m of log.moves) {
		if (m.logFrom >= length) continue
		const keep = Math.min(m.intents.length, length - m.logFrom)
		moves.push(
			keep === m.intents.length
				? m
				: {
						...m,
						intents: m.intents.slice(0, keep),
						infos: m.infos.slice(0, keep),
						steps: m.steps.slice(0, keep),
					},
		)
	}
	return { ...log, moves, openId: null, live: false }
}

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

/** "+2 {DIL}, −1 {LAT}" (empty when nothing changed). */
export function deltaPhrase(d: Partial<Record<ResourceId, number>>): string {
	return (['DIL', 'LAT', 'GLO'] as const)
		.filter((r) => (d[r] ?? 0) !== 0)
		.map((r) => `${d[r]! > 0 ? '+' : '−'}${Math.abs(d[r]!)} {${r}}`)
		.join(', ')
}

/** The ticker's sentence after the bot's name: the first step, then " → "
 *  and what came of it (the headline-worthy follow-ups, the resource
 *  changes, the logged events). `opponentName` names the other seat. */
export function moveHeadline(move: BotMove, opponentName: string): string {
	const [first, ...rest] = move.steps
	if (first === undefined) return ''
	const effects: string[] = []
	for (const s of rest) if (s.headline) effects.push(s.phrase)
	const own = deltaPhrase(move.deltas[move.seat])
	if (own !== '') effects.push(own)
	const other = deltaPhrase(move.deltas[move.seat === 0 ? 1 : 0])
	if (other !== '') effects.push(`${opponentName} ${other}`)
	for (const s of move.steps)
		for (const n of s.notes) if (n.kind === 'EVENT') effects.push(n.text)
	const shown = effects.slice(0, 4)
	return (
		first.phrase +
		(shown.length > 0 ? ` → ${shown.join(' · ')}` : '') +
		(effects.length > shown.length ? ' · …' : '')
	)
}

/** A phrase as plain text (screen readers, titles): card names from the STCC
 *  data, resource tokens as words. */
export function phraseText(phrase: string): string {
	return withCardNames(phrase).replace(
		/\{(DIL|LAT|GLO)\}/g,
		(_, r: ResourceId) => RESOURCE_LABEL[r],
	)
}
