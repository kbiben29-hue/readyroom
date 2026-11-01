// Red alert lighting: a fixed, pointer-less overlay that pulses red around the
// edges of the screen (and tints the board) when an Incident is played — four
// pulses in time with the klaxon. A taken Incident gets one short pulse. The
// key restarts the CSS animation on every new alert.

import { useEffect, useState } from 'react'
import { useFlash } from './sound'

const DURATION_MS = { alert: 2900, warning: 900 } as const

export function RedAlertFlash() {
	const flash = useFlash()
	const [shown, setShown] = useState<number | null>(null)
	useEffect(() => {
		if (flash === null) return
		setShown(flash.seq)
		const t = setTimeout(() => setShown(null), DURATION_MS[flash.kind])
		return () => clearTimeout(t)
	}, [flash])
	if (flash === null || shown !== flash.seq) return null
	return (
		<div
			key={flash.seq}
			className={`red-alert-flash red-alert-${flash.kind}`}
			aria-hidden="true"
		>
			<div className="red-alert-beacon red-alert-beacon-l" />
			<div className="red-alert-beacon red-alert-beacon-r" />
		</div>
	)
}
