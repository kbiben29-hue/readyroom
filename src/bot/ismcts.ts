// The search-based "Hard" house AI (todo/15 §4): single-observer Information-
// Set MCTS (SO-ISMCTS, Cowling, Powley & Whitehouse 2012) with PUCT selection
// guided by heuristic priors. A HOUSE AI, not the official solo Bot.
//
// One iteration:
//   1. take a determinization of the root seat's information set (a pool of
//      `worlds` samples drawn with `determinizeWith`, seeded from
//      `seedFromView`; iteration i uses world i mod worlds, so the states
//      along the tree are memoised per (node, world));
//   2. descend the tree. At every node the decider (the pending choice's seat,
//      else the active seat) has the options `candidates()` lists IN THIS
//      world; only those are eligible, and each of them gets its
//      availability count bumped (the ISMCTS fix: the exploration term uses
//      how often an edge was AVAILABLE, not the parent's visits).
//      Progressive widening keeps only the top-k available edges by prior,
//      k = max(2, ⌊widenK · (n + 1)^widen⌋);
//   3. select with PUCT, Q̂ + c · P · √avail / (1 + n), where P is the softmax
//      of the edges' prior scores over the eligible set and Q̂ is the edge's
//      mean value min-max normalised over the whole tree (values are small
//      VP-margin differences, so a fixed c would not fit them);
//   4. the first edge without a child expands a node, and that node is the
//      leaf. A state past the search horizon (the end of the current turn by
//      default, `turns` = how many turn hand-overs the tree may cross) or a
//      finished game is a leaf too;
//   5. evaluate the leaf: a finished game is ±1 (plus a small margin term);
//      otherwise `leaf: 'rollout'` (the default) plays up to `rolloutDepth`
//      decisions of a cheap rollout policy (`rollout()`), then the heuristic's
//      `settle` ends the turn owner's turn with the cheap policies;
//      `leaf: 'settle'` settles at once. Then tanh(evaluate / scale) (or
//      `opts.value`, the hook for a learned value function) from the ROOT
//      seat's view;
//   6. back the value up: every edge stores its value from its own decider's
//      side (+v for the root seat, −v for the opponent).
//
// SO-ISMCTS: there is one tree, keyed by the decision history (each edge is
// `<decider seat>|intentKey`), and the opponent's decisions inside it are
// chosen from the same tree, maximising −value. The opponent is thus assumed
// to see what the root player's determinization shows (strategy fusion is
// reduced but not removed, and there is no bluffing model); chance (draws,
// shuffles) is folded into the determinization.
//
// The move played is the root edge with the most visits (ties: higher Q,
// then the earlier candidate). A single candidate, or a completable mission
// (`missionsFirst`, the heuristic's rule), is returned without searching.
//
// Deterministic for an iteration budget: the only randomness is the
// view-seeded sampler, and the tree lives only inside one `decide` call.
// A time budget (`timeMs` with an injected `clock`, e.g. performance.now)
// makes the iteration count, and so the answer, depend on the machine.

import type { GameState } from '../engine/state'
import { forkState } from '../engine/state'
import type { Intent } from '../engine/intents'
import { reduce, legalIntents, firstLegalSelection } from '../engine/intents'
import { checkSelection } from '../engine/resolver/choices'
import type { Seat } from '../engine/resolver/queries'
import type { Rng } from '../engine/rng'
import type { Bot, BotId } from './types'
import { candidates, intentKey } from './candidates'
import { determinizeWith, seedFromView } from './determinize'
import {
	cardValuePrior,
	evaluate,
	EVAL_SCALE,
	terminalOutcome,
} from './evaluate'
import { priorBonus, priorSelection, settle, simulate } from './heuristic'
import { firstLegalPolicy } from './autoPlay'
import {
	marginOfValue,
	NOTE_FORCED,
	NOTE_MISSION,
	ruleInfo,
	topOptions,
	type DecisionInfo,
	type DecisionOption,
} from './explain'

/** How a node's edges get their prior scores (VP; softmax over them is P):
 *  - `bonus`: the heuristic's rule priors only (`priorBonus`);
 *  - `step`: + `evaluate` one step after the intent (one `reduce`);
 *  - `settle`: + the heuristic's full candidate score (`simulate`: apply,
 *    settle to the end of the turn, evaluate) — the strongest and dearest. */
