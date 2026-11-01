// Sound effects, synthesized on the fly with the Web Audio API — no audio
// files ship. Every cue is a few oscillators / a noise burst with an envelope,
// built when it plays and dropped when it ends.
//
// Stored per device like the theme (enabled + volume), every storage access
// guarded. Without an AudioContext (jsdom, old browsers) every cue is a no-op.
// Browsers keep audio locked until a user gesture, so the context is created
// (or resumed) on the first pointer / key press.

import { useSyncExternalStore } from 'react'

export const SOUND_KEY = 'ready-room.sound'

export interface SoundSettings {
	enabled: boolean
	/** 0..1 */
	volume: number
}

const DEFAULT: SoundSettings = { enabled: true, volume: 0.6 }

function readSettings(): SoundSettings {
	try {
		const raw = globalThis.localStorage?.getItem(SOUND_KEY)
		if (raw === null || raw === undefined) return DEFAULT
		const v = JSON.parse(raw) as Partial<SoundSettings>
		return {
			enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT.enabled,
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
let noise: AudioBuffer | null = null

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
		// a gentle limiter so stacked cues never clip
		const comp = ctx.createDynamicsCompressor()
		comp.threshold.value = -10
		comp.ratio.value = 6
		master.connect(comp)
		comp.connect(ctx.destination)
		const len = Math.floor(ctx.sampleRate * 1.5)
		noise = ctx.createBuffer(1, len, ctx.sampleRate)
		const d = noise.getChannelData(0)
		// deterministic-enough noise is irrelevant here: this is UI, not engine
		for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
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
		if (c !== null && c.state === 'suspended') void c.resume()
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

interface ToneOpts {
	type?: OscillatorType
	/** start frequency (Hz) */
	f: number
	/** end frequency, swept exponentially */
	to?: number
	/** seconds after now */
	at?: number
	dur: number
	gain?: number
	attack?: number
	pan?: number
}

function tone(c: AudioContext, out: AudioNode, o: ToneOpts): void {
	const t0 = c.currentTime + (o.at ?? 0)
	const osc = c.createOscillator()
	osc.type = o.type ?? 'sine'
	osc.frequency.setValueAtTime(o.f, t0)
	if (o.to !== undefined)
		osc.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur)
	const g = c.createGain()
	const peak = o.gain ?? 0.3
	const atk = o.attack ?? 0.005
	g.gain.setValueAtTime(0.0001, t0)
	g.gain.exponentialRampToValueAtTime(peak, t0 + atk)
	g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur)
	osc.connect(g)
	let tail: AudioNode = g
	if (o.pan !== undefined && typeof c.createStereoPanner === 'function') {
		const p = c.createStereoPanner()
		p.pan.value = Math.max(-1, Math.min(1, o.pan))
		g.connect(p)
		tail = p
	}
	tail.connect(out)
	osc.start(t0)
	osc.stop(t0 + o.dur + 0.02)
}

interface NoiseOpts {
	at?: number
	dur: number
	/** band-pass centre sweep (Hz) */
	f: number
	to: number
	q?: number
	gain?: number
	pan?: number
	panTo?: number
}

function whoosh(c: AudioContext, out: AudioNode, o: NoiseOpts): void {
	if (noise === null) return
	const t0 = c.currentTime + (o.at ?? 0)
	const src = c.createBufferSource()
	src.buffer = noise
	const bp = c.createBiquadFilter()
	bp.type = 'bandpass'
	bp.Q.value = o.q ?? 1.2
	bp.frequency.setValueAtTime(o.f, t0)
	bp.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur)
	const g = c.createGain()
	const peak = o.gain ?? 0.5
	g.gain.setValueAtTime(0.0001, t0)
	g.gain.exponentialRampToValueAtTime(peak, t0 + o.dur * 0.35)
	g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur)
	src.connect(bp)
	bp.connect(g)
	let tail: AudioNode = g
	if (o.pan !== undefined && typeof c.createStereoPanner === 'function') {
		const p = c.createStereoPanner()
		p.pan.setValueAtTime(o.pan, t0)
		p.pan.linearRampToValueAtTime(o.panTo ?? o.pan, t0 + o.dur)
		g.connect(p)
		tail = p
	}
	tail.connect(out)
	src.start(t0, Math.random() * 0.5)
	src.stop(t0 + o.dur + 0.02)
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
	| 'prompt'
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

export interface CueOpts {
	/** -1 (left) .. 1 (right) — where on screen it happens */
	pan?: number
	/** a swoosh's pan at the end of its flight */
	panTo?: number
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
		CUES[cue](c, out, opts)
	} catch {
		// a cue must never break the game
	}
}

/** True when a game cue sounded in the last `ms` (the click listener's guard). */
export function cuedRecently(ms = 120): boolean {
	return now() - lastCueAt < ms
}

const CUES: Record<
	Cue,
	(c: AudioContext, out: AudioNode, o: CueOpts) => void
