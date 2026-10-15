// Game log panel (todo/14 §6, docs/ui-spec.md §6). The engine emits a flat
// LogEntry list (kind / seat / message / involved iid); this renders it with
// kind chips so COST vs BENEFIT vs SKIPPED vs AUTO-EVENT is readable at a
// glance, plus a my-actions / opponent-actions / all filter. SKIPPED entries
// are exactly how a player learns "nothing happened because …" — they are
// never filtered out (only seat-filtered).
//
// The engine's entries are flat, so the turn→phase→operation nesting from the
// spec is approximated with a chronological stream + chips rather than a tree.
// Clicking an entry with an involved card opens its detail.

import { useEffect, useRef } from 'react'
import type { LogEntry, LogKind } from '../engine/state'
import { OpText } from './cards'
import type { Seat } from '../engine/resolver/queries'
import {
	useProjected,
	useGameStore,
	useViewerSeat,
	type LogFilter,
} from './store'

const KIND_LABEL: Record<LogKind, string> = {
	COST: 'cost',
	BENEFIT: 'benefit',
	SKIPPED: 'skipped',
	EVENT: 'event',
	CHOICE: 'choice',
	INFO: 'info',
	FAILED: 'failed',
}

function seatOf(e: LogEntry): number | null {
	return e.seat ?? null
}

export function LogPanel() {
	const projected = useProjected()
	const filter = useGameStore((s) => s.logFilter)
	const setFilter = useGameStore((s) => s.setLogFilter)
	const viewer = useViewerSeat()
	// rows the last dispatch added — "what just happened" (flow.ts Motion)
	const freshFrom = useGameStore((s) => s.motion?.logFrom ?? null)
	const motionSeq = useGameStore((s) => s.motion?.seq ?? null)
	const listRef = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const first = listRef.current?.querySelector('.log-fresh')
		if (
			first instanceof HTMLElement &&
			typeof first.scrollIntoView === 'function'
		)
			first.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
	}, [motionSeq])
	if (projected === null) return null
	const log: LogEntry[] = projected.log as unknown as LogEntry[]

	const shown = log
		.map((e, i) => ({ e, i }))
		.filter(({ e }) => {
			if (filter === 'ALL') return true
			const s = seatOf(e)
			if (s === null) return true
			return filter === 'MINE' ? s === viewer : s !== viewer
		})

	return (
		<section className="panel log-panel" aria-label="Game log">
			<div className="log-head">
				<h3>Log</h3>
				<div className="log-filters" role="group" aria-label="Log filter">
					{(['ALL', 'MINE', 'THEIRS'] as LogFilter[]).map((f) => (
						<button
							key={f}
							type="button"
							className={`btn micro${filter === f ? ' btn-active' : ''}`}
							onClick={() => setFilter(f)}
						>
							{f}
						</button>
					))}
				</div>
			</div>
			<div className="log-list" ref={listRef}>
				{shown.length === 0 && <p className="muted small">No entries.</p>}
				{shown.map(({ e, i }) => (
					<LogRow
						key={i}
						entry={e}
						fresh={freshFrom !== null && i >= freshFrom}
					/>
				))}
			</div>
			<p className="muted small">
				SKIPPED / failed entries explain why nothing happened — the cost
				isn&apos;t always payable.
			</p>
		</section>
	)
}

function LogRow({ entry, fresh }: { entry: LogEntry; fresh: boolean }) {
	const setDetail = useGameStore((s) => s.setDetail)
	const ownerSeat: Seat | null = entry.seat ?? null
	return (
		<div
			className={`log-row log-${entry.kind.toLowerCase()}${fresh ? ' log-fresh' : ''}`}
			onClick={
				entry.iid !== undefined ? () => setDetail(entry.iid!) : undefined
			}
		>
			<span
				className={`log-seat ${ownerSeat !== null ? `seat-${ownerSeat}` : ''}`}
			>
				{ownerSeat !== null ? `P${ownerSeat + 1}` : ''}
			</span>
			<span className={`log-kind log-kind-${entry.kind.toLowerCase()}`}>
				{KIND_LABEL[entry.kind]}
			</span>
			<span className="log-message">
				<OpText text={entry.message} plain />
			</span>
		</div>
	)
}
