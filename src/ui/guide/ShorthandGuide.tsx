// The Shorthand guide (docs/shorthand.md): how to read the glyph lines, in the
// app. Four parts:
//   - Learn: a translator cycling real cards (glyph line over its English) and
//     the grammar, each rule on a real card's compiled line;
//   - Lexicon: every glyph with its word;
//   - Cards: the whole catalogue as tiles, any card open in its Rosetta view;
//   - Practice: a line and three English sentences — pick the one it says.
// Everything is compiled from the card data at runtime, so it teaches exactly
// what the board shows. Opens from the console strip, the phone menu, the
// setup screen, Hails and every card's detail.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cardName } from '../../data/cardNames'
import type { CardDef } from '../../data/schema'
import type { DeckId } from '../../data/ids'
import { shorthandOperation, type ShorthandLine } from '../../engine/shorthand'
import { deckName } from '../../session/log'
import { useCatalog } from '../store'
import { ShorthandLineView } from '../shorthand'
import { TIMING_WORD } from '../shorthandGlyphs'
import { CardTile } from '../tile/CardTile'
import { SuitGl } from '../tile/glyph'
import {
	GRAMMAR,
	LEXICON,
	englishOf,
	makeQuestion,
	quizPool,
	resolveRef,
	type QuizQuestion,
} from './glossary'
import { EnglishText, GlyphLegend, LexItem } from './legend'
import { ReferenceTabs } from '../ReferenceTabs'
import './guide.css'

export type GuideSection = 'learn' | 'lexicon' | 'cards' | 'practice'

const SECTIONS: { id: GuideSection; label: string }[] = [
	{ id: 'learn', label: 'Learn' },
	{ id: 'lexicon', label: 'Lexicon' },
	{ id: 'cards', label: 'Cards' },
	{ id: 'practice', label: 'Practice' },
]

const reducedMotion = (): boolean =>
	typeof window !== 'undefined' &&
	typeof window.matchMedia === 'function' &&
	window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ---------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------

function CardName({ def }: { def: CardDef }) {
	return (
		<span className="sg-card-name">
			<SuitGl suit={def.suit} />
			{cardName(def)}
		</span>
	)
}

function lineOf(op: CardDef['operations'][number]): ShorthandLine | null {
	try {
		return shorthandOperation(op)
	} catch {
		return null
	}
}

// ---------------------------------------------------------------------------
// Learn: translator + grammar
// ---------------------------------------------------------------------------

function Translator({ defs }: { defs: readonly CardDef[] }) {
	const examples = useMemo(
		() =>
			GRAMMAR.flatMap((r) => (r.example === 'timing' ? [] : [r.example]))
				.map((ref) => resolveRef(defs, ref))
				.filter((x) => x !== null)
				.map((x) => ({ ...x, line: lineOf(x.op), english: englishOf(x.op) }))
				.filter((x) => x.line !== null && x.english !== null),
		[defs],
	)
	const [i, setI] = useState(0)
	const [auto, setAuto] = useState(() => !reducedMotion())
	useEffect(() => {
		if (!auto || examples.length < 2) return
		const t = window.setInterval(
			() => setI((n) => (n + 1) % examples.length),
			6000,
		)
		return () => window.clearInterval(t)
	}, [auto, examples.length])
	const ex = examples[i % Math.max(1, examples.length)]
	if (ex === undefined || ex.line === null || ex.english === null) return null
	const step = (d: number) => {
		setAuto(false)
		setI((n) => (n + d + examples.length) % examples.length)
	}
	return (
		<section className="sg-translator" aria-label="Translator">
			<div className="sg-tr-who">
				<CardName def={ex.def} /> · {TIMING_WORD[ex.line.timing]}
			</div>
			<div className="sg-tr-line" key={`l${i}`}>
				<ShorthandLineView line={ex.line} label={ex.english} size="lg" />
			</div>
			<p className="sg-tr-en" key={`e${i}`}>
				<EnglishText text={ex.english} />
			</p>
			<div className="sg-tr-ctrl">
				<span className="sg-dots" aria-hidden="true">
					{examples.map((_, n) => (
						<i key={n} className={n === i ? 'on' : ''} />
					))}
				</span>
				<button
					type="button"
					className="sg-pill"
					onClick={() => step(-1)}
					aria-label="Previous example"
				>
					‹
				</button>
				<button
					type="button"
					className="sg-pill"
					onClick={() => step(1)}
					aria-label="Next example"
				>
					›
				</button>
			</div>
		</section>
	)
}

