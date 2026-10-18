// The LCARS palette (docs/ui-lcars.md §2). Each theme is a set of token
// overrides in lcars.css keyed on <html data-theme>; the roles stay fixed
// (frame, Market, Neutral Zone, time/score, you, opponent, alert) and only
// the hues move. Stored per device like the layout choice (shell.ts), every
// storage access guarded — private windows throw. index.html applies the
// stored theme before first paint so a reload never flashes the default.

import { useSyncExternalStore } from 'react'

export type Theme = 'tng' | 'lcars-blue' | 'voyager' | 'enterprise-e'

export const THEME_KEY = 'ready-room.theme'

/** `ground` paints the browser chrome; `frame` is the swatch in pickers. */
export const THEMES: readonly {
	v: Theme
	label: string
	short: string
	ground: string
	frame: string
}[] = [
	{
		v: 'tng',
		label: 'TNG classic',
		short: 'TNG',
		ground: '#05050a',
		frame: '#ff9c00',
	},
	{
		v: 'lcars-blue',
		label: 'LCARS blue',
		short: 'Blue',
		ground: '#04060f',
		frame: '#7fa6ea',
	},
	{
		v: 'voyager',
		label: 'Voyager',
		short: 'Voyager',
		ground: '#07060f',
		frame: '#9999ff',
	},
	{
		v: 'enterprise-e',
		label: 'Enterprise-E',
		short: 'Ent-E',
		ground: '#05070a',
		frame: '#7c9cc4',
	},
]

const DEFAULT: Theme = 'tng'

function isTheme(v: unknown): v is Theme {
	return THEMES.some((t) => t.v === v)
}

export function readTheme(): Theme {
	try {
		const v = globalThis.localStorage?.getItem(THEME_KEY)
		return isTheme(v) ? v : DEFAULT
	} catch {
		return DEFAULT
	}
}

/** Paint a theme onto the document: the data attribute the tokens key on,
 *  plus the browser chrome colour (phone status bar). */
export function applyTheme(theme: Theme): void {
	if (typeof document === 'undefined') return
	const root = document.documentElement
	if (theme === DEFAULT) delete root.dataset.theme
	else root.dataset.theme = theme
	const ground = THEMES.find((t) => t.v === theme)?.ground
	if (ground !== undefined)
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute('content', ground)
}

const listeners = new Set<() => void>()
let themeNow: Theme | null = null

function currentTheme(): Theme {
	if (themeNow === null) themeNow = readTheme()
	return themeNow
}

export function setTheme(theme: Theme): void {
	themeNow = theme
	try {
		if (theme === DEFAULT) globalThis.localStorage?.removeItem(THEME_KEY)
		else globalThis.localStorage?.setItem(THEME_KEY, theme)
	} catch {
		// storage unavailable: the theme lasts for this page only
	}
	applyTheme(theme)
	for (const l of listeners) l()
}

/** Forget the cached theme (tests reset localStorage between cases). */
export function resetThemeCache(): void {
	themeNow = null
	for (const l of listeners) l()
}

function subscribe(fn: () => void): () => void {
	listeners.add(fn)
	// another tab changed it: follow along
	const onStorage = (e: StorageEvent) => {
		if (e.key === THEME_KEY) {
			themeNow = null
			applyTheme(currentTheme())
			fn()
		}
	}
	if (typeof window !== 'undefined')
		window.addEventListener('storage', onStorage)
	return () => {
		listeners.delete(fn)
		if (typeof window !== 'undefined')
			window.removeEventListener('storage', onStorage)
	}
}

/** The active theme, live across tabs. */
export function useTheme(): Theme {
	return useSyncExternalStore(subscribe, currentTheme, () => DEFAULT)
}
