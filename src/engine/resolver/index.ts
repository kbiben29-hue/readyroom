// Resolver public surface (todo/04). Wires the stack machine, probe mode and
// the choice resume flow together; todo/06/07 build intents + the full choice
// surface on top of this.

export {
	run,
	runCollecting,
	executeOne,
	pushEffect,
	pushOperation,
	drainEvents,
	MAX_STEPS,
} from './stack'
export { probe } from './probe'
export {
	applyChoice,
	probeFirstChoice,
	validateSelection,
	validateChoice,
	checkSelection,
	IllegalSelectionError,
} from './choices'
export type {
	PendingChoice,
	ResolveChoiceIntent,
	ChoiceSeed,
	ChoiceBase,
	ChoiceOption,
	ChoiceDisabledCard,
	ChoiceCardsContext,
	ValidateResult,
} from './choices'
export { PRIMITIVES, canResolveEffect, canPayAll } from './primitives'
export type { Primitive } from './primitives'
export type * from './nodes'
export type * from './queries'