export type PriorMode = 'bonus' | 'step' | 'settle'

/** Leaf evaluation: `settle` (option b) or a truncated `rollout` (option a). */
export type LeafMode = 'settle' | 'rollout'

export interface IsmctsOptions {
	/** The id the bot reports (default 'hard'). */
	id?: BotId | undefined
	/** Iteration budget (default 200 without a time budget). With `timeMs`
	 *  it is a cap. */
	iterations?: number | undefined
	/** Wall-clock budget in ms; needs `clock`. */
	timeMs?: number | undefined
	/** Injected clock in ms (e.g. `performance.now`): the bot itself never
	 *  reads the time (src/bot is under the determinism lint). */
	clock?: (() => number) | undefined
	/** PUCT exploration constant (default 1.5). */
	c?: number | undefined
	/** Progressive-widening exponent; 0 = consider every candidate
	 *  (default 0.5). */
	widen?: number | undefined
	/** Progressive-widening factor (default 2). */
	widenK?: number | undefined
	/** Leaf evaluation (default 'rollout': it beat 'settle' in the arena). */
	leaf?: LeafMode | undefined
	/** Decisions a rollout plays before it settles (default 8). */
	rolloutDepth?: number | undefined
	/** The rollout policy (default 'cheap'). */
	rollout?: RolloutPolicy | undefined
	/** Prior of the root's edges (default 'settle'). */
	rootPrior?: PriorMode | undefined
	/** Prior of the inner nodes' edges (default 'step'). */
	prior?: PriorMode | undefined
	/** Softmax temperature of the priors, in VP (default 1). */
	temperature?: number | undefined
	/** Determinizations in the pool (default 16). */
	worlds?: number | undefined
	/** Turn hand-overs the tree may cross before a state is a leaf
	 *  (default 0: the search stays inside the current turn). */
	turns?: number | undefined
	/** Max tree depth (default 48). */
	maxDepth?: number | undefined
	/** VP scale of the value squash tanh(margin / scale) (default EVAL_SCALE). */
	scale?: number | undefined
	/** Complete a completable mission without searching (default true). */
	missionsFirst?: boolean | undefined
	/** A learned value function replacing `evaluateNormalized` at non-terminal
	 *  leaves: the value of `state` (settled to the end of the turn, a
	 *  determinized full state) for `seat`, in [−1, 1]. */
	value?: ((state: GameState, seat: Seat) => number) | undefined
}

/** Weight of the margin term in a finished game's value. */
const TERMINAL_MARGIN = 0.1

/** Salt mixed into the view seed (distinct from the heuristic's sampler). */
const SEARCH_SALT = 0x15c7_0a11

/** Engine steps a leaf settle may take. */
const SETTLE_STEPS = 60

interface Edge {
	key: string
	seat: Seat
	/** prior score (VP) */
	score: number
	/** visits */
	n: number
	/** summed value from `seat`'s side */
	w: number
	/** times the edge was available (eligible) at selection */
	avail: number
	child: TreeNode | undefined
}

/** One node's memoised data in one world. */
interface WorldEntry {
	state: GameState
	/** decider and options, computed on the first descent through the node */
	seat?: Seat | undefined
	cands?: Intent[] | undefined
	/** their edge keys */
	keys?: string[] | undefined
	/** keys whose `reduce` threw in this world */
	failed?: Set<string> | undefined
	/** the leaf value of this state (deterministic, so memoised) */
	leaf?: number | undefined
}

interface TreeNode {
	edges: Map<string, Edge>
	/** visits (leaf evaluations backed up through the node) */
	n: number
	/** summed value from the root seat's side */
	w: number
	/** turn hand-overs between the root and this node */
	crossings: number
	/** the active seat at the node (the turn owner) */
	owner: Seat
	worlds: Map<number, WorldEntry>
}

/** Search statistics of one decision (exposed for tests and tools). */
export interface IsmctsStats {
	iterations: number
	nodes: number
	root: {
		key: string
		intent: Intent
		n: number
		q: number
		avail: number
		prior: number
	}[]
}

/** The turn a state is in (changes at every hand-over, Cadet included). */
function turnSig(s: GameState): string {
	return `${s.turnNumber}|${s.activeSeat}|${s.turnsTaken[0]}|${s.turnsTaken[1]}`
}

/** The deciding seat of a state. */
function deciderOf(s: GameState): Seat {
	return s.pendingChoice?.seat ?? s.activeSeat
}

