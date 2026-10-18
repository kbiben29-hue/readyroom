// Training math for the learned value (src/bot/learned.ts): a tanh MLP fitted
// by minibatch Adam on a weighted squared error, with early stopping on a
// validation set. Used by tools/train-value.ts; kept in src/bot so its unit
// tests run with the bot tests. Not imported by the app.
//
// Deterministic: initialisation and shuffling come from a seeded PRNG
// (mulberry32), never Math.random.

/** A dense data set: n rows of d inputs, targets y and optional weights w. */
export interface Dataset {
	n: number
	d: number
	/** row-major n × d */
	x: Float32Array
	y: Float32Array
	/** per-row loss weights (default 1) */
	w?: Float32Array | undefined
}

/** A tanh MLP: layer k maps sizes[k] → sizes[k+1]; W[k] is row-major
 *  [out][in]. Every layer, the output included, is tanh. */
export interface Mlp {
	sizes: number[]
	W: Float64Array[]
	b: Float64Array[]
}

/** mulberry32: a small seeded PRNG returning floats in [0, 1). */
export function seededRandom(seed: number): () => number {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** Fisher–Yates shuffle in place. */
export function shuffleInPlace(
	xs: Uint32Array | number[],
	rand: () => number,
): void {
	for (let i = xs.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1))
		const t = xs[i]!
		xs[i] = xs[j]!
		xs[j] = t
	}
}

/** Glorot-uniform weights, zero biases. */
export function initMlp(sizes: readonly number[], seed: number): Mlp {
	const rand = seededRandom(seed)
	const W: Float64Array[] = []
	const b: Float64Array[] = []
	for (let k = 0; k + 1 < sizes.length; k++) {
		const nIn = sizes[k]!
		const nOut = sizes[k + 1]!
		const lim = Math.sqrt(6 / (nIn + nOut))
		const w = new Float64Array(nIn * nOut)
		for (let i = 0; i < w.length; i++) w[i] = (rand() * 2 - 1) * lim
		W.push(w)
		b.push(new Float64Array(nOut))
	}
	return { sizes: [...sizes], W, b }
}

export function cloneMlp(net: Mlp): Mlp {
	return {
		sizes: [...net.sizes],
		W: net.W.map((w) => Float64Array.from(w)),
		b: net.b.map((b) => Float64Array.from(b)),
	}
}

/** Activations of every layer for one input row (acts[0] = the input). */
function forwardActs(
	net: Mlp,
	x: Float32Array | Float64Array,
	offset: number,
	acts: Float64Array[],
): void {
	const a0 = acts[0]!
	for (let i = 0; i < a0.length; i++) a0[i] = x[offset + i]!
	for (let k = 0; k < net.W.length; k++) {
		const nIn = net.sizes[k]!
		const nOut = net.sizes[k + 1]!
		const w = net.W[k]!
		const bias = net.b[k]!
		const inp = acts[k]!
		const out = acts[k + 1]!
		for (let o = 0; o < nOut; o++) {
			let s = bias[o]!
			const row = o * nIn
			for (let i = 0; i < nIn; i++) s += w[row + i]! * inp[i]!
			out[o] = Math.tanh(s)
		}
	}
}

function newActs(net: Mlp): Float64Array[] {
	return net.sizes.map((s) => new Float64Array(s))
}

/** The network's output for row `row` of `x` (d = sizes[0] columns). */
export function predictRow(
	net: Mlp,
	x: Float32Array | Float64Array,
	row: number,
	acts: Float64Array[] = newActs(net),
): number {
	forwardActs(net, x, row * net.sizes[0]!, acts)
	return acts[acts.length - 1]![0]!
}

/** Predictions for every row of a data set. */
export function predictAll(net: Mlp, data: Dataset): Float64Array {
	const acts = newActs(net)
	const out = new Float64Array(data.n)
	for (let r = 0; r < data.n; r++) out[r] = predictRow(net, data.x, r, acts)
	return out
}

