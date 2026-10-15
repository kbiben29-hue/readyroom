// Shell selection (docs/ui-mobile.md §2): viewport media queries pick the
// frame; a player's stored choice overrides it; storage failures are safe.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	SHELL_KEY,
	pickShell,
	readShellChoice,
	resetShellChoiceCache,
	setShellChoice,
	shellForSize,
	readViewport,
} from './shell'

afterEach(() => {
	vi.restoreAllMocks()
	localStorage.clear()
	resetShellChoiceCache()
})

describe('shell selection', () => {
	it('picks by viewport', () => {
		expect(shellForSize(390, 844)).toBe('phone')
		expect(shellForSize(767, 1000)).toBe('phone')
		expect(shellForSize(844, 390)).toBe('phone-wide') // a phone on its side
		expect(shellForSize(820, 1180)).toBe('tablet')
		expect(shellForSize(1079, 800)).toBe('tablet')
		expect(shellForSize(1080, 800)).toBe('console')
		expect(shellForSize(1440, 900)).toBe('console')
		// landscape but tall enough: not the phone rail
		expect(shellForSize(1024, 768)).toBe('tablet')
	})

	it('the stored choice overrides the viewport', () => {
		const phone = { wide: false, phone: true, tablet: true }
		const desk = { wide: false, phone: false, tablet: false }
		const side = { wide: true, phone: false, tablet: true }
		expect(pickShell(phone, 'console')).toBe('console')
		expect(pickShell(desk, 'phone')).toBe('phone')
		expect(pickShell(side, 'phone')).toBe('phone-wide')
		expect(pickShell(desk, 'tablet')).toBe('tablet')
		expect(pickShell(desk, 'auto')).toBe('console')
	})

	it('persists the choice and survives unreadable storage', () => {
		expect(readShellChoice()).toBe('auto')
		setShellChoice('phone')
		expect(localStorage.getItem(SHELL_KEY)).toBe('phone')
		expect(readShellChoice()).toBe('phone')
		setShellChoice('auto')
		expect(localStorage.getItem(SHELL_KEY)).toBeNull()
		localStorage.setItem(SHELL_KEY, 'nonsense')
		expect(readShellChoice()).toBe('auto')
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('private window')
		})
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('private window')
		})
		expect(readShellChoice()).toBe('auto')
		expect(() => setShellChoice('tablet')).not.toThrow()
	})

	it('reads as the console without matchMedia (jsdom, old browsers)', () => {
		expect(readViewport()).toEqual({ wide: false, phone: false, tablet: false })
	})
})
