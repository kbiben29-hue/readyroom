import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareOfflineApp } from './offline'

afterEach(() => {
	vi.unstubAllGlobals()
	vi.useRealTimers()
})
describe('offline startup', () => {
	it('starts immediately with an existing controller even if update registration hangs', async () => {
		vi.stubGlobal('navigator', {
			serviceWorker: {
				controller: {},
				register: () => new Promise(() => {}),
			},
		})
		await expect(prepareOfflineApp()).resolves.toBeUndefined()
	})
	it('bounds a first install that never becomes ready', async () => {
		vi.useFakeTimers()
		vi.stubGlobal('navigator', {
			serviceWorker: {
				controller: null,
				register: async () => ({}),
				ready: new Promise(() => {}),
				removeEventListener: vi.fn(),
			},
		})
		const result = expect(prepareOfflineApp()).rejects.toThrow('timed out')
		await vi.advanceTimersByTimeAsync(12001)
		await result
	})
	it('does not miss a controller acquired while ready is resolving', async () => {
		const worker = {
			controller: null as object | null,
			register: async () => ({}),
			get ready() {
				worker.controller = {}
				return Promise.resolve({})
			},
			removeEventListener: vi.fn(),
		}
		vi.stubGlobal('navigator', { serviceWorker: worker })
		await expect(prepareOfflineApp()).resolves.toBeUndefined()
	})
})
