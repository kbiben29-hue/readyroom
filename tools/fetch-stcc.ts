// Fetches the STCC card database (https://periodic-agent.github.io/stcc-strategy/)
// onto this machine: card JSON, errata/FAQ, card scans and the cardface icon set.
//
// Nothing fetched here is committed — vendor/stcc/ and public/stcc/ are
// gitignored. The upstream repo carries no license and the card scans are
// © WizKids, so every player pulls their own copy.
//
// Run: `npm run fetch-cards` (pinned commit from tools/stcc-source.json), or
// `npm run fetch-cards -- --latest` to bump the pin to upstream HEAD first.
// Re-runnable: files already on disk are skipped.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const SOURCE_PATH = join(ROOT, 'tools', 'stcc-source.json')
const VENDOR_DIR = join(ROOT, 'vendor', 'stcc')
const PUBLIC_DIR = join(ROOT, 'public', 'stcc')

const BOXES = ['box1', 'box2', 'box3', 'promo1', 'promo2'] as const
const DATA_FILES = ['errata', 'faq', 'tokens'] as const
// Be gentle with their host.
const CONCURRENCY = 6

interface Source {
	repo: string
	site: string
	sha: string
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path)
		return true
	} catch {
		return false
	}
}

async function fetchOk(url: string, attempts = 3): Promise<Response> {
	for (let i = 1; ; i++) {
		const res = await fetch(url)
		if (res.ok) return res
		// raw.githubusercontent.com throws the odd transient 5xx; back off and retry.
		if (res.status < 500 || i >= attempts)
			throw new Error(`${res.status} ${res.statusText}: ${url}`)
		await new Promise((r) => setTimeout(r, 1000 * i))
	}
}

async function writeOut(
	path: string,
	data: string | Uint8Array,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, data)
}

async function pool<T>(
	items: T[],
	n: number,
	fn: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0
	const worker = async () => {
		while (next < items.length) await fn(items[next++] as T)
	}
	await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
}

async function main(): Promise<void> {
	const source = JSON.parse(await readFile(SOURCE_PATH, 'utf8')) as Source

	if (process.argv.includes('--latest')) {
		const head = (await (
			await fetchOk(`https://api.github.com/repos/${source.repo}/commits/HEAD`)
		).json()) as {
			sha: string
		}
		if (head.sha !== source.sha) {
			console.log(`pin ${source.sha.slice(0, 7)} -> ${head.sha.slice(0, 7)}`)
			source.sha = head.sha
			await writeFile(SOURCE_PATH, JSON.stringify(source, null, 2) + '\n')
		}
	}

	const raw = (path: string) =>
		`https://raw.githubusercontent.com/${source.repo}/${source.sha}/${path}`
	console.log(`fetching ${source.repo}@${source.sha.slice(0, 7)}`)

	// Card JSON, one file per box.
	const images: { url: string; out: string }[] = []
	const counts: Record<string, number> = {}
	for (const box of BOXES) {
		const text = await (await fetchOk(raw(`${box}.json`))).text()
		await writeOut(join(VENDOR_DIR, `${box}.json`), text)
		const cards = JSON.parse(text) as { filename?: string }[]
		counts[box] = cards.length
		for (const c of cards) {
			if (!c.filename) continue
			images.push({
				url: raw(`img/${box}/${c.filename}`),
				out: join(PUBLIC_DIR, 'img', box, c.filename),
			})
		}
	}

	for (const name of DATA_FILES) {
		await writeOut(
			join(VENDOR_DIR, `${name}.json`),
			await (await fetchOk(raw(`data/${name}.json`))).text(),
		)
	}

	// Cardface icons: a script declaring `const CARDFACE = {group: {name: dataUri}}`.
	const assetsJs = await (await fetchOk(raw('cardface-assets.js'))).text()
	const ctx: { CARDFACE?: Record<string, Record<string, string>> } = {}
	vm.runInNewContext(`${assetsJs}\n;this.CARDFACE = CARDFACE`, ctx, {
		timeout: 5000,
	})
	const iconIndex: Record<string, string> = {}
	for (const [group, entries] of Object.entries(ctx.CARDFACE ?? {})) {
		for (const [name, uri] of Object.entries(entries)) {
			const m = /^data:image\/(\w+)(?:\+xml)?;base64,(.*)$/s.exec(uri)
			if (!m) continue
			const ext = m[1] === 'svg' ? 'svg' : m[1]
			await writeOut(
				join(PUBLIC_DIR, 'icons', group, `${name}.${ext}`),
				Buffer.from(m[2] ?? '', 'base64'),
			)
			iconIndex[`${group}/${name}`] = `icons/${group}/${name}.${ext}`
		}
	}
	// "group/name" → path under public/stcc/, for the UI (formats vary: svg/png).
	await writeOut(
		join(VENDOR_DIR, 'icons.json'),
		JSON.stringify(iconIndex, null, 2) + '\n',
	)
	const icons = Object.keys(iconIndex).length

	// Card scans, skipping any already on disk.
	const missing: typeof images = []
	for (const img of images) if (!(await exists(img.out))) missing.push(img)
	const failed: string[] = []
	let done = 0
	await pool(missing, CONCURRENCY, async (img) => {
		try {
			await writeOut(
				img.out,
				new Uint8Array(await (await fetchOk(img.url)).arrayBuffer()),
			)
		} catch (e) {
			failed.push(String(e))
		}
		if (++done % 50 === 0) console.log(`  images ${done}/${missing.length}`)
	})

	const manifest = {
		repo: source.repo,
		sha: source.sha,
		fetchedAt: new Date().toISOString(),
		cards: counts,
		images: images.length - failed.length,
		icons,
	}
	await writeOut(
		join(VENDOR_DIR, 'manifest.json'),
		JSON.stringify(manifest, null, 2) + '\n',
	)

	const total = Object.values(counts).reduce((a, b) => a + b, 0)
	console.log(
		`cards ${total}, images ${manifest.images}/${images.length} (${missing.length} new), icons ${icons}`,
	)
	if (failed.length) {
		console.warn(
			`${failed.length} image(s) failed:\n  ${failed.slice(0, 10).join('\n  ')}`,
		)
		process.exitCode = 1
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
