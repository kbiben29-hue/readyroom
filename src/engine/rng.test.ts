// RNG determinism (todo/05 §1): `shuffle` with the same seed+counter must
// yield the same permutation every time — this is what makes replay exact.
// The state threads `rng` through every consumer; there is no mutable
// generator and no Math.random anywhere in the engine (ESLint guards that).

import { describe, expect, it } from 'vitest'
import { next, shuffle, type Rng } from './rng'

describe('splitmix32-style counter RNG', () => {
	it('next() is stateless: same rng yields the same value, and counter advances by one', () => {
		const rng: Rng = { seed: 42, counter: 7 }
		const [a, r1] = next(rng)
		const [b, r2] = next(rng)
		expect(a).toBe(b)
		expect(r1.counter).toBe(8)
		expect(r2.counter).toBe(8)
		expect(rng.counter).toBe(7) // caller's rng untouched
	})

	it('values stay in [0, 1) and are deterministic across a run', () => {
		let r: Rng = { seed: 123, counter: 0 }
		const seen: number[] = []
		for (let i = 0; i < 100; i++) {
			const [u, nr] = next(r)
			r = nr
			expect(u).toBeGreaterThanOrEqual(0)
			expect(u).toBeLessThan(1)
			seen.push(u)
		}
		// second identical run reproduces the exact sequence
		let r2: Rng = { seed: 123, counter: 0 }
		for (let i = 0; i < 100; i++) {
			const [u, nr] = next(r2)
			r2 = nr
			expect(u).toBe(seen[i])
		}
	})

	it('shuffle with the same seed+counter yields the same permutation 1000×', () => {
		const items = Array.from({ length: 12 }, (_, i) => `c${i}`)
		const rng: Rng = { seed: 99, counter: 0 }
		const [first, firstR] = shuffle(items, rng)
		let r = firstR
		for (let i = 0; i < 1000; i++) {
			const [perm, nr] = shuffle(items, rng)
			r = nr
			expect(perm).toEqual(first)
			expect(perm).toHaveLength(12)
			expect(new Set(perm).size).toBe(12)
		}
		expect(r.counter).toBeGreaterThan(0)
	})

	it('different seeds produce different permutations', () => {
		const items = Array.from({ length: 12 }, (_, i) => `c${i}`)
		const [a] = shuffle(items, { seed: 1, counter: 0 })
		const [b] = shuffle(items, { seed: 2, counter: 0 })
		expect(a).not.toEqual(b)
	})
})
