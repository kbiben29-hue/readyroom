// Sound effects: one audio file per moment, in the top-level `sounds/` folder
// (sounds/README.md lists the names). A file is matched by its name without
// the extension, so `alert.mp3`, `alert.wav` or `alert.m4a` all work; a moment
// with no file is silent. The files are bundled at build time.
//
// Stored per device like the theme (enabled + volume), every storage access
// guarded. Without an AudioContext (jsdom, old browsers) every cue is a no-op.
// Browsers keep audio locked until a user gesture, so the context is created
// (or resumed) on the first pointer / key press.

import { useSyncExternalStore } from 'react'

export const SOUND_KEY = 'ready-room.sound'

export interface SoundSettings {
	enabled: boolean
	/** the theme on the main menu */
	music: boolean
	/** 0..1 */
	volume: number
}

const DEFAULT: SoundSettings = { enabled: true, music: true, volume: 0.6 }

function readSettings(): SoundSettings {
	try {
		const raw = globalThis.localStorage?.getItem(SOUND_KEY)
		if (raw === null || raw === undefined) return DEFAULT
		const v = JSON.parse(raw) as Partial<SoundSettings>
		return {
			enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT.enabled,
			music: typeof v.music === 'boolean' ? v.music : DEFAULT.music,
			volume:
				typeof v.volume === 'number' && v.volume >= 0 && v.volume <= 1
					? v.volume
					: DEFAULT.volume,
		}
	} catch {
		return DEFAULT
	}
}

let settings: SoundSettings = readSettings()
const listeners = new Set<() => void>()

export function setSoundSettings(next: Partial<SoundSettings>): void {
	settings = { ...settings, ...next }
	try {
		globalThis.localStorage?.setItem(SOUND_KEY, JSON.stringify(settings))
	} catch {
		// private window: keep it for this session only
	}
	if (master !== null) master.gain.value = settings.volume
	syncMusic()
	for (const l of listeners) l()
}

export function useSoundSettings(): SoundSettings {
	return useSyncExternalStore(
		(l) => {
			listeners.add(l)
			return () => listeners.delete(l)
		},
		() => settings,
		() => settings,
	)
}

// ---------------------------------------------------------------------------
// Audio graph
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null
let master: GainNode | null = null

/** sounds/<cue>.<ext> → bundled URL */
const FILES = import.meta.glob(
	'../../sounds/*.{mp3,wav,m4a,aac,ogg,MP3,WAV,M4A}',
	{ eager: true, query: '?url', import: 'default' },
) as Record<string, string>

function fileFor(cue: string): string | null {
	for (const [path, url] of Object.entries(FILES)) {
		const name = path.split('/').pop()!.replace(/\.[^.]+$/, '')
		if (name.toLowerCase() === cue.toLowerCase()) return url
	}
	return null
}

const buffers = new Map<string, AudioBuffer>()
const loading = new Set<string>()

function load(c: AudioContext, cue: string, then?: () => void): void {
	if (buffers.has(cue) || loading.has(cue)) return
	const url = fileFor(cue)
	if (url === null) return
	loading.add(cue)
	fetch(url)
		.then((r) => r.arrayBuffer())
		.then((data) => c.decodeAudioData(data))
		.then((b) => {
			buffers.set(cue, b)
			then?.()
		})
		.catch(() => {
			// an unreadable file stays silent
		})
		.finally(() => loading.delete(cue))
}

function audioCtor(): typeof AudioContext | null {
	const g = globalThis as unknown as {
		AudioContext?: typeof AudioContext
		webkitAudioContext?: typeof AudioContext
	}
	return g.AudioContext ?? g.webkitAudioContext ?? null
}

function ensure(): AudioContext | null {
	if (ctx !== null) return ctx
	const Ctor = audioCtor()
	if (Ctor === null) return null
	try {
		ctx = new Ctor()
		master = ctx.createGain()
		master.gain.value = settings.volume
		master.connect(ctx.destination)
		for (const cue of CUE_NAMES) load(ctx, cue)
		load(ctx, THEME, syncMusic)
	} catch {
		ctx = null
		master = null
	}
	return ctx
}

/** Unlock audio on the first gesture (call once at app start). */
export function installSoundUnlock(): void {
	if (typeof window === 'undefined') return
	const unlock = () => {
		const c = ensure()
		if (c !== null && c.state === 'suspended')
			void c.resume().then(syncMusic, () => undefined)
		else syncMusic()
	}
	window.addEventListener('pointerdown', unlock, { capture: true })
	window.addEventListener('keydown', unlock, { capture: true })
}

/** The live context, or null when sound is off / unavailable / still locked. */
function live(): { c: AudioContext; out: GainNode } | null {
	if (!settings.enabled || settings.volume === 0) return null
	const c = ensure()
	if (c === null || master === null) return null
	if (c.state === 'suspended') {
		void c.resume()
		return null
	}
	return { c, out: master }
}

// ---------------------------------------------------------------------------
// Cues
// ---------------------------------------------------------------------------