function edgeKey(seat: Seat, intent: Intent): string {
	return `${seat}|${intentKey(intent)}`
}

/** A finished game's value for `seat`. */
function terminalValue(s: GameState, seat: Seat, scale: number): number {
	const end = terminalOutcome(s, seat)
	if (end === null) return 0
	const base = end.outcome === 'win' ? 1 : end.outcome === 'loss' ? -1 : 0
	return (
		base * (1 - TERMINAL_MARGIN) +
		TERMINAL_MARGIN * Math.tanh(end.margin / scale)
	)
}

function tryReduce(s: GameState, intent: Intent): GameState | null {
	try {
		return reduce(forkState(s), intent).state
	} catch {
		return null
	}
}

/** The prior score of `intent` for `seat` in `s` (see PriorMode). */
export function priorScore(
	s: GameState,
	seat: Seat,
	intent: Intent,
	mode: PriorMode,
): number {
	const bonus = priorBonus(s, seat, intent)
	if (mode === 'bonus') return bonus
	if (mode === 'settle') {
		const v = simulate(s, seat, intent, 'turn', SETTLE_STEPS)
		return Number.isFinite(v) ? v + bonus : -1e3
	}
	const next = tryReduce(s, intent)
	if (next === null) return -1e3
	return evaluate(next, seat) + bonus
}

/** One cheap answer for a choice inside a rollout. */
function rolloutChoice(s: GameState, owner: Seat): Intent | null {
	const choice = s.pendingChoice!
	let selection =
		choice.seat === owner
			? priorSelection(s, choice)
			: firstLegalPolicy(s, choice)
	if (!checkSelection(choice, selection).ok) {
		selection = firstLegalSelection(s)
		if (selection === null) return null
	}
	return { t: 'RESOLVE_CHOICE', choiceId: choice.id, selection }
}

/** The rollout policy: `cheap` plays the hand's best card (by
 *  `cardValuePrior`, no lookahead); `greedy` tries every option one step
 *  ahead with `evaluate`. */
export type RolloutPolicy = 'cheap' | 'greedy'

/**
 * The truncated rollout (option a): `owner` keeps playing the current turn
 * for up to `depth` decisions — a completable mission first; else (`greedy`)
 * the option whose one-step `evaluate` gain plus rule prior is best, as long
 * as it is positive, or (`cheap`) a play of the most valuable playable hand
 * card; else the turn ends. Choices are answered by `priorSelection` (owner)
 * / `firstLegalPolicy` (opponent). Stops at the end of the turn; the caller
 * settles and evaluates.
 */
export function rollout(
	state: GameState,
	owner: Seat,
	depth: number,
	policy: RolloutPolicy = 'cheap',
): GameState {
	let s = state
	const sig = turnSig(s)
	for (let step = 0; step < depth; step++) {
		if (s.result !== null || turnSig(s) !== sig) break
		let intent: Intent | null
		if (s.pendingChoice !== null) intent = rolloutChoice(s, owner)
		else if (s.phase.k !== 'ACTION') {
			intent = legalIntents(s)[0] ?? null
		} else {
			const legal = legalIntents(s)
			const mission = legal.find((i) => i.t === 'COMPLETE_MISSION')
			if (mission !== undefined) intent = mission
			else if (policy === 'cheap') {
				let best: Intent | null = null
				let bestValue = Number.NEGATIVE_INFINITY
				for (const c of legal) {
					if (c.t !== 'PLAY_CARD') continue
					const v = cardValuePrior(s, c.iid, owner)
					if (v > bestValue) {
						bestValue = v
						best = c
					}
				}
				if (best === null) break
				intent = best
			} else {
				const base = evaluate(s, owner)
				let best: Intent | null = null
				let bestGain = 0
				for (const c of legal) {
					if (c.t === 'PASS' || c.t === 'END_TURN') continue
					const next = tryReduce(s, c)
					if (next === null) continue
					const gain = evaluate(next, owner) - base + priorBonus(s, owner, c)
					if (gain > bestGain) {
						bestGain = gain
						best = c
					}
				}
				// nothing worth more than stopping: hand over to settle
				if (best === null) break
				intent = best
			}
		}
		if (intent === null) break
		const next = tryReduce(s, intent)
		if (next === null) break
		s = next
	}
	return s
}

