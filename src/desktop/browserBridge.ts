// Same first-run fetcher as the native app, with browser-local data storage.
// No copyrighted card assets are published to GitHub Pages.
import { get, set } from 'idb-keyval'
import source from '../../tools/stcc-source.json'
import type { StccIo, StccManifest, StccSource } from '../data/stccFetch'

export const STCC_SOURCE: StccSource = source
export const OPEN_CARD_DATABASE = 'ready-room:card-database'
export const CARD_CACHE = 'ready-room-card-images-v1'
const prefix = 'ready-room.stcc.'
export const stccBase = () =>
	`${location.origin}${import.meta.env.BASE_URL}stcc`
export const stccFolder = async () => 'this iPad or browser (offline storage)'

function assetUrl(rel: string): string {
	if (!/^(public|vendor)\//.test(rel) || rel.split('/').includes('..'))
		throw new Error('Invalid card asset path')
	return `${stccBase()}/${rel}`
}
async function checked(url: string): Promise<Response> {
	if (
		!url.startsWith(
			'https://raw.githubusercontent.com/periodic-agent/stcc-strategy/',
		)
	)
		throw new Error('Unexpected card source')
	const response = await fetch(url)
	if (!response.ok) throw new Error(`${response.status}: ${url}`)
	return response
}
export const tauriIo: StccIo = {
	fetchText: async (url) => (await checked(url)).text(),
	download: async (url, rel) => {
		const response = await checked(url)
		const cache = await caches.open(CARD_CACHE)
		await cache.put(assetUrl(rel), response)
	},
	writeText: async (rel, text) => {
		if (rel.startsWith('vendor/')) await set(prefix + rel, text)
		else {
			const cache = await caches.open(CARD_CACHE)
			await cache.put(assetUrl(rel), new Response(text))
		}
	},
	writeBytes: async (rel, bytes) => {
		const cache = await caches.open(CARD_CACHE)
		await cache.put(assetUrl(rel), new Response(new Uint8Array(bytes)))
	},
	exists: async (rel) => {
		if (rel.startsWith('vendor/'))
			return (await get(prefix + rel)) !== undefined
		return (
			(await (await caches.open(CARD_CACHE)).match(assetUrl(rel))) !== undefined
		)
	},
}
export async function readVendorJson(name: string): Promise<unknown> {
	const raw = await get<string>(prefix + `vendor/${name}`)
	return raw === undefined ? null : (JSON.parse(raw) as unknown)
}
export async function readManifest(): Promise<StccManifest | null> {
	return (await readVendorJson('manifest.json')) as StccManifest | null
}
