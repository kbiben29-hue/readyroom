#!/usr/bin/env -S npx tsx
// Bot-vs-bot arena (house AI, todo/15 §4). A thin CLI over src/bot/arena.ts:
// plays a schedule of seat-swapped game pairs in parallel worker threads,
// prints the results from bot A's side and writes summary.json.
//
//   npx tsx tools/arena.ts --a normal --b first-legal --games 200 --seed 1
//   npx tsx tools/arena.ts --a heuristic:samples=4,noise=0.5 --b normal \
//       --games 40 --pairings PIC-SHR,KOL-SIS --out arena/run1 --jobs 8
//   npx tsx tools/arena.ts --a normal --b normal --games 20 \
//       --records arena/self.jsonl --record-every 2
//
// Options
//   --a, --b <spec>       bot specs (src/bot/registry.ts BOT_FACTORIES):
//                         first-legal|easy|normal|hard|heuristic:k=v,…
//   --games N             games incl. swaps (rounded up to even; default 20)
//   --seed S              base seed (default 1)
//   --pairings P          all | nobur | PIC-SHR,KOL.B-SIS (default all)
//   --out DIR             write every game as a replayable session JSON
//                         (<pairing>-<seed>-<swap>.json) and summary.json
//   --records FILE        JSONL training records, one per decision
//   --record-every K      keep every K-th decision (default 1)
//   --jobs J              worker threads (default CPU cores − 1)
//   --cap N               intent cap per game (default playBots' 5000)
//   --weights n=FILE,…    learned value weights by name, for specs with
//                         value=<n> (e.g. --weights cand=.bot-data/c.json
//                         --a ismcts:value=cand); value=learned is the
//                         bundled src/bot/weights/value.json
//
// Results do not depend on --jobs: each game is a pure function of its
// (pairing, seed, swap) and the results are reported in schedule order.

import { availableParallelism } from 'node:os'
import {
	mkdirSync,
	readFileSync,
	writeFileSync,
	createWriteStream,
} from 'node:fs'
import { join, dirname } from 'node:path'
import {
	Worker,
	isMainThread,
	parentPort,
	workerData,
} from 'node:worker_threads'

import { loadCatalog } from '../src/data/catalog'
import {
	parsePairings,
	playMatch,
	scheduleGame,
	summarize,
	type MatchResult,
	type Tally,
} from '../src/bot/arena'
import { botFromSpec } from '../src/bot/registry'

interface Job {
	a: string
	b: string
	seed: number
	pairings: string
	cap: number | undefined
	recordEvery: number | undefined
	session: boolean
	/** learned weights by name (parsed JSON) */
	weights: Record<string, unknown>
}

/** Workers run this .ts file too, so they need tsx's loader. */
const TSX_API = import.meta.resolve('tsx/esm/api')
const WORKER_BOOT = `import { register } from ${JSON.stringify(TSX_API)}
register()
await import(${JSON.stringify(import.meta.url)})`

/** Fixed session timestamps: arena files are reproducible byte for byte. */
const SESSION_TIME = '2026-01-01T00:00:00.000Z'

// ---------------------------------------------------------------------------
// worker
// ---------------------------------------------------------------------------

async function workerMain(): Promise<void> {
	const job = workerData as Job
	const catalog = await loadCatalog()
	const ctx = { catalog, weights: job.weights }
	const botA = botFromSpec(job.a, ctx)
	const botB = botFromSpec(job.b, ctx)
	const pairings = parsePairings(job.pairings)
	parentPort!.on('message', (index: number | null) => {
		if (index === null) {
			parentPort!.close()
			return
		}
		const g = scheduleGame(index, job.seed, pairings)
		const r = playMatch(catalog, g.pairing, g.seed, botA, botB, g.swap, {
			cap: job.cap,
			recordEvery: job.recordEvery,
			session: job.session ? { now: () => new Date(SESSION_TIME) } : undefined,
		})
		parentPort!.postMessage({ index, result: r })
	})
	parentPort!.postMessage({ ready: true })
}

// ---------------------------------------------------------------------------
// main
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
			if (v === undefined || v.startsWith('--'))
				throw new Error(`option ${arg} needs a value`)
			out[arg.slice(2)] = v
			i++
		}
	}
	return out
}

