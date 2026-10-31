import { beforeEach, describe, expect, it, vi } from 'vitest'
const storage = vi.hoisted(() => new Map<string, unknown>())
vi.mock('idb-keyval', () => ({
	get: async (key: string) => storage.get(key),
	set: async (key: string, value: unknown) => {
		storage.set(key, value)
	},
}))
import { tauriIo, readVendorJson } from './browserBridge'

const entries = new Map<string, Response>()
beforeEach(() => {
	storage.clear()
	entries.clear()
	vi.stubGlobal('caches', {
		open: async () => ({
			put: async (key: string, response: Response) => {
				entries.set(key, response)
			},
			match: async (key: string) => entries.get(key),
		}),
	})
})
describe('browser card storage', () => {
	it('persists card metadata separately from the image cache', async () => {
		await tauriIo.writeText('vendor/box1.json', '[{"card_number":"test"}]')
		expect(await readVendorJson('box1.json')).toEqual([{ card_number: 'test' }])
		expect(await tauriIo.exists('vendor/box1.json')).toBe(true)
		expect(await readVendorJson('missing.json')).toBeNull()
	})
	it('stores locally generated icons where the service worker can serve them', async () => {
		await tauriIo.writeBytes('public/icons/test.png', new Uint8Array([1, 2, 3]))
		expect(await tauriIo.exists('public/icons/test.png')).toBe(true)
		expect([...entries.keys()][0]).toContain('/stcc/public/icons/test.png')
		expect(await tauriIo.exists('public/icons/other.png')).toBe(false)
	})
	it('rejects paths outside card storage and downloads from unexpected hosts', async () => {
		await expect(
			tauriIo.writeBytes('public/../escape', new Uint8Array()),
		).rejects.toThrow()
		await expect(
			tauriIo.download('https://example.com/card.png', 'public/card.png'),
		).rejects.toThrow('Unexpected card source')
	})
})
