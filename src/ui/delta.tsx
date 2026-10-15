// Delta badges: the "+2" / "−1" that rises off a token counter when a flight
// leaves or lands on it (flight.tsx), plus a short ring pulse on the counter.
//
// A tiny module-level bus rather than store state: badges are pure cosmetics
// fired on animation timing, and routing them through zustand would re-render
// every subscriber on each token. Pool keys are flow.ts `poolKey`s
// ("player:0:DIL", "stardate", "card:<iid>:GLO").

import { useEffect, useRef, useState, type ReactNode } from 'react'

/** How long a badge stays up; repeats within it add up into one badge. */
export const DELTA_WINDOW_MS = 1600

type Listener = (delta: number) => void
const listeners = new Map<string, Set<Listener>>()

export function emitDelta(pool: string, delta: number): void {
	if (delta === 0) return
	for (const l of listeners.get(pool) ?? []) l(delta)
}

function subscribe(pool: string, l: Listener): () => void {
	let set = listeners.get(pool)
	if (set === undefined) listeners.set(pool, (set = new Set()))
	set.add(l)
	return () => {
		set.delete(l)
		if (set.size === 0) listeners.delete(pool)
	}
}

/** The running delta for one pool: summed while the window is open, cleared
 *  when it closes. `seq` restarts the CSS animation on every change. */
export function useDelta(pool: string): { delta: number; seq: number } | null {
	const [shown, setShown] = useState<{ delta: number; seq: number } | null>(
		null,
	)
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
	useEffect(() => {
		const off = subscribe(pool, (d) => {
			setShown((prev) => ({
				delta: (prev?.delta ?? 0) + d,
				seq: (prev?.seq ?? 0) + 1,
			}))
			if (timer.current !== null) clearTimeout(timer.current)
			timer.current = setTimeout(() => setShown(null), DELTA_WINDOW_MS)
		})
		return () => {
			off()
			if (timer.current !== null) clearTimeout(timer.current)
		}
	}, [pool])
	return shown
}

/**
 * Wraps a token counter: marks it as a flight anchor, pulses it on change and
 * floats the running delta above it. `label` names the pool for the
 * screen-reader announcement ("Player 1 Dilithium").
 */
export function DeltaCounter({
	pool,
	anchor,
	label,
	className,
	title,
	children,
}: {
	pool: string
	/** `data-anchor` key; defaults to the pool key. */
	anchor?: string
	label: string
	className?: string
	title?: string
	children: ReactNode
}) {
	const d = useDelta(pool)
	const dir = d === null || d.delta === 0 ? '' : d.delta > 0 ? 'up' : 'down'
	return (
		<span
			className={`delta-host${className !== undefined ? ` ${className}` : ''}${dir !== '' ? ` delta-${dir}` : ''}`}
			data-anchor={anchor ?? pool}
			title={title}
		>
			{children}
			{d !== null && d.delta !== 0 && (
				<span
					key={d.seq}
					className={`delta-badge delta-badge-${dir}`}
					role="status"
					aria-label={`${label} ${d.delta > 0 ? '+' : '−'}${Math.abs(d.delta)}`}
				>
					{d.delta > 0 ? '+' : '−'}
					{Math.abs(d.delta)}
				</span>
			)}
		</span>
	)
}
