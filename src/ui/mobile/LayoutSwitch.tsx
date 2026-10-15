// The console's way back to the phone shells: a small layout picker in the
// console strip (the phone and tablet menus carry the same choice). Stored
// per device — see shell.ts.

import { setShellChoice, useShell, type ShellChoice } from './shell'

const OPTIONS: { v: ShellChoice; label: string }[] = [
	{ v: 'auto', label: 'Auto' },
	{ v: 'phone', label: 'Phone' },
	{ v: 'tablet', label: 'Tablet' },
	{ v: 'console', label: 'Console' },
]

export function LayoutSwitch() {
	const { choice } = useShell()
	return (
		<label className="layout-switch" title="Layout on this device">
			<span className="nav-label">Layout</span>
			<select
				value={choice}
				onChange={(e) => setShellChoice(e.target.value as ShellChoice)}
				aria-label="Layout on this device"
			>
				{OPTIONS.map((o) => (
					<option key={o.v} value={o.v}>
						{o.label}
					</option>
				))}
			</select>
		</label>
	)
}
