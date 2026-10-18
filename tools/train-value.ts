#!/usr/bin/env -S npx tsx
// Train the house AI's learned value (src/bot/learned.ts) on self-play
// records (tools/selfplay.ts / tools/arena.ts --records). docs/bot.md
// "Learned value" describes the method.
//
//   npx tsx tools/train-value.ts --data .bot-data/it0 --out .bot-data/candidate-value.json
//   npx tsx tools/train-value.ts --data .bot-data/it0 --search --jobs 6
//
// What it does
//   1. reads every *.jsonl under --data (files or directories, comma list),
//      drops duplicate games (a deterministic bot against itself plays the
//      seat-swapped half of a pair move for move);
//   2. splits BY GAME PAIR (`<pairing>-<seed>`, both seat-swapped halves
//      together), never by line: --val-pct of the pairs (by a hash of the
//      key) are validation;
//   3. standardises the inputs of the chosen layout (learned.ts
//      INPUT_LAYOUTS) on the training rows, trains a tanh MLP with minibatch
//      AdamW and early stopping on the validation MSE against the outcome;
//   4. reports validation MSE and sign accuracy (does the value predict the
//      winner?) next to the hand-tuned evaluateNormalized on the same
//      positions (tanh(evaluate / EVAL_SCALE), and with its scale refit);
//   5. writes ValueWeights (5 significant digits) to --out, without a gate
//      (tools/retrain.ts runs the arena gate).
//
// Options
//   --data P[,P…]       JSONL files or directories (default .bot-data/it0)
//   --out FILE          weights JSON (default .bot-data/candidate-value.json)
//   --report FILE       the validation report as JSON
//   --layout L          pair | pair-masked | diff | diff-masked (default pair-masked)
//   --hidden 32,16      hidden layer sizes (default 32,16: 64,32 and
//                       128,64 overfit the ~1–2k training games sooner)
//   --target T          outcome | blend:<alpha> (alpha·outcome +
//                       (1−alpha)·tanh(margin / 15)); default outcome
//   --late X            row weight 1 + X·(turn / last turn of its game); default 0
//   --epochs N          max epochs (default 30); --patience N (default 4)
//   --lr X              Adam step (default 0.0001); --batch N (default 256)
//   --wd X              AdamW decoupled weight decay (default 0.0001)
//   --seed S            init + shuffle seed (default 1)
//   --val-pct P         validation share of the game pairs (default 15)
//   --no-swap           do not add the mirrored row of every record (by
//                       default each record also trains from the opponent's
//                       side; see loadRows)
//   --turn-start        train and validate on the first decision of each turn
//                       only (the positions closest to a search leaf)
//   --max-rows N        subsample the training rows (deterministic) for speed
//   --search            train a grid of layouts × targets × sizes in
//                       parallel child processes (--jobs J) and keep the best
//                       by validation MSE among the masked layouts (the
//                       unmasked one is reported as the ablation). Note: a
//                       lower validation MSE did not mean a stronger search
//                       in the arena (docs/bot.md); tools/retrain.ts trains
//                       its screened RECIPE unless asked to --search
//   --trained-on TEXT   meta.trainedOn description
//
// Runtime: about 30 s per configuration for ~2000 games (~1M mirrored rows)
// on a loaded core; --search runs 6 configurations with --jobs in parallel.

import {
	createReadStream,
	readdirSync,
	statSync,
	writeFileSync,
	readFileSync,
	mkdirSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'

import { loadCatalog } from '../src/data/catalog'
import { cardDataHash, hashString } from '../src/data/cardDataHash'
import {
	EVAL_SCALE,
	FEATURE_NAMES,
	evaluateFeatures,
} from '../src/bot/evaluate'
import {
	featureHash,
	inputColumns,
	inputVector,
	INPUT_LAYOUTS,
	INPUT_CLIP,
	valueOfFeatures,
	type InputLayout,
	type ValueWeights,
} from '../src/bot/learned'
import {
	initMlp,
	mseOf,
	predictAll,
	roundSig,
	seededRandom,
	signAccuracy,
	trainMlp,
	type Dataset,
	type Mlp,
} from '../src/bot/valueTrain'

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string> {
	const out: Record<string, string> = {}
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!
		if (!arg.startsWith('--')) throw new Error(`unexpected argument '${arg}'`)
		const eq = arg.indexOf('=')
		if (eq > 0) out[arg.slice(2, eq)] = arg.slice(eq + 1)
		else {
			const v = argv[i + 1]
			if (v === undefined || v.startsWith('--')) out[arg.slice(2)] = 'true'
			else {
				out[arg.slice(2)] = v
				i++
			}
		}
	}
	return out
}

