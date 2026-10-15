// Small pieces of the Shorthand guide that card details reuse: the legend of
// the glyphs on a card, a lexicon item, and English with its resource tokens
// drawn as glyphs. Kept apart from the guide so a card detail doesn't pull in
// the whole guide (and the guide's tiles don't import back into cards.tsx).

import { useMemo } from 'react'
import type { ShorthandLine } from '../../engine/shorthand'
import { GlyphMark } from '../shorthand'
import { glyphsOfLines, type LexiconEntry } from './glossary'
import './guide.css'

const TOKEN = /(\{DIL\}|\{LAT\}|\{GLO\}|\{ACTION\}|\[ATTACK\])/

/** English with its {DIL} / {ACTION} tokens drawn as the same glyphs. */
export function EnglishText({ text }: { text: string }) {
	const parts = text.split(TOKEN)
	return (
		<>
			{parts.map((p, i) => {
				switch (p) {
					case '{DIL}':
						return <GlyphMark key={i} mark={{ k: 'glyph', g: 'DIL' }} />
					case '{LAT}':
						return <GlyphMark key={i} mark={{ k: 'glyph', g: 'LAT' }} />
					case '{GLO}':
						return <GlyphMark key={i} mark={{ k: 'glyph', g: 'GLO' }} />
					case '{ACTION}':
						return <GlyphMark key={i} mark={{ k: 'glyph', g: 'ACT' }} />
					case '[ATTACK]':
						return <GlyphMark key={i} mark={{ k: 'glyph', g: 'ATTACK' }} />
					default:
						return <span key={i}>{p.replace(/^\s+/, i > 0 ? ' ' : '')}</span>
				}
			})}
		</>
	)
}

/** Every glyph in these lines with its word — the legend under a card. */
export function GlyphLegend({
	lines,
	title = 'Glyphs on this card',
	onLearn,
}: {
	lines: readonly ShorthandLine[]
	title?: string | undefined
	onLearn?: (() => void) | undefined
}) {
	const entries = useMemo(() => glyphsOfLines(lines), [lines])
	if (entries.length === 0) return null
	return (
		<section className="sg-legend" aria-label={title}>
			<div className="sg-legend-head">
				<span>{title}</span>
				{onLearn !== undefined && (
					<button type="button" className="sg-link" onClick={onLearn}>
						Learn the glyphs ›
					</button>
				)}
			</div>
			<ul>
				{entries.map((e, i) => (
					<LexItem key={i} entry={e} />
				))}
			</ul>
		</section>
	)
}

export function LexItem({ entry }: { entry: LexiconEntry }) {
	return (
		<li className="sg-lex-item">
			<GlyphMark mark={entry.mark} className="sg-lex-mark" />
			<span>{entry.word}</span>
		</li>
	)
}
