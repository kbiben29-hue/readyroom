// Training math of the learned value (src/bot/valueTrain.ts): the analytic
// gradient matches finite differences, and Adam fits a toy problem.

import { describe, expect, it } from 'vitest'

import {
	initMlp,
	lossAndGrad,
	mse,
	seededRandom,
	signAccuracy,
	trainMlp,
	type Dataset,
} from './valueTrain'

function toy(n: number, seed: number): Dataset {
	const rand = seededRandom(seed)
	const d = 3
	const x = new Float32Array(n * d)
	const y = new Float32Array(n)
	const w = new Float32Array(n)
	for (let r = 0; r < n; r++) {
		for (let j = 0; j < d; j++) x[r * d + j] = rand() * 2 - 1
		y[r] = Math.tanh(
			1.5 * x[r * d]! - x[r * d + 1]! + 0.5 * x[r * d]! * x[r * d + 2]!,
		)
		w[r] = 0.5 + rand()
	}
	return { n, d, x, y, w }
}

describe('valueTrain', () => {
	it('the analytic gradient matches central finite differences', () => {
		const net = initMlp([3, 4, 3, 1], 7)
		const data = toy(6, 3)
		const rows = [0, 1, 2, 3, 4, 5]
		const g = lossAndGrad(net, data, rows)
		void g
		const grads = (() => {
			const out = {
				W: net.W.map((w) => new Float64Array(w.length)),
				b: net.b.map((b) => new Float64Array(b.length)),
			}
			lossAndGrad(net, data, rows, out)
			return out
		})()
		const eps = 1e-6
		let worst = 0
		const check = (p: Float64Array, gp: Float64Array) => {
			for (let i = 0; i < p.length; i++) {
				const keep = p[i]!
				p[i] = keep + eps
				const up = lossAndGrad(net, data, rows)
				p[i] = keep - eps
				const down = lossAndGrad(net, data, rows)
				p[i] = keep
				const num = (up - down) / (2 * eps)
				worst = Math.max(
					worst,
					Math.abs(num - gp[i]!) /
						Math.max(1e-6, Math.abs(num) + Math.abs(gp[i]!)),
				)
			}
		}
		for (let k = 0; k < net.W.length; k++) {
			check(net.W[k]!, grads.W[k]!)
			check(net.b[k]!, grads.b[k]!)
		}
		expect(worst).toBeLessThan(1e-5)
	})

	it('training lowers the validation loss on a toy problem, deterministically', () => {
		const train = toy(2000, 1)
		const val = toy(500, 2)
		const run = () => {
			const net = initMlp([3, 8, 1], 5)
			const before = mse(net, val)
			const res = trainMlp(net, train, val, {
				epochs: 30,
				lr: 1e-2,
				batch: 64,
				seed: 9,
			})
			return { before, after: res.bestValLoss, net: res.net }
		}
		const a = run()
		expect(a.after).toBeLessThan(a.before * 0.2)
		expect(a.after).toBeLessThan(0.02)
		const b = run()
		expect(b.after).toBe(a.after)
		expect(Array.from(b.net.W[0]!)).toEqual(Array.from(a.net.W[0]!))
	})

	it('sign accuracy ignores drawn outcomes', () => {
		expect(signAccuracy([0.5, -0.2, 0.9, 0.1], [1, 1, 0, -1])).toBeCloseTo(
			1 / 3,
		)
	})
})
