// Sound effects degrade to silence without an AudioContext (jsdom), and the
// red alert lighting still shows.

import { afterEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { RedAlertFlash } from './alertFlash'
import {
	playCue,
	redAlert,
	setSoundSettings,
	SOUND_KEY,
	type Cue,
} from './sound'

let root: Root | null = null
let host: HTMLElement | null = null

afterEach(() => {
	act(() => root?.unmount())
	host?.remove()
	root = null
	host = null
	localStorage.clear()
})

function mount(): HTMLElement {
	host = document.createElement('div')
	document.body.appendChild(host)
	root = createRoot(host)
	act(() => root!.render(<RedAlertFlash />))
	return host
}

describe('sound effects', () => {
	it('every cue is a silent no-op without Web Audio', () => {
		const cues: Cue[] = [
			'click',
			'play',
			'activate',
			'swoosh',
			'land',
			'pass',
			'endTurn',
			'mission',
			'alert',
			'warning',
			'undo',
			'beam',
			'victory',
			'defeat',
		]
		for (const c of cues) expect(() => playCue(c)).not.toThrow()
	})

	it('stores the settings per device', () => {
		setSoundSettings({ enabled: false, volume: 0.3 })
		expect(JSON.parse(localStorage.getItem(SOUND_KEY)!)).toEqual({
			enabled: false,
			music: true,
			volume: 0.3,
		})
		setSoundSettings({ enabled: true, volume: 0.6 })
	})

	it('a red alert flashes the screen red', () => {
		const el = mount()
		expect(el.querySelector('.red-alert-flash')).toBeNull()
		act(() => redAlert('alert'))
		expect(el.querySelector('.red-alert-flash.red-alert-alert')).not.toBeNull()
	})
})
