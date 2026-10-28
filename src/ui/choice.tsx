// The choice panel (todo/14 §4, docs/ui-spec.md §4) — one renderer per
// PendingChoice kind from src/engine/choiceUi.ts. Key behaviours:
//   - always show prompt + source card + min/max + live selection count;
//   - "select in situ": CHOOSE_CARDS / CHOOSE_LOCATION candidates are toggled
//     where they physically are (Hand / Market / Neutral Zone render the
//     accent ring from the store's `selected`), and the panel lists them too;
//   - disabled candidates are greyed WITH their reason;
//   - route by choice.seat: in hot-seat, a choice for the opponent shows the
//     pass-the-device interstitial first (docs/ui-spec.md §4).
//
// Every renderer hands a selection to `confirmChoice`, which dispatches
// RESOLVE_CHOICE; the engine re-validates (never trust the client).

import { useState, type ReactNode } from 'react'
import type {
	PendingChoice,
	ChoiceDisabledCard,
	ChoiceOption,
} from '../engine/resolver/choices'
import type { OperationRef } from '../engine/state'
import type { CardInstanceId } from '../engine/ids'
import type { MarketSuit, SpecialtyId, TraitId } from '../data/ids'
import { describeOperation } from '../engine/describe'
import {
	useProjected,
	useSelected,
	useViewerSeat,
	useGameStore,
	confirmChoice,
	usePendingChoice,
} from './store'
import { CardSprite, OpText } from './cards'
import { seatLabel } from './format'
import { useDefForIid, useDefById } from './defs'
import { cardName, withCardNames } from '../data/cardNames'

/** The sentinel "skip" Location candidate for the Control Step (phases.ts). */
const SKIP_CONTROL = '__SKIP__' as CardInstanceId

// ---------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------

function SourceCard({
	sourceCard,
	sourceDef,
}: {
	sourceCard: CardInstanceId | null
	sourceDef?: string | undefined
}) {
	// The instance may have gone face-down (an Incident returned to its deck
	// mid-effect) — fall back to the def id stamped on the choice.
	const liveDef = useDefForIid(sourceCard)
	const stampedDef = useDefById(sourceDef ?? '')
	const def = liveDef ?? stampedDef
	if (sourceCard === null) return null
	return (
		<span className="source-card">
			<CardSprite iid={sourceCard} size="micro" detailOnHover={false} />
			<span>{cardName(def) ?? '??'}</span>
		</span>
	)
}

function ChoiceHeader({
	choice,
	extra,
}: {
	choice: PendingChoice
	extra?: ReactNode
}) {
	return (
		<div className="choice-head">
			<div className="choice-prompt">
				<strong>
					<OpText text={choice.prompt} plain />
				</strong>
				<span className="muted">for {seatLabel(choice.seat)}</span>
				<SourceCard
					sourceCard={choice.sourceCard}
					sourceDef={choice.sourceDef}
				/>
			</div>
			{extra !== undefined && <div className="choice-extra">{extra}</div>}
		</div>
	)
}

// ---------------------------------------------------------------------------
// the panel
// ---------------------------------------------------------------------------

export function ChoicePanel() {
	const choice = usePendingChoice()
	const viewer = useViewerSeat()
	// the house AI answers its own choices (the bot bar shows it thinking)
	const botToMove = useGameStore((s) => s.botToMove)
	if (choice === null || botToMove !== null) return null

	// Hot-seat routing (todo/14 §4): a REACTION choice for the opponent shows a
	// pass-the-device interstitial before the actual choices.
	if (choice.seat !== viewer) {
		return (
			<section
				className="panel choice-panel pass-device"
				aria-label="Pass the device"
			>
				<h3>Choice for {seatLabel(choice.seat)}</h3>
				<p>
					{choice.k === 'OPTIONAL_TRIGGERS'
						? 'A reaction window is open and the opponent must answer.'
						: 'The deciding player must answer this prompt.'}
				</p>
				<button
					type="button"
					className="btn btn-primary"
					onClick={() => useGameStore.getState().setViewer(choice.seat)}
				>
					Pass device — I&apos;m {seatLabel(choice.seat)}
				</button>
				<SourceCard
					sourceCard={choice.sourceCard}
					sourceDef={choice.sourceDef}
				/>
			</section>
		)
	}

	switch (choice.k) {
		case 'CONFIRM':
			return <ConfirmChoice choice={choice} />
		case 'CHOOSE_OPTION':
			return <ChooseOptionChoice choice={choice} />
		case 'CHOOSE_CARDS':
			return <ChooseCardsChoice choice={choice} />
		case 'CHOOSE_LOCATION':
			return <ChooseLocationChoice choice={choice} />
		case 'CHOOSE_SUIT':
			return <ChooseSuitChoice choice={choice} />
		case 'CHOOSE_TRAIT':
			return <ChooseTraitChoice choice={choice} />
		case 'CHOOSE_SPECIALTY':
			return <ChooseSpecialtyChoice choice={choice} />
		case 'CHOOSE_DESTINATION':
			return <ChooseDestinationChoice choice={choice} />
		case 'CHOOSE_AMOUNT':
			return <ChooseAmountChoice choice={choice} />
		case 'ORDER_OPERATIONS':
			return <OrderOperationsChoice choice={choice} />
		case 'OPTIONAL_TRIGGERS':
			return <OptionalTriggersChoice choice={choice} />
		case 'CHOOSE_WITNESS':
			return <ChooseWitnessChoice choice={choice} />
		case 'CHOOSE_WILDCARD_AS':
			return <ChooseWildcardChoice choice={choice} />
		case 'ORDER_CARDS':
			return <OrderCardsChoice choice={choice} />
	}
}

function ConfirmChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CONFIRM' }>
}) {
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<div className="choice-actions">
				<button
					type="button"
					className="btn btn-primary"
					onClick={() => confirmChoice(true)}
				>
					Confirm
				</button>
				<button
					type="button"
					className="btn"
					onClick={() => confirmChoice(false)}
				>
					Cancel / decline
				</button>
			</div>
		</section>
	)
}

function ChooseOptionChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_OPTION' }>
}) {
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<div className="choice-options">
				{choice.options.map((opt: ChoiceOption) => (
					<button
						key={opt.key}
						type="button"
						className={`btn option-row${opt.enabled ? '' : ' option-disabled'}`}
						disabled={!opt.enabled}
						title={opt.enabled ? undefined : opt.reason}
						onClick={() => confirmChoice({ key: opt.key })}
					>
						<span>
							<OpText text={opt.label} plain />
						</span>
						{!opt.enabled && opt.reason !== undefined && (
							<span className="muted small"> — {opt.reason}</span>
						)}
					</button>
				))}
			</div>
		</section>
	)
}

function ChooseCardsChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_CARDS' }>
}) {
	const selected = useSelected()
	const projected = useProjected()
	if (projected === null) return null
	const { min, max, optional } = choice
	const disabledByIid = new Map(
		(choice.disabled ?? []).map((d: ChoiceDisabledCard) => [d.iid, d.reason]),
	)
	const hidden = new Set(choice.hidden ?? [])
	const candidates = [
		...choice.candidates,
		...(choice.disabled ?? []).map((d) => d.iid),
	]
	const canConfirm = !(selected.length < min || selected.length > max)

	// Group candidates by zone so the panel keeps spatial context inline.
	const groups = new Map<string, CardInstanceId[]>()
	for (const iid of candidates) {
		const z = projected.cards[iid]?.zone
		if (z === undefined) continue
		let key: string = z.k
		if (
			z.k === 'HAND' ||
			z.k === 'DRAW' ||
			z.k === 'DISCARD' ||
			z.k === 'RESERVE' ||
			z.k === 'DEVELOPMENT' ||
			z.k === 'LOG' ||
			z.k === 'STAGING' ||
			z.k === 'FLEET' ||
			z.k === 'LOCATION_AREA' ||
			z.k === 'DUTY_OFFICER' ||
			z.k === 'CAPTAIN'
		) {
			key = `${z.k}:${(z as { seat?: number }).seat ?? '?'}`
		} else if (z.k === 'MARKET_DECK') {
			key = `${z.k}:${(z as { suit?: string }).suit ?? '?'}`
		}
		const arr = groups.get(key) ?? []
		arr.push(iid)
		groups.set(key, arr)
	}

	return (
		<section
			className="panel choice-panel"
			aria-label={withCardNames(choice.prompt)}
		>
			<ChoiceHeader
				choice={choice}
				extra={
					<span className={`choice-count${canConfirm ? '' : ' muted'}`}>
						{selected.length} selected · min {min} · max {max}
						{optional === true ? ' · optional' : ''}
					</span>
				}
			/>
			<div className="choice-actions">
				<button
					type="button"
					className="btn btn-primary"
					disabled={!canConfirm}
					onClick={() => confirmChoice(selected)}
				>
					Confirm {selected.length > 0 ? `(${selected.length})` : ''}
				</button>
				{optional === true && (
					<button
						type="button"
						className="btn"
						onClick={() => confirmChoice([])}
					>
						Decline / none
					</button>
				)}
				<button
					type="button"
					className="btn"
					onClick={() => useGameStore.getState().setSelected([])}
				>
					Clear
				</button>
			</div>
			<div className="candidate-groups">
				{[...groups.entries()].map(([group, iids]) => (
					<div key={group} className="candidate-group">
						<span className="muted small">
							— {group} ({iids.length}) —
						</span>
						<div className="candidate-row">
							{iids.map((iid) => {
								const disabledReason = disabledByIid.get(iid)
								const isSel = selected.includes(iid)
								const isHiddenCandidate = hidden.has(iid)
								const click =
									disabledReason === undefined
										? () => useGameStore.getState().cardClicked(iid)
										: undefined
								return (
									<div
										key={iid}
										className={`candidate-tile${isSel ? ' candidate-selected' : ''}${disabledReason !== undefined ? ' candidate-disabled' : ''}`}
										title={disabledReason}
									>
										<div className="candidate-card-wrap">
											<CardSprite
												iid={iid}
												size="board"
												selected={isSel}
												dimmed={disabledReason !== undefined}
												reason={disabledReason}
												onClick={click}
											/>
										</div>
										{disabledReason !== undefined && (
											<span className="muted small why-not">
												why not: {disabledReason}
											</span>
										)}
										{isHiddenCandidate && !isSel && (
											<span className="muted small">(face down)</span>
										)}
									</div>
								)
							})}
						</div>
					</div>
				))}
			</div>
			<p className="muted small">
				Tip: click the cards where they sit — selection rings appear in place,
				e.g. in your Hand.
			</p>
		</section>
	)
}

function ChooseLocationChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_LOCATION' }>
}) {
	const selected = useSelected()
	const projected = useProjected()
	const viewer = useViewerSeat()
	const chosen = selected[0] ?? null
	const skip = choice.candidates.includes(SKIP_CONTROL)

	// group by where the Location sits: your area, the opponent's, the Neutral Zone
	const groups = new Map<string, CardInstanceId[]>()
	for (const iid of choice.candidates) {
		if (iid === SKIP_CONTROL) continue
		const z = projected?.cards[iid]?.zone
		const label =
			z?.k === 'LOCATION_AREA'
				? z.seat === viewer
					? 'Your Location Area'
					: "Opponent's Location Area"
				: z?.k === 'NEUTRAL_ZONE'
					? 'Neutral Zone'
					: 'Elsewhere'
		const arr = groups.get(label) ?? []
		arr.push(iid)
		groups.set(label, arr)
	}

	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<div className="candidate-groups location-groups">
				{[...groups.entries()].map(([label, iids]) => (
					<div key={label} className="candidate-group">
						<span className="candidate-group-label">{label}</span>
						<div className="candidate-row">
							{iids.map((iid) => (
								<div
									key={iid}
									className={`candidate-tile location-tile${chosen === iid ? ' candidate-selected' : ''}`}
								>
									<CardSprite
										iid={iid}
										size="board"
										selected={chosen === iid}
										onClick={() => useGameStore.getState().setSelected([iid])}
									/>
									<LocationLabel iid={iid} />
								</div>
							))}
						</div>
					</div>
				))}
			</div>
			<div className="choice-actions">
				<button
					type="button"
					className="btn btn-primary"
					disabled={chosen === null}
					onClick={() => confirmChoice(chosen!)}
				>
					Confirm
				</button>
				{skip && (
					<button
						type="button"
						className="btn"
						onClick={() => confirmChoice(SKIP_CONTROL)}
					>
						Skip (decline take-control)
					</button>
				)}
			</div>
		</section>
	)
}

function LocationLabel({ iid }: { iid: CardInstanceId }) {
	const def = useDefForIid(iid)
	return <span className="small">{cardName(def) ?? iid}</span>
}

function ChooseSuitChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_SUIT' }>
}) {
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<div className="choice-options">
				{choice.suits.map((suit: MarketSuit) => (
					<button
						key={suit}
						type="button"
						className="btn"
						onClick={() => confirmChoice(suit)}
					>
						{suit}
					</button>
				))}
			</div>
		</section>
	)
}

function ChooseTraitChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_TRAIT' }>
}) {
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<div className="choice-options">
				{choice.traits.map((trait: TraitId) => (
					<button
						key={trait}
						type="button"
						className="btn"
						onClick={() => confirmChoice(trait)}
					>
						{trait}
					</button>
				))}
			</div>
		</section>
	)
}

function ChooseSpecialtyChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_SPECIALTY' }>
}) {
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<div className="choice-options">
				{choice.specialties.map((s: SpecialtyId) => (
					<button
						key={s}
						type="button"
						className={`btn specialty-btn specialty-${s.toLowerCase()}`}
						onClick={() => confirmChoice(s)}
					>
						{s}
					</button>
				))}
			</div>
		</section>
	)
}

function ChooseDestinationChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_DESTINATION' }>
}) {
	const destinationDefault = useGameStore((s) => s.destinationDefault)
	const hasDefault =
		destinationDefault !== null && choice.options.includes(destinationDefault)
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<div className="choice-dest">
				<div className="dest-card">
					<CardSprite iid={choice.card} size="board" detailOnHover={false} />
				</div>
				{choice.options.map((opt) => (
					<button
						key={opt}
						type="button"
						className={`btn btn-primary dest-btn${destinationDefault === opt ? ' dest-default' : ''}`}
						onClick={() => confirmChoice(opt)}
					>
						{opt === 'DECK_TOP' ? 'Top of deck' : 'Discard pile'}
					</button>
				))}
			</div>
			{hasDefault && (
				<div className="choice-actions">
					<button
						type="button"
						className="btn"
						onClick={() => confirmChoice(destinationDefault)}
					>
						Use default:{' '}
						{destinationDefault === 'DECK_TOP' ? 'top of deck' : 'discard'}
					</button>
				</div>
			)}
			<div className="choice-actions">
				{choice.options.map((opt) => (
					<button
						key={opt}
						type="button"
						className="btn"
						onClick={() => useGameStore.getState().setDestinationDefault(opt)}
					>
						Remember {opt === 'DECK_TOP' ? 'top of deck' : 'discard'} for
						session
					</button>
				))}
			</div>
			<p className="muted small">
				This prompt fires constantly when gaining/scanning — use the remember
				toggle to make it one click.
			</p>
		</section>
	)
}

function ChooseAmountChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_AMOUNT' }>
}) {
	const [value, setValue] = useState(choice.min)
	return (
		<section className="panel choice-panel">
			<ChoiceHeader
				choice={choice}
				extra={
					<span className="choice-count muted">
						{choice.min}..{choice.max}
					</span>
				}
			/>
			<div className="choice-actions amount-row">
				<button
					type="button"
					className="btn"
					onClick={() => setValue(Math.max(choice.min, value - 1))}
					aria-label="decrease"
				>
					−
				</button>
				<strong className="amount-value">{value}</strong>
				<button
					type="button"
					className="btn"
					onClick={() => setValue(Math.min(choice.max, value + 1))}
					aria-label="increase"
				>
					+
				</button>
				<button
					type="button"
					className="btn btn-primary"
					onClick={() => confirmChoice(value)}
				>
					Confirm {value}
				</button>
			</div>
		</section>
	)
}

// ---------------------------------------------------------------------------
// ordering / reactions
// ---------------------------------------------------------------------------

function OrderList<T>({
	order,
	move,
	render,
	ariaPrefix,
}: {
	order: T[]
	move: (up: boolean, index: number) => void
	render: (item: T, index: number) => ReactNode
	ariaPrefix: string
}) {
	return (
		<ol className="order-list">
			{order.map((item, i) => (
				<li key={ariaPrefix + i} className="order-row">
					<span className="order-index">{i + 1}</span>
					{render(item, i)}
					<span className="order-actions">
						<button
							type="button"
							className="btn micro"
							disabled={i === 0}
							onClick={() => move(true, i)}
							aria-label="move up"
						>
							↑
						</button>
						<button
							type="button"
							className="btn micro"
							disabled={i === order.length - 1}
							onClick={() => move(false, i)}
							aria-label="move down"
						>
							↓
						</button>
					</span>
				</li>
			))}
		</ol>
	)
}

function OpName({ ref }: { ref: OperationRef }) {
	const def = useDefForIid(ref.card)
	const op = def?.operations[ref.opIndex]
	return (
		<span className="op-name">
			<strong>{cardName(def) ?? ref.card}</strong>
			{op !== undefined && (
				<span className="muted small">
					{' '}
					— <OpText text={describeOperation(op)} plain />
				</span>
			)}
		</span>
	)
}

function OrderOperationsChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'ORDER_OPERATIONS' }>
}) {
	const [order, move] = useOrderState<OperationRef>(choice.pending)
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<OrderList
				order={order}
				move={move}
				ariaPrefix="op"
				render={(ref) => <OpName ref={ref} />}
			/>
			<div className="choice-actions">
				<button
					type="button"
					className="btn btn-primary"
					onClick={() => confirmChoice(order)}
				>
					Resolve in this order
				</button>
				<button
					type="button"
					className="btn"
					onClick={() => confirmChoice(choice.pending)}
				>
					Auto (current order)
				</button>
			</div>
		</section>
	)
}

function OptionalTriggersChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'OPTIONAL_TRIGGERS' }>
}) {
	const [picked, setPicked] = useState<OperationRef[]>([])
	const toggle = (ref: OperationRef) => {
		setPicked((prev) => {
			const has = prev.some(
				(p) => p.card === ref.card && p.opIndex === ref.opIndex,
			)
			return has
				? prev.filter(
						(p) => !(p.card === ref.card && p.opIndex === ref.opIndex),
					)
				: [...prev, ref]
		})
	}
	return (
		<section className="panel choice-panel">
			<ChoiceHeader
				choice={choice}
				extra={
					<span className="choice-count muted">
						take any number, including none
					</span>
				}
			/>
			<div className="trigger-list">
				{choice.offered.map((ref, i) => {
					const isPicked = picked.some(
						(p) => p.card === ref.card && p.opIndex === ref.opIndex,
					)
					return (
						<div
							key={i}
							className={`trigger-row${isPicked ? ' trigger-picked' : ''}`}
						>
							<button
								type="button"
								className="btn"
								onClick={() => toggle(ref)}
								onMouseEnter={() =>
									useGameStore.getState().setHoverIid(ref.card)
								}
								onMouseLeave={() => useGameStore.getState().setHoverIid(null)}
							>
								{isPicked ? '✓ taken' : 'Use'}
							</button>
							<OpName ref={ref} />
						</div>
					)
				})}
			</div>
			<div className="choice-actions">
				<button
					type="button"
					className="btn btn-primary"
					onClick={() => confirmChoice(picked)}
				>
					Take selected ({picked.length})
				</button>
				<button type="button" className="btn" onClick={() => confirmChoice([])}>
					Skip all
				</button>
			</div>
			<p className="muted small">
				Reactions resolve in the order you select them; hover highlights the
				card on the board.
			</p>
		</section>
	)
}

function ChooseWitnessChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_WITNESS' }>
}) {
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<div className="witness-sets">
				{choice.sets.map((set, si) => (
					<div key={si} className="witness-set">
						<span className="muted small">Witness set {si + 1}</span>
						<div className="witness-cards">
							{set.map((iid) => (
								<CardSprite
									key={iid}
									iid={iid}
									size="board"
									detailOnHover={false}
								/>
							))}
						</div>
						<button
							type="button"
							className="btn btn-primary"
							onClick={() => confirmChoice(set)}
						>
							Choose this set
						</button>
					</div>
				))}
			</div>
		</section>
	)
}

function ChooseWildcardChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_WILDCARD_AS' }>
}) {
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<div className="choice-options">
				{choice.traits.map((trait) => (
					<button
						key={trait}
						type="button"
						className="btn btn-primary"
						onClick={() => confirmChoice(trait)}
					>
						Treat as {trait}
					</button>
				))}
			</div>
		</section>
	)
}

function OrderCardsChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'ORDER_CARDS' }>
}) {
	const [order, move] = useOrderState<CardInstanceId>(choice.cards)
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<OrderList
				order={order}
				move={move}
				ariaPrefix="card"
				render={(iid) => <OrderCardLine iid={iid} />}
			/>
			<div className="choice-actions">
				<button
					type="button"
					className="btn btn-primary"
					onClick={() => confirmChoice(order)}
				>
					Confirm order
				</button>
			</div>
		</section>
	)
}

function OrderCardLine({ iid }: { iid: CardInstanceId }) {
	const def = useDefForIid(iid)
	return (
		<span className="op-name">
			<span className="op-card-micro">
				<CardSprite iid={iid} size="micro" detailOnHover={false} />
			</span>
			<strong>{cardName(def) ?? iid}</strong>
		</span>
	)
}

// Shared state for ordering choices (array + up/down mover + setter). Also
// drives the phone's ordering sheets (src/ui/mobile/ChoiceSheet.tsx).
export function useOrderState<T>(
	initial: T[],
): [T[], (up: boolean, index: number) => void, (list: T[]) => void] {
	const [order, setOrder] = useState<T[]>(initial)
	const move = (up: boolean, index: number) => {
		setOrder((prev) => {
			const target = up ? index - 1 : index + 1
			if (target < 0 || target >= prev.length) return prev
			const next = [...prev]
			const item = next[index]
			if (item === undefined) return prev
			next.splice(index, 1)
			next.splice(target, 0, item)
			return next
		})
	}
	return [order, move, setOrder]
}
