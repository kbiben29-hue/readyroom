// The hand dock (docs/ui-lcars.md §4): your hand rests along the bottom edge
// with only the top strip of each card showing — the name band, enough to see
// what you hold and which cards are live (the rest stay dimmed, as in the
// raised hand) — so the board above it is never covered by default.
//
// It lifts to full size over the board when you point at it, when focus moves
// into it, or on a tap (the first tap on a lowered dock only lifts it). H pins
// it up, H or Esc again lets it drop. Raising moves the cards straight up and
// never sideways, so the two clicks of a double-click (the store's timer in
// cardClicked) land on the same card.
//
// Your Draw and Discard sit at its left end, the decks on your side of the
// table.

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
	CSSProperties,
	MouseEvent as ReactMouseEvent,
	PointerEvent as ReactPointerEvent,
} from 'react'
import { zoneKey } from '../../engine/state'
import type { Seat } from '../../engine/resolver/queries'
import { DeckPiles, Hand } from '../board'
import { useProjected } from '../store'
import { useConsoleUi } from './consoleUi'
import { useEscape, useShortcut } from './useShortcut'

/** Pointer dwell before the dock lifts, and grace before it drops — so a
 *  pointer crossing the bottom edge on its way somewhere does not flap it. */
const RAISE_MS = 140
const LOWER_MS = 260

export function HandDock({ seat }: { seat: Seat }) {
	const projected = useProjected()
	const count = projected?.zones[zoneKey({ k: 'HAND', seat })]?.length ?? 0
	const pinned = useConsoleUi((s) => s.handPinned)
	const setPinned = useConsoleUi((s) => s.setHandPinned)
	const [hovered, setHovered] = useState(false)
	const [focused, setFocused] = useState(false)
	const [tapped, setTapped] = useState(false)
	const raised = pinned || hovered || focused || tapped
	const timer = useRef<number | null>(null)
	const dock = useRef<HTMLDivElement>(null)

	const clear = () => {
		if (timer.current !== null) window.clearTimeout(timer.current)
		timer.current = null
	}
	useEffect(() => clear, [])

	useShortcut('h', () => {
		setTapped(false)
		setPinned(!pinned)
	})
	const drop = useCallback(() => {
		setPinned(false)
		setTapped(false)
	}, [setPinned])
	useEscape(pinned || tapped, drop)

	// a tap outside lowers a dock a tap raised
	useEffect(() => {
		if (!tapped) return
		const onDown = (e: PointerEvent) => {
			if (!(e.target instanceof Node) || dock.current?.contains(e.target))
				return
			setTapped(false)
		}
		window.addEventListener('pointerdown', onDown)
		return () => window.removeEventListener('pointerdown', onDown)
	}, [tapped])

	const onEnter = (e: ReactPointerEvent) => {
		if (e.pointerType === 'touch') return
		clear()
		timer.current = window.setTimeout(() => setHovered(true), RAISE_MS)
	}
	const onLeave = (e: ReactPointerEvent) => {
		if (e.pointerType === 'touch') return
		clear()
		timer.current = window.setTimeout(() => setHovered(false), LOWER_MS)
	}
	// touch: the first tap on a lowered hand only lifts it (the decks and the
	// handle work at once)
	const lastPointer = useRef<string>('mouse')
	const onDownCapture = (e: ReactPointerEvent) => {
		lastPointer.current = e.pointerType
	}
	const onClickCapture = (e: ReactMouseEvent) => {
		if (raised || lastPointer.current !== 'touch') return
		if (
			!(e.target instanceof Element) ||
			e.target.closest('.dock-fan') === null
		)
			return
		e.stopPropagation()
		e.preventDefault()
		setTapped(true)
	}

	return (
		<div
			ref={dock}
			className={`hand-dock${raised ? ' dock-raised' : ''}${pinned ? ' dock-pinned' : ''}`}
			style={{ '--hand-n': Math.max(1, count) } as CSSProperties}
			onPointerEnter={onEnter}
			onPointerLeave={onLeave}
			onPointerDownCapture={onDownCapture}
			onClickCapture={onClickCapture}
			onFocus={() => setFocused(true)}
			onBlur={(e) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node | null))
					setFocused(false)
			}}
		>
			<DeckPiles seat={seat} />
			<button
				type="button"
				className="dock-handle"
				onClick={() => {
					setTapped(false)
					setPinned(!pinned)
				}}
				aria-pressed={pinned}
				title={pinned ? 'Let your hand drop (H)' : 'Keep your hand up (H)'}
			>
				<span className="dock-handle-label">
					Hand <kbd>H</kbd>
				</span>
			</button>
			<div className="dock-fan">
				<Hand seat={seat} />
			</div>
		</div>
	)
}
