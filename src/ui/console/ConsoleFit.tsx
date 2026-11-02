import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** The tallest PC canvas on a phone held upright. */
export const MAX_PORTRAIT_H = 1000

/** Keep the PC table arrangement and scale its canvas to the device's space
 *  (iPad and iPhone alike). */
export function desktopFit(width: number, height: number) {
	const scale = Math.min(1, width / 1080)
	const tall = height / scale
	// a phone held upright: stretching the PC rows down a very tall canvas only
	// spreads the board out, so keep it table-shaped and leave the rest below
	const phonePortrait = width < 600 && height > width
	return {
		scale,
		width: width / scale,
		// otherwise exactly the screen: the table scrolls inside the canvas and
		// the hand dock stays pinned to the bottom, as on the PC
		height: phonePortrait ? Math.min(tall, MAX_PORTRAIT_H) : tall,
		rotateHint: phonePortrait,
	}
}

export function ConsoleFit({ children }: { children: ReactNode }) {
	const host = useRef<HTMLDivElement>(null)
	const [fit, setFit] = useState<ReturnType<typeof desktopFit> | null>(null)
	useLayoutEffect(() => {
		const el = host.current
		if (!el || typeof ResizeObserver === 'undefined') return
		const measure = () => {
			const touch = window.matchMedia?.('(any-pointer: coarse)').matches
			const width = el.clientWidth
			const height = el.clientHeight
			setFit(
				touch && width > 0 && height > 0
					? desktopFit(width, height)
					: null,
			)
		}
		const observer = new ResizeObserver(measure)
		observer.observe(el)
		window.addEventListener('resize', measure)
		measure()
		return () => {
			observer.disconnect()
			window.removeEventListener('resize', measure)
		}
	}, [])
	return (
		<div ref={host} className="console-fit-host">
			<div
				className={
					fit ? 'console-fit-canvas console-fitted' : 'console-fit-canvas'
				}
				style={
					fit
						? { width: fit.width, height: fit.height, zoom: fit.scale }
						: undefined
				}
			>
				{children}
			</div>
			{fit?.rotateHint === true && (
				<p className="console-rotate-hint">
					Turn your phone sideways for bigger cards
				</p>
			)}
		</div>
	)
}