function Learn({ defs }: { defs: readonly CardDef[] }) {
	return (
		<>
			<p className="sg-lead">
				Every card operation is written as one line of glyphs: when it happens,
				what it costs, what you get. The lines are generated from the rules the
				game plays by, so a line never says something the card doesn’t do. Tap
				or hover a glyph for its word; open any card for its lines with the
				English underneath.
			</p>
			<Translator defs={defs} />
			<h2 className="sg-h2">The grammar</h2>
			<ol className="sg-rules">
				{GRAMMAR.map((rule) => {
					const ex =
						rule.example === 'timing' ? null : resolveRef(defs, rule.example)
					const line = ex === null ? null : lineOf(ex.op)
					const english = ex === null ? null : englishOf(ex.op)
					return (
						<li key={rule.title} className="sg-rule">
							<h3>{rule.title}</h3>
							<p>{rule.text}</p>
							{rule.example === 'timing' ? (
								<ul className="sg-timings">
									{LEXICON[0]!.entries.map((e, n) => (
										<LexItem key={n} entry={e} />
									))}
								</ul>
							) : ex !== null && line !== null ? (
								<div className="sg-example">
									<ShorthandLineView
										line={line}
										label={english ?? undefined}
										size="md"
									/>
									{english !== null && (
										<p className="sg-example-en">
											<EnglishText text={english} />
										</p>
									)}
									<span className="sg-example-card">
										<CardName def={ex.def} />
									</span>
								</div>
							) : null}
						</li>
					)
				})}
			</ol>
		</>
	)
}

// ---------------------------------------------------------------------------
// Lexicon
// ---------------------------------------------------------------------------

