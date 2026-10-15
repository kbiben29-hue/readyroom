// Engine public surface (todo/06: setup, the 4-phase turn loop and the intent
// layer are the top-level entry points; todo/05 finalised state/rng/queries).
export * from './resolver'
export * from './choiceUi'
export * from './ids'
export { next, shuffle } from './rng'
export type { Rng } from './rng'
export * from './state'
export { registerCards, cardDef, hasCardDef } from './cards'
export * from './setup'
export * from './phases'
export * from './intents'
export * from './endgame'
export {
	describe,
	describeOperation,
	describeTrigger,
	describeAmount,
	describePredicate,
	describeFilter,
	describeQuery,
} from './describe'
