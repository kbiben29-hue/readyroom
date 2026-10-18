// Fetches the STCC card database (https://periodic-agent.github.io/stcc-strategy/)
// into vendor/stcc/ (card JSON, errata/FAQ, icon index) and public/stcc/ (card
// scans, icons). The fetch itself lives in src/data/stccFetch.ts, shared with
// the desktop app's first-run download.
//
// Nothing fetched here is committed — vendor/stcc/ and public/stcc/ are
// gitignored. The upstream repo carries no license and the card scans are
// © WizKids, so every player pulls their own copy.
//
// Run: `npm run fetch-cards` (pinned commit from tools/stcc-source.json), or
// `npm run fetch-cards -- --latest` to bump the pin to upstream HEAD first.
// Re-runnable: files already on disk are skipped.

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { fetchStcc, type StccIo, type StccSource } from '../src/data/stccFetch'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const SOURCE_PATH = join(ROOT, 'tools', 'stcc-source.json')
const VENDOR_DIR = join(ROOT, 'vendor', 'stcc')
const PUBLIC_DIR = join(ROOT, 'public', 'stcc')

async function fetchOk(url: string): Promise<Response> {
	const res = await fetch(url)
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`)
	return res
}

/** `vendor/x` → vendor/stcc/x, `public/x` → public/stcc/x. */
function local(rel: string): string {
	const m = /^(vendor|public)\/(.+)$/.exec(rel)
	if (!m || m[2]!.split('/').includes('..')) throw new Error(`bad path: ${rel}`)
	return join(m[1] === 'vendor' ? VENDOR_DIR : PUBLIC_DIR, m[2]!)
}

async function writeOut(
	path: string,
	data: string | Uint8Array,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true })
	// write-then-rename, so an interrupted run never leaves a truncated scan
	// that the next run would skip
	await writeFile(`${path}.part`, data)
	await rename(`${path}.part`, path)
}

const nodeIo: StccIo = {
	fetchText: async (url) => (await fetchOk(url)).text(),
	download: async (url, rel) =>
		writeOut(
			local(rel),
			new Uint8Array(await (await fetchOk(url)).arrayBuffer()),
		),
	writeText: (rel, text) => writeOut(local(rel), text),
	writeBytes: (rel, bytes) => writeOut(local(rel), bytes),
	exists: async (rel) => {
		try {
			await stat(local(rel))
			return true
		} catch {
			return false
		}
	},
}

async function main(): Promise<void> {
	const source = JSON.parse(await readFile(SOURCE_PATH, 'utf8')) as StccSource

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

	console.log(`fetching ${source.repo}@${source.sha.slice(0, 7)}`)
	const { manifest, fetched, failed } = await fetchStcc(source, nodeIo, {
		now: () => new Date().toISOString(),
		onProgress: (p) => {
			if (p.phase === 'images' && p.done > 0 && p.done % 50 === 0)
				console.log(`  images ${p.done}/${p.total}`)
		},
	})

	const total = Object.values(manifest.cards).reduce((a, b) => a + b, 0)
	console.log(
		`cards ${total}, images ${manifest.images}/${manifest.imagesTotal} (${fetched} new), icons ${manifest.icons}`,
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