interface Config {
	iterations: number
	timeMs: number | undefined
	clock: (() => number) | undefined
	c: number
	widen: number
	widenK: number
	leaf: LeafMode
	rolloutDepth: number
	rollout: RolloutPolicy
	rootPrior: PriorMode
	prior: PriorMode
	temperature: number
	worlds: number
	turns: number
	maxDepth: number
	scale: number
	missionsFirst: boolean
	value: ((state: GameState, seat: Seat) => number) | undefined
}

function configOf(opts: IsmctsOptions): Config {
	const timed = opts.timeMs !== undefined && opts.clock !== undefined
	return {
		iterations: Math.max(
			1,
			opts.iterations ?? (timed ? Number.MAX_SAFE_INTEGER : 200),
		),
		timeMs: timed ? opts.timeMs : undefined,
		clock: timed ? opts.clock : undefined,
		c: opts.c ?? 1.5,
		widen: Math.max(0, opts.widen ?? 0.5),
		widenK: Math.max(1, opts.widenK ?? 2),
		leaf: opts.leaf ?? 'rollout',
		rolloutDepth: Math.max(0, opts.rolloutDepth ?? 8),
		rollout: opts.rollout ?? 'cheap',
		rootPrior: opts.rootPrior ?? 'settle',
		prior: opts.prior ?? 'step',
		temperature: Math.max(1e-3, opts.temperature ?? 1),
		worlds: Math.max(1, Math.floor(opts.worlds ?? 16)),
		turns: Math.max(0, Math.floor(opts.turns ?? 0)),
		maxDepth: Math.max(1, opts.maxDepth ?? 48),
		scale: opts.scale ?? EVAL_SCALE,
		missionsFirst: opts.missionsFirst ?? true,
		value: opts.value,
	}
}

function newNode(owner: Seat, crossings: number): TreeNode {
	return { edges: new Map(), n: 0, w: 0, crossings, owner, worlds: new Map() }
}

/**
 * Run the search for `seat` in `state` and return the chosen root intent and
 * the statistics. `rootCands` are the root's options (from the true state:
 * they depend only on what `seat` sees). Pure and deterministic for an
 * iteration budget.
 */
