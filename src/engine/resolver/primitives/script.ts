import type { Effect } from '../nodes'
import type { Primitive } from './index'
import type { EffectCtx } from '../../state'
import type { CardInstanceId } from '../../ids'
import { placeEnlisted } from './enlistDevelopment'

type State = Parameters<Primitive<Effect>['execute']>[0]

/** Named escape-hatch handlers (docs/effect-dsl.md §8) — a small registry of
 *  hand-written functions for effects no node combination expresses. Budget:
 *  at most 5 SCRIPT cards across the whole game; track in todo/12/13. */
export interface ScriptHandler {
	canResolve(
		state: State,
		node: Extract<Effect, { k: 'SCRIPT' }>,
		ctx: EffectCtx,
	): boolean
	execute(
		state: State,
		node: Extract<Effect, { k: 'SCRIPT' }>,
		ctx: EffectCtx,
	): State
}

const HANDLERS = new Map<string, ScriptHandler>()

export function registerScript(fn: string, handler: ScriptHandler): void {
	HANDLERS.set(fn, handler)
}

export const script: Primitive<Extract<Effect, { k: 'SCRIPT' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		const h = HANDLERS.get(node.fn)
		return h !== undefined && h.canResolve(state, node, ctx)
	},
	execute(state, node, ctx, _frame) {
		const h = HANDLERS.get(node.fn)
		if (!h) throw new Error(`SCRIPT: no handler registered for '${node.fn}'`)
		return h.execute(state, node, ctx)
	},
}

// --- built-in named handlers -------------------------------------------------

// enlist.place: ENLIST_DEVELOPMENT pushes PAY_THEN(developmentCost, SCRIPT
// 'enlist.place'); the cost pays first, then this moves the chosen Development
// to the top of the actor's Draw deck.
registerScript('enlist.place', {
	canResolve: (_state, _node, ctx) =>
		typeof ctx.bindings['enlist.pick'] === 'string',
	execute: (state, _node, ctx) => {
		const pick = ctx.bindings['enlist.pick']
		if (typeof pick !== 'string')
			throw new Error(`enlist.place: no enlist.pick in bindings`)
		const iid = pick as CardInstanceId
		return placeEnlisted(state, iid, ctx.actor)
	},
})
