import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** `vite build --mode desktop` (the Tauri build) and `--mode hosted` (the Fly
 *  image) ship code only: the STCC JSON is not bundled (src/ui/stcc.ts) and
 *  the scans/icons Vite copied from public/stcc/ are removed, even when they
 *  were fetched on this machine. The desktop app downloads its own copy on
 *  first launch (docs/desktop.md). */
const CODE_ONLY = new Set(['desktop', 'hosted'])

function dropStcc(): Plugin {
	let outDir = 'dist'
	return {
		name: 'ready-room:drop-stcc',
		apply: 'build',
		configResolved(config) {
			outDir = resolve(config.root, config.build.outDir)
		},
		async closeBundle() {
			await rm(resolve(outDir, 'stcc'), { recursive: true, force: true })
			// locally rendered art of the fan-made custom packs (public/custom/)
			await rm(resolve(outDir, 'custom'), { recursive: true, force: true })
		},
	}
}

/** Dev only: the app mirrors every autosave here (src/ui/persistence.ts
 *  `mirrorToDevServer`), one file per game under `.debug/games/` (gitignored),
 *  so `npm run game` can replay and summarise the game you are testing. */
function debugGames(): Plugin {
	return {
		name: 'ready-room:debug-games',
		apply: 'serve',
		configureServer(server) {
			const dir = resolve(server.config.root, '.debug', 'games')
			server.middlewares.use('/__debug/games/', (req, res, next) => {
				const id = (req.url ?? '').replace(/^\//, '')
				if (req.method !== 'PUT' || !/^[\w-]+$/.test(id)) return next()
				let body = ''
				req.setEncoding('utf8')
				req.on('data', (chunk: string) => (body += chunk))
				req.on('end', () => {
					void (async () => {
						try {
							await mkdir(dir, { recursive: true })
							const pretty = JSON.stringify(JSON.parse(body), null, 2)
							await writeFile(resolve(dir, `${id}.json`), pretty)
							res.statusCode = 204
						} catch {
							res.statusCode = 400
						}
						res.end()
					})()
				})
			})
		},
	}
}

export default defineConfig(({ mode }) => ({
	plugins: [
		react(),
		debugGames(),
		...(CODE_ONLY.has(mode) ? [dropStcc()] : []),
	],
	// the house-AI worker (src/ui/botWorker.ts) is a module worker; ES output
	// keeps it valid if it ever code-splits (iife can't)
	worker: { format: 'es' },
	resolve: {
		alias: {
			'@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
			'@data': fileURLToPath(new URL('./src/data', import.meta.url)),
			'@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
			'@session': fileURLToPath(new URL('./src/session', import.meta.url)),
		},
	},
}))
