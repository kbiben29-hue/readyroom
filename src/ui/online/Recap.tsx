// "Previously on…" — the opponent's turn(s) since your last own turn
// (docs/ui-mobile.md §5), from GET /games/:id/recap. Four deltas on top answer
// "what changed?" before any row is read; then one row per intent: the card
// and its operation in Shorthand, or the choice that was answered, with the
// engine's log lines as notes. Anything that hit you — an attack, a decision
// your standing order or a deadline made for you — is outlined in your colour.
//
// Hidden cards arrive as `hidden` (history masking, src/engine/seatView.ts),
// so a note can never name a card you could not see.

import type { CardDef } from '../../data/schema'
import type { Recap, RecapEntry, Seat } from '../../session/online'
import { ShorthandOp } from '../shorthand'
import { SUIT_SVG } from '../shorthandGlyphs'
import './online.css'
import { cardName, withCardNames } from '../../data/cardNames'

export interface RecapViewProps {
	recap: Recap
	/** the captains' names, by seat */
	names: [string, string]
	defs: ReadonlyMap<string, CardDef>
	/** instance id → def id for cards the viewer can see (the view's cards) */
	defOfIid: (iid: string) => string | null
	onContinue: () => void
	continueLabel?: string | undefined
}

/** A card instance id, or the `hidden` stand-in history masking leaves. */
const IID_TOKEN = /[A-Za-z][A-Za-z0-9]*#\d+|\bhidden\b/g

/** A log line with card ids replaced by names (hidden ones by "a hidden card"). */
export function humanize(
	message: string,
	defOfIid: (iid: string) => string | null,
	defs: ReadonlyMap<string, CardDef>,
): string {
	return withCardNames(message).replace(IID_TOKEN, (token) => {
		if (token.startsWith('hidden')) return 'a hidden card'
		const def = defOfIid(token)
		const name = def === null ? null : (cardName(defs.get(def)) ?? null)
		return name ?? 'a card'
	})
}

function SuitMark({ def }: { def: CardDef | null }) {
	const suit = def?.suit ?? 'ANY'
	return (
		<i className={`ol-suit sh-suit-${suit.toLowerCase()}`} aria-hidden="true">
			<svg
				viewBox="0 0 24 24"
				dangerouslySetInnerHTML={{ __html: SUIT_SVG[suit] }}
			/>
		</i>
	)
}

function phaseWord(entry: RecapEntry): string | null {
	switch (entry.intent.t) {
		case 'START':
			return 'The game begins'
		case 'PASS':
			return 'Next step'
		case 'END_TURN':
			return 'Ends the Action step'
		default:
			return null
	}
}

