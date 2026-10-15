// Deterministic RNG (todo/05 owns the final form; this is the counter-based
// core used by the resolver's shuffle-needing primitives). Never use
// Math.random / Date anywhere in the engine — state.rng is the only source of
// randomness, which is what makes replay exact.

export interface Rng {
	seed: number
	counter: number
}

/** Next [0,1) value and the advanced Rng. Stateless per call. */
export function next(rng: Rng): [number, Rng] {
	const c = rng.counter + 1
	let z = (rng.seed + c * 0x9e3779b9) >>> 0
	z ^= z >>> 16
	z = Math.imul(z, 0x21f0aaad)
	z ^= z >>> 15
	z = Math.imul(z, 0x735a2d97)
	z ^= z >>> 15
	return [(z >>> 0) / 4294967296, { ...rng, counter: c }]
}

/** Fisher–Yates shuffle; in-order (moves elements one at a time). */
export function shuffle<T>(items: readonly T[], rng: Rng): [T[], Rng] {
	const out = [...items]
	let r = rng
	for (let i = out.length - 1; i > 0; i--) {
		const [u, nextR] = next(r)
		r = nextR
		const j = Math.floor(u * (i + 1))
		const tmp = out[i] as T
		out[i] = out[j] as T
		out[j] = tmp
	}
	return [out, r]
}
