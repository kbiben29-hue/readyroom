// Builds a prompt kit for generating custom-pack card art (or whole cards)
// with an image model such as ChatGPT, after `npm run custom-cards`.
//
//   npm run custom-cards:kit             # the Firefly pack
//
// Writes vendor/custom/<pack>/prompt-kit/ (local only, like everything the
// renderer fetches): a README, every prompt in one file, a few printed cards
// from the fetched STCC data as style reference, and per card a folder with
// its prompts, its exact text, our rendered layout and the likeness still.
// Generated art goes back in as vendor/custom/<pack>/override/<art key>.png.

import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadStccNode } from '../stcc-node'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const PACK = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'firefly'
const WORK = join(ROOT, 'vendor', 'custom', PACK)
const KIT = join(WORK, 'prompt-kit')
const FACES = join(ROOT, 'public', 'custom', PACK)

/** Printed cards of the published game, by card number: the look the
 *  generated art should match (a PERSON, a SHIP, a LOCATION, a CAPTAIN). */
const STYLE_REFS = ['1PIC08/24', '1PIC02/24', '1SHR23/24', '1PIC01/24']

interface PackCard {
	name: string
	suit: string
	card_number: string
	position_indicator?: string
	glory?: number | null
	species_traits?: string[]
	regular_traits?: string[]
	other_traits?: string[]
	icons?: { type: string; specialty: string }[]
	away_team?: string
	text: Record<string, string>
	flavor?: string
	art?: string
}

/** `[[token]]` → plain words for a prompt. */
const plain = (s: string) =>
	s
		.replace(/\[\[(\d+)vp\]\]/g, '$1 VP')
		.replace(
			/\[\[(res|inf|mil)(\d+)\]\]/g,
			(_, sp: string, n: string) =>
				`${{ res: 'Research', inf: 'Influence', mil: 'Military' }[sp]} ${n}+`,
		)
		.replace(/\[\[([^\]]+)\]\]/g, (_, t: string) => `[${t.toUpperCase()}]`)

const slug = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')

function cardText(c: PackCard): string {
	const traits = [
		...(c.species_traits ?? []),
		...(c.regular_traits ?? []),
		...(c.other_traits ?? []),
	]
	const icons = (c.icons ?? []).map(
		(i) => `${i.specialty} ${i.type.toLowerCase()}`,
	)
	const lines = [
		`Name: ${c.name}`,
		`Suit: ${c.suit.toUpperCase()}`,
		`Traits: ${traits.join(', ') || '—'}`,
		`Skill/focus icons: ${icons.join(', ') || '—'}`,
	]
	for (const [k, label] of [
		['hand', 'Play box (light)'],
		['table', 'Table box (blue)'],
		['goal', 'Endgame box (dark)'],
		['reward', 'Resupply / clean-up box'],
		['cost', 'Dev. cost bar'],
	] as const)
		if (c.text[k]) lines.push(`${label}: ${plain(c.text[k])}`)
	if (c.flavor) lines.push(`Flavor (italic): “${c.flavor}”`)
	lines.push(
		`Footer: ${c.card_number} · ${(c.position_indicator ?? '').toUpperCase()}${
			c.away_team
				? ` · ${c.away_team} away teams`
				: typeof c.glory === 'number' && c.glory !== 0
					? ` · ${c.glory} VP badge`
					: ''
		}`,
	)
	return lines.join('\n')
}

/** Where the subject goes: the card frame covers the top-left (name plates),
 *  the top-right (trait badges) and the bottom 40 % (rules text). */
