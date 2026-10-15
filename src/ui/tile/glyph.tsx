// One Shorthand glyph outside a line: tile headers, the phone header, meters
// and chips reuse the same drawings (src/ui/shorthandGlyphs.ts) so the phone
// speaks one icon language. Where the game prints an icon for the glyph
// (src/ui/printedIcons.ts), that icon is shown instead. Decorative by default — the caller keeps the word
// or number beside it; `title` names it for a hover.

import type { Suit } from '../../data/ids'
import type { GlyphId } from '../../engine/shorthand'
import {
	printedGlyphUrl,
	printedSuitUrl,
	type SpecialtyAs,
} from '../printedIcons'
import { GLYPH_SVG, GLYPH_WORD, SUIT_SVG } from '../shorthandGlyphs'

function Svg({ svg }: { svg: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			focusable="false"
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	)
}

export function Gl({
	g,
	as,
	className = '',
	title,
}: {
	g: GlyphId
	/** a specialty glyph as a skill (default), focus or variable icon */
	as?: SpecialtyAs | undefined
	className?: string | undefined
	title?: string | undefined
}) {
	const url = printedGlyphUrl(g, as)
	return (
		<i
			className={`pb-gl pb-g-${g} ${className}`}
			title={title ?? GLYPH_WORD[g]}
			aria-hidden={title === undefined ? true : undefined}
		>
			{url !== null ? (
				<img className="pb-img" src={url} alt="" draggable={false} />
			) : (
				<Svg svg={GLYPH_SVG[g]} />
			)}
		</i>
	)
}

export function SuitGl({
	suit,
	className = '',
	title,
}: {
	suit: Suit | 'ANY'
	className?: string | undefined
	title?: string | undefined
}) {
	const url = printedSuitUrl(suit)
	const mask = url === null ? null : `url("${url}")`
	return (
		<i
			className={`pb-gl pb-suit-${suit} ${className}`}
			title={title ?? (suit === 'ANY' ? 'any card' : suit)}
			aria-hidden="true"
		>
			{mask !== null ? (
				<span
					className="pb-mask"
					style={{ maskImage: mask, WebkitMaskImage: mask }}
				/>
			) : (
				<Svg svg={SUIT_SVG[suit]} />
			)}
		</i>
	)
}
