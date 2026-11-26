// Drag a card from your hand onto the table to play it (like a real card
// game). Pointer events, so mouse, finger and pencil all work the same way:
//
//   - press a hand card and move it more than a few pixels: a copy of the card
//     follows the pointer and the table lights up as the place to drop it;
//   - let go anywhere on the table (outside the hand): the card is played —
//     straight away when it has exactly one legal way to be played, otherwise
//     its detail opens so you pick which way (or see why it can't be played);
//   - let go back over the hand, or press Esc: nothing happens;
//   - a press without moving is an ordinary click (detail / double-click).
//
// The copy is drawn on document.body, outside the console's zoomed canvas, so
// it sits exactly under the pointer on a fitted iPad / iPhone screen too.

import type { PointerEvent as ReactPointerEvent } from 'react'
import type { CardInstanceId } from '../engine/ids'
import { useGameStore } from './store'

/** Movement (screen px) before a press becomes a drag. */
const DRAG_START_PX = 10

export function onHandPointerDown(e: ReactPointerEvent): void {
	if (e.button !== 0) return
	const target = e.target instanceof Element ? e.target : null
	const cardEl = target?.closest<HTMLElement>('[data-anchor^="card:"]')
	if (cardEl === null || cardEl === undefined) return
	const iid = cardEl.dataset.anchor!.slice('card:'.length) as CardInstanceId
	const startX = e.clientX
	const startY = e.clientY
	const pointerId = e.pointerId
	let ghost: HTMLElement | null = null
	let grabX = 0
	let grabY = 0

	// a finger holding a card must not scroll the page underneath it
	const noScroll = (ev: TouchEvent) => {
		if (ghost !== null) ev.preventDefault()
	}

	const overTable = (x: number, y: number): boolean => {
		if (typeof document.elementFromPoint !== 'function') return false
		const under = document.elementFromPoint(x, y)
		if (under === null) return false
		if (under.closest('.hand-dock, .hand') !== null) return false
		return under.closest('.board, .table, .frame') !== null
	}

	const begin = () => {
		const r = cardEl.getBoundingClientRect()
		ghost = cardEl.cloneNode(true) as HTMLElement
		ghost.removeAttribute('data-anchor')
		ghost.classList.add('drag-ghost')
		const w = Math.max(90, Math.min(200, r.width * 1.15))
		const h = r.width > 0 ? (r.height / r.width) * w : w * 1.4
		grabX = w / 2
		grabY = h * 0.35
		ghost.style.width = `${w}px`
		ghost.style.height = `${h}px`
		document.body.appendChild(ghost)
		cardEl.classList.add('drag-source')
		document.body.classList.add('card-dragging')
	}

	const place = (x: number, y: number) => {
		if (ghost === null) return
		ghost.style.left = `${x - grabX}px`
		ghost.style.top = `${y - grabY}px`
		document.body.classList.toggle('card-drop-ready', overTable(x, y))
	}

	const finish = () => {
		window.removeEventListener('pointermove', move)
		window.removeEventListener('pointerup', up)
		window.removeEventListener('pointercancel', cancel)
		window.removeEventListener('keydown', key)
		window.removeEventListener('touchmove', noScroll)
		ghost?.remove()
		cardEl.classList.remove('drag-source')
		document.body.classList.remove('card-dragging', 'card-drop-ready')
	}

	const move = (ev: PointerEvent) => {
		if (ev.pointerId !== pointerId) return
		if (ghost === null) {
			if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_START_PX)
				return
			begin()
		}
		place(ev.clientX, ev.clientY)
	}

	const up = (ev: PointerEvent) => {
		if (ev.pointerId !== pointerId) return
		const dragged = ghost !== null
		const drop = dragged && overTable(ev.clientX, ev.clientY)
		finish()
		if (!dragged) return // a plain click: the card's own onClick handles it
		// the click that follows a drag must not also open the card
		const swallow = (c: MouseEvent) => {
			c.stopPropagation()
			c.preventDefault()
		}
		window.addEventListener('click', swallow, { capture: true, once: true })
		window.setTimeout(
			() => window.removeEventListener('click', swallow, { capture: true }),
			0,
		)
		if (drop) useGameStore.getState().cardDropped(iid)
	}

	const cancel = (ev: PointerEvent) => {
		if (ev.pointerId !== pointerId) return
		finish()
	}

	const key = (ev: KeyboardEvent) => {
		if (ev.key === 'Escape') finish()
	}

	window.addEventListener('pointermove', move)
	window.addEventListener('pointerup', up)
	window.addEventListener('pointercancel', cancel)
	window.addEventListener('keydown', key)
	window.addEventListener('touchmove', noScroll, { passive: false })
}