export function search(
	state: GameState,
	seat: Seat,
	rootCands: Intent[],
	opts: IsmctsOptions = {},
): { intent: Intent; stats: IsmctsStats } {
	const cfg = configOf(opts)
	const t0 = cfg.clock?.() ?? 0
	let rng: Rng = {
		seed: (seedFromView(state, seat) ^ SEARCH_SALT) >>> 0,
		counter: 0,
	}
	const worldPool: GameState[] = []
	const root = newNode(state.activeSeat, 0)
	const rootIntents = new Map<string, Intent>()
	for (const c of rootCands) rootIntents.set(edgeKey(seat, c), c)
	// min-max of backed-up values (root seat's side), for Q normalisation
	let vMin = Number.POSITIVE_INFINITY
	let vMax = Number.NEGATIVE_INFINITY
	let nodes = 1

	/** The leaf value of a node's state in one world, memoised there. */
	const leafOf = (e: WorldEntry, owner: Seat): number => {
		e.leaf ??= leafValue(e.state, owner)
		return e.leaf
	}

	const leafValue = (s: GameState, owner: Seat): number => {
		if (s.result !== null) return terminalValue(s, seat, cfg.scale)
		let t = forkState(s)
		if (cfg.leaf === 'rollout' && cfg.rolloutDepth > 0)
			t = rollout(t, owner, cfg.rolloutDepth, cfg.rollout)
		if (t.result === null) t = settle(t, owner, 'turn', SETTLE_STEPS).state
		if (t.result !== null) return terminalValue(t, seat, cfg.scale)
		if (cfg.value !== undefined) return cfg.value(t, seat)
		return Math.tanh(evaluate(t, seat) / cfg.scale)
	}

	/** Normalised Q of an edge from its decider's side. */
	const qHat = (q: number, edgeSeat: Seat): number => {
		const span = vMax - vMin
		if (!(span > 1e-9)) return 0.5
		// the opponent's q is −v, so its range is [−vMax, −vMin]
		return edgeSeat === seat ? (q - vMin) / span : (q + vMax) / span
	}

	const runIteration = (iter: number): void => {
		const k = iter % cfg.worlds
		if (worldPool[k] === undefined) {
			const [w, r] = determinizeWith(state, seat, rng)
			worldPool[k] = w
			rng = r
		}
		let node = root
		let entry = node.worlds.get(k)
		if (entry === undefined) {
			entry = { state: worldPool[k]!, seat, cands: rootCands }
			node.worlds.set(k, entry)
		}
		const path: { edge: Edge }[] = []
		let value: number
		let depth = 0
		for (;;) {
			const s = entry.state
			if (s.result !== null) {
				value = terminalValue(s, seat, cfg.scale)
				break
			}
			if (depth >= cfg.maxDepth) {
				value = leafOf(entry, node.owner)
				break
			}
			if (entry.cands === undefined) {
				const decider = deciderOf(s)
				entry.seat = decider
				entry.cands =
					s.pendingChoice === null && s.phase.k !== 'ACTION'
						? legalIntents(s)
						: candidates(s, decider, legalIntents(s))
			}
			const decider = entry.seat!
			const failed = entry.failed
			const keys = (entry.keys ??= entry.cands.map((c) => edgeKey(decider, c)))
			const avail: Edge[] = []
			const intentOf = new Map<Edge, Intent>()
			for (let ci = 0; ci < entry.cands.length; ci++) {
				const c = entry.cands[ci]!
				const key = keys[ci]!
				if (failed?.has(key) === true) continue
				let edge = node.edges.get(key)
				if (edge === undefined) {
					const mode = node === root ? cfg.rootPrior : cfg.prior
					edge = {
						key,
						seat: decider,
						score:
							entry.cands.length === 1 ? 0 : priorScore(s, decider, c, mode),
						n: 0,
						w: 0,
						avail: 0,
						child: undefined,
					}
					node.edges.set(key, edge)
				}
				avail.push(edge)
				intentOf.set(edge, c)
			}
			if (avail.length === 0) {
				value = leafOf(entry, node.owner)
				break
			}
			// progressive widening: the top-k available edges by prior
			let eligible = avail
			if (cfg.widen > 0) {
				const kw = Math.max(
					2,
					Math.floor(cfg.widenK * Math.pow(node.n + 1, cfg.widen)),
				)
				if (avail.length > kw) {
					eligible = [...avail]
						.sort((a, b) => b.score - a.score || cmp(a.key, b.key))
						.slice(0, kw)
				}
			}
			// softmax prior over the eligible set
			let top = Number.NEGATIVE_INFINITY
			for (const e of eligible) top = Math.max(top, e.score)
			const ex = eligible.map((e) =>
				Math.exp((e.score - top) / cfg.temperature),
			)
			const total = ex.reduce((a, b) => a + b, 0)
			// first-play urgency: an unvisited edge counts at the node's value
			const nodeQ = node.n > 0 ? node.w / node.n : 0
			let best = 0
			let bestScore = Number.NEGATIVE_INFINITY
			for (let i = 0; i < eligible.length; i++) {
				const e = eligible[i]!
				e.avail++
				const q = e.n > 0 ? e.w / e.n : e.seat === seat ? nodeQ : -nodeQ
				const u =
					qHat(q, e.seat) +
					(cfg.c * (ex[i]! / total) * Math.sqrt(e.avail)) / (1 + e.n)
				if (u > bestScore) {
					bestScore = u
					best = i
				}
			}
			const edge = eligible[best]!
			const intent = intentOf.get(edge)!
			// apply it in this world (memoised per child and world)
			let child = edge.child
			let childEntry = child?.worlds.get(k)
			if (childEntry === undefined) {
				const next = tryReduce(s, intent)
				if (next === null) {
					// not playable in this world after all: drop it and reselect
					entry.failed ??= new Set()
					entry.failed.add(edge.key)
					for (const e of eligible) e.avail--
					continue
				}
				childEntry = { state: next }
			}
			path.push({ edge })
			depth++
			const crossed = turnSig(childEntry.state) !== turnSig(s)
			if (child === undefined) {
				child = newNode(
					childEntry.state.activeSeat,
					node.crossings + (crossed ? 1 : 0),
				)
				child.worlds.set(k, childEntry)
				edge.child = child
				nodes++
				value = leafOf(
					childEntry,
					child.crossings > cfg.turns ? node.owner : child.owner,
				)
				node = child
				break
			}
			if (!child.worlds.has(k)) child.worlds.set(k, childEntry)
			// past the horizon: the state is a leaf, scored for the last
			// in-horizon turn's owner
			if (child.crossings > cfg.turns) {
				value = leafOf(childEntry, node.owner)
				node = child
				break
			}
			node = child
			entry = childEntry
		}
		// back-up: the root, then every edge and the node it leads to
		vMin = Math.min(vMin, value)
		vMax = Math.max(vMax, value)
		root.n++
		root.w += value
		for (const { edge } of path) {
			edge.n++
			edge.w += edge.seat === seat ? value : -value
			edge.child!.n++
			edge.child!.w += value
		}
	}

	let iter = 0
	while (iter < cfg.iterations) {
		if (cfg.clock !== undefined && iter > 0 && cfg.clock() - t0 >= cfg.timeMs!)
			break
		runIteration(iter)
		iter++
	}

	// the most visited root edge (ties: higher Q, then candidate order)
	const rows = rootCands.map((intent) => {
		const key = edgeKey(seat, intent)
		const e = root.edges.get(key)
		return {
			key,
			intent,
			n: e?.n ?? 0,
			q: e !== undefined && e.n > 0 ? e.w / e.n : Number.NEGATIVE_INFINITY,
			avail: e?.avail ?? 0,
			prior: e?.score ?? 0,
		}
	})
	let pick = rows[0]!
	for (const r of rows)
		if (r.n > pick.n || (r.n === pick.n && r.q > pick.q)) pick = r
	return {
		intent: rootIntents.get(pick.key) ?? pick.intent,
		stats: { iterations: iter, nodes, root: rows },
	}
}

