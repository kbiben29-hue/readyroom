// Desktop entry: before the game renders, make sure this machine has the STCC
// card database (src/desktop/bridge.ts). First launch, a pin bump or an
// interrupted download shows the card-database screen; once the data is
// complete, startup goes straight to the app.

import { useCallback, useEffect, useState, type ReactNode } from 'react'

import {
	fetchStcc,
	stccUpToDate,
	type StccManifest,
	type StccProgress,
} from '../data/stccFetch'
import { loadStccFrom } from '../ui/stcc'
import * as nativeBridge from './bridge'

export type CardDataBridge = Pick<
	typeof nativeBridge,
	| 'OPEN_CARD_DATABASE'
	| 'STCC_SOURCE'
	| 'readManifest'
	| 'readVendorJson'
	| 'stccBase'
	| 'stccFolder'
	| 'tauriIo'
>

type Screen =
	| { kind: 'checking' }
	| { kind: 'setup'; manifest: StccManifest | null }
	| { kind: 'app' }

async function installData(bridge: CardDataBridge): Promise<void> {
	await loadStccFrom(`${bridge.stccBase()}/public`, bridge.readVendorJson)
}

export function DesktopRoot({
	children,
	bridge = nativeBridge,
}: {
	children: ReactNode
	bridge?: CardDataBridge
}) {
	const [screen, setScreen] = useState<Screen>({ kind: 'checking' })

	const check = useCallback(
		async (force: boolean) => {
			const manifest = await bridge.readManifest().catch(() => null)
			if (!force && stccUpToDate(manifest, bridge.STCC_SOURCE)) {
				await installData(bridge)
				setScreen({ kind: 'app' })
			} else setScreen({ kind: 'setup', manifest })
		},
		[bridge],
	)

	useEffect(() => {
		void check(false)
		const open = () => void check(true)
		window.addEventListener(bridge.OPEN_CARD_DATABASE, open)
		return () => window.removeEventListener(bridge.OPEN_CARD_DATABASE, open)
	}, [check])

	if (screen.kind === 'app') return children
	if (screen.kind === 'checking') return null
	return (
		<StccSetup
			bridge={bridge}
			manifest={screen.manifest}
			onDone={() =>
				void installData(bridge).then(() => setScreen({ kind: 'app' }))
			}
		/>
	)
}

const PHASE_LABEL: Record<StccProgress['phase'], string> = {
	data: 'Card data',
	icons: 'Card icons',
	images: 'Card scans',
}

function StccSetup({
	bridge,
	manifest,
	onDone,
}: {
	bridge: CardDataBridge
	manifest: StccManifest | null
	onDone: () => void
}) {
	const [progress, setProgress] = useState<StccProgress | null>(null)
	const [running, setRunning] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [folder, setFolder] = useState<string | null>(null)
	const upToDate = stccUpToDate(manifest, bridge.STCC_SOURCE)

	useEffect(() => {
		void bridge.stccFolder().then(setFolder, () => {})
	}, [bridge])

	const download = async () => {
		setRunning(true)
		setError(null)
		try {
			const res = await fetchStcc(bridge.STCC_SOURCE, bridge.tauriIo, {
				now: () => new Date().toISOString(),
				onProgress: setProgress,
			})
			if (res.failed.length > 0)
				setError(
					`${res.failed.length} card scan(s) could not be downloaded. Retry, or continue without them.`,
				)
			else onDone()
		} catch (e) {
			setError(`Download failed: ${e instanceof Error ? e.message : String(e)}`)
		} finally {
			setRunning(false)
		}
	}

	const status =
		manifest === null
			? 'Not downloaded yet.'
			: manifest.sha !== bridge.STCC_SOURCE.sha
				? 'A newer version of the card database is available.'
				: upToDate
					? `Up to date: ${manifest.images} card scans, ${manifest.icons} icons.`
					: `Incomplete: ${manifest.images} of ${manifest.imagesTotal} card scans.`

	return (
		<main className="stcc-setup">
			<h1>Ready Room</h1>
			<section className="panel">
				<h2>Card database</h2>
				<p>
					Card names, rules text, scans and icons come from the STCC Card
					Database (<code>{bridge.STCC_SOURCE.site}</code>). They are © WizKids
					and not part of this app, so Ready Room downloads its own copy onto
					this device (about 340 MB, once). After downloading, local games work
					offline.
				</p>
				<p className="muted small">
					{status}
					{folder !== null && (
						<>
							<br />
							Stored in <code>{folder}</code>
						</>
					)}
				</p>
				{progress !== null && running && (
					<div className="stcc-progress">
						<progress value={progress.done} max={Math.max(progress.total, 1)} />
						<span className="small">
							{PHASE_LABEL[progress.phase]} {progress.done}/{progress.total}
						</span>
					</div>
				)}
				{error !== null && <p className="error-text">{error}</p>}
				<div className="error-actions">
					<button
						type="button"
						className="btn btn-primary btn-lg"
						onClick={() => void download()}
						disabled={running}
					>
						{running
							? 'Downloading…'
							: error !== null
								? 'Retry'
								: upToDate
									? 'Check again'
									: manifest === null
										? 'Download card database'
										: 'Update card database'}
					</button>
					<button
						type="button"
						className="btn btn-lg"
						onClick={onDone}
						disabled={running}
					>
						{upToDate || error !== null
							? 'Continue'
							: 'Skip — play with text cards'}
					</button>
				</div>
			</section>
		</main>
	)
}
