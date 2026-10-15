// Authoring-tool surface (todo/03 §5): the runtime enumerations, the schemas,
// and the hand-written types. Dropdowns built from TRAITS/SUITS/etc. stay in
// lock-step with the validator because both read this same module.

export * from './ids'
export { CardArraySchema, CardDefSchema } from './schema'
export { loadCatalog } from './catalog'
export type { CatalogError } from './catalog'
export type { CardDef } from './schema'
export type { Effect, Operation, TriggerSpec } from '../engine/resolver/nodes'
export type {
	Amount,
	CardFilter,
	CardQuery,
	LocationQuery,
	MarketQuery,
	Predicate,
	Query,
	VariableSkillSpec,
	ZoneSpec,
} from '../engine/resolver/queries'
