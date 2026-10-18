// Self-play batches for the learned value (tools/selfplay.ts is the CLI; see
// its header for the modes). Each run is a tools/arena.ts child process.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { runArena, summaryLine } from './arenaRun'

export interface SelfplayRun {
	name: string
	a: string
	b: string
	games: number
	seed: number
}

/** The runs of a self-play batch (see the header). */
export function selfplayRuns(
	mode: 'fast' | 'ismcts',
	games: number,
	seed: number,
	iters = 64,
): SelfplayRun[] {
	const even = (x: number) => Math.max(2, 2 * Math.round(x / 2))
	if (mode === 'ismcts')
		return [
			{
				name: `ismcts${iters}`,
				a: `ismcts:iters=${iters},value=cand`,
				b: `ismcts:iters=${iters},value=eval`,
				games: even(games),
				seed,
			},
		]
	return [
		{ name: 'nn', a: 'normal', b: 'normal', games: even(games / 2), seed },
		{
			name: 'h3n',
			a: 'heuristic:noise=0.3',
			b: 'normal',
			games: even(games / 4),
			seed: seed + 1,
		},
		{
			name: 'h7h3',
			a: 'heuristic:noise=0.7',
			b: 'heuristic:noise=0.3',
			games: even(games / 8),
			seed: seed + 2,
		},
		{
			name: 'en',
			a: 'easy',
			b: 'normal',
			games: even(games / 8),
			seed: seed + 3,
		},
	]
}

/** Play the runs; returns the record files. */
export async function selfplay(opts: {
	mode: 'fast' | 'ismcts'
	games: number
	seed: number
	jobs: number
	out: string
	iters?: number | undefined
	weights?: string | undefined
}): Promise<string[]> {
	const runs = selfplayRuns(opts.mode, opts.games, opts.seed, opts.iters)
	if (
		opts.mode === 'ismcts' &&
		(opts.weights === undefined || !existsSync(opts.weights))
	)
		throw new Error(
			'selfplay --mode ismcts needs --weights FILE (the current candidate)',
		)
	const files: string[] = []
	for (const r of runs) {
		const records = join(opts.out, `${r.name}.jsonl`)
		console.log(
			`selfplay ${r.name}: ${r.a} vs ${r.b}, ${r.games} games, seed ${r.seed}`,
		)
		const s = await runArena({
			a: r.a,
			b: r.b,
			games: r.games,
			seed: r.seed,
			jobs: opts.jobs,
			out: join(opts.out, `${r.name}-out`),
			records,
			weights: opts.weights === undefined ? undefined : { cand: opts.weights },
		})
		console.log(`  ${summaryLine(s)}`)
		const stops = Object.entries(s.stops).filter(([k]) => k !== 'GAME_OVER')
		if (stops.length > 0)
			console.log(
				`  !! stops: ${stops.map(([k, v]) => `${k} ${v}`).join(', ')}`,
			)
		files.push(records)
	}
	return files
}
