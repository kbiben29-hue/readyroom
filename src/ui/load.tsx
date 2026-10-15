// "Continue a saved game" panel (todo/17 §1). Browsable from the setup screen
// without replaying anything — each save carries its full meta (deck names,
// board sides, turn number, phase, timestamp, score estimate), so the list is
// just `listSessions()` + the stored meta. A card-data hash mismatch labels a
// save as stale instead of silently replaying it under different card data.
// Import-from-file (todo/17 §3) also lives here: `importSession` + resume.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CardCatalog } from '../engine/setup'
import { useGameStore } from './store'
import type { Session } from '../session/log'
import { cardDataDrift, getSessionStore, readSessionFile } from './persistence'
import { seatLabel } from './format'
import { shortUpdatedAt } from './format'

export function SavedGamesPanel({ catalog }: { catalog: CardCatalog | null }) {
	const resume = useGameStore((s) => s.resumeGame)
	const [saves, setSaves] = useState<Session[] | null>(null)
	const [listError, setListError] = useState<string | null>(null)
	const [importError, setImportError] = useState<string | null>(null)
	const [copiedId, setCopiedId] = useState<string | null>(null)
	const fileRef = useRef<HTMLInputElement | null>(null)

	const refresh = useCallback(() => {
		void getSessionStore()
			.list()
			.then((list) => {
				setSaves(list)
				setListError(null)
			})
			.catch((e: unknown) => {
				setSaves([])
				setListError((e as Error).message)
			})
	}, [])

	useEffect(() => {
		refresh()
	}, [refresh])

	const onImportFile = useCallback(
		async (file: File | undefined) => {
			if (file === undefined) return
			setImportError(null)
			try {
				const imported = await readSessionFile(file)
				// Importing replaces the current (none — we're on the setup screen).
				resume(imported)
			} catch (e) {
				setImportError(`Import failed — ${(e as Error).message}`)
			}
		},
		[resume],
	)

	return (
		<section className="panel saved-games" aria-label="Continue a saved game">
			<div className="saved-head">
				<h3>Continue a saved game</h3>
				<div className="error-actions">
					<button type="button" className="btn micro" onClick={refresh}>
						Refresh
					</button>
					<label className="btn micro file-btn">
						Import session…
						<input
							ref={fileRef}
							type="file"
							accept=".json,application/json"
							className="hidden-file"
							aria-label="import a session JSON"
							onChange={(e) => {
								void onImportFile(e.target.files?.[0])
								e.target.value = ''
							}}
						/>
					</label>
				</div>
			</div>

			{importError !== null && <p className="error-text">{importError}</p>}
			{listError !== null && <p className="error-text">{listError}</p>}

			{saves === null ? (
				<p className="muted small">Loading saves…</p>
			) : saves.length === 0 ? (
				<p className="muted small">
					No saved games yet — a game autosaves after you start it, so you can
					pick it up here after a refresh.
				</p>
			) : (
				<ul className="save-list">
					{saves.map((s) => (
						<SaveRow
							key={s.id}
							session={s}
							catalog={catalog}
							onResume={() => resume(s)}
							onDelete={() => {
								void getSessionStore().remove(s.id).then(refresh)
							}}
							onCopy={async () => {
								const { copySession } = await import('./persistence')
								void copySession(s).then(() => setCopiedId(s.id))
							}}
							copied={copiedId === s.id}
						/>
					))}
				</ul>
			)}
			<p className="muted small">
				<strong>Save format:</strong> intent log + seed + setup (a few KB).
				Loading replays it byte-exactly — undo, replay and export all read the
				same log.
			</p>
		</section>
	)
}

function SaveRow({
	session,
	catalog,
	onResume,
	onDelete,
	onCopy,
	copied,
}: {
	session: Session
	catalog: CardCatalog | null
	onResume: () => void
	onDelete: () => void
	onCopy: () => void
	copied: boolean
}) {
	const m = session.meta
	const drift = catalog !== null ? cardDataDrift(session, catalog) : null
	const sitsAt =
		m.phase === 'SETUP' ? 'setup' : `turn ${m.turnNumber} · ${m.phase}`
	return (
		<li
			className={`save-row${drift !== null && !drift.ok ? ' save-drift' : ''}`}
		>
			<div className="save-meta">
				<strong className="save-title">
					{m.deckNames[0]} vs {m.deckNames[1]}
				</strong>
				<span className="muted small">
					{m.boardSides[0]} / {m.boardSides[1]} · {sitsAt} · {m.intentCount}{' '}
					intent{m.intentCount === 1 ? '' : 's'} · updated{' '}
					{shortUpdatedAt(m.updatedAt)}
				</span>
				<span className="muted small">
					score est. {m.scoreEstimate[0]}–{m.scoreEstimate[1]} · awaiting{' '}
					{seatLabel(m.activeSeat)}
				</span>
				{drift !== null && !drift.ok && (
					<span
						className="save-warn-badge"
						title={`stored card-data hash ${drift.stored} ≠ now ${drift.current}`}
					>
						⚠ card data changed since this save — the log may replay differently
					</span>
				)}
			</div>
			<div className="error-actions">
				<button
					type="button"
					className="btn micro btn-primary"
					onClick={onResume}
				>
					Continue
				</button>
				<button type="button" className="btn micro" onClick={onCopy}>
					{copied ? 'Copied ✓' : 'Copy JSON'}
				</button>
				<button
					type="button"
					className="btn micro btn-warn"
					onClick={onDelete}
					aria-label={`delete save ${session.id}`}
				>
					Delete
				</button>
			</div>
		</li>
	)
}
