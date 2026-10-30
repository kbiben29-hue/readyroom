// Fullscreen for the console (F, or the head bar button): on a laptop the
// browser's own toolbars cost ~90px of a screen that is short already. The
// whole document goes fullscreen, so the portalled overlays (card detail,
// Orders, rules) stay visible.
//
// Offered only where it works and helps: not where the API is missing (iPhone
// Safari), not in the desktop app (Tauri has its own window controls), and
// not when the app already runs from the home screen with no browser chrome.

import { useSyncExternalStore } from 'react'
import { isDesktop } from '../../desktop/bridge'

interface PrefixedDocument {
	webkitFullscreenEnabled?: boolean
	webkitFullscreenElement?: Element | null
	webkitExitFullscreen?: () => Promise<void> | void
}
interface PrefixedElement {
	webkitRequestFullscreen?: () => Promise<void> | void
}

function doc(): Document & PrefixedDocument {
	return document as Document & PrefixedDocument
}

function standalone(): boolean {
	return (
		typeof window.matchMedia === 'function' &&
		(window.matchMedia('(display-mode: standalone)').matches ||
			window.matchMedia('(display-mode: fullscreen)').matches)
	)
}

/** Whether the console should offer a fullscreen button at all. */
export function fullscreenAvailable(): boolean {
	if (typeof document === 'undefined' || isDesktop() || standalone())
		return false
	const d = doc()
	return d.fullscreenEnabled === true || d.webkitFullscreenEnabled === true
}

export function isFullscreen(): boolean {
	const d = doc()
	return (d.fullscreenElement ?? d.webkitFullscreenElement ?? null) !== null
}

export function toggleFullscreen(): void {
	const d = doc()
	try {
		if (isFullscreen()) {
			if (typeof d.exitFullscreen === 'function') void d.exitFullscreen()
			else d.webkitExitFullscreen?.()
			return
		}
		const root = document.documentElement as HTMLElement & PrefixedElement
		if (typeof root.requestFullscreen === 'function')
			void root.requestFullscreen().catch(() => undefined)
		else root.webkitRequestFullscreen?.()
	} catch {
		// refused (no user gesture, a policy) — the button simply does nothing
	}
}

function subscribe(onChange: () => void): () => void {
	document.addEventListener('fullscreenchange', onChange)
	document.addEventListener('webkitfullscreenchange', onChange)
	return () => {
		document.removeEventListener('fullscreenchange', onChange)
		document.removeEventListener('webkitfullscreenchange', onChange)
	}
}

/** Re-renders when the document enters or leaves fullscreen. */
export function useFullscreen(): boolean {
	return useSyncExternalStore(subscribe, isFullscreen, () => false)
}
