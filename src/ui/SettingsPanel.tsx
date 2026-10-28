// The settings drawer: the per-device preferences that used to crowd the
// console strip and the House AI bar — layout, colour theme, House AI speed
// and card faces — plus the dev-only "reveal all".

import { hasBots } from '../session/opponents'
import { SPEED_LABEL } from './BotBar'
import { LayoutSwitch } from './mobile/LayoutSwitch'
import { BOT_SPEEDS, useGameStore, type BotSpeed } from './store'
import { ThemeSwitch } from './ThemeSwitch'

export function SettingsPanel({ onClose }: { onClose: () => void }) {
	const speed = useGameStore((s) => s.botSpeed)
	const setBotSpeed = useGameStore((s) => s.setBotSpeed)
	const botGame = useGameStore(
		(s) => s.online === null && hasBots(s.session?.opponents),
	)
	const showCardDetails = useGameStore((s) => s.showCardDetails)
	const setShowCardDetails = useGameStore((s) => s.setShowCardDetails)
	const revealAll = useGameStore((s) => s.revealAll)
	const setRevealAll = useGameStore((s) => s.setRevealAll)
	const debug = import.meta.env.DEV || !!import.meta.env.VITE_REVEAL_ALL
	return (
		<div className="drawer-backdrop" onClick={onClose}>
			<aside
				className="drawer settings-drawer"
				onClick={(e) => e.stopPropagation()}
				aria-label="Settings"
			>
				<div className="drawer-head">
					<strong>Settings</strong>
					<button type="button" className="btn" onClick={onClose}>
						Close
					</button>
				</div>
				<div className="settings-body">
					<LayoutSwitch />
					<ThemeSwitch />
					{botGame && (
						<label className="layout-switch">
							<span className="nav-label">House AI speed</span>
							<select
								value={speed}
								onChange={(e) => setBotSpeed(e.target.value as BotSpeed)}
								aria-label="House AI speed"
							>
								{BOT_SPEEDS.map((s) => (
									<option key={s} value={s}>
										{SPEED_LABEL[s]}
									</option>
								))}
							</select>
						</label>
					)}
					<label
						className="layout-switch"
						title="The printed card art (default) or the full text card"
					>
						<span className="nav-label">Card faces</span>
						<select
							value={showCardDetails ? 'text' : 'art'}
							onChange={(e) => setShowCardDetails(e.target.value === 'text')}
							aria-label="Card faces"
						>
							<option value="art">Printed art</option>
							<option value="text">Full text</option>
						</select>
					</label>
					{debug && (
						<label
							className="layout-switch"
							title="dev/debug: show every card (including hidden zones)"
						>
							<span className="nav-label">Reveal all (debug)</span>
							<input
								type="checkbox"
								checked={revealAll}
								onChange={(e) => setRevealAll(e.target.checked)}
							/>
						</label>
					)}
				</div>
			</aside>
		</div>
	)
}
