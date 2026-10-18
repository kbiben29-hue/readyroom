// House-AI seats on a session (todo/15 §4): an optional field, so old saves
// load unchanged, kept through export/import, and cleaned when malformed.

import { describe, expect, it, beforeAll } from 'vitest'
import type { CardCatalog } from '../engine/setup'
import { createSession } from './log'
import { exportSession, importSession, parseSession } from './persistence'
import { SessionAdapter } from './adapter'
import {
	decidersOf,
	hasBots,
	humanSeats,
	isSpectator,
	opponentsLabel,
	parseOpponents,
} from './opponents'
import { makeCatalog, sessionConfig } from './playGame'

let catalog: CardCatalog

beforeAll(async () => {
	catalog = await makeCatalog()
})

describe('session opponents', () => {
	it('is absent on a hot-seat session and survives export/import when set', () => {
		const hot = createSession(sessionConfig(), catalog, { id: 'h' })
		expect('opponents' in hot).toBe(false)
		expect(importSession(exportSession(hot)).opponents).toBeUndefined()

		const vs = createSession(sessionConfig(), catalog, {
			id: 'v',
			opponents: { 1: 'normal' },
		})
		const back = importSession(exportSession(vs))
		expect(back.opponents).toEqual({ 1: 'normal' })
		expect(back.opponents?.[1]).toBe('normal')
		expect(humanSeats(back.opponents)).toEqual([0])
	})

	it('keeps the field through adapter commits and undo', () => {
		const session = createSession(sessionConfig(), catalog, {
			id: 'a',
			opponents: { 0: 'easy' },
		})
		const adapter = new SessionAdapter({ session, catalog })
		adapter.dispatch({ t: 'START' })
		expect(adapter.session.opponents).toEqual({ 0: 'easy' })
		adapter.undo()
		expect(adapter.session.opponents).toEqual({ 0: 'easy' })
	})

	it('drops malformed entries instead of rejecting the save', () => {
		const session = createSession(sessionConfig(), catalog, { id: 'm' })
		const raw = { ...session, opponents: { 0: 'grandmaster', 1: 'hard' } }
		expect(parseSession(raw)?.opponents).toEqual({ 1: 'hard' })
		const junk = { ...session, opponents: 'yes' }
		const parsed = parseSession(junk)
		expect(parsed).not.toBeNull()
		expect(parsed!.opponents).toBeUndefined()
		expect(parseOpponents({ '0': 'easy', '1': 'first-legal' })).toEqual({
			0: 'easy',
			1: 'first-legal',
		})
	})

	it('labels the load list', () => {
		expect(opponentsLabel(undefined)).toBeNull()
		expect(opponentsLabel({ 1: 'normal' })).toBe('vs House AI (Normal)')
		expect(opponentsLabel({ 0: 'easy', 1: 'hard' })).toBe(
			'House AI (Easy) vs House AI (Hard)',
		)
		expect(hasBots({})).toBe(false)
		expect(isSpectator({ 0: 'easy', 1: 'hard' })).toBe(true)
	})

	it('decidersOf names the seat each logged intent was decided by', () => {
		const session = createSession(sessionConfig(), catalog, { id: 'd' })
		const adapter = new SessionAdapter({ session, catalog })
		adapter.dispatch({ t: 'START' })
		adapter.dispatch({ t: 'END_TURN' })
		const deciders = decidersOf(
			adapter.session.setup,
			adapter.session.log,
			catalog,
		)
		expect(deciders).toEqual([0, 0])
	})
})
