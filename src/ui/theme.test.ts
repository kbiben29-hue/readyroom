// LCARS themes (docs/ui-lcars.md §2): the stored choice paints <html
// data-theme>, the default leaves no trace, storage failures are safe, and
// every theme has its token block and its pre-paint entry in index.html.

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	THEMES,
	THEME_KEY,
	applyTheme,
	readTheme,
	resetThemeCache,
	setTheme,
} from './theme'

afterEach(() => {
	vi.restoreAllMocks()
	localStorage.clear()
	resetThemeCache()
	applyTheme('tng')
})

describe('theme selection', () => {
	it('defaults to TNG classic', () => {
		expect(readTheme()).toBe('tng')
		localStorage.setItem(THEME_KEY, 'mirror-universe')
		expect(readTheme()).toBe('tng')
	})

	it('stores and paints a theme; the default clears both', () => {
		const meta = document.createElement('meta')
		meta.name = 'theme-color'
		document.head.append(meta)

		setTheme('lcars-blue')
		expect(localStorage.getItem(THEME_KEY)).toBe('lcars-blue')
		expect(document.documentElement.dataset.theme).toBe('lcars-blue')
		expect(meta.getAttribute('content')).toBe('#04060f')
		expect(readTheme()).toBe('lcars-blue')

		setTheme('tng')
		expect(localStorage.getItem(THEME_KEY)).toBeNull()
		expect(document.documentElement.dataset.theme).toBeUndefined()
		expect(meta.getAttribute('content')).toBe('#05050a')
		meta.remove()
	})

	it('survives storage that throws', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('private window')
		})
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('private window')
		})
		expect(readTheme()).toBe('tng')
		expect(() => setTheme('voyager')).not.toThrow()
		expect(document.documentElement.dataset.theme).toBe('voyager')
	})

	it('every theme has a token block and a pre-paint entry', () => {
		const css = readFileSync('src/ui/lcars.css', 'utf8')
		const html = readFileSync('index.html', 'utf8')
		for (const t of THEMES) {
			if (t.v === 'tng') continue
			expect(css).toContain(`:root[data-theme='${t.v}']`)
			expect(css).toMatch(
				new RegExp(`data-theme='${t.v}'\\][^}]*--ground: ${t.ground};`),
			)
			expect(html).toContain(`html[data-theme='${t.v}'] body`)
			expect(html).toMatch(new RegExp(`'?${t.v}'?: '${t.ground}'`))
		}
	})
})
