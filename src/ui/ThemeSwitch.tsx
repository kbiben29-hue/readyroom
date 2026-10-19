// The palette picker for the console strip and the start screen (the phone
// menu carries the same choice as a segmented control). Stored per device —
// see theme.ts.

import { setTheme, THEMES, useTheme, type Theme } from './theme'

/** `compact` drops the text label (the console strip is short on width; the
 *  selected theme's name says what the control is). */
export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
	const theme = useTheme()
	return (
		<label className="layout-switch theme-switch" title="Colour theme">
			{!compact && <span className="nav-label">Theme</span>}
			<select
				value={theme}
				onChange={(e) => setTheme(e.target.value as Theme)}
				aria-label="Colour theme"
			>
				{THEMES.map((t) => (
					<option key={t.v} value={t.v}>
						{t.label}
					</option>
				))}
			</select>
		</label>
	)
}