function EntryRow({
	entry,
	viewer,
	names,
	defs,
	defOfIid,
}: {
	entry: RecapEntry
	viewer: Seat
	names: [string, string]
	defs: ReadonlyMap<string, CardDef>
	defOfIid: (iid: string) => string | null
}) {
	const phase = phaseWord(entry)
	if (phase !== null)
		return (
			<div className="ol-ev ol-ev-phase">
				<span>{phase}</span>
			</div>
		)
	const intent = entry.intent
	const def = entry.card !== null ? (defs.get(entry.card.def) ?? null) : null
	const opIndex =
		intent.t === 'PLAY_CARD' || intent.t === 'ACTIVATE'
			? intent.operationIndex
			: null
	const op =
		def !== null && opIndex !== null ? (def.operations[opIndex] ?? null) : null
	const attackedYou = entry.events.some(
		(e) => e.k === 'ATTACKED' && e.victim === viewer,
	)
	const notes = entry.log
		.filter((l) => l.kind !== 'SKIPPED' && l.kind !== 'CHOICE')
		.slice(0, 3)
		.map((l) => humanize(l.message, defOfIid, defs))
	const who = entry.yours ? 'You' : names[entry.seat]
	const verb =
		intent.t === 'PLAY_CARD'
			? 'played'
			: intent.t === 'ACTIVATE'
				? 'activated'
				: intent.t === 'COMPLETE_MISSION'
					? 'completed a mission'
					: intent.t === 'RESOLVE_CHOICE'
						? 'chose'
						: ''
	const sourceDef =
		entry.choice?.sourceDef !== null && entry.choice?.sourceDef !== undefined
			? (defs.get(entry.choice.sourceDef) ?? null)
			: null
	return (
		<div
			className={`ol-ev${entry.yours || attackedYou ? ' ol-ev-you' : ''}`}
			data-seq={entry.seq}
		>
			<div className="ol-ev-head">
				<span className="ol-ev-who">{who}</span>
				<span className="ol-ev-verb">{verb}</span>
				{def !== null && (
					<span className="ol-ev-card">
						<SuitMark def={def} />
						{cardName(def)}
					</span>
				)}
				{def === null && sourceDef !== null && (
					<span className="ol-ev-card">
						<SuitMark def={sourceDef} />
						{sourceDef.name}
					</span>
				)}
				{entry.by === 'order' && (
					<span className="ol-badge">standing order</span>
				)}
				{entry.by === 'timeout' && (
					<span className="ol-badge ol-badge-late">deadline passed</span>
				)}
			</div>
			{op !== null && <ShorthandOp op={op} size="md" />}
			{entry.choice !== null && intent.t === 'RESOLVE_CHOICE' && (
				<p className="ol-ev-note">{withCardNames(entry.choice.prompt)}</p>
			)}
			{attackedYou && <p className="ol-ev-hit">This attacked you.</p>}
			{notes.map((n, i) => (
				<p key={i} className="ol-ev-note">
					{n}
				</p>
			))}
		</div>
	)
}

export function RecapView(props: RecapViewProps) {
	const { recap, names } = props
	const me = recap.seat
	const them: Seat = me === 0 ? 1 : 0
	const { before, after } = recap
	const delta = (a: number, b: number) => (a === b ? `${b}` : `${a} → ${b}`)
	const turns = new Map<number, RecapEntry[]>()
	for (const e of recap.entries) {
		const list = turns.get(e.turn) ?? []
		list.push(e)
		turns.set(e.turn, list)
	}
	return (
		<div className="ol-screen">
			<header className="ol-top">
				<h1 className="ol-title">Previously on…</h1>
				<p className="ol-sub">
					{recap.entries.length === 0
						? 'Nothing has happened since your last turn.'
						: `${recap.entries.length} move${recap.entries.length === 1 ? '' : 's'} since your last turn`}
				</p>
			</header>
			<div className="ol-deltas">
				<div>
					<b className="ol-them">{delta(before.vp[them], after.vp[them])}</b>
					{names[them]} VP
				</div>
				<div>
					<b className="ol-you">{delta(before.vp[me], after.vp[me])}</b>
					your VP
				</div>
				<div>
					<b>{delta(before.stardateGlory, after.stardateGlory)}</b>
					Glory on the Stardate
				</div>
				<div>
					<b>{delta(before.incidentDeck, after.incidentDeck)}</b>
					Incidents left
				</div>
			</div>
			{[...turns.entries()].map(([turn, entries]) => (
				<section key={turn} className="ol-section" aria-label={`Turn ${turn}`}>
					<h2 className="ol-sec-h">
						Turn {turn} ·{' '}
						{entries[0]!.activeSeat === me
							? 'your turn'
							: `${names[entries[0]!.activeSeat]}'s turn`}
					</h2>
					{entries.map((e) => (
						<EntryRow
							key={e.seq}
							entry={e}
							viewer={me}
							names={names}
							defs={props.defs}
							defOfIid={props.defOfIid}
						/>
					))}
				</section>
			))}
			<div className="ol-actions">
				<button
					type="button"
					className="ol-pill ol-primary"
					onClick={props.onContinue}
				>
					{props.continueLabel ?? 'Take the chair'}
				</button>
			</div>
		</div>
	)
}
