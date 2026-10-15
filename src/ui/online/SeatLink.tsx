// "Copy my seat link" (docs/ui-mobile.md §7). A seat lives only in this
// device's storage, and an answered invite link is retired, so this is the way
// to take a seat to another device, or to keep a backup: the same
// `#join=<gameId>.<token>` link an invite uses, carrying this seat's own
// token. Opening it where the game has started opens the game.

import { useState } from 'react'
import type { SeatCredentials } from '../../session/online'
import { inviteLink } from '../../session/online'
import { appUrl } from './seats'

/** Copy to the clipboard; false when the browser refuses (no permission,
 *  insecure origin such as a phone on a LAN address over http). */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text)
		return true
	} catch {
		return false
	}
}

export function SeatLink({
	creds,
	pill = 'pb-pill',
	note = 'pb-note',
}: {
	creds: SeatCredentials
	/** button / note classes of the surrounding sheet */
	pill?: string
	note?: string
}) {
	const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
	const link = inviteLink(appUrl(), creds)
	return (
		<>
			<button
				type="button"
				className={pill}
				onClick={() => {
					void copyText(link).then((ok) => setState(ok ? 'copied' : 'failed'))
				}}
			>
				{state === 'copied' ? 'Seat link copied' : 'Copy my seat link'}
			</button>
			{state === 'failed' && (
				<input
					aria-label="Your seat link"
					className="ol-input ol-mono-text"
					value={link}
					readOnly
					autoFocus
					onFocus={(e) => e.currentTarget.select()}
				/>
			)}
			<p className={note}>
				{state === 'failed'
					? 'Copying isn’t allowed here; copy the link by hand. '
					: ''}
				Open it on another device to play your seat there. It is your seat:
				anyone with it plays for you, so keep it to yourself.
			</p>
		</>
	)
}
