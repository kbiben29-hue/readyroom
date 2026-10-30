// The console's own view state: whether the hand is pinned up, the log drawer
// and the viewscreen are open, the head menu is showing. Game state never
// lives here — that is the game store (src/ui/store.ts); this only remembers
// where the player is looking, so it resets freely (a new game, a reload).

import { create } from 'zustand'

export interface ConsoleUi {
	/** H: the hand stays raised until H again (or Esc). */
	handPinned: boolean
	logOpen: boolean
	/** log entries the player had seen when they last closed the drawer */
	logSeen: number
	/** V: the opponent's full board on screen */
	viewscreen: boolean
	menuOpen: boolean
	setHandPinned: (b: boolean) => void
	/** `entries` is the log length now, remembered when the drawer closes. */
	setLogOpen: (b: boolean, entries: number) => void
	setViewscreen: (b: boolean) => void
	setMenuOpen: (b: boolean) => void
	/** A new game: everything closed, its `entries` log rows already seen. */
	reset: (entries: number) => void
}

export const useConsoleUi = create<ConsoleUi>((set) => ({
	handPinned: false,
	logOpen: false,
	logSeen: 0,
	viewscreen: false,
	menuOpen: false,
	setHandPinned: (handPinned) => set({ handPinned }),
	setLogOpen: (logOpen, entries) => set({ logOpen, logSeen: entries }),
	setViewscreen: (viewscreen) => set({ viewscreen }),
	setMenuOpen: (menuOpen) => set({ menuOpen }),
	reset: (entries) =>
		set({
			handPinned: false,
			logOpen: false,
			logSeen: entries,
			viewscreen: false,
			menuOpen: false,
		}),
}))