const KNOWN = [
	'data',
	'out',
	'report',
	'layout',
	'hidden',
	'target',
	'late',
	'epochs',
	'patience',
	'lr',
	'wd',
	'batch',
	'seed',
	'val-pct',
	'max-rows',
	'search',
	'jobs',
	'trained-on',
	'quiet',
	'turn-start',
	'no-swap',
]

// ---------------------------------------------------------------------------
// records
// ---------------------------------------------------------------------------

interface Rows {
	n: number
	/** n × F own features, then n × F opponent features */
	f: Float32Array
	o: Float32Array
	outcome: Int8Array
	margin: Float32Array
	/** turn / last turn of its game */
	progress: Float32Array
	/** 1 for the first recorded decision of a turn (closest to a search
	 *  leaf, which is a settled state at the start of a turn) */
	turnStart: Uint8Array
	/** game pair index */
	pair: Int32Array
	pairKeys: string[]
	games: number
	duplicates: number
}

interface RawRecord {
	game: string
	seat: number
	turn: number
	step: number
	features: number[]
	opp: number[]
	outcome: 1 | 0 | -1
	margin: number
}

function listJsonl(spec: string): string[] {
	const out: string[] = []
	for (const p of spec
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)) {
		const st = statSync(p)
		if (st.isDirectory()) {
			for (const name of readdirSync(p).sort())
				if (name.endsWith('.jsonl')) out.push(join(p, name))
		} else out.push(p)
	}
	return out
}

/** The pair key of an arena game name `<pairing>-<seed>-<swap>`. */
function pairKeyOf(game: string): string {
	return game.replace(/-[01]$/, '')
}

/**
 * `swap`: every record also yields the mirrored row (the opponent's view:
 * its features as `me`, the decider's as `opp`, outcome and margin negated).
 * Records are taken at decision points, where `me` is nearly always the
 * active seat, but a search leaf is usually the start of the OTHER seat's
 * turn, scored from the root seat's side: without mirrored rows, inputs
 * such as turn.isActive and actions.available are far outside the training
 * distribution there.
 */
async function loadRows(files: string[], swap: boolean): Promise<Rows> {
	const F = FEATURE_NAMES.length
	const games = new Map<string, RawRecord[]>()
	const order: string[] = []
	for (const file of files) {
		const rl = createInterface({
			input: createReadStream(file),
			crlfDelay: Infinity,
		})
		for await (const line of rl) {
			if (line.trim() === '') continue
			const r = JSON.parse(line) as RawRecord
			if (r.features.length !== F || r.opp.length !== F)
				throw new Error(
					`${file}: a record has ${r.features.length} features, FEATURE_NAMES has ${F} (stale records: regenerate them)`,
				)
			// a file's game names are unique; prefix the file so two runs with
			// the same game name stay apart
			const key = `${file}|${r.game}`
			let g = games.get(key)
			if (g === undefined) {
				g = []
				games.set(key, g)
				order.push(key)
			}
			g.push(r)
		}
	}
	// drop duplicate games (identical position sequences)
	const seen = new Set<string>()
	const kept: RawRecord[][] = []
	let duplicates = 0
	for (const key of order) {
		const g = games.get(key)!
		const fp = hashString(
			g.map((r) => `${r.seat}:${r.features.join(',')}`).join('|'),
		)
		if (seen.has(fp)) {
			duplicates++
			continue
		}
		seen.add(fp)
		kept.push(g)
	}
	let n = 0
	for (const g of kept) n += g.length
	if (swap) n *= 2
	const rows: Rows = {
		n,
		f: new Float32Array(n * F),
		o: new Float32Array(n * F),
		outcome: new Int8Array(n),
		margin: new Float32Array(n),
		progress: new Float32Array(n),
		turnStart: new Uint8Array(n),
		pair: new Int32Array(n),
		pairKeys: [],
		games: kept.length,
		duplicates,
	}
	const pairIndex = new Map<string, number>()
	let i = 0
	for (const g of kept) {
		const pk = pairKeyOf(g[0]!.game)
		let p = pairIndex.get(pk)
		if (p === undefined) {
			p = rows.pairKeys.length
			pairIndex.set(pk, p)
			rows.pairKeys.push(pk)
		}
		let last = 1
		for (const r of g) last = Math.max(last, r.turn)
		let prevTurn = -1
		for (const r of g) {
			const start = r.turn !== prevTurn ? 1 : 0
			prevTurn = r.turn
			for (const mirrored of swap ? [false, true] : [false]) {
				rows.turnStart[i] = start
				rows.f.set(mirrored ? r.opp : r.features, i * F)
				rows.o.set(mirrored ? r.features : r.opp, i * F)
				rows.outcome[i] = mirrored ? -r.outcome : r.outcome
				rows.margin[i] = mirrored ? -r.margin : r.margin
				rows.progress[i] = r.turn / last
				rows.pair[i] = p
				i++
			}
		}
	}
	return rows
}

