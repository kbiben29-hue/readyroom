// The reference menu: Rules, Card list, Shorthand and Deck review are one menu
// behind one console button. Each keeps its own panel; this tab strip sits in
// every panel's head and switches between them (store.openReference).

import { useGameStore } from './store'

export type ReferenceTab = 'rules' | 'cards' | 'shorthand' | 'decks'

const TABS: { id: ReferenceTab; label: string }[] = [
	{ id: 'rules', label: 'Rules' },
	{ id: 'cards', label: 'Card list' },
	{ id: 'shorthand', label: 'Shorthand' },
	{ id: 'decks', label: 'Deck review' },
]

export function ReferenceTabs({ current }: { current: ReferenceTab }) {
	const openReference = useGameStore((s) => s.openReference)
	return (
		<nav className="ref-tabs" role="tablist" aria-label="Reference">
			{TABS.map((t) => (
				<button
					key={t.id}
					type="button"
					role="tab"
					aria-selected={current === t.id}
					className={`btn micro${current === t.id ? ' btn-active' : ''}`}
					onClick={() => openReference(t.id)}
				>
					{t.label}
				</button>
			))}
		</nav>
	)
}
