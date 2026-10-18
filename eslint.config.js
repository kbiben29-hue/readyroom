import tseslint from 'typescript-eslint'

export default tseslint.config(
	{ ignores: ['dist', 'node_modules', 'tools/bin'] },
	...tseslint.configs.recommended,
	{
		// The engine's primitive callbacks are declared with the full
		// `(state, node, ctx, frame)` signature even when a handler only needs some
		// of them; the `_`-prefix is the accepted convention (TS noUnusedParameters
		// already treats `_`-prefixed params as "intentionally unused").
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
				},
			],
		},
	},
	{
		// Determinism guardrails (todo/01 §3): engine + data never use wall-clock time
		// or Math.random; all randomness comes from state.rng. Tests may construct
		// Dates/Map/Set to exercise the invariants, so the guardrails skip *.test.ts.
		// The bots (src/bot) are held to the same rule: their sampler is seeded
		// from the seat's view (src/bot/determinize.ts). Decision timing uses
		// performance.now(), which only reports and never steers play.
		files: ['src/engine/**/*.ts', 'src/data/**/*.ts', 'src/bot/**/*.ts'],
		ignores: ['src/**/*.test.ts'],
		rules: {
			'no-restricted-properties': [
				'error',
				{
					object: 'Math',
					property: 'random',
					message: 'Use state.rng (src/engine/rng.ts).',
				},
				{
					object: 'Date',
					property: 'now',
					message: 'Use the intent log / stardate, not wall-clock time.',
				},
			],
			'no-restricted-syntax': [
				'error',
				{
					selector: "NewExpression[callee.name='Date']",
					message: 'Use the intent log / stardate, not wall-clock time.',
				},
			],
		},
	},
	{
		// The engine must stay DOM-free: no UI imports (todo/01 §3).
		files: ['src/engine/**/*.ts'],
		ignores: ['src/**/*.test.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{ patterns: ['@ui/*', '../ui/*', '**/ui/**'] },
			],
		},
	},
)
