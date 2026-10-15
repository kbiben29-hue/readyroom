# TODO 01 — Project setup

**Depends on:** nothing. **Blocks:** everything.
**Estimate:** 2–3 h.

---

## 1. Scaffold

- [ ] `npm create vite@latest . -- --template react-ts`
- [ ] `npm i -D vitest @vitest/coverage-v8 typescript-eslint eslint prettier`
- [ ] `npm i zod zustand idb-keyval`
- [ ] `npm i -D sharp` _(sprite pipeline — Node only, not bundled)_

## 2. TypeScript config

- [ ] In `tsconfig.json` set:
  - `"strict": true`
  - `"noUncheckedIndexedAccess": true` — catches `zones[key]` being `undefined`, which **will**
    happen with a `Record<string, CardInstanceId[]>` zone map
  - `"exactOptionalPropertyTypes": true`
  - `"noImplicitOverride": true`
- [ ] Path aliases: `@engine/*`, `@data/*`, `@ui/*`, `@session/*` in both `tsconfig` and
      `vite.config.ts` (`resolve.alias`).

## 3. Determinism guardrails — do this now, not later

These are cheap now and save a painful debugging session later.

- [ ] ESLint rule banning `Math.random` inside `src/engine/**` and `src/data/**`:
  ```js
  // eslint.config.js
  {
    files: ['src/engine/**/*.ts', 'src/data/**/*.ts'],
    rules: { 'no-restricted-properties': ['error',
      { object: 'Math', property: 'random', message: 'Use state.rng (src/engine/rng.ts).' }] }
  }
  ```
- [ ] ESLint rule banning `Date.now()` / `new Date()` in `src/engine/**` for the same reason.
- [ ] ESLint rule banning imports from `src/ui` inside `src/engine`:
  ```js
  { files: ['src/engine/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['@ui/*', '../ui/*', '**/ui/**'] }] } }
  ```
- [ ] A test that asserts the engine is DOM-free: `vitest --environment node` for
      `src/engine/**/*.test.ts` (set `environmentMatchGlobs` in `vitest.config.ts`).

## 4. The serialisability invariant

`GameState` must round-trip through JSON. Enforce it mechanically.

- [ ] Write `src/engine/invariants.ts`:
  ```ts
  export function assertSerialisable(state: unknown): void {
  	const seen = new WeakSet()
  	;(function walk(v: unknown, path: string): void {
  		if (v === null || typeof v !== 'object') {
  			if (typeof v === 'function') throw new Error(`function at ${path}`)
  			if (typeof v === 'bigint' || typeof v === 'symbol')
  				throw new Error(`${typeof v} at ${path}`)
  			return
  		}
  		if (v instanceof Map || v instanceof Set)
  			throw new Error(`Map/Set at ${path}`)
  		if (v instanceof Date) throw new Error(`Date at ${path}`)
  		if (seen.has(v as object)) throw new Error(`cycle at ${path}`)
  		seen.add(v as object)
  		for (const [k, child] of Object.entries(v)) walk(child, `${path}.${k}`)
  	})(state, '$')
  }
  ```
- [ ] Call it at the end of **every** engine test (add it to a shared test helper), and behind
      `import.meta.env.DEV` after each `reduce()`.

> Why: the moment a `Map` or a card **object reference** sneaks into the state, save/load, undo
> and replay all break — and they break _silently_, hours later.

## 5. Directory skeleton

- [ ] Create the tree from `docs/architecture.md` §6 with an `index.ts` in each folder.
- [ ] Add `assets/spritesheets/` with a `README.md` stating what belongs there
      (see `docs/open-questions.md` B1).
- [ ] `.gitignore`: `node_modules`, `dist`, `assets/cards-raw/` (the sliced intermediates —
      regenerable, and there will be ~300 PNGs).
- [ ] **Do** commit `assets/atlas/` (the packed runtime atlases) and `src/data/cards/*.json`.

## 6. Scripts

- [ ] In `package.json`:
  ```json
  {
  	"dev": "vite",
  	"build": "npm run validate:cards && tsc -b && vite build",
  	"test": "vitest run",
  	"test:watch": "vitest",
  	"lint": "eslint src tools",
  	"sprites:slice": "tsx tools/slice-sprites.ts",
  	"sprites:pack": "tsx tools/pack-atlas.ts",
  	"validate:cards": "tsx tools/validate-cards.ts",
  	"authoring": "vite --config tools/authoring/vite.config.ts"
  }
  ```
- [ ] `npm i -D tsx`.

## 7. Git

- [ ] `git init` (the directory is **not** currently a repo).
- [ ] First commit: the rules markdown, the docs, these todos, the skeleton.
- [ ] **Commit the rulebook PDF too** — it's 9.8 MB but it is the ground truth for every ruling
      you will argue with yourself about. (If you'd rather not, add it to `.gitignore` and note
      the source URL in `rules/00-index.md`.)

---

## Definition of Done

- [ ] `npm run dev` serves a blank page.
- [ ] `npm test` runs and passes zero tests without error.
- [ ] `npm run lint` passes.
- [ ] Adding `Math.random()` to a file in `src/engine/` **fails lint**.
- [ ] Adding `import { Foo } from '@ui/Foo'` to a file in `src/engine/` **fails lint**.
- [ ] `assertSerialisable({ a: new Map() })` throws.