> = {
	// soft console key tap
	click: (c, out) => {
		tone(c, out, { type: 'sine', f: 1850, dur: 0.045, gain: 0.08 })
		tone(c, out, { type: 'triangle', f: 920, dur: 0.03, gain: 0.05 })
	},
	// a bright two-step computer chirp
	play: (c, out) => {
		tone(c, out, { type: 'sine', f: 1320, to: 1760, dur: 0.07, gain: 0.22 })
		tone(c, out, {
			type: 'sine',
			f: 2350,
			to: 2640,
			at: 0.075,
			dur: 0.09,
			gain: 0.2,
		})
		tone(c, out, {
			type: 'triangle',
			f: 3520,
			at: 0.075,
			dur: 0.06,
			gain: 0.05,
		})
	},
	// a lower, rounder triple blip for using a card already in play
	activate: (c, out) => {
		tone(c, out, { type: 'sine', f: 990, dur: 0.05, gain: 0.2 })
		tone(c, out, { type: 'sine', f: 1480, at: 0.055, dur: 0.05, gain: 0.18 })
		tone(c, out, { type: 'sine', f: 1980, at: 0.11, dur: 0.08, gain: 0.16 })
	},
	// air rushing past as a token flies
	swoosh: (c, out, o) => {
		whoosh(c, out, {
			dur: 0.42,
			f: 500,
			to: 3200,
			q: 1.6,
			gain: 0.45,
			pan: o.pan ?? 0,
			panTo: o.panTo ?? o.pan ?? 0,
		})
		whoosh(c, out, { dur: 0.3, f: 1600, to: 6000, q: 3, gain: 0.12 })
	},
	// the token settling into place
	land: (c, out, o) => {
		tone(c, out, { type: 'sine', f: 2600, dur: 0.06, gain: 0.07, pan: o.pan })
	},
	// phase advance: a short rising two-tone
	pass: (c, out) => {
		tone(c, out, { type: 'sine', f: 660, dur: 0.09, gain: 0.16 })
		tone(c, out, { type: 'sine', f: 990, at: 0.09, dur: 0.14, gain: 0.16 })
	},
	// end of turn: the bridge-chime "boop-beep-boop"
	endTurn: (c, out) => {
		tone(c, out, { type: 'sine', f: 1046, dur: 0.12, gain: 0.18 })
		tone(c, out, { type: 'sine', f: 1568, at: 0.12, dur: 0.12, gain: 0.18 })
		tone(c, out, { type: 'sine', f: 784, at: 0.24, dur: 0.22, gain: 0.18 })
	},
	// mission complete: a rising brass-ish fanfare
	mission: (c, out) => {
		const notes = [523, 659, 784, 1046]
		notes.forEach((f, i) => {
			tone(c, out, {
				type: 'sawtooth',
				f,
				at: i * 0.12,
				dur: i === 3 ? 0.7 : 0.16,
				gain: 0.07,
				attack: 0.02,
			})
			tone(c, out, {
				type: 'triangle',
				f: f * 2,
				at: i * 0.12,
				dur: i === 3 ? 0.7 : 0.16,
				gain: 0.08,
			})
		})
	},
	// klaxon: four whooping sweeps, harsh and buzzy
	alert: (c, out) => {
		const lp = c.createBiquadFilter()
		lp.type = 'lowpass'
		lp.frequency.value = 2800
		lp.connect(out)
		for (let i = 0; i < 4; i++) {
			const at = i * 0.7
			tone(c, lp, {
				type: 'sawtooth',
				f: 420,
				to: 880,
				at,
				dur: 0.5,
				gain: 0.2,
				attack: 0.03,
			})
			tone(c, lp, {
				type: 'square',
				f: 423,
				to: 884,
				at,
				dur: 0.5,
				gain: 0.08,
				attack: 0.03,
			})
			tone(c, lp, {
				type: 'square',
				f: 210,
				to: 440,
				at,
				dur: 0.5,
				gain: 0.06,
				attack: 0.03,
			})
		}
	},
	// a single warning whoop (an Incident lands on someone)
	warning: (c, out) => {
		const lp = c.createBiquadFilter()
		lp.type = 'lowpass'
		lp.frequency.value = 2400
		lp.connect(out)
		tone(c, lp, {
			type: 'sawtooth',
			f: 400,
			to: 800,
			dur: 0.45,
			gain: 0.16,
			attack: 0.03,
		})
		tone(c, lp, {
			type: 'square',
			f: 200,
			to: 400,
			dur: 0.45,
			gain: 0.05,
			attack: 0.03,
		})
	},
	// rewind: a falling sweep
	undo: (c, out) => {
		whoosh(c, out, { dur: 0.35, f: 3000, to: 500, q: 1.6, gain: 0.35 })
		tone(c, out, { type: 'sine', f: 1500, to: 700, dur: 0.2, gain: 0.08 })
	},
	// your input is needed
	prompt: (c, out) => {
		tone(c, out, { type: 'sine', f: 1760, dur: 0.08, gain: 0.12 })
		tone(c, out, { type: 'sine', f: 1760, at: 0.11, dur: 0.1, gain: 0.1 })
	},
	victory: (c, out) => {
		const notes = [392, 523, 659, 784, 1046]
		notes.forEach((f, i) =>
			tone(c, out, {
				type: 'triangle',
				f,
				at: i * 0.15,
				dur: i === notes.length - 1 ? 1.2 : 0.2,
				gain: 0.2,
			}),
		)
	},
	defeat: (c, out) => {
		const notes = [523, 466, 392, 311]
		notes.forEach((f, i) =>
			tone(c, out, {
				type: 'triangle',
				f,
				at: i * 0.22,
				dur: i === notes.length - 1 ? 1 : 0.24,
				gain: 0.18,
			}),
		)
	},
}

/** Screen x (px) → stereo pan. */
export function panAt(x: number): number {
	const w = typeof window !== 'undefined' ? window.innerWidth : 0
	if (w <= 0) return 0
	return Math.max(-0.8, Math.min(0.8, (x / w) * 2 - 1))
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