function framing(c: PackCard): string {
	const zones =
		'The card frame covers the top-left corner (name plates), the top-right quarter (trait badges) and the bottom 40 % (rules text); keep important detail out of all three.'
	if (['Person', 'Captain', 'Ally'].includes(c.suit))
		return `Framing: a close chest-up portrait like the printed PERSON cards, not a full-body shot. Head and shoulders are large in the frame. The face is centred horizontally, with the eyes at about 40 % of the image height from the top; the top 22 % is background only, so the head never reaches the top edge. ${zones} Below the chin show only shoulders, torso and background. Format: portrait, 1170 × 1635 px (5:7).`
	return `Framing: the subject sits in the middle band of the image, between about 20 % and 60 % of its height. ${zones} Format: portrait, 1170 × 1635 px (5:7).`
}

interface ArtDirection {
	subject?: string
	/** false: no likeness still (the reference would mislead, e.g. a real
	 *  spacecraft standing in for a fictional one) — design from the text */
	likeness?: boolean
	/** extra direction for this card ("light the face evenly …") */
	notes?: string
}

/** Pack-wide art direction from the manifest's top level. */
interface PackStyle {
	/** the source the deck comes from, for "true to the look of …" */
	universe: string
	/** the colour mood that sets the pack apart from the printed decks */
	palette: string
}

function artPrompt(
	c: PackCard,
	subject: string,
	dir: ArtDirection,
	style: PackStyle,
): string {
	return [
		`Paint the card illustration for a fan-made "${c.name}" card (${c.suit.toUpperCase()}) in the style of the attached Star Trek: Captain's Chair cards (style-*.jpg): polished painterly digital portrait, crisp detail, soft cinematic rim light, a luminous cosmic sky behind the subject.`,
		`Subject: ${subject}.`,
		dir.likeness === false
			? `There is no likeness reference for this one: design it from the description, true to the look of ${style.universe} — do not borrow real-world spacecraft or stations.`
			: `Use likeness.jpg (a still from the series) for the face, hair, costume and props, but repaint it in the card style — do not copy the photo's background.`,
		...(dir.notes !== undefined ? [`Also: ${dir.notes}`] : []),
		`Palette: ${style.palette}.`,
		framing(c),
		`No text, letters, logos, frames, borders or card elements — art only.`,
	].join('\n\n')
}

function cardPrompt(c: PackCard, subject: string, style: PackStyle): string {
	return [
		`Make a complete playing card for a fan-made Star Trek: Captain's Chair expansion, matching the printed cards attached as style-*.jpg in layout, typography, colours and finish. layout.jpg shows this card's exact content and arrangement; repaint the art in the game's painterly style (likeness.jpg is a still from the series for the likeness).`,
		`Art subject: ${subject}. Palette: ${style.palette}.`,
		`Use exactly this text and nothing else — spell it exactly; square brackets stand for the game's icons (as drawn in layout.jpg and the style cards):`,
		cardText(c),
		`Portrait 1170 × 1635 px. Small print in the right margin: "Fan-made card. Not affiliated with WizKids, CBS or 20th Television."`,
	].join('\n\n')
}

