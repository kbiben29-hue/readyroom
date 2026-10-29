// A CHOOSE_OPTION whose options are operations of a card (free play "resolve
// which play operation?", "duplicate which operation?"): the card itself, with
// each option as its printed operation, clickable like in the card detail.
// Desktop panel and phone sheet share it.

import type { ChoiceOption } from '../engine/resolver/choices'
import type { CardInstanceId } from '../engine/ids'
import type { GameState } from '../engine/state'
import type { Seat } from '../engine/resolver/queries'
import { idleOperationReason } from '../engine/queries/legality'
import { printedOpFor, printedOps } from '../data/stcc'
import { CardSprite, OpBlock, OpText, type CardSize } from './cards'
import { useDefForIid } from './defs'
import { stccCard } from './stcc'
import { confirmChoice, useRealState } from './store'

type OpOption = ChoiceOption & { op: NonNullable<ChoiceOption['op']> }

/** The options as operations, grouped by card — or null when any option is
 *  not an operation (the plain option list renders those). */
export function operationOptions(
	options: readonly ChoiceOption[],
): Map<CardInstanceId, OpOption[]> | null {
	if (options.length === 0) return null
	const byCard = new Map<CardInstanceId, OpOption[]>()
	for (const o of options) {
		if (o.op === undefined || o.op.opIndex < 0) return null
		const arr = byCard.get(o.op.card) ?? []
		arr.push(o as OpOption)
		byCard.set(o.op.card, arr)
	}
	return byCard
}

export function OperationOptions({
	byCard,
	seat,
	size,
}: {
	byCard: Map<CardInstanceId, OpOption[]>
	/** the deciding seat, which resolves the operation */
	seat: Seat
	size: CardSize
}) {
	return (
		<div className="op-options">
			{[...byCard.entries()].map(([iid, opts]) => (
				<CardOperations
					key={iid}
					iid={iid}
					options={opts}
					seat={seat}
					size={size}
				/>
			))}
		</div>
	)
}

function CardOperations({
	iid,
	options,
	seat,
	size,
}: {
	iid: CardInstanceId
	options: OpOption[]
	seat: Seat
	size: CardSize
}) {
	// the "does nothing right now" probe runs on the real engine state, as in
	// the card detail (the projection hides decks an effect may need)
	const state = useRealState()
	const def = useDefForIid(iid)
	const stcc = def === null ? null : stccCard(def)
	const printed = stcc === null ? [] : printedOps(stcc.text)
	return (
		<div className="op-options-card">
			<div className="op-options-sprite">
				<CardSprite iid={iid} size={size} />
			</div>
			<div className="op-options-list">
				{options.map((o) => {
					const op = def?.operations[o.op.opIndex]
					const text =
						def === null
							? undefined
							: printedOpFor(printed, def.operations, o.op.opIndex)?.text
					return (
						<OpBlock
							key={o.key}
							blocked={!o.enabled}
							run={
								o.enabled
									? {
											label: 'Resolve',
											idle: idleReason(state, seat, iid, o.op.opIndex),
											onRun: () => confirmChoice({ key: o.key }),
										}
									: null
							}
						>
							{op !== undefined && (
								<div className="op-detail-head">
									<span className={`op-type op-type-${op.type.toLowerCase()}`}>
										{op.type}
									</span>
									{op.isAttack ? <span className="chip">attack</span> : null}
								</div>
							)}
							<p className="op-text">
								<OpText text={text ?? o.label} plain />
							</p>
							{!o.enabled && o.reason !== undefined && (
								<p className="op-reason muted">Why not: {o.reason}</p>
							)}
						</OpBlock>
					)
				})}
			</div>
		</div>
	)
}

function idleReason(
	state: GameState | null,
	seat: Seat,
	iid: CardInstanceId,
	opIndex: number,
): string | null {
	if (state === null) return null
	try {
		return idleOperationReason(state, seat, iid, opIndex)
	} catch {
		return null
	}
}