/** Weighted mean squared error of the network on `data`. */
export function mse(net: Mlp, data: Dataset): number {
	const p = predictAll(net, data)
	let s = 0
	let ws = 0
	for (let r = 0; r < data.n; r++) {
		const w = data.w?.[r] ?? 1
		const e = p[r]! - data.y[r]!
		s += w * e * e
		ws += w
	}
	return ws > 0 ? s / ws : NaN
}

/** Gradient buffers shaped like the network. */
export interface Grads {
	W: Float64Array[]
	b: Float64Array[]
}

export function zeroGrads(net: Mlp): Grads {
	return {
		W: net.W.map((w) => new Float64Array(w.length)),
		b: net.b.map((b) => new Float64Array(b.length)),
	}
}

/**
 * Loss and gradient over the rows `rows` (indices into `data`): the weighted
 * mean squared error Σ w (ŷ − y)² / Σ w. Gradients are written into `g`
 * (overwritten). Returns the loss.
 */
export function lossAndGrad(
	net: Mlp,
	data: Dataset,
	rows: ArrayLike<number>,
	g: Grads = zeroGrads(net),
	scratch?: { acts: Float64Array[]; delta: Float64Array[] },
): number {
	for (const w of g.W) w.fill(0)
	for (const b of g.b) b.fill(0)
	const acts = scratch?.acts ?? newActs(net)
	const delta = scratch?.delta ?? net.sizes.map((s) => new Float64Array(s))
	const L = net.W.length
	let wsum = 0
	for (let t = 0; t < rows.length; t++) wsum += data.w?.[rows[t]!] ?? 1
	if (!(wsum > 0)) return 0
	let loss = 0
	for (let t = 0; t < rows.length; t++) {
		const r = rows[t]!
		const wr = (data.w?.[r] ?? 1) / wsum
		forwardActs(net, data.x, r * data.d, acts)
		const yhat = acts[L]![0]!
		const e = yhat - data.y[r]!
		loss += wr * e * e
		// dL/dz at the output (tanh): 2 e w · (1 − ŷ²)
		delta[L]![0] = 2 * e * wr * (1 - yhat * yhat)
		for (let k = L - 1; k >= 0; k--) {
			const nIn = net.sizes[k]!
			const nOut = net.sizes[k + 1]!
			const w = net.W[k]!
			const gw = g.W[k]!
			const gb = g.b[k]!
			const inp = acts[k]!
			const dOut = delta[k + 1]!
			const dIn = delta[k]!
			if (k > 0) dIn.fill(0)
			for (let o = 0; o < nOut; o++) {
				const d = dOut[o]!
				if (d === 0) continue
				gb[o] = gb[o]! + d
				const row = o * nIn
				for (let i = 0; i < nIn; i++) {
					gw[row + i] = gw[row + i]! + d * inp[i]!
					if (k > 0) dIn[i] = dIn[i]! + d * w[row + i]!
				}
			}
			if (k > 0)
				for (let i = 0; i < nIn; i++) {
					const a = inp[i]!
					dIn[i] = dIn[i]! * (1 - a * a)
				}
		}
	}
	return loss
}

export interface TrainOptions {
	epochs?: number | undefined
	batch?: number | undefined
	lr?: number | undefined
	/** decoupled weight decay per step (AdamW), times lr */
	weightDecay?: number | undefined
	/** epochs without a validation improvement before stopping */
	patience?: number | undefined
	seed?: number | undefined
	/** called after every epoch */
	onEpoch?:
		| ((info: { epoch: number; trainLoss: number; valLoss: number }) => void)
		| undefined
}

export interface TrainResult {
	/** the network at the best validation loss */
	net: Mlp
	bestValLoss: number
	bestEpoch: number
	epochs: number
}

/** Minibatch AdamW with early stopping on `val`'s loss. Deterministic for a
 *  given seed. `net` is trained in place; the best copy is returned. */