async function main(): Promise<void> {
	const pack = JSON.parse(
		await readFile(join(ROOT, 'src', 'data', 'custom', `${PACK}.json`), 'utf8'),
	) as { title: string; cards: PackCard[] }
	const manifest = JSON.parse(
		await readFile(join(ROOT, 'tools', 'custom', `${PACK}-art.json`), 'utf8'),
	) as { art: Record<string, ArtDirection> } & Partial<PackStyle>
	const arts = manifest.art
	const style: PackStyle = {
		universe: manifest.universe ?? 'the source series',
		palette: manifest.palette ?? 'cinematic, matching the style cards',
	}
	const credits: Record<string, { file: string }> = existsSync(
		join(WORK, 'art', 'credits.json'),
	)
		? (JSON.parse(
				await readFile(join(WORK, 'art', 'credits.json'), 'utf8'),
			) as Record<string, { file: string }>)
		: {}

	await rm(KIT, { recursive: true, force: true })
	await mkdir(join(KIT, 'style'), { recursive: true })
	const stcc = await loadStccNode({ custom: false })
	for (const [i, number] of STYLE_REFS.entries()) {
		const scan = stcc.get(number)?.image // /stcc/img/box1/<file>
		const src = scan ? join(ROOT, 'public', scan) : null
		if (src !== null && existsSync(src))
			await copyFile(src, join(KIT, 'style', `style-${i + 1}.jpg`))
	}
	if (existsSync(join(FACES, 'template-blank.jpg')))
		await copyFile(
			join(FACES, 'template-blank.jpg'),
			join(KIT, 'template-blank.jpg'),
		)

	const all: string[] = [`# ${pack.title}: image prompts\n`]
	let n = 0
	for (const c of pack.cards) {
		if (c.suit === 'Mission' || c.art === undefined) continue
		n++
		const subject = arts[c.art]?.subject ?? c.name
		const dir = join(
			KIT,
			'cards',
			`${c.card_number.slice(4, 6)}-${slug(c.name)}`,
		)
		await mkdir(dir, { recursive: true })
		const face = join(FACES, `${c.card_number.replace('/', '-')}.jpg`)
		if (existsSync(face)) await copyFile(face, join(dir, 'layout.jpg'))
		const direction = arts[c.art] ?? {}
		const still =
			direction.likeness === false ? undefined : credits[c.art]?.file
		if (still !== undefined && existsSync(join(WORK, 'art', still)))
			await copyFile(
				join(WORK, 'art', still),
				join(dir, `likeness.${still.split('.').pop()}`),
			)
		const art = artPrompt(c, subject, direction, style)
		const full = cardPrompt(c, subject, style)
		await writeFile(
			join(dir, 'prompt.md'),
			`# ${c.name} (${c.card_number})\n\nAttach: style/*.jpg, likeness.*, layout.jpg (for the full card).\nSave the art as \`vendor/custom/${PACK}/override/${c.art}.png\`.\n\n## A. Art only (recommended)\n\n${art}\n\n## B. Whole card\n\n${full}\n`,
		)
		await writeFile(join(dir, 'card-text.txt'), `${cardText(c)}\n`)
		all.push(
			`## ${c.card_number} ${c.name} — art key \`${c.art}\`\n\n### A. Art only\n\n${art}\n\n### B. Whole card\n\n${full}\n`,
		)
	}
	await writeFile(join(KIT, 'prompts.md'), all.join('\n'))
	await writeFile(
		join(KIT, 'README.md'),
		`# ${pack.title}: prompt kit

Everything here is for your own use with an image model (e.g. ChatGPT). It is
local only and must not be published: the style cards are WizKids/CBS scans
from your fetched STCC data, and the likeness stills belong to their owners.

## Recommended: art only, our frame

1. Open a new ChatGPT image chat.
2. Attach the four \`style/style-*.jpg\` printed cards once and say: "These are the
   reference style for every image in this chat."
3. For each card folder in \`cards/\`, attach its \`likeness.*\` and paste
   prompt **A** from its \`prompt.md\`.
4. Save the result as \`vendor/custom/${PACK}/override/<art key>.png\` (the key is
   named in each prompt.md), then run \`npm run custom-cards\`. The renderer
   draws our frame, icons and exact rules text over your art.

Image models garble small text, so A keeps every rule exact.

## Alternative: whole cards

Attach \`layout.jpg\` as well and paste prompt **B**. Check every word and
number against \`card-text.txt\` before you use the result. Save a whole card
as \`vendor/custom/${PACK}/override/faces/<card number>.jpg\` (\`1MAL01-25.jpg\` …)
and run \`npm run custom-cards\`: it is used instead of the rendered face.

\`template-blank.jpg\` is the empty frame, if you want to design around it.
${n} cards; all prompts are also in \`prompts.md\`.
`,
	)
	console.log(`prompt kit: ${n} cards → ${KIT}`)
}

main().catch((err: unknown) => {
	console.error(err)
	process.exitCode = 1
})