/** Validation pairs: a hash of the pair key, so the split is stable when
 *  more data is added. */
function isValPair(key: string, pct: number): boolean {
	return parseInt(hashString(`split|${key}`).slice(0, 8), 16) % 1000 < pct * 10
}

// ---------------------------------------------------------------------------
// datasets
// ---------------------------------------------------------------------------

interface Split {
	train: number[]
	val: number[]
}

function split(rows: Rows, pct: number): Split {
	const valPair = rows.pairKeys.map((k) => isValPair(k, pct))
	const train: number[] = []
	const val: number[] = []
	for (let i = 0; i < rows.n; i++)
		(valPair[rows.pair[i]!] ? val : train).push(i)
	return { train, val }
}

function rowFeatures(
	rows: Rows,
	i: number,
): { mine: Float32Array; theirs: Float32Array } {
	const F = FEATURE_NAMES.length
	return {
		mine: rows.f.subarray(i * F, (i + 1) * F),
		theirs: rows.o.subarray(i * F, (i + 1) * F),
	}
}

type Target = { kind: 'outcome' } | { kind: 'blend'; alpha: number }

function parseTarget(s: string): Target {
	if (s === 'outcome') return { kind: 'outcome' }
	const m = /^blend:([0-9.]+)$/.exec(s)
	if (m === null)
		throw new Error(`--target must be outcome | blend:<alpha> ('${s}')`)
	return { kind: 'blend', alpha: Number(m[1]) }
}

function targetOf(rows: Rows, i: number, t: Target): number {
	const y = rows.outcome[i]!
	if (t.kind === 'outcome') return y
	return t.alpha * y + (1 - t.alpha) * Math.tanh(rows.margin[i]! / EVAL_SCALE)
}

/** The raw input matrix of `idx` for a layout. */
function rawInputs(
	rows: Rows,
	idx: readonly number[],
	layout: InputLayout,
): Float32Array {
	const cols = inputColumns(layout)
	const d = cols.length
	const x = new Float32Array(idx.length * d)
	const buf = new Float64Array(d)
	for (let r = 0; r < idx.length; r++) {
		const { mine, theirs } = rowFeatures(rows, idx[r]!)
		inputVector(cols, mine, theirs, buf)
		x.set(buf, r * d)
	}
	return x
}

function normStats(
	x: Float32Array,
	n: number,
	d: number,
): { mean: number[]; std: number[] } {
	const mean = new Array<number>(d).fill(0)
	const sq = new Array<number>(d).fill(0)
	for (let r = 0; r < n; r++)
		for (let j = 0; j < d; j++) {
			const v = x[r * d + j]!
			mean[j]! += v
			sq[j]! += v * v
		}
	const std = new Array<number>(d)
	for (let j = 0; j < d; j++) {
		mean[j] = mean[j]! / n
		const varj = sq[j]! / n - mean[j]! * mean[j]!
		std[j] = Math.sqrt(Math.max(0, varj))
		if (std[j]! < 1e-6) std[j] = 0 // a constant column: input 0
	}
	return { mean, std }
}

