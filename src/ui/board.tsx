// Shared board components (todo/14 §3, docs/ui-spec.md §2). All read the
// projected state — the only game-viewing surface. `compact` variants keep the
// opponent column small; the viewer's area + hand get the full treatment.
//
// Hook discipline: every component calls its hooks unconditionally at the top
// (React rules even though the react-hooks linter plugin is not configured).

import type { GameState } from '../engine/state'
import { zoneKey, player } from '../engine/state'
import { dutyOfficerSlots } from '../engine/dutyOfficers'
import type { CSSProperties } from 'react'
import type { CardInstanceId } from '../engine/ids'
import type { Seat, ZoneRef } from '../engine/resolver/queries'
import type { SpecialtyId, MarketSuit } from '../data/ids'
import { MARKET_SUITS_FOUR } from '../engine/market'
import { shipTokensAt, isSecured } from '../engine/queries/board'
import { canPlay } from '../engine/queries/legality'
import {
	useProjected,
	useGameStore,
	useViewerSeat,
	useLegal,
	useRealState,
} from './store'
import { CardSprite, CardStack } from './cards'
import { RESOURCE_LABEL, seatLabel } from './format'
import { Icon, SpecialtyLabel, suitIconId } from './icons'
import { DeltaCounter } from './delta'
import { HIDDEN_DEF } from './projection'
import { deckLabel, missionTitle } from '../data/cardNames'
import { describePredicate } from '../engine/describe'

// ---------------------------------------------------------------------------
// shared helpers (hooks — call at the top of a component)
// ---------------------------------------------------------------------------

function useStateGame(): GameState | null {
	const projected = useProjected()
	return projected === null ? null : (projected as unknown as GameState)
}

function useZones(ref: ZoneRef): readonly CardInstanceId[] {
	const projected = useProjected()
	return projected?.zones[zoneKey(ref)] ?? []
}

// ---------------------------------------------------------------------------
// Stardate track
// ---------------------------------------------------------------------------

export function StardateTrack() {
	const projected = useProjected()
	const state = useStateGame()
	const top = state !== null ? state.stardates.pile[0] : undefined
	const topDef = top !== undefined ? projected?.cards[top]?.def : undefined
	if (state === null) return null
	return (
		<section className="panel stardate-track" aria-label="Stardate track">
			<h3>Stardate</h3>
			<div className="stardate-row">
				<span className="stardate-name">
					{top === undefined ? '—' : topDef === HIDDEN_DEF ? '??' : topDef}
				</span>
				<DeltaCounter
					pool="stardate"
					label="Stardate Glory"
					className="stardate-glory"
					title="Glory tokens on the current Stardate card"
				>
					{Array.from({ length: state.stardates.gloryOnTop }).map((_, i) => (
						<Icon key={i} id="GLO" label="Glory" />
					))}
					<span className="stardate-glory-n">{state.stardates.gloryOnTop}</span>
				</DeltaCounter>
				<span className="stardate-count muted">
					{state.stardates.pile.length} left
				</span>
			</div>
			{state.resolutionTriggered && (
				<div className="resolution-banner" role="status">
					⚠ Resolution triggered — round finishes, then final scoring
				</div>
			)}
		</section>
	)
}

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

export function Market() {
	return (
		<section className="panel market" aria-label="Market" data-anchor="supply">
			<h3>Market</h3>
			<div className="market-row">
				{MARKET_SUITS_FOUR.map((suit) => (
					<MarketSuitCol key={suit} suit={suit} />
				))}
			</div>
		</section>
	)
}

