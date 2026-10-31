import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Keep the PC table arrangement and scale its canvas to the tablet's space. */
export function desktopFit(width: number, height: number) {
	const scale = Math.min(1, width / 1080)
	return { scale, width: width / scale, height: height / scale }
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
				touch && width >= 600 && width > 0 && height > 0
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
		</div>
	)
}