function normalise(
	x: Float32Array,
	n: number,
	d: number,
	norm: { mean: number[]; std: number[] },
): void {
	for (let r = 0; r < n; r++)
		for (let j = 0; j < d; j++) {
			const s = norm.std[j]!
			let z = s > 0 ? (x[r * d + j]! - norm.mean[j]!) / s : 0
			if (z > INPUT_CLIP) z = INPUT_CLIP
			else if (z < -INPUT_CLIP) z = -INPUT_CLIP
			x[r * d + j] = z
		}
}

// ---------------------------------------------------------------------------
// baseline: the hand-tuned evaluation on the same positions
// ---------------------------------------------------------------------------

interface Metrics {
	mse: number
	sign: number
	/** on the last 40 % of each game (progress ≥ 0.6) */
	mseLate: number
	signLate: number
}

function metrics(
	pred: ArrayLike<number>,
	rows: Rows,
	idx: readonly number[],
): Metrics {
	const y = idx.map((i) => rows.outcome[i]!)
	const late = idx
		.map((i, k) => (rows.progress[i]! >= 0.6 ? k : -1))
		.filter((k) => k >= 0)
	const p = Array.from(pred)
	return {
		mse: mseOf(p, y),
		sign: signAccuracy(p, y),
		mseLate: mseOf(
			late.map((k) => p[k]!),
			late.map((k) => y[k]!),
		),
		signLate: signAccuracy(
			late.map((k) => p[k]!),
			late.map((k) => y[k]!),
		),
	}
}

function baselineEvals(rows: Rows, idx: readonly number[]): number[] {
	return idx.map((i) => {
		const { mine, theirs } = rowFeatures(rows, i)
		return evaluateFeatures(mine, theirs)
	})
}

/** The squash scale that minimises the training MSE of tanh(eval / s). */
function fitScale(evals: readonly number[], y: readonly number[]): number {
	let best = EVAL_SCALE
	let bestLoss = Infinity
	for (let s = 2; s <= 80; s *= 1.1) {
		const loss = mseOf(
			evals.map((e) => Math.tanh(e / s)),
			y,
		)
		if (loss < bestLoss) {
			bestLoss = loss
			best = s
		}
	}
	return best
}

// ---------------------------------------------------------------------------
// one configuration
// ---------------------------------------------------------------------------

interface Config {
	layout: InputLayout
	hidden: number[]
	target: string
	late: number
	epochs: number
	patience: number
	lr: number
	wd: number
	batch: number
	seed: number
	valPct: number
	maxRows: number | undefined
	turnStart: boolean
	swap: boolean
}

export interface Report {
	config: Config
	positions: { train: number; val: number }
	games: number
	duplicates: number
	pairs: { train: number; val: number }
	learned: Metrics
	baseline: Metrics
	baselineFit: Metrics & { scale: number }
	bestEpoch: number
	epochs: number
	seconds: number
}

function toWeights(
	net: Mlp,
	cfg: Config,
	norm: { mean: number[]; std: number[] },
	hash: string,
	report: Report,
	trainedOn: string,
): ValueWeights {
	const layers = net.W.map((w, k) => {
		const nIn = net.sizes[k]!
		const nOut = net.sizes[k + 1]!
		const rows: number[][] = []
		for (let o = 0; o < nOut; o++) {
			const row: number[] = []
			for (let i = 0; i < nIn; i++) row.push(roundSig(w[o * nIn + i]!))
			rows.push(row)
		}
		return { w: rows, b: Array.from(net.b[k]!, (x) => roundSig(x)) }
	})
	return {
		format: 1,
		layout: cfg.layout,
		featureHash: featureHash(cfg.layout),
		cardDataHash: hash,
		featureNames: inputColumns(cfg.layout).map((c) => c.name),
		norm: {
			mean: norm.mean.map((x) => roundSig(x)),
			std: norm.std.map((x) => roundSig(x)),
		},
		layers,
		meta: {
			trainedOn,
			games: report.games,
			positions: report.positions.train + report.positions.val,
			valLoss: roundSig(report.learned.mse, 4),
			signAccuracy: roundSig(report.learned.sign, 4),
			baselineSignAccuracy: roundSig(report.baseline.sign, 4),
			baselineValLoss: roundSig(report.baseline.mse, 4),
			target: cfg.target,
			hidden: cfg.hidden,
			late: cfg.late,
			turnStart: cfg.turnStart,
			mirrored: cfg.swap,
		},
	}
}