const KNOWN = [
	'a',
	'b',
	'games',
	'seed',
	'pairings',
	'out',
	'records',
	'record-every',
	'jobs',
	'cap',
	'weights',
]

function intOpt(
	args: Record<string, string>,
	key: string,
	dflt: number | undefined,
): number | undefined {
	const raw = args[key]
	if (raw === undefined) return dflt
	const v = Number(raw)
	if (!Number.isInteger(v)) throw new Error(`--${key} must be an integer`)
	return v
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-')

function tallyRow(label: string, t: Tally): string {
	return [
		label.padEnd(14),
		String(t.games).padStart(5),
		String(t.aWins).padStart(6),
		String(t.bWins).padStart(6),
		String(t.draws).padStart(6),
		pct(t.aRate.p).padStart(7),
		`[${pct(t.aRate.lo)}, ${pct(t.aRate.hi)}]`.padStart(17),
		`${f(t.marginMean, 1)} ± ${f(t.marginSe, 1)}`.padStart(13),
		f(t.intentsMean, 0).padStart(8),
	].join(' ')
}

const HEADER = [
	''.padEnd(14),
	'games'.padStart(5),
	'A wins'.padStart(6),
	'B wins'.padStart(6),
	'draws'.padStart(6),
	'A rate'.padStart(7),
	'95% Wilson CI'.padStart(17),
	'margin A−B'.padStart(13),
	'intents'.padStart(8),
].join(' ')

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2))
	for (const k of Object.keys(args))
		if (!KNOWN.includes(k)) throw new Error(`unknown option --${k}`)
	const a = args['a'] ?? 'normal'
	const b = args['b'] ?? 'first-legal'
	let games = intOpt(args, 'games', 20)!
	if (games % 2 === 1) games++
	const seed = intOpt(args, 'seed', 1)!
	const pairingSpec = args['pairings'] ?? 'all'
	const out = args['out']
	const recordsFile = args['records']
	const recordEvery =
		recordsFile === undefined ? undefined : intOpt(args, 'record-every', 1)
	const jobs = Math.max(
		1,
		Math.min(
			games,
			intOpt(args, 'jobs', Math.max(1, availableParallelism() - 1))!,
		),
	)
	const cap = intOpt(args, 'cap', undefined)
	const weights: Record<string, unknown> = {}
	for (const part of (args['weights'] ?? '').split(',')) {
		if (part.trim() === '') continue
		const eq = part.indexOf('=')
		if (eq <= 0) throw new Error(`--weights: '${part}' is not name=file`)
		weights[part.slice(0, eq).trim()] = JSON.parse(
			readFileSync(part.slice(eq + 1).trim(), 'utf8'),
		)
	}
	// validate in the main thread before spawning
	const ctx = { catalog: await loadCatalog(), weights }
	botFromSpec(a, ctx)
	botFromSpec(b, ctx)
	const pairings = parsePairings(pairingSpec)

	console.log(
		`arena: A = ${a}, B = ${b}; ${games} games (${games / 2} seat-swapped pairs) over ${Math.min(pairings.length, games / 2)} of ${pairings.length} pairings; seed ${seed}; ${jobs} jobs`,
	)
	const job: Job = {
		a,
		b,
		seed,
		pairings: pairingSpec,
		cap,
		recordEvery,
		session: out !== undefined,
		weights,
	}

	if (out !== undefined) mkdirSync(out, { recursive: true })
	const results: (MatchResult | undefined)[] = new Array(games)
	let next = 0
	let done = 0
	const t0 = performance.now()
	await new Promise<void>((resolve, reject) => {
		let alive = jobs
		for (let w = 0; w < jobs; w++) {
			const worker = new Worker(WORKER_BOOT, { eval: true, workerData: job })
			const feed = () => {
				if (next < games) worker.postMessage(next++)
				else worker.postMessage(null)
			}
			worker.on(
				'message',
				(msg: { ready?: true; index?: number; result?: MatchResult }) => {
					if (msg.result !== undefined) {
						const r = msg.result
						results[msg.index!] = r
						done++
						if (r.session !== undefined && out !== undefined) {
							writeFileSync(
								join(out, `${r.game}.json`),
								JSON.stringify(r.session),
							)
							r.session = undefined
						}
						if (r.stopped !== 'GAME_OVER')
							console.log(
								`!! ${r.game}: stopped ${r.stopped}${r.crash !== undefined ? ` (${r.crash})` : ''}`,
							)
						if (done % 20 === 0 || done === games)
							process.stderr.write(
								`  ${done}/${games} games, ${f((performance.now() - t0) / 1000, 0)} s\n`,
							)
					}
					feed()
				},
			)
			worker.on('error', reject)
			worker.on('exit', () => {
				if (--alive === 0) resolve()
			})
		}
	})
	const wallS = (performance.now() - t0) / 1000
	const all = results as MatchResult[]
	if (all.some((r) => r === undefined)) throw new Error('a worker lost a game')

	// records (outcome/margin are filled in by playMatch after the game)
	let recordLines = 0
	if (recordsFile !== undefined) {
		mkdirSync(dirname(recordsFile), { recursive: true })
		const stream = createWriteStream(recordsFile)
		for (const r of all)
			for (const rec of r.records ?? []) {
				stream.write(`${JSON.stringify(rec)}\n`)
				recordLines++
			}
		await new Promise<void>((res) => stream.end(res))
		for (const r of all) r.records = undefined
	}

	const s = summarize(a, b, all)
	console.log('')
	console.log(HEADER)
	console.log(tallyRow('total', s.total))
	console.log(tallyRow('A in seat 0', s.bySeat[0]))
	console.log(tallyRow('A in seat 1', s.bySeat[1]))
	console.log('')
	console.log('per pairing (seat 0 deck – seat 1 deck):')
	for (const [k, t] of Object.entries(s.byPairing)) console.log(tallyRow(k, t))
	console.log('')
	console.log(
		`finished ${s.total.finished}/${s.total.games}; burns ${s.total.burns}; stops ${Object.entries(
			s.stops,
		)
			.map(([k, v]) => `${k} ${v}`)
			.join(', ')}`,
	)
	for (const who of ['A', 'B'] as const) {
		const t = s.timing[who]
		console.log(
			`bot ${who} (${who === 'A' ? a : b}): ${t.decisions} decisions, ${f(t.msMean)} ms mean, ${f(t.msP90)} ms p90, ${f(t.msMax, 0)} ms max; fallbacks ${t.fallbacks}`,
		)
	}
	console.log(
		`wall ${f(wallS, 1)} s with ${jobs} jobs (${f((games / wallS) * 60, 1)} games/min, ${f((games / wallS / jobs) * 60, 1)} per job)`,
	)
	if (recordsFile !== undefined)
		console.log(`records: ${recordLines} lines → ${recordsFile}`)
	if (s.abnormal.length > 0) {
		console.log('')
		console.log(`!!!! ${s.abnormal.length} game(s) did not reach GAME_OVER:`)
		for (const x of s.abnormal)
			console.log(
				`!!!!   ${x.game}: ${x.stopped}${x.cycleStart !== undefined ? ` (cycle from step ${x.cycleStart})` : ''}${x.crash !== undefined ? ` — ${x.crash}` : ''}`,
			)
	}
	if (s.fallbackGames.length > 0) {
		console.log(`!! fallbacks in ${s.fallbackGames.length} game(s):`)
		for (const x of s.fallbackGames.slice(0, 20))
			console.log(`!!   ${x.game}: A ${x.A}, B ${x.B}`)
	}
	if (out !== undefined) {
		writeFileSync(
			join(out, 'summary.json'),
			JSON.stringify(
				{
					...s,
					args: {
						a,
						b,
						games,
						seed,
						pairings: pairingSpec,
						jobs,
						cap,
						recordEvery,
					},
					wallSeconds: wallS,
					games: all.map((r) => ({
						game: r.game,
						pairing: r.pairing,
						seed: r.seed,
						swap: r.swap,
						aSeat: r.aSeat,
						stopped: r.stopped,
						winner: r.winner,
						vp: r.vp,
						margin: r.margin,
						intents: r.intents,
						turns: r.turns,
						burn: r.burn,
						fallbacks: r.fallbacks,
					})),
				},
				null,
				2,
			),
		)
		console.log(`sessions + summary.json → ${out}`)
	}
}

if (isMainThread) {
	main().catch((e: unknown) => {
		console.error(e)
		process.exit(1)
	})
} else {
	void workerMain()
}
