// Run tools/arena.ts as a child process (the house AI tools: selfplay,
// retrain, bot-check) and read back its summary.json.

import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ArenaSummary } from '../../src/bot/arena'

export const REPO_ROOT = resolve(
	fileURLToPath(new URL('../..', import.meta.url)),
)
const ARENA = join(REPO_ROOT, 'tools', 'arena.ts')

export interface ArenaRun {
	a: string
	b: string
	games: number
	seed: number
	jobs: number
	pairings?: string | undefined
	/** the run directory: sessions, summary.json, arena.log */
	out: string
	records?: string | undefined
	/** learned weights by name → file (arena --weights) */
	weights?: Record<string, string> | undefined
	/** echo the arena's progress to this process's stderr */
	echo?: boolean | undefined
}

export type ArenaRunSummary = ArenaSummary & { wallSeconds: number }

/** Run one arena and return its summary (rejects when the arena fails). */
export function runArena(run: ArenaRun): Promise<ArenaRunSummary> {
	mkdirSync(run.out, { recursive: true })
	const args = [
		ARENA,
		'--a',
		run.a,
		'--b',
		run.b,
		'--games',
		String(run.games),
		'--seed',
		String(run.seed),
		'--jobs',
		String(run.jobs),
		'--pairings',
		run.pairings ?? 'all',
		'--out',
		run.out,
	]
	if (run.records !== undefined) {
		mkdirSync(dirname(run.records), { recursive: true })
		args.push('--records', run.records)
	}
	const w = Object.entries(run.weights ?? {})
	if (w.length > 0)
		args.push('--weights', w.map(([k, f]) => `${k}=${f}`).join(','))
	const log = createWriteStream(join(run.out, 'arena.log'))
	return new Promise((res, rej) => {
		const child = spawn(process.execPath, [...process.execArgv, ...args], {
			cwd: REPO_ROOT,
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		child.stdout.pipe(log, { end: false })
		child.stderr.pipe(log, { end: false })
		if (run.echo === true) child.stderr.pipe(process.stderr, { end: false })
		child.on('error', rej)
		child.on('exit', (code) => {
			log.end()
			if (code !== 0) {
				rej(
					new Error(
						`arena exited ${code} (${run.a} vs ${run.b}); see ${join(run.out, 'arena.log')}`,
					),
				)
				return
			}
			res(
				JSON.parse(
					readFileSync(join(run.out, 'summary.json'), 'utf8'),
				) as ArenaRunSummary,
			)
		})
	})
}

export const pct = (x: number): string => `${(100 * x).toFixed(1)}%`

/** One line: `A vs B: 61.0 % [54.1, 67.5], 120–76–4, margin 2.1 ± 0.6`. */
export function summaryLine(s: ArenaRunSummary): string {
	const t = s.total
	return `${s.a} vs ${s.b}: ${pct(t.aRate.p)} [${pct(t.aRate.lo)}, ${pct(t.aRate.hi)}], ${t.aWins}–${t.bWins}–${t.draws} of ${t.finished}, margin ${t.marginMean.toFixed(1)} ± ${t.marginSe.toFixed(1)}; ${s.wallSeconds.toFixed(0)} s`
}