export function trainMlp(
	net: Mlp,
	train: Dataset,
	val: Dataset,
	opts: TrainOptions = {},
): TrainResult {
	const epochs = opts.epochs ?? 40
	const batch = opts.batch ?? 256
	const lr = opts.lr ?? 1e-3
	const wd = opts.weightDecay ?? 1e-4
	const patience = opts.patience ?? 4
	const rand = seededRandom((opts.seed ?? 1) ^ 0x5eed)
	const beta1 = 0.9
	const beta2 = 0.999
	const eps = 1e-8
	const g = zeroGrads(net)
	const m = zeroGrads(net)
	const v = zeroGrads(net)
	const scratch = {
		acts: newActs(net),
		delta: net.sizes.map((s) => new Float64Array(s)),
	}
	const order = new Uint32Array(train.n)
	for (let i = 0; i < train.n; i++) order[i] = i
	let step = 0
	let best = cloneMlp(net)
	let bestVal = mse(net, val)
	let bestEpoch = 0
	let since = 0
	let epoch = 0
	for (epoch = 1; epoch <= epochs; epoch++) {
		shuffleInPlace(order, rand)
		let lossSum = 0
		let batches = 0
		for (let s = 0; s < train.n; s += batch) {
			const rows = order.subarray(s, Math.min(train.n, s + batch))
			lossSum += lossAndGrad(net, train, rows, g, scratch)
			batches++
			step++
			const c1 = 1 - Math.pow(beta1, step)
			const c2 = 1 - Math.pow(beta2, step)
			const update = (
				p: Float64Array,
				gp: Float64Array,
				mp: Float64Array,
				vp: Float64Array,
				decay: boolean,
			) => {
				for (let i = 0; i < p.length; i++) {
					const gi = gp[i]!
					mp[i] = beta1 * mp[i]! + (1 - beta1) * gi
					vp[i] = beta2 * vp[i]! + (1 - beta2) * gi * gi
					const mh = mp[i]! / c1
					const vh = vp[i]! / c2
					p[i] =
						p[i]! - lr * (mh / (Math.sqrt(vh) + eps) + (decay ? wd * p[i]! : 0))
				}
			}
			for (let k = 0; k < net.W.length; k++) {
				update(net.W[k]!, g.W[k]!, m.W[k]!, v.W[k]!, true)
				update(net.b[k]!, g.b[k]!, m.b[k]!, v.b[k]!, false)
			}
		}
		const valLoss = mse(net, val)
		opts.onEpoch?.({
			epoch,
			trainLoss: lossSum / Math.max(1, batches),
			valLoss,
		})
		if (valLoss < bestVal - 1e-6) {
			bestVal = valLoss
			best = cloneMlp(net)
			bestEpoch = epoch
			since = 0
		} else if (++since >= patience) break
	}
	return {
		net: best,
		bestValLoss: bestVal,
		bestEpoch,
		epochs: Math.min(epoch, epochs),
	}
}

/** Fraction of rows with a decided outcome (y ≠ 0) whose prediction has the
 *  outcome's sign. */
export function signAccuracy(
	pred: ArrayLike<number>,
	outcome: ArrayLike<number>,
): number {
	let ok = 0
	let n = 0
	for (let i = 0; i < pred.length; i++) {
		const y = outcome[i]!
		if (y === 0) continue
		n++
		if ((pred[i]! > 0 && y > 0) || (pred[i]! < 0 && y < 0)) ok++
	}
	return n === 0 ? NaN : ok / n
}

/** Weighted mean squared error of fixed predictions. */
export function mseOf(
	pred: ArrayLike<number>,
	y: ArrayLike<number>,
	w?: ArrayLike<number>,
): number {
	let s = 0
	let ws = 0
	for (let i = 0; i < pred.length; i++) {
		const wi = w?.[i] ?? 1
		const e = pred[i]! - y[i]!
		s += wi * e * e
		ws += wi
	}
	return ws > 0 ? s / ws : NaN
}

/** Round to `digits` significant digits (keeps the weights file small). */
export function roundSig(x: number, digits = 5): number {
	if (x === 0 || !Number.isFinite(x)) return x
	return Number(x.toPrecision(digits))
}