function cmp(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0
}

/** The search's root statistics as a DecisionInfo (src/bot/explain.ts):
 *  ranked by visits, each option's mean value mapped back to a VP margin
 *  (unvisited edges: their prior score). No extra search. */
export function searchInfo(
	id: BotId,
	chosen: Intent,
	stats: IsmctsStats,
	scale: number = EVAL_SCALE,
	ms?: number,
): DecisionInfo {
	const total = stats.root.reduce((a, r) => a + r.n, 0)
	const key = intentKey(chosen)
	const rows: DecisionOption[] = stats.root.map((r) => ({
		intent: r.intent,
		score: r.n > 0 ? marginOfValue(r.q, scale) : r.prior,
		share: total > 0 ? r.n / total : 0,
		chosen: intentKey(r.intent) === key,
	}))
	return {
		botId: id,
		kind: 'search',
		options: topOptions(rows, (o) => (o.share ?? 0) * 1e6 + o.score),
		iterations: stats.iterations,
		ms,
	}
}

/** The ISMCTS bot (see the header). */
export function makeIsmctsBot(opts: IsmctsOptions = {}): Bot {
	const missionsFirst = opts.missionsFirst ?? true
	const id = opts.id ?? 'hard'
	/** The decision; with `explain` also its DecisionInfo (from the search
	 *  already run — the chosen intent never depends on it). */
	const choose = (
		state: GameState,
		seat: Seat,
		legal: Intent[],
		explain: boolean,
	): { intent: Intent; info: DecisionInfo | null } => {
		const cands = candidates(state, seat, legal)
		const forced = (intent: Intent) => ({
			intent,
			info: explain ? ruleInfo(id, 'forced', NOTE_FORCED) : null,
		})
		if (cands.length === 0) return forced(legal[0]!)
		if (cands.length === 1) return forced(cands[0]!)
		if (missionsFirst) {
			const mission = cands.find((c) => c.t === 'COMPLETE_MISSION')
			if (mission !== undefined)
				return {
					intent: mission,
					info: explain ? ruleInfo(id, 'rule', NOTE_MISSION) : null,
				}
		}
		const t0 = explain ? opts.clock?.() : undefined
		const { intent, stats } = search(state, seat, cands, opts)
		if (!explain) return { intent, info: null }
		const ms =
			t0 !== undefined && opts.clock !== undefined
				? opts.clock() - t0
				: undefined
		return {
			intent,
			info: searchInfo(id, intent, stats, opts.scale ?? EVAL_SCALE, ms),
		}
	}
	return {
		id,
		decide(state, seat, legal) {
			return choose(state, seat, legal, false).intent
		},
		decideExplained(state, seat, legal) {
			const r = choose(state, seat, legal, true)
			return { intent: r.intent, info: r.info! }
		},
	}
}