function Lexicon() {
	return (
		<div className="sg-lexicon">
			{LEXICON.map((group) => (
				<section
					key={group.title}
					className="sg-lex-group"
					aria-label={group.title}
				>
					<h2 className="sg-h3">{group.title}</h2>
					<ul>
						{group.entries.map((e, n) => (
							<LexItem key={n} entry={e} />
						))}
					</ul>
				</section>
			))}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Cards: the catalogue, Rosetta on tap
// ---------------------------------------------------------------------------

function Rosetta({ def, onClose }: { def: CardDef; onClose: () => void }) {
	const ops = def.operations
		.map((op) => ({ op, line: lineOf(op), english: englishOf(op) }))
		.filter((x) => x.line !== null)
	const lines = ops.map((x) => x.line!)
	const ref = useRef<HTMLElement>(null)
	useEffect(() => {
		ref.current?.scrollIntoView?.({ block: 'nearest' })
		ref.current?.focus()
	}, [def])
	return (
		<section
			className="sg-rosetta"
			aria-label={`${cardName(def)}, Rosetta view`}
			ref={ref}
			tabIndex={-1}
		>
			<div className="sg-rosetta-head">
				<CardName def={def} />
				{def.vp !== 0 && <span className="sg-vp">{def.vp} VP</span>}
				<button type="button" className="sg-pill" onClick={onClose}>
					Close
				</button>
			</div>
			{ops.length === 0 && <p className="sg-muted">No operations.</p>}
			{ops.map((x, n) => (
				<div key={n} className="sg-rosetta-op">
					<div className="sg-rosetta-lbl">{TIMING_WORD[x.line!.timing]}</div>
					<ShorthandLineView
						line={x.line!}
						label={x.english ?? undefined}
						size="lg"
					/>
					{x.english !== null && (
						<p className="sg-example-en">
							<EnglishText text={x.english} />
						</p>
					)}
				</div>
			))}
			<GlyphLegend lines={lines} />
		</section>
	)
}

function Cards({ defs }: { defs: readonly CardDef[] }) {
	const catalog = useCatalog()
	const decks = useMemo(() => {
		const set = new Set<DeckId>()
		for (const d of defs) if (d.deck !== undefined) set.add(d.deck)
		const crew = [...set].filter((d) => d !== 'COMMON').sort()
		return set.has('COMMON') ? [...crew, 'COMMON' as DeckId] : crew
	}, [defs])
	const [deck, setDeck] = useState<DeckId | null>(decks[0] ?? null)
	const [query, setQuery] = useState('')
	const [open, setOpen] = useState<CardDef | null>(null)
	const q = query.trim().toUpperCase()
	const shown = defs.filter((d) =>
		q !== ''
			? cardName(d).toUpperCase().includes(q) ||
				d.traits.some((t) => t.includes(q)) ||
				d.suit.includes(q)
			: d.deck === deck,
	)
	const label = (d: DeckId) =>
		d === 'COMMON' ? 'Common' : catalog !== null ? deckName(catalog, d) : d
	return (
		<>
			<div className="sg-bar">
				<div className="sg-seg" role="group" aria-label="Deck">
					{decks.map((d) => (
						<button
							key={d}
							type="button"
							aria-pressed={q === '' && deck === d}
							onClick={() => {
								setDeck(d)
								setQuery('')
							}}
						>
							{label(d)}
						</button>
					))}
				</div>
				<input
					id="sg-search"
					className="sg-input"
					type="search"
					placeholder="Search a card, trait or suit"
					aria-label="Search cards"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
				<span className="sg-muted">
					{shown.length} card{shown.length === 1 ? '' : 's'}
				</span>
			</div>
			{open !== null && <Rosetta def={open} onClose={() => setOpen(null)} />}
			<div className="sg-grid">
				{shown.map((d) => (
					<CardTile
						key={d.id}
						def={d}
						show="all"
						onOpen={() => setOpen(d)}
						className={open?.id === d.id ? 'is-picked' : ''}
					/>
				))}
			</div>
		</>
	)
}

// ---------------------------------------------------------------------------
// Practice
// ---------------------------------------------------------------------------

function Practice({ defs }: { defs: readonly CardDef[] }) {
	const pool = useMemo(() => quizPool(defs), [defs])
	const [q, setQ] = useState<QuizQuestion | null>(() =>
		makeQuestion(pool, Math.random),
	)
	const [answer, setAnswer] = useState<string | null>(null)
	const [score, setScore] = useState({ right: 0, asked: 0, streak: 0 })
	if (q === null)
		return <p className="sg-muted">Not enough cards to practise with.</p>
	const next = () => {
		setAnswer(null)
		setQ(makeQuestion(pool, Math.random))
	}
	const pick = (option: string) => {
		if (answer !== null) return
		setAnswer(option)
		const right = option === q.item.english
		setScore((s) => ({
			right: s.right + (right ? 1 : 0),
			asked: s.asked + 1,
			streak: right ? s.streak + 1 : 0,
		}))
	}
	const right = answer !== null && answer === q.item.english
	return (
		<section className="sg-practice" aria-label="Practice">
			<p className="sg-lead">
				Read the line, then pick the sentence it says. The two wrong answers
				happen at the same time as the right one, so the timing mark alone won’t
				give it away.
			</p>
			<div className="sg-score" role="status">
				{score.asked === 0
					? 'No answers yet'
					: `${score.right} of ${score.asked} right · streak ${score.streak}`}
			</div>
			<div className="sg-quiz-line">
				<ShorthandLineView
					line={q.item.line}
					label="Which sentence is this?"
					size="lg"
				/>
			</div>
			<div className="sg-options" role="group" aria-label="Answers">
				{q.options.map((o) => {
					const state =
						answer === null
							? ''
							: o === q.item.english
								? ' is-right'
								: o === answer
									? ' is-wrong'
									: ' is-out'
					return (
						<button
							key={o}
							type="button"
							className={`sg-option${state}`}
							onClick={() => pick(o)}
							disabled={answer !== null}
						>
							<EnglishText text={o} />
						</button>
					)
				})}
			</div>
			{answer !== null && (
				<div
					className={`sg-feedback${right ? ' is-right' : ' is-wrong'}`}
					role="alert"
				>
					<p className="sg-feedback-text">
						<b>{right ? 'Right.' : 'Not quite.'}</b> That line is{' '}
						<CardName def={q.item.def} /> (
						{TIMING_WORD[q.item.line.timing].toLowerCase()}).
					</p>
					<GlyphLegend lines={[q.item.line]} title="Glyphs in this line" />
					<button
						type="button"
						className="sg-pill sg-primary"
						onClick={next}
						autoFocus
					>
						Next line ›
					</button>
				</div>
			)}
		</section>
	)
}

// ---------------------------------------------------------------------------
// the guide
// ---------------------------------------------------------------------------

export function ShorthandGuide({
	section,
	onSection,
	onClose,
}: {
	section: GuideSection
	onSection: (s: GuideSection) => void
	onClose: () => void
}) {
	const catalog = useCatalog()
	const defs = useMemo(() => catalog?.defs ?? [], [catalog])
	const panel = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose])
	useEffect(() => {
		panel.current?.scrollTo?.({ top: 0 })
	}, [section])
	let body: ReactNode
	switch (section) {
		case 'learn':
			body = <Learn defs={defs} />
			break
		case 'lexicon':
			body = <Lexicon />
			break
		case 'cards':
			body = <Cards defs={defs} />
			break
		case 'practice':
			body = <Practice defs={defs} />
			break
	}
	return (
		<div
			className="sg-overlay"
			role="dialog"
			aria-modal="true"
			aria-label="Shorthand guide"
			ref={panel}
		>
			<div className="sg">
				<header className="sg-head">
					<ReferenceTabs current="shorthand" />
					<button type="button" className="sg-pill" onClick={onClose}>
						Close
					</button>
				</header>
				<nav className="sg-tabs" aria-label="Guide sections">
					{SECTIONS.map((s) => (
						<button
							key={s.id}
							type="button"
							aria-current={section === s.id ? 'page' : undefined}
							onClick={() => onSection(s.id)}
						>
							{s.label}
						</button>
					))}
				</nav>
				{catalog === null ? <p className="sg-muted">Loading cards…</p> : body}
			</div>
		</div>
	)
}