function MarketSuitCol({ suit }: { suit: MarketSuit }) {
	const deck = useZones({ k: 'MARKET_DECK', suit })
	const offers = useZones({ k: 'MARKET_OFFER', suit })
	return (
		<div className="market-col">
			<span className={`suit-pill suit-banner card-suit-${suit.toLowerCase()}`}>
				<Icon id={suitIconId(suit)} label={suit} size="md" />
				{suit}
			</span>
			<CardStack label={suit} count={deck.length} />
			<div className="market-offer-slot">
				{offers.length > 0 ? (
					offers.map((iid) => <CardSprite key={iid} iid={iid} size="board" />)
				) : (
					<div className="empty-slot muted">empty</div>
				)}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Neutral Zone
// ---------------------------------------------------------------------------

export function NeutralZone() {
	return (
		<section className="panel neutral-zone" aria-label="Neutral Zone">
			<h3>Neutral Zone</h3>
			<div className="nz-row">
				{([0, 1, 2] as const).map((slot) => (
					<LocationSlot key={slot} slot={slot} />
				))}
			</div>
		</section>
	)
}

function LocationSlot({ slot }: { slot: 0 | 1 | 2 }) {
	const state = useStateGame()
	const viewer = useViewerSeat()
	const locs = useZones({ k: 'NEUTRAL_ZONE', slot })
	if (state === null) return null
	const loc = locs[0]
	const secured = loc !== undefined && isSecured(state, loc, viewer)
	const at = loc !== undefined ? state.awayTeamsAt[loc] : undefined
	const ships0 = loc !== undefined ? shipTokensAt(state, loc, 0) : 0
	const ships1 = loc !== undefined ? shipTokensAt(state, loc, 1) : 0
	return (
		<div className={`location-slot${secured ? ' location-secured' : ''}`}>
			{loc === undefined ? (
				<div className="empty-slot muted">no Location</div>
			) : (
				<>
					<div className="location-with-teams">
						<CardSprite
							iid={loc}
							size="board"
							badge={
								secured ? <span className="secured-badge">secured</span> : null
							}
							onClick={() => useGameStore.getState().cardClicked(loc)}
						/>
						<AwayTeamMarkers teams={at} />
					</div>
					<div className="location-tokens">
						<span className="ship-count">
							ships P1 {ships0} / P2 {ships1}
						</span>
					</div>
				</>
			)}
		</div>
	)
}

/** Away Teams at a Location, drawn as token icons stacked down the card's
 *  edges — P1 on the left, P2 on the right — each icon half over the card. */
function AwayTeamMarkers({
	teams,
}: {
	teams: readonly [number, number] | undefined
}) {
	return (
		<>
			{([0, 1] as const).map((seat) => {
				const n = teams?.[seat] ?? 0
				if (n === 0) return null
				const label = `P${seat + 1}: ${n} Away Team${n === 1 ? '' : 's'}`
				return (
					<div
						key={seat}
						className={`away-stack away-stack-${seat}${n > 5 ? ' away-stack-dense' : ''}`}
						role="img"
						aria-label={label}
						title={label}
					>
						{Array.from({ length: n }, (_, i) => (
							<span key={i} className="away-marker">
								<Icon id="AWAY_TEAM" label={label} size="md" />
							</span>
						))}
					</div>
				)
			})}
		</>
	)
}

// ---------------------------------------------------------------------------
// Junk + Incident
// ---------------------------------------------------------------------------

export function JunkIncidentBar() {
	const junk = useZones({ k: 'JUNK' })
	const incidents = useZones({ k: 'INCIDENT_DECK' })
	return (
		<section className="panel piles-bar" aria-label="Shared piles">
			<CardStack label="Junk" count={junk.length} browse={junk} />
			<CardStack
				label="Incident deck"
				count={incidents.length}
				warn={incidents.length <= 2}
			/>
			<div className="muted small">
				The Burn wins for whoever holds fewer Incidents when the deck empties.
			</div>
		</section>
	)
}

// ---------------------------------------------------------------------------
// Viewer deck — the player's Draw pile + Discard (relocated out of PlayerArea)
// ---------------------------------------------------------------------------

export function PlayerDeckPiles() {
	const viewer = useViewerSeat()
	const draw = useZones({ k: 'DRAW', seat: viewer })
	const discard = useZones({ k: 'DISCARD', seat: viewer })
	return (
		<section className="panel player-deck" aria-label="Your deck">
			<h3>Your deck</h3>
			<div className="piles-bar">
				<CardStack label="Draw" count={draw.length} />
				<CardStack label="Discard" count={discard.length} browse={discard} />
			</div>
		</section>
	)
}

// ---------------------------------------------------------------------------
// PlayerArea — the three rows from rules/02 §2.3
// ---------------------------------------------------------------------------

type PlayerZoneK =
	| 'DUTY_OFFICER'
	| 'LOCATION_AREA'
	| 'CAPTAIN'
	| 'FLEET'
	| 'STAGING'
	| 'DRAW'
	| 'DISCARD'
	| 'RESERVE'
	| 'DEVELOPMENT'
	| 'LOG'
	| 'HAND'

function ZoneCount({ seat, k }: { seat: Seat; k: PlayerZoneK }) {
	const iids = useZones({ k, seat })
	return <>{iids.length}</>
}

function ZoneRow({
	seat,
	k,
	title,
	size,
	slot,
	full,
}: {
	seat: Seat
	k: 'DUTY_OFFICER' | 'LOCATION_AREA' | 'CAPTAIN' | 'FLEET' | 'STAGING'
	title: string
	size: 'board'
	/** A single-card slot (Duty Officer, Captain) rather than an area that runs
	 *  right — one column wide, and it holds column 1 of the area grid. */
	slot?: boolean | undefined
	/** Spans the whole row (the Staging Area), starting back at column 1. */
	full?: boolean | undefined
}) {
	const iids = useZones({ k, seat })
	const state = useStateGame()
	return (
		<div
			className={`area-row${slot === true ? ' area-slot' : ''}${full === true ? ' area-full' : ''}`}
		>
			<div className="area-slot-label">{title}</div>
			<div className="slot-group">
				{iids.length === 0 ? (
					<span className="empty-slot muted">empty</span>
				) : (
					iids.map((iid) => {
						const sprite = (
							<CardSprite
								key={iid}
								iid={iid}
								size={size}
								onClick={() => useGameStore.getState().cardClicked(iid)}
							/>
						)
						return k === 'LOCATION_AREA' ? (
							<div key={iid} className="location-with-teams">
								{sprite}
								<AwayTeamMarkers teams={state?.awayTeamsAt[iid]} />
							</div>
						) : (
							sprite
						)
					})
				)}
			</div>
		</div>
	)
}

export function PlayerArea({
	seat,
	compact,
}: {
	seat: Seat
	compact?: boolean
}) {
	const state = useStateGame()
	const viewer = useViewerSeat()
	const pl = state !== null ? player(state, seat) : null
	if (state === null || pl === null) return null
	const isMine = seat === viewer
	const doCount = (state.zones[zoneKey({ k: 'DUTY_OFFICER', seat })] ?? [])
		.length
	const doSlots = dutyOfficerSlots(state, seat).length
	return (
		<section
			className={`panel player-area${compact ? '' : ' full'}`}
			aria-label={`Player ${seat + 1} area`}
		>
			<div className="area-head" data-anchor={`seat:${seat}`}>
				<strong>
					{seatLabel(seat)} {isMine ? '(you)' : ''}
				</strong>
				<span className="area-resources">
					{(['DIL', 'LAT', 'GLO'] as const).map((r) => (
						<DeltaCounter
							key={r}
							pool={`player:${seat}:${r}`}
							label={`${seatLabel(seat)} ${RESOURCE_LABEL[r]}`}
							className={`res-pip pip-${r.toLowerCase()}`}
							title={RESOURCE_LABEL[r]}
						>
							<Icon id={r} label={RESOURCE_LABEL[r]} size="md" />{' '}
							<span className="res-n">{pl.resources[r]}</span>
						</DeltaCounter>
					))}
					<ActionTray seat={seat} />
				</span>
			</div>

			{compact ? (
				<div className="area-compact-grid">
					<span>
						hand <ZoneCount seat={seat} k="HAND" />
					</span>
					<span>
						duty <ZoneCount seat={seat} k="DUTY_OFFICER" />
					</span>
					<span>
						loc <ZoneCount seat={seat} k="LOCATION_AREA" />
					</span>
					<span>
						fleet <ZoneCount seat={seat} k="FLEET" />
					</span>
					<span>
						staging <ZoneCount seat={seat} k="STAGING" />
					</span>
					<span>
						dev <ZoneCount seat={seat} k="DEVELOPMENT" />
					</span>
				</div>
			) : (
				<div
					className="area-grid"
					// rules/08 `promote`: with more than one Duty Officer, the slot
					// column widens and the Location Area shifts right to make room.
					style={
						{
							'--do-slots': Math.max(1, doCount),
						} as CSSProperties
					}
				>
					{/* The three printed rows (rules/02 §2.3) laid on one column grid:
              the single slot holds column 1, its area runs right from it, and
              the Staging Area starts back at column 1 — so Duty Officer,
              Captain and the first Staging card line up down the left edge and
              every other card sits on the same rhythm. */}
					<ZoneRow
						seat={seat}
						k="DUTY_OFFICER"
						title={
							doSlots > 1
								? `Duty Officers (${doCount}/${doSlots})`
								: 'Duty Officer'
						}
						size="board"
						slot
					/>
					<ZoneRow
						seat={seat}
						k="LOCATION_AREA"
						title="Location Area"
						size="board"
					/>
					<ZoneRow seat={seat} k="CAPTAIN" title="Captain" size="board" slot />
					<ZoneRow seat={seat} k="FLEET" title="Fleet Area" size="board" />
					<ZoneRow
						seat={seat}
						k="STAGING"
						title="Staging Area"
						size="board"
						full
					/>
				</div>
			)}
		</section>
	)
}

/**
 * The action budget as tokens: one lit action token per action still
 * available (no cap — gained actions show), then a hollow one per action
 * already spent this turn, and the count in words. It is also the flight
 * anchor for actions, so paying one visibly flies a token onto the card.
 */
export function ActionTray({
	seat,
	size = 'md',
}: {
	seat: Seat
	size?: 'md' | 'lg'
}) {
	const state = useStateGame()
	if (state === null) return null
	const { available, spent } = player(state, seat).actions
	const title = `${available} action${available === 1 ? '' : 's'} left · ${spent} used this turn`
	return (
		<DeltaCounter
			pool={`player:${seat}:ACTION`}
			label={`${seatLabel(seat)} actions`}
			className={`action-tray tray-${size} tray-seat-${seat}${available === 0 ? ' tray-empty' : ''}`}
			title={title}
		>
			<span className="tray-icons">
				{Array.from({ length: available }).map((_, i) => (
					<span key={`a${i}`} className="tray-token tray-available">
						<Icon id="ACTION" label="available action" size="md" />
					</span>
				))}
				{Array.from({ length: spent }).map((_, i) => (
					<span key={`s${i}`} className="tray-token tray-spent">
						<Icon id="ACTION" label="used action" size="md" />
					</span>
				))}
			</span>
			<span className="tray-count">
				<strong>{available}</strong> left
			</span>
		</DeltaCounter>
	)
}

// ---------------------------------------------------------------------------
// Crew board — specialty tracks + missions
// ---------------------------------------------------------------------------

export function CrewBoard({
	seat,
	compact,
}: {
	seat: Seat
	compact?: boolean
}) {
	const state = useStateGame()
	const legal = useLegal()
	const viewer = useViewerSeat()
	const reserve = useZones({ k: 'RESERVE', seat })
	const development = useZones({ k: 'DEVELOPMENT', seat })
	const log = useZones({ k: 'LOG', seat })
	if (state === null) return null
	const pl = player(state, seat)
	return (
		<section
			className={`panel crew-board`}
			aria-label={`Player ${seat + 1} crew board`}
		>
			<div className="crew-head">
				<strong>Crew board — {deckLabel(pl.deckId)}</strong>
				<span className="muted">
					{pl.boardSide} side · missions{' '}
					{pl.missions.filter((m) => m.completed).length}/{pl.missions.length}
				</span>
			</div>
			{!compact && (
				<div className="crew-piles piles-row">
					{/* Development pile + Reserve deck sit beside the Crew board, and the
              Captain's Log is tucked under the Captain (rules/02 §2.3) — piles
              you count rather than cards you act on. Your own Log is
              browsable; an opponent's is a count only (rules/04 §4.5). */}
					<CardStack label="Reserve" count={reserve.length} />
					<CardStack
						label="Development"
						count={development.length}
						browse={development}
					/>
					<CardStack
						label="Log"
						count={log.length}
						browse={seat === viewer ? log : null}
					/>
				</div>
			)}
			{!compact && (
				<div className="tracks">
					{(['RESEARCH', 'INFLUENCE', 'MILITARY'] as const).map((s) => (
						<MultiplierTrack
							key={s}
							seat={seat}
							specialty={s}
							position={pl.specialties[s]}
							multipliers={pl.tracks[s]}
						/>
					))}
				</div>
			)}
			<div className="missions">
				{pl.missions.map((m, i) => {
					const ready =
						state.activeSeat === seat &&
						state.phase.k === 'ACTION' &&
						legal.some((it) => it.t === 'COMPLETE_MISSION' && it.index === i)
					return (
						<div
							key={i}
							className={`mission${m.completed ? ' mission-done' : ''}${ready ? ' mission-ready' : ''}`}
						>
							<span
								className="mission-index"
								title={
									m.completed
										? 'completed'
										: ready
											? 'ready to complete'
											: 'open'
								}
							>
								<Icon id="VP" label="Mission" size="md" />
								<span className="mission-state" aria-hidden="true" />M{i + 1}
								<span className="sr-only">
									{m.completed ? ' completed' : ready ? ' ready' : ' open'}
								</span>
							</span>
							{/* mission VP only scores on the Advanced side (rules/07 §7.4.1 #6) */}
							{pl.boardSide === 'ADVANCED' && (
								<span className="mission-vp muted">VP {m.vp}</span>
							)}
							{ready && (
								<button
									type="button"
									className="btn btn-primary"
									onClick={() =>
										useGameStore
											.getState()
											.dispatch({ t: 'COMPLETE_MISSION', index: i })
									}
								>
									Complete
								</button>
							)}
							{!compact && (
								<span className="mission-text" title={m.cardId}>
									{missionTitle(m)} — {describePredicate(m.goal)}
								</span>
							)}
						</div>
					)
				})}
			</div>
			{!compact && (
				<p className="muted small">
					Positions R {pl.specialties.RESEARCH} / I {pl.specialties.INFLUENCE} /
					M {pl.specialties.MILITARY}.
				</p>
			)}
		</section>
	)
}

function MultiplierTrack({
	seat,
	specialty,
	position,
	multipliers,
}: {
	seat: Seat
	specialty: SpecialtyId
	position: number
	multipliers: { step: number; value: number }[]
}) {
	const max = 15
	// the multiplier Focus icons score at right now (highest glyph reached;
	// ×0 below an Advanced side's first glyph — rules/07 §7.1.4)
	const current = multipliers.reduce(
		(v, m) => (position >= m.step && m.value > v ? m.value : v),
		0,
	)
	return (
		<div className="track">
			<span
				className={`track-label s-${specialty.toLowerCase()}`}
				title={`Focus icons currently score ×${current}`}
			>
				<SpecialtyLabel specialty={specialty} /> ×{current}
			</span>
			<div className="track-ruler">
				{Array.from({ length: max + 1 }).map((_, step) => {
					const mult = multipliers.find((m) => m.step === step)
					return (
						<span
							key={step}
							className={`track-step${step === position ? ' track-marker' : ''}${mult !== undefined ? ' track-mult' : ''}`}
							title={
								mult !== undefined
									? `×${mult.value} at step ${step}`
									: step === position
										? `position ${step}`
										: undefined
							}
						>
							{mult !== undefined
								? `×${mult.value}`
								: step % 4 === 0
									? String(step)
									: ''}
						</span>
					)
				})}
				<span
					className={`track-position track-position-seat-${seat}`}
					style={{ left: `${(position / max) * 100}%` }}
					title={`position ${position}`}
				/>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Hand
// ---------------------------------------------------------------------------

export function Hand({ seat }: { seat: Seat }) {
	const state = useStateGame()
	// Legality must be evaluated on the real engine state — the projected view
	// hides facedown decks (HIDDEN_DEF), which starves the canPlay probe of the
	// candidate cards a PLAY effect needs (e.g. RECRUIT's "gain a PERSON/ALLY").
	const realState = useRealState()
	const viewer = useViewerSeat()
	const iids = useZones({ k: 'HAND', seat })
	if (state === null || realState === null) return null
	const mine = seat === viewer
	const inTurn = mine && state.activeSeat === seat && state.phase.k === 'ACTION'

	return (
		<section
			className={`panel hand${mine ? '' : ' hand-opponent'}`}
			aria-label={`Player ${seat + 1} hand`}
		>
			<div className="hand-head">
				<strong>{seatLabel(seat)} hand</strong>
				<span className="muted">
					{iids.length} card{iids.length === 1 ? '' : 's'}
				</span>
			</div>
			<div className="hand-row">
				{iids.map((iid) => {
					const card = state.cards[iid]
					if (card === undefined) return null
					if (card.def === HIDDEN_DEF) {
						return (
							<CardSprite
								key={iid}
								iid={iid}
								size="hand"
								detailOnHover={false}
							/>
						)
					}
					const check = inTurn ? canPlay(realState, seat, iid) : null
					// Single click always opens the card detail (the "what can I do"
					// view). Double click is the fast path for a card with exactly one
					// legal action — e.g. a hand card with a single legal PLAY. A card
					// that can be played more than one way (e.g. UTILIZE: pay an action
					// for one effect, or a free one) has no single legal action, so
					// double click does nothing and the player picks from the detail.
					const canAct = inTurn && state.pendingChoice === null
					const playOps = check !== null && check.ok ? check.operations : []
					const multiPlay = canAct && playOps.length > 1
					const singlePlay = canAct && playOps.length === 1
					const dimmed = inTurn ? !singlePlay && !multiPlay : false
					const reason = dimmed ? (check?.reasons.join('; ') ?? null) : null
					return (
						<CardSprite
							key={iid}
							iid={iid}
							size="hand"
							dimmed={dimmed}
							reason={reason}
							onClick={() => useGameStore.getState().cardClicked(iid)}
						/>
					)
				})}
			</div>
			{!mine && (
				<p className="muted small">Opponent's hand — face down in hot-seat.</p>
			)}
			{mine && iids.length === 0 && <p className="muted small">Empty hand.</p>}
		</section>
	)
}
