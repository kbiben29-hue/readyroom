#!/usr/bin/env -S npx tsx
// Engine micro-benchmark for the house AI (todo/15 §4): how much search the
// engine affords. Reports
//   * full first-legal games: intents per second (each intent = legalIntents
//     + one reduce), intents per game;
//   * pure `reduce` per second (replaying the recorded intent logs);
//   * the cost of `legalIntents`, `structuredClone(state)`, `forkState`,
//     `determinize`, `seedFromView`, `evaluate` on a mid-game state;
//   * the JSON size of a mid-game and a final state;
//   * heuristic ('normal') vs first-legal games: decisions per game and ms per
//     heuristic decision.
//
//   npx tsx tools/bench-engine.ts            # defaults
//   BENCH_GAMES=20 BENCH_BOT_GAMES=6 npx tsx tools/bench-engine.ts

import { loadCatalog } from '../src/data/catalog'
import { setup, type SetupConfig } from '../src/engine/setup'
import { forkState, type GameState } from '../src/engine/state'
import { reduce, legalIntents, type Intent } from '../src/engine/intents'
import { autoPlay, playBots } from '../src/bot/autoPlay'
import { determinize, seedFromView } from '../src/bot/determinize'
import { evaluate } from '../src/bot/evaluate'
import { firstLegalBot, makeBot } from '../src/bot/index'
import type { Bot } from '../src/bot/types'

const GAMES = Number(process.env['BENCH_GAMES'] ?? 10)
const BOT_GAMES = Number(process.env['BENCH_BOT_GAMES'] ?? 4)
const PAIRS = [
	['PIC', 'SHR'],
	['SHR', 'KOL'],
	['KOL', 'SIS'],
	['SIS', 'SEL'],
	['SEL', 'PIC'],
] as const

function config(g: number): SetupConfig {
	const [a, b] = PAIRS[g % PAIRS.length]!
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: a, boardSide: 'ADVANCED' },
			{ deck: b, boardSide: 'ADVANCED' },
		],
		seed: 1000 + g,
	}
}

/** Mean ms of `fn` over `n` runs (after one warm-up). */
function time(n: number, fn: () => unknown): number {
	fn()
	const t = performance.now()
	for (let i = 0; i < n; i++) fn()
	return (performance.now() - t) / n
}

const fmt = (x: number, d = 3) => x.toFixed(d)

const catalog = await loadCatalog()

// --- first-legal games ------------------------------------------------------
const logs: { start: GameState; intents: Intent[] }[] = []
let mid: GameState | undefined
let midChoice: GameState | undefined
let final: GameState | undefined
let steps = 0
let t = performance.now()
for (let g = 0; g < GAMES; g++) {
	const start = setup(config(g), catalog)
	const r = autoPlay(start, undefined, undefined, (s, _i, step) => {
		if (g === 0 && step === 150) mid = s
		if (
			g === 0 &&
			step > 150 &&
			midChoice === undefined &&
			s.pendingChoice !== null
		)
			midChoice = s
	})
	steps += r.steps
	logs.push({ start, intents: r.intents })
	if (g === 0) final = r.state
}
const playMs = performance.now() - t

// pure reduce: replay the logs
t = performance.now()
let reduces = 0
for (const { start, intents } of logs) {
	let s = start
	for (const i of intents) {
		s = reduce(s, i).state
		reduces++
	}
}
const replayMs = performance.now() - t

const m = mid!
const midJson = JSON.stringify(m)
const finalJson = JSON.stringify(final!)

console.log('== engine ==')
console.log(
	`first-legal games:        ${GAMES}, ${fmt(steps / GAMES, 1)} intents/game`,
)
console.log(`intents/s (legal+reduce): ${fmt((steps / playMs) * 1000, 0)}`)
console.log(`reduce/s (replay only):   ${fmt((reduces / replayMs) * 1000, 0)}`)
console.log(
	`legalIntents (mid):       ${fmt(time(300, () => legalIntents(m)))} ms`,
)
console.log(
	`structuredClone (mid):    ${fmt(time(300, () => structuredClone(m)))} ms`,
)
console.log(
	`forkState (mid):          ${fmt(
		time(3000, () => forkState(m)),
		4,
	)} ms`,
)
if (midChoice !== undefined) {
	const c = midChoice
	console.log(
		`forkState (choice, ${c.stack.length} frames): ${fmt(
			time(3000, () => forkState(c)),
			4,
		)} ms`,
	)
}
console.log(
	`JSON.stringify (mid):     ${fmt(time(300, () => JSON.stringify(m)))} ms`,
)
console.log(
	`state size:               mid ${fmt(midJson.length / 1024, 1)} KB (${Object.keys(m.cards).length} cards, log ${m.log.length}, fx ${m.fx.length}); final ${fmt(finalJson.length / 1024, 1)} KB`,
)
console.log('== bot primitives (mid-game) ==')
console.log(
	`determinize:              ${fmt(time(300, () => determinize(m, 0, { seed: 1, counter: 0 })))} ms`,
)
console.log(
	`seedFromView:             ${fmt(time(300, () => seedFromView(m, 0)))} ms`,
)
console.log(
	`evaluate:                 ${fmt(time(300, () => evaluate(m, 0)))} ms`,
)

// --- heuristic vs first-legal ---------------------------------------------------
const normal = makeBot('normal')
let decisions = 0
let decideMs = 0
let wins = 0
let margin = 0
let botSteps = 0
t = performance.now()
for (let g = 0; g < BOT_GAMES; g++) {
	const seat = (g % 2) as 0 | 1
	const bots: [Bot, Bot] =
		seat === 0 ? [normal, firstLegalBot] : [firstLegalBot, normal]
	const r = playBots(setup(config(g), catalog), bots)
	decisions += r.timing.decisions[seat]
	decideMs += r.timing.ms[seat]
	botSteps += r.steps
	const res = r.state.result
	if (res?.kind === 'COMPLETE') {
		const b = res.scoreboard
		margin += b.breakdown[seat].total - b.breakdown[1 - seat]!.total
		if (b.winners.length === 1 && b.winners[0] === seat) wins++
	}
}
const botMs = performance.now() - t
console.log('== heuristic (normal) vs first-legal ==')
console.log(
	`games:                    ${BOT_GAMES} (${fmt(botMs / 1000, 1)} s), ${fmt(botSteps / BOT_GAMES, 1)} intents/game`,
)
console.log(`heuristic decisions/game: ${fmt(decisions / BOT_GAMES, 1)}`)
console.log(`heuristic ms/decision:    ${fmt(decideMs / decisions, 2)}`)
console.log(
	`heuristic wins:           ${wins}/${BOT_GAMES}, avg margin ${fmt(margin / BOT_GAMES, 1)} VP`,
)
