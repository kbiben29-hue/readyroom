// The desktop (Tauri) side of the app: card data lives in the app-data folder,
// fetched on first launch by the same code as `npm run fetch-cards`
// (src/data/stccFetch.ts) and served to the webview over the `stcc` scheme
// that src-tauri/src/lib.rs registers. In a browser none of this runs.

import { convertFileSrc, invoke } from '@tauri-apps/api/core'

import source from '../../tools/stcc-source.json'
import type { StccIo, StccManifest, StccSource } from '../data/stccFetch'

export const STCC_SOURCE: StccSource = source

export function isDesktop(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Base URL of the `stcc` scheme (`stcc://localhost` on macOS,
 *  `http://stcc.localhost` on Windows); paths below it mirror the app-data
 *  folder (`vendor/…`, `public/…`). */
export function stccBase(): string {
	return convertFileSrc('', 'stcc').replace(/\/+$/, '')
}

export const tauriIo: StccIo = {
	fetchText: (url) => invoke<string>('stcc_fetch_text', { url }),
	download: (url, rel) => invoke<void>('stcc_download', { url, rel }),
	writeText: (rel, text) => invoke<void>('stcc_write_text', { rel, text }),
	writeBytes: (rel, bytes) =>
		invoke<void>('stcc_write_bytes', bytes, { headers: { rel } }),
	exists: (rel) => invoke<boolean>('stcc_exists', { rel }),
}

async function readText(rel: string): Promise<string | null> {
	return invoke<string | null>('stcc_read_text', { rel })
}

export async function readVendorJson(name: string): Promise<unknown> {
	const text = await readText(`vendor/${name}`)
	if (text === null) return null
	try {
		return JSON.parse(text) as unknown
	} catch {
		return null
	}
}

export async function readManifest(): Promise<StccManifest | null> {
	return (await readVendorJson('manifest.json')) as StccManifest | null
}

/** The folder the card data is stored in, for the setup screen. */
export function stccFolder(): Promise<string> {
	return invoke<string>('stcc_folder')
}

/** Ask the root to show the card-database screen again (re-download/status). */
export const OPEN_CARD_DATABASE = 'ready-room:card-database'
export function openCardDatabase(): void {
	window.dispatchEvent(new Event(OPEN_CARD_DATABASE))
}
