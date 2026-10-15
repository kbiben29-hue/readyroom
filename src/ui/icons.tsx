// Printed icons, from the fetched STCC cardface icon set (public/stcc/icons,
// see tools/fetch-stcc.ts and src/ui/stcc.ts).
//
// The cards print resources and suits as small marks rather than words, and so
// does the board — a Glory count next to its token is read at a glance, "GLO 4"
// is read letter by letter. When the icons have not been fetched (or one fails
// to load), each falls back to its text glyph, so the board never shows a
// broken image; the caller always keeps the number or label beside it.

import { useState } from 'react'
import type { ResourceId, SkillIcon, SpecialtyId, Suit } from '../data/ids'
import {
	RESOURCE_GLYPH,
	RESOURCE_LABEL,
	SPECIALTY_GLYPH,
	specialtyName,
} from './format'
import { glyphMarkup } from './shorthandGlyphs'
import { stccIconUrl } from './stcc'

export type IconId =
	| ResourceId
	| 'ACTION'
	| 'AWAY_TEAM'
	| 'VP'
	| 'ATTACK'
	| `SUIT:${Suit}`
	| `SPECIALTY:${SpecialtyId}`
	| `FOCUS:${SpecialtyId}`
	| `SKILL:${SkillIcon}`

const RESOURCE_ICON: Record<ResourceId, string> = {
	DIL: 'token/dilithium',
	LAT: 'token/latinum',
	GLO: 'token/glory-token',
}

/** Icon key in the fetched set, tried in order (the suit banner font set has MISSION). */
function iconKeys(id: IconId): string[] {
	if (id === 'ACTION') return ['token/action']
	if (id === 'AWAY_TEAM') return ['token/away-team']
	if (id === 'VP') return ['token/vp']
	if (id === 'ATTACK') return ['traitChip/attack', 'trait/attack']
	if (id.startsWith('SPECIALTY:'))
		return [`skill/${id.slice(10).toLowerCase()}`]
	if (id.startsWith('FOCUS:')) return [`focus/${id.slice(6).toLowerCase()}`]
	if (id.startsWith('SKILL:'))
		return [
			`skill/${id
				.slice(6)
				.replace(/^SKILL_/, '')
				.toLowerCase()}`,
		]
	if (id.startsWith('SUIT:')) {
		const suit = id.slice(5).toLowerCase()
		return [`suit/${suit}`, `suitFont/${suit}`]
	}
	return [RESOURCE_ICON[id as ResourceId]]
}

const FALLBACK_GLYPH: Partial<Record<IconId, string>> = {
	...RESOURCE_GLYPH,
	AWAY_TEAM: '⚑',
	VP: 'VP',
	ATTACK: '⚔',
	'SPECIALTY:RESEARCH': SPECIALTY_GLYPH.RESEARCH,
	'SPECIALTY:INFLUENCE': SPECIALTY_GLYPH.INFLUENCE,
	'SPECIALTY:MILITARY': SPECIALTY_GLYPH.MILITARY,
	'FOCUS:RESEARCH': SPECIALTY_GLYPH.RESEARCH,
	'FOCUS:INFLUENCE': SPECIALTY_GLYPH.INFLUENCE,
	'FOCUS:MILITARY': SPECIALTY_GLYPH.MILITARY,
	'SKILL:SKILL_RESEARCH': SPECIALTY_GLYPH.RESEARCH,
	'SKILL:SKILL_INFLUENCE': SPECIALTY_GLYPH.INFLUENCE,
	'SKILL:SKILL_MILITARY': SPECIALTY_GLYPH.MILITARY,
	'SKILL:SKILL_ANY': '✦',
	'SKILL:SKILL_VARIABLE': '◌',
}

/** Every suit gets an icon slot; whether it resolves depends on the fetched set. */
export function suitIconId(suit: Suit): IconId {
	return `SUIT:${suit}`
}

export function iconUrl(id: IconId): string | null {
	for (const key of iconKeys(id)) {
		const url = stccIconUrl(key)
		if (url !== null) return url
	}
	return null
}

/**
 * One printed icon. The image is decorative — the caller always keeps the
 * number or label beside it, so the icon is `alt=""` and the title carries the
 * name for a hover.
 */
export function Icon({
	id,
	label,
	size = 'sm',
}: {
	id: IconId
	label: string
	size?: 'sm' | 'md' | 'lg'
}) {
	const [broken, setBroken] = useState(false)
	const src = iconUrl(id)
	if (src === null || broken) {
		// the action token falls back to our isolinear chip, not a character
		if (id === 'ACTION')
			return (
				<span
					className={`icon icon-${size} icon-glyph icon-chip`}
					title={label}
					aria-hidden="true"
					dangerouslySetInnerHTML={{ __html: glyphMarkup('ACT') }}
				/>
			)
		const glyph = FALLBACK_GLYPH[id]
		return glyph === undefined ? null : (
			<span
				className={`icon icon-${size} icon-glyph`}
				title={label}
				aria-hidden="true"
			>
				{glyph}
			</span>
		)
	}
	return (
		<img
			className={`icon icon-${size}`}
			src={src}
			alt=""
			title={label}
			draggable={false}
			onError={() => setBroken(true)}
		/>
	)
}

/** A specialty as printed icon + name (ui-spec §8: never colour alone). */
export function SpecialtyLabel({
	specialty,
	focus,
}: {
	specialty: SpecialtyId
	/** Draw the Focus icon rather than the skill icon. */
	focus?: boolean
}) {
	const name = specialtyName(specialty)
	return (
		<span className="icon-label">
			<Icon
				id={focus === true ? `FOCUS:${specialty}` : `SPECIALTY:${specialty}`}
				label={name}
			/>
			{name}
		</span>
	)
}

/** A resource as printed token + name. */
export function ResourceLabel({ res }: { res: ResourceId }) {
	return (
		<span className="icon-label">
			<Icon id={res} label={RESOURCE_LABEL[res]} />
			{RESOURCE_LABEL[res]}
		</span>
	)
}
