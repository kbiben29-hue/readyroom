#!/usr/bin/env -S npx tsx
// Generate training records for the learned value (house AI, docs/bot.md
// "Learned value"). Each run is a tools/arena.ts schedule over all 30
// pairings with seat swaps, recording every decision's features of both
// seats with the game's outcome (JSONL, ~220 lines / ~75 KB per game).
//
//   npx tsx tools/selfplay.ts --mode fast --games 960 --seed 1001 --out .bot-data/it0
//   npx tsx tools/selfplay.ts --mode ismcts --games 200 --iters 64 \
//       --weights .bot-data/candidate-value.json --seed 2001 --out .bot-data/it1
//
// Modes
//   fast    iteration 0: the heuristics (milliseconds per decision):
//             1/2  normal vs normal (the seat-swapped half replays the same
//                  game, so train-value drops it; the pairs still differ)
//             1/4  heuristic:noise=0.3 vs normal
//             1/8  heuristic:noise=0.7 vs heuristic:noise=0.3
//             1/8  easy vs normal
//           about 150 games/min on 6 jobs.
//   ismcts  Expert Iteration: ISMCTS with the given weights as its leaf value
//           against ISMCTS with the hand-tuned leaf, both at --iters (two
//           different searchers, so the swapped halves are different games).
//           Roughly 1–2 games/min per job at --iters 64.
//
// Records land in <out>/<run>.jsonl (outside git: .bot-data/ is ignored).
//
// Options: --mode fast|ismcts, --games N, --seed S (each run uses S, S+1, …;
// keep them disjoint from the gate seed), --jobs J (default 6), --out DIR,
// --iters N (ismcts, default 64), --weights FILE (ismcts).

import { selfplay } from './lib/selfplay'

function parseArgs(argv: string[]): Record<string, string> {
	const out: Record<string, string> = {}
	for (let i = 0; i < argv.length; i += 2) {
		const k = argv[i]!
		if (!k.startsWith('--') || argv[i + 1] === undefined)
			throw new Error(`bad argument '${k}'`)
		out[k.slice(2)] = argv[i + 1]!
	}
	return out
}

async function main(): Promise<void> {
	const a = parseArgs(process.argv.slice(2))
	const mode = (a['mode'] ?? 'fast') as 'fast' | 'ismcts'
	if (mode !== 'fast' && mode !== 'ismcts')
		throw new Error('--mode must be fast|ismcts')
	const t0 = performance.now()
	const files = await selfplay({
		mode,
		games: Number(a['games'] ?? (mode === 'fast' ? 960 : 200)),
		seed: Number(a['seed'] ?? (mode === 'fast' ? 1001 : 2001)),
		jobs: Number(a['jobs'] ?? 6),
		out: a['out'] ?? (mode === 'fast' ? '.bot-data/it0' : '.bot-data/it1'),
		iters: a['iters'] === undefined ? undefined : Number(a['iters']),
		weights: a['weights'],
	})
	console.log(
		`records: ${files.join(', ')} (${((performance.now() - t0) / 60000).toFixed(1)} min)`,
	)
}

main().catch((e: unknown) => {
	console.error(e)
	process.exit(1)
})
