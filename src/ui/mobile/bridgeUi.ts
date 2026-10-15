// The Pocket Bridge's own view state: which station is up, which sheet is
// open, whether the opponent view is showing. Game state never lives here —
// that is the game store (src/ui/store.ts); this only remembers where the
// player is looking, so it resets freely.

import { create } from 'zustand'
import type { CardInstanceId } from '../../engine/ids'
import type { Station } from './facts'

export type Sheet =
	| { k: 'hand' }
	| { k: 'orders' }
	| { k: 'menu' }
	| { k: 'crew' }
	| { k: 'pile'; label: string; iids: CardInstanceId[] }

export interface BridgeUi {
	tab: Station
	sheet: Sheet | null
	screen: 'bridge' | 'opponent'
	/** the choice sheet folded down to its header, to look at the board */
	choiceFolded: boolean
	setTab: (tab: Station) => void
	openSheet: (sheet: Sheet | null) => void
	setScreen: (screen: 'bridge' | 'opponent') => void
	setChoiceFolded: (b: boolean) => void
	reset: () => void
}

export const useBridgeUi = create<BridgeUi>((set) => ({
	tab: 'ship',
	sheet: null,
	screen: 'bridge',
	choiceFolded: false,
	setTab: (tab) => set({ tab, sheet: null }),
	openSheet: (sheet) => set({ sheet }),
	setScreen: (screen) => set({ screen, sheet: null }),
	setChoiceFolded: (choiceFolded) => set({ choiceFolded }),
	reset: () =>
		set({ tab: 'ship', sheet: null, screen: 'bridge', choiceFolded: false }),
}))
