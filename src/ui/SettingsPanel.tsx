// The settings drawer: the per-device preferences that used to crowd the
// console strip and the House AI bar — layout, colour theme, House AI speed
// and card faces — plus the dev-only "reveal all".

import { hasBots } from '../session/opponents'
import { SPEED_LABEL } from './BotBar'
import { LayoutSwitch } from './mobile/LayoutSwitch'
import {
	BOT_RECAPS,
	BOT_SPEEDS,
	useGameStore,
	type BotRecap,
	type BotSpeed,
} from './store'
import { ThemeSwitch } from './ThemeSwitch'
import { playCue, redAlert, setSoundSettings, useSoundSettings } from './sound'

const RECAP_LABEL: Record<BotRecap, string> = {
	hit: 'When it affects you',
	always: 'After every AI turn',
	never: 'Only from AI turn',
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
	const speed = useGameStore((s) => s.botSpeed)
	const setBotSpeed = useGameStore((s) => s.setBotSpeed)
	const recap = useGameStore((s) => s.botRecap)
	const setBotRecap = useGameStore((s) => s.setBotRecap)
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
					<SoundControls />
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
					{botGame && (
						<label
							className="layout-switch"
							title="When the House AI's turn opens by itself once yours begins"
						>
							<span className="nav-label">Show the AI's turn</span>
							<select
								value={recap}
								onChange={(e) => setBotRecap(e.target.value as BotRecap)}
								aria-label="Show the AI's turn"
							>
								{BOT_RECAPS.map((r) => (
									<option key={r} value={r}>
										{RECAP_LABEL[r]}
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

function SoundControls() {
	const sound = useSoundSettings()
	return (
		<>
			<label className="layout-switch" title="Sound effects on or off">
				<span className="nav-label">Sound effects</span>
				<input
					type="checkbox"
					checked={sound.enabled}
					onChange={(e) => {
						setSoundSettings({ enabled: e.target.checked })
						if (e.target.checked) playCue('play')
					}}
					aria-label="Sound effects"
				/>
			</label>
			<label className="layout-switch" title="Sound effects volume">
				<span className="nav-label">Volume</span>
				<input
					type="range"
					min={0}
					max={100}
					step={5}
					value={Math.round(sound.volume * 100)}
					disabled={!sound.enabled}
					onChange={(e) =>
						setSoundSettings({ volume: Number(e.target.value) / 100 })
					}
					onPointerUp={() => playCue('play')}
					aria-label="Volume"
				/>
			</label>
			<label className="layout-switch" title="Hear and see a red alert">
				<span className="nav-label">Test red alert</span>
				<button
					type="button"
					className="btn"
					onClick={() => redAlert('alert')}
				>
					Red alert
				</button>
			</label>
		</>
	)
}
