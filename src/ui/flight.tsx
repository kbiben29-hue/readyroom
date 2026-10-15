// Flight layer: flies token icons across the screen for each dispatch's token
// movement (flow.ts plans the waves; this draws them). A fixed, pointer-less
// overlay above the board — tokens move, cards never do (docs/ui-lcars.md §1).
//
// DOM-imperative on purpose: a flight is a few absolutely-positioned <img>s
// animated with the Web Animations API, created and removed within a second.
// Pushing each through React state would re-render the board per token.
//
// Degrades to badges only: with prefers-reduced-motion, without
// Element.animate (jsdom), or when an anchor cannot be found, every delta is
// emitted immediately and nothing flies.

import { useEffect, useRef } from 'react'
import { useGameStore } from './store'
import { planFlights, type Flight, type TokenKind } from './flow'
import { emitDelta } from './delta'
import { iconUrl } from './icons'
import { RESOURCE_GLYPH } from './format'
import { glyphMarkup } from './shorthandGlyphs'

const FLIGHT_MS = 720
const STAGGER_MS = 80
const WAVE_GAP_MS = 380
/** Cap on a whole dispatch's choreography — long chains compress. */
const MAX_TOTAL_MS = 3200
const MAX_TOKENS = 5
const SOURCE_GLOW_MS = 900

function anchorEl(key: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(
		`[data-anchor="${key.replace(/["\\]/g, '\\$&')}"]`,
	)
}

/** Centre of the first anchor in the chain that is on screen. */
function resolve(
	chain: string[],
): { key: string; x: number; y: number; el: HTMLElement } | null {
	for (const key of chain) {
		const el = anchorEl(key)
		if (el === null) continue
		const r = el.getBoundingClientRect()
		if (r.width === 0 && r.height === 0) continue
		if (r.bottom < 0 || r.top > window.innerHeight) continue
		if (r.right < 0 || r.left > window.innerWidth) continue
		return { key, x: r.left + r.width / 2, y: r.top + r.height / 2, el }
	}
	return null
}

function tokenEl(kind: TokenKind): HTMLElement {
	const el = document.createElement('div')
	el.className = `flight-token flight-${kind.toLowerCase()}`
	const url = iconUrl(kind)
	if (url !== null) {
		const img = document.createElement('img')
		img.src = url
		img.alt = ''
		img.draggable = false
		el.appendChild(img)
	} else if (kind === 'ACTION') {
		el.innerHTML = glyphMarkup('ACT')
	} else {
		el.textContent = RESOURCE_GLYPH[kind]
	}
	return el
}

function prefersReducedMotion(): boolean {
	return (
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	)
}

function canAnimate(): boolean {
	return (
		typeof Element !== 'undefined' &&
		typeof Element.prototype.animate === 'function' &&
		!prefersReducedMotion()
	)
}

function badgeNow(f: Flight): void {
	if (f.fromPool !== null) emitDelta(f.fromPool, -f.n)
	if (f.toPool !== null) emitDelta(f.toPool, f.n)
}

interface Running {
	timers: ReturnType<typeof setTimeout>[]
	anims: Animation[]
	nodes: HTMLElement[]
}

function fly(host: HTMLElement, f: Flight, run: Running): void {
	const from = resolve(f.from)
	const to = resolve(f.to)
	if (from === null || to === null || from.key === to.key) {
		badgeNow(f)
		return
	}
	if (f.source !== null) {
		const src = anchorEl(`card:${f.source}`)
		if (src !== null) {
			src.classList.add('fx-source')
			run.timers.push(
				setTimeout(() => src.classList.remove('fx-source'), SOURCE_GLOW_MS),
			)
		}
	}
	if (f.fromPool !== null) emitDelta(f.fromPool, -f.n)

	const dx = to.x - from.x
	const dy = to.y - from.y
	// arc: lift the midpoint perpendicular-ish, more for longer flights
	const lift = Math.min(120, 40 + Math.hypot(dx, dy) * 0.18)
	const count = Math.min(f.n, MAX_TOKENS)
	let landed = 0
	for (let i = 0; i < count; i++) {
		const el = tokenEl(f.kind)
		if (i === 0 && f.n > MAX_TOKENS) {
			const n = document.createElement('span')
			n.className = 'flight-count'
			n.textContent = `×${f.n}`
			el.appendChild(n)
		}
		el.style.left = `${from.x}px`
		el.style.top = `${from.y}px`
		host.appendChild(el)
		run.nodes.push(el)
		const jitter = (i - (count - 1) / 2) * 10
		const anim = el.animate(
			[
				{ transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
				{
					transform: `translate(calc(-50% + ${dx * 0.1 + jitter}px), calc(-50% + ${dy * 0.1 - 18}px)) scale(1.35)`,
					opacity: 1,
					offset: 0.18,
				},
				{
					transform: `translate(calc(-50% + ${dx * 0.55 + jitter}px), calc(-50% + ${dy * 0.55 - lift}px)) scale(1.1)`,
					opacity: 1,
					offset: 0.6,
				},
				{
					transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.7)`,
					opacity: 0.85,
				},
			],
			{
				duration: FLIGHT_MS,
				delay: i * STAGGER_MS,
				easing: 'cubic-bezier(.45,.05,.35,1)',
				fill: 'both',
			},
		)
		run.anims.push(anim)
		anim.onfinish = () => {
			el.remove()
			landed++
			if (landed === count && f.toPool !== null) emitDelta(f.toPool, f.n)
			if (landed === count) {
				to.el.classList.remove('fx-land')
				// reflow so a second landing restarts the pulse
				void to.el.offsetWidth
				to.el.classList.add('fx-land')
				run.timers.push(
					setTimeout(() => to.el.classList.remove('fx-land'), 500),
				)
			}
		}
	}
}

export function FlightLayer() {
	const motion = useGameStore((s) => s.motion)
	const layer = useRef<HTMLDivElement>(null)
	const running = useRef<Running>({ timers: [], anims: [], nodes: [] })

	useEffect(() => {
		const host = layer.current
		const run = running.current
		if (motion === null) {
			// undo / pass the device / load: drop whatever is still in the air
			for (const t of run.timers) clearTimeout(t)
			for (const a of run.anims) a.cancel()
			for (const n of run.nodes) n.remove()
			running.current = { timers: [], anims: [], nodes: [] }
			return
		}
		if (host === null) return
		// forget what already finished (timers are harmless once fired)
		run.anims = run.anims.filter((a) => a.playState !== 'finished')
		run.nodes = run.nodes.filter((n) => n.isConnected)
		let waves: Flight[][]
		try {
			waves = planFlights(motion)
		} catch {
			return
		}
		if (!canAnimate()) {
			for (const wave of waves) for (const f of wave) badgeNow(f)
			return
		}
		const gap = Math.min(WAVE_GAP_MS, MAX_TOTAL_MS / Math.max(1, waves.length))
		waves.forEach((wave, wi) => {
			run.timers.push(
				setTimeout(() => {
					for (const f of wave) {
						try {
							fly(host, f, run)
						} catch {
							badgeNow(f)
						}
					}
				}, wi * gap),
			)
		})
	}, [motion])

	return <div ref={layer} className="flight-layer" aria-hidden="true" />
}