export type Cue =
	| 'click'
	| 'play'
	| 'activate'
	| 'swoosh'
	| 'land'
	| 'pass'
	| 'endTurn'
	| 'mission'
	| 'alert'
	| 'warning'
	| 'undo'
	| 'beam'
	| 'victory'
	| 'defeat'

/** When the last game cue played (performance.now ms) — lets the generic
 *  button click stay quiet when the button already made its own sound. */
let lastCueAt = -Infinity
/** Throttle per cue so a burst of flights is one sweep, not a wall of noise. */
const lastByCue: Partial<Record<Cue, number>> = {}
const MIN_GAP: Partial<Record<Cue, number>> = {
	swoosh: 70,
	land: 60,
	click: 40,
	alert: 2500,
	warning: 900,
}

function now(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

const CUE_NAMES: Cue[] = [
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

export interface CueOpts {
	/** -1 (left) .. 1 (right) — where on screen it happens */
	pan?: number | undefined
	/** a swoosh's pan at the end of its flight */
	panTo?: number | undefined
}

export function playCue(cue: Cue, opts: CueOpts = {}): void {
	const t = now()
	const gap = MIN_GAP[cue]
	if (gap !== undefined && t - (lastByCue[cue] ?? -Infinity) < gap) return
	lastByCue[cue] = t
	if (cue !== 'click' && cue !== 'swoosh' && cue !== 'land') lastCueAt = t
	const a = live()
	if (a === null) return
	const { c, out } = a
	try {
		const b = buffers.get(cue)
		if (b === undefined) {
			load(c, cue)
			return
		}
		const src = c.createBufferSource()
		src.buffer = b
		let tail: AudioNode = src
		const canPan = typeof c.createStereoPanner === 'function'
		if (opts.pan !== undefined && canPan) {
			const p = c.createStereoPanner()
			const t0 = c.currentTime
			p.pan.setValueAtTime(opts.pan, t0)
			p.pan.linearRampToValueAtTime(opts.panTo ?? opts.pan, t0 + b.duration)
			src.connect(p)
			tail = p
		}
		tail.connect(out)
		src.start()
	} catch {
		// a cue must never break the game
	}
}

/** True when a game cue sounded in the last `ms` (the click listener's guard). */
export function cuedRecently(ms = 120): boolean {
	return now() - lastCueAt < ms
}

/** Screen x (px) → stereo pan. */
export function panAt(x: number): number {
	const w = typeof window !== 'undefined' ? window.innerWidth : 0
	if (w <= 0) return 0
	return Math.max(-0.8, Math.min(0.8, (x / w) * 2 - 1))
}

// ---------------------------------------------------------------------------
// Main-menu theme (sounds/theme.*), looped while the menu is open
// ---------------------------------------------------------------------------

const THEME = 'theme'
const FADE_S = 1.2
/** the theme comes in fast; leaving it fades out gently */
const FADE_IN_S = 0.25
let wantMusic = false
let music: { src: AudioBufferSourceNode; gain: GainNode } | null = null

function syncMusic(): void {
	const on = wantMusic && settings.enabled && settings.music
	if (!on) {
		if (music !== null && ctx !== null) {
			const { src, gain } = music
			const t = ctx.currentTime
			gain.gain.cancelScheduledValues(t)
			gain.gain.setValueAtTime(gain.gain.value, t)
			gain.gain.linearRampToValueAtTime(0, t + FADE_S)
			try {
				src.stop(t + FADE_S + 0.05)
			} catch {
				// already stopped
			}
		}
		music = null
		return
	}
	if (music !== null) return
	const c = ctx
	if (c === null || master === null || c.state !== 'running') return
	const b = buffers.get(THEME)
	if (b === undefined) {
		load(c, THEME, syncMusic)
		return
	}
	try {
		const src = c.createBufferSource()
		src.buffer = b
		src.loop = true
		const gain = c.createGain()
		gain.gain.setValueAtTime(0, c.currentTime)
		gain.gain.linearRampToValueAtTime(0.8, c.currentTime + FADE_IN_S)
		src.connect(gain)
		gain.connect(master)
		src.start()
		music = { src, gain }
	} catch {
		music = null
	}
}

/** The main menu is open (true) or closed (false). The theme starts once
 *  audio is unlocked by the first tap or key press. */
export function setMenuMusic(on: boolean): void {
	wantMusic = on
	syncMusic()
}

// ---------------------------------------------------------------------------
// Red alert flash (drawn by RedAlertFlash in alertFlash.tsx)
// ---------------------------------------------------------------------------

export type FlashKind = 'alert' | 'warning'
let flashSeq = 0
let flash: { seq: number; kind: FlashKind } | null = null
const flashListeners = new Set<() => void>()

export function triggerFlash(kind: FlashKind): void {
	flash = { seq: ++flashSeq, kind }
	for (const l of flashListeners) l()
}

export function useFlash(): { seq: number; kind: FlashKind } | null {
	return useSyncExternalStore(
		(l) => {
			flashListeners.add(l)
			return () => flashListeners.delete(l)
		},
		() => flash,
		() => flash,
	)
}

/** Red alert: klaxon + flashing lights. `warning` is the short version. */
export function redAlert(kind: FlashKind = 'alert'): void {
	playCue(kind)
	triggerFlash(kind)
}