async function trainOne(
	cfg: Config,
	dataSpec: string,
	out: string,
	reportFile: string | undefined,
	trainedOn: string,
	quiet: boolean,
): Promise<Report> {
	const t0 = performance.now()
	const files = listJsonl(dataSpec)
	if (files.length === 0) throw new Error(`no .jsonl files in ${dataSpec}`)
	const rows = await loadRows(files, cfg.swap)
	const sp = split(rows, cfg.valPct)
	if (cfg.turnStart) {
		sp.train = sp.train.filter((i) => rows.turnStart[i] === 1)
		sp.val = sp.val.filter((i) => rows.turnStart[i] === 1)
	}
	let train = sp.train
	if (cfg.maxRows !== undefined && train.length > cfg.maxRows) {
		const rand = seededRandom(cfg.seed ^ 0xabc)
		train = train.filter(() => rand() < cfg.maxRows! / sp.train.length)
	}
	const val = sp.val
	const log = (s: string) => {
		if (!quiet) console.log(s)
	}
	log(
		`data: ${files.length} file(s), ${rows.games} games (${rows.duplicates} duplicates dropped), ${rows.n} positions; train ${train.length}, val ${val.length} positions`,
	)
	const cols = inputColumns(cfg.layout)
	const d = cols.length
	const target = parseTarget(cfg.target)
	const xTrain = rawInputs(rows, train, cfg.layout)
	const norm = normStats(xTrain, train.length, d)
	normalise(xTrain, train.length, d, norm)
	const xVal = rawInputs(rows, val, cfg.layout)
	normalise(xVal, val.length, d, norm)
	const trainSet: Dataset = {
		n: train.length,
		d,
		x: xTrain,
		y: Float32Array.from(train, (i) => targetOf(rows, i, target)),
		w:
			cfg.late > 0
				? Float32Array.from(train, (i) => 1 + cfg.late * rows.progress[i]!)
				: undefined,
	}
	const valSet: Dataset = {
		n: val.length,
		d,
		x: xVal,
		y: Float32Array.from(val, (i) => rows.outcome[i]!),
	}
	const net = initMlp([d, ...cfg.hidden, 1], cfg.seed)
	const res = trainMlp(net, trainSet, valSet, {
		epochs: cfg.epochs,
		batch: cfg.batch,
		lr: cfg.lr,
		weightDecay: cfg.wd,
		patience: cfg.patience,
		seed: cfg.seed,
		onEpoch: ({ epoch, trainLoss, valLoss }) =>
			log(
				`  epoch ${String(epoch).padStart(2)}: train ${trainLoss.toFixed(4)}  val ${valLoss.toFixed(4)}`,
			),
	})
	// the written (rounded) weights are what gets evaluated
	const hash = cardDataHash(await loadCatalog())
	const draft: Report = {
		config: cfg,
		positions: { train: train.length, val: val.length },
		games: rows.games,
		duplicates: rows.duplicates,
		pairs: {
			train: new Set(train.map((i) => rows.pair[i]!)).size,
			val: new Set(val.map((i) => rows.pair[i]!)).size,
		},
		learned: { mse: res.bestValLoss, sign: NaN, mseLate: NaN, signLate: NaN },
		baseline: { mse: NaN, sign: NaN, mseLate: NaN, signLate: NaN },
		baselineFit: {
			mse: NaN,
			sign: NaN,
			mseLate: NaN,
			signLate: NaN,
			scale: NaN,
		},
		bestEpoch: res.bestEpoch,
		epochs: res.epochs,
		seconds: 0,
	}
	const weights = toWeights(res.net, cfg, norm, hash, draft, trainedOn)
	const value = valueOfFeatures(weights)
	const predVal = val.map((i) => {
		const { mine, theirs } = rowFeatures(rows, i)
		return value(mine, theirs)
	})
	draft.learned = metrics(predVal, rows, val)
	// sanity: the compiled forward pass agrees with the trainer's
	const trainerPred = predictAll(res.net, valSet)
	let maxDiff = 0
	for (let k = 0; k < Math.min(500, val.length); k++)
		maxDiff = Math.max(maxDiff, Math.abs(trainerPred[k]! - predVal[k]!))
	if (maxDiff > 1e-3) throw new Error(`forward pass mismatch ${maxDiff}`)
	const evVal = baselineEvals(rows, val)
	draft.baseline = metrics(
		evVal.map((e) => Math.tanh(e / EVAL_SCALE)),
		rows,
		val,
	)
	const evTrain = baselineEvals(rows, train)
	const scale = fitScale(
		evTrain,
		train.map((i) => rows.outcome[i]!),
	)
	draft.baselineFit = {
		...metrics(
			evVal.map((e) => Math.tanh(e / scale)),
			rows,
			val,
		),
		scale,
	}
	draft.seconds = (performance.now() - t0) / 1000
	const final = toWeights(res.net, cfg, norm, hash, draft, trainedOn)
	final.meta.validation = {
		learned: draft.learned,
		baseline: draft.baseline,
		baselineFit: draft.baselineFit,
		pairs: draft.pairs,
	}
	mkdirSync(dirname(out), { recursive: true })
	writeFileSync(out, `${JSON.stringify(final)}\n`)
	if (reportFile !== undefined) {
		mkdirSync(dirname(reportFile), { recursive: true })
		writeFileSync(reportFile, JSON.stringify(draft, null, 2))
	}
	log(formatReport(draft))
	log(`weights → ${out}`)
	return draft
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`

export function formatReport(r: Report): string {
	const row = (label: string, m: Metrics) =>
		`  ${label.padEnd(30)} ${m.mse.toFixed(4).padStart(8)} ${pct(m.sign).padStart(8)} ${m.mseLate.toFixed(4).padStart(10)} ${pct(m.signLate).padStart(10)}`
	return [
		`config: layout ${r.config.layout}, hidden ${r.config.hidden.join('×')}, target ${r.config.target}, late ${r.config.late}; best epoch ${r.bestEpoch}/${r.epochs}; ${r.seconds.toFixed(0)} s`,
		`validation (${r.positions.val} positions from ${r.pairs.val} game pairs):`,
		`  ${''.padEnd(30)} ${'MSE'.padStart(8)} ${'sign'.padStart(8)} ${'MSE late'.padStart(10)} ${'sign late'.padStart(10)}`,
		row('learned', r.learned),
		row(`hand-tuned tanh(eval/${EVAL_SCALE})`, r.baseline),
		row(
			`hand-tuned tanh(eval/${r.baselineFit.scale.toFixed(1)}) (refit)`,
			r.baselineFit,
		),
	].join('\n')
}

// ---------------------------------------------------------------------------
// search: a small grid in parallel child processes
// ---------------------------------------------------------------------------

const SELF = new URL(import.meta.url).pathname

function runChild(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[...process.execArgv, SELF, ...args, '--quiet'],
			{
				stdio: ['ignore', 'inherit', 'inherit'],
			},
		)
		child.on('exit', (code) =>
			code === 0
				? resolve()
				: reject(
						new Error(`train-value child exited ${code}: ${args.join(' ')}`),
					),
		)
	})
}

async function search(args: Record<string, string>): Promise<void> {
	const out = args['out'] ?? '.bot-data/candidate-value.json'
	const dir = join(dirname(out), 'search')
	mkdirSync(dir, { recursive: true })
	const jobs = Number(args['jobs'] ?? 6)
	const grid: {
		layout: InputLayout
		target: string
		late: number
		hidden?: string
		lr?: string
	}[] = [
		{ layout: 'diff-masked', target: 'outcome', late: 0 },
		{ layout: 'diff-masked', target: 'blend:0.5', late: 0 },
		{ layout: 'diff-masked', target: 'blend:0', late: 0 },
		{
			layout: 'diff-masked',
			target: 'outcome',
			late: 0,
			hidden: 'none',
			lr: '0.001',
		},
		{ layout: 'pair-masked', target: 'outcome', late: 0 },
		{ layout: 'pair', target: 'outcome', late: 0 }, // the hidden-feature ablation
	]
	const tasks = grid.map((g, k) => ({
		...g,
		weights: join(dir, `w${k}.json`),
		report: join(dir, `r${k}.json`),
	}))
	const pass = [
		'no-swap',
		'turn-start',
		'data',
		'hidden',
		'epochs',
		'patience',
		'lr',
		'wd',
		'batch',
		'seed',
		'val-pct',
		'max-rows',
		'trained-on',
	]
	let next = 0
	await Promise.all(
		Array.from({ length: Math.min(jobs, tasks.length) }, async () => {
			while (next < tasks.length) {
				const t = tasks[next++]!
				const a: string[] = []
				for (const k of pass)
					if (args[k] !== undefined) a.push(`--${k}`, args[k]!)
				if (t.hidden !== undefined) a.push('--hidden', t.hidden)
				if (t.lr !== undefined) a.push('--lr', t.lr)
				a.push(
					'--layout',
					t.layout,
					'--target',
					t.target,
					'--late',
					String(t.late),
					'--out',
					t.weights,
					'--report',
					t.report,
				)
				await runChild(a)
			}
		}),
	)
	const reports = tasks.map((t) => ({
		t,
		r: JSON.parse(readFileSync(t.report, 'utf8')) as Report,
	}))
	console.log('search (validation MSE vs the outcome, sign accuracy):')
	for (const { t, r } of reports)
		console.log(
			`  ${t.layout.padEnd(12)} ${t.target.padEnd(10)} hidden ${(t.hidden ?? 'default').padEnd(7)} late ${t.late}  MSE ${r.learned.mse.toFixed(4)}  sign ${pct(r.learned.sign)}  late-MSE ${r.learned.mseLate.toFixed(4)}  late-sign ${pct(r.learned.signLate)}`,
		)
	const eligible = reports.filter(({ t }) => t.layout.endsWith('-masked'))
	eligible.sort((x, y) => x.r.learned.mse - y.r.learned.mse)
	const best = eligible[0]!
	console.log(
		`best (masked layouts only): ${best.t.layout} ${best.t.target} hidden ${best.t.hidden ?? 'default'} late ${best.t.late}`,
	)
	console.log(formatReport(best.r))
	const w = JSON.parse(readFileSync(best.t.weights, 'utf8')) as ValueWeights
	w.meta.search = reports.map(({ t, r }) => ({
		layout: t.layout,
		hidden: r.config.hidden,
		target: t.target,
		late: t.late,
		valLoss: roundSig(r.learned.mse, 4),
		signAccuracy: roundSig(r.learned.sign, 4),
	}))
	writeFileSync(out, `${JSON.stringify(w)}\n`)
	const reportFile = args['report']
	if (reportFile !== undefined)
		writeFileSync(
			reportFile,
			JSON.stringify(
				{ best: best.r, search: reports.map((x) => x.r) },
				null,
				2,
			),
		)
	console.log(
		`weights → ${out} (${(JSON.stringify(w).length / 1024).toFixed(0)} KB)`,
	)
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2))
	for (const k of Object.keys(args))
		if (!KNOWN.includes(k)) throw new Error(`unknown option --${k}`)
	const layout = (args['layout'] ?? 'pair-masked') as InputLayout
	if (!(INPUT_LAYOUTS as readonly string[]).includes(layout))
		throw new Error(`--layout must be one of ${INPUT_LAYOUTS.join(', ')}`)
	parseTarget(args['target'] ?? 'outcome')
	const cfg: Config = {
		layout,
		hidden: (args['hidden'] ?? '32,16')
			.split(',')
			.filter((x) => x.trim() !== '' && x !== 'none')
			.map(Number),
		target: args['target'] ?? 'outcome',
		late: Number(args['late'] ?? 0),
		epochs: Number(args['epochs'] ?? 30),
		patience: Number(args['patience'] ?? 4),
		lr: Number(args['lr'] ?? 1e-4),
		wd: Number(args['wd'] ?? 1e-4),
		batch: Number(args['batch'] ?? 256),
		seed: Number(args['seed'] ?? 1),
		valPct: Number(args['val-pct'] ?? 15),
		maxRows:
			args['max-rows'] === undefined ? undefined : Number(args['max-rows']),
		turnStart: args['turn-start'] === 'true',
		swap: args['no-swap'] !== 'true',
	}
	const data = args['data'] ?? '.bot-data/it0'
	const trainedOn = args['trained-on'] ?? `self-play records in ${data}`
	if (args['search'] === 'true') {
		await search(args)
		return
	}
	await trainOne(
		cfg,
		data,
		args['out'] ?? '.bot-data/candidate-value.json',
		args['report'],
		trainedOn,
		args['quiet'] === 'true',
	)
}

main().catch((e: unknown) => {
	console.error(e)
	process.exit(1)
})
