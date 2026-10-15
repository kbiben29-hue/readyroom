// Which frame draws the game (docs/ui-mobile.md §2): viewport media queries
// pick the shell, container queries pick each card's density.
//
//   landscape and height < 500px → phone-wide (header rail, hand column)
//   width < 768px                → phone
//   768px ≤ width < 1080px       → tablet (Sector | Ship, Crew drawer)
//   width ≥ 1080px               → console (the LCARS desktop, unchanged)
//
// A player may force a shell from the menu; the choice is stored per device
// (localStorage, every access guarded — private windows throw). Without
// matchMedia (jsdom, very old browsers) the viewport reads as the console, so
// nothing changes for them unless a shell is forced.

import { useSyncExternalStore } from 'react'

export type Shell = 'phone' | 'phone-wide' | 'tablet' | 'console'
export type ShellChoice = 'auto' | 'phone' | 'tablet' | 'console'

export const SHELL_KEY = 'ready-room.shell'

export const SHELL_QUERIES = {
	/** a phone on its side: too short for a header over a station */
	wide: '(orientation: landscape) and (max-height: 499.98px)',
	phone: '(max-width: 767.98px)',
	tablet: '(max-width: 1079.98px)',
} as const

export interface Viewport {
	wide: boolean
	phone: boolean
	tablet: boolean
}

/** The shell for a viewport and a player's choice. Pure. */
export function pickShell(v: Viewport, choice: ShellChoice): Shell {
	switch (choice) {
		case 'console':
			return 'console'
		case 'tablet':
			return 'tablet'
		case 'phone':
			return v.wide ? 'phone-wide' : 'phone'
		case 'auto':
			if (v.wide) return 'phone-wide'
			if (v.phone) return 'phone'
			if (v.tablet) return 'tablet'
			return 'console'
	}
}

/** Same rule from raw numbers (tests, docs). */
export function shellForSize(
	width: number,
	height: number,
	choice: ShellChoice = 'auto',
): Shell {
	return pickShell(
		{
			wide: width > height && height < 500,
			phone: width < 768,
			tablet: width < 1080,
		},
		choice,
	)
}

// ---------------------------------------------------------------------------
// The stored choice
// ---------------------------------------------------------------------------

const CHOICES: readonly ShellChoice[] = ['auto', 'phone', 'tablet', 'console']

export function readShellChoice(): ShellChoice {
	try {
		const v = globalThis.localStorage?.getItem(SHELL_KEY)
		return CHOICES.includes(v as ShellChoice) ? (v as ShellChoice) : 'auto'
	} catch {
		return 'auto'
	}
}

const listeners = new Set<() => void>()
let choiceNow: ShellChoice | null = null

function currentChoice(): ShellChoice {
	if (choiceNow === null) choiceNow = readShellChoice()
	return choiceNow
}

export function setShellChoice(choice: ShellChoice): void {
	choiceNow = choice
	try {
		if (choice === 'auto') globalThis.localStorage?.removeItem(SHELL_KEY)
		else globalThis.localStorage?.setItem(SHELL_KEY, choice)
	} catch {
		// storage unavailable: the choice lasts for this page only
	}
	for (const l of listeners) l()
}

/** Forget the cached choice (tests reset localStorage between cases). */
export function resetShellChoiceCache(): void {
	choiceNow = null
	for (const l of listeners) l()
}

// ---------------------------------------------------------------------------
// The viewport
// ---------------------------------------------------------------------------

function mql(q: string): MediaQueryList | null {
	try {
		return typeof window !== 'undefined' &&
			typeof window.matchMedia === 'function'
			? window.matchMedia(q)
			: null
	} catch {
		return null
	}
}

export function readViewport(): Viewport {
	return {
		wide: mql(SHELL_QUERIES.wide)?.matches ?? false,
		phone: mql(SHELL_QUERIES.phone)?.matches ?? false,
		tablet: mql(SHELL_QUERIES.tablet)?.matches ?? false,
	}
}

function subscribe(fn: () => void): () => void {
	listeners.add(fn)
	const lists = Object.values(SHELL_QUERIES)
		.map(mql)
		.filter((m): m is MediaQueryList => m !== null)
	for (const m of lists) m.addEventListener?.('change', fn)
	const onStorage = (e: StorageEvent) => {
		if (e.key === SHELL_KEY) {
			choiceNow = null
			fn()
		}
	}
	if (typeof window !== 'undefined')
		window.addEventListener('storage', onStorage)
	return () => {
		listeners.delete(fn)
		for (const m of lists) m.removeEventListener?.('change', fn)
		if (typeof window !== 'undefined')
			window.removeEventListener('storage', onStorage)
	}
}

function snapshot(): string {
	const v = readViewport()
	return `${pickShell(v, currentChoice())}|${currentChoice()}`
}

/** The active shell and the stored choice, live across resizes/rotation. */
export function useShell(): { shell: Shell; choice: ShellChoice } {
	const snap = useSyncExternalStore(subscribe, snapshot, () => 'console|auto')
	const [shell, choice] = snap.split('|') as [Shell, ShellChoice]
	return { shell, choice }
}
