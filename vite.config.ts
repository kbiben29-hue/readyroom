import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** `vite build --mode desktop` (the Tauri build) ships code only: the STCC
 *  JSON is not bundled (src/ui/stcc.ts) and the scans/icons Vite copied from
 *  public/stcc/ are removed, even when they were fetched on this machine. The
 *  app downloads its own copy on first launch (docs/desktop.md). */
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
		},
	}
}

export default defineConfig(({ mode }) => ({
	plugins: [react(), ...(mode === 'desktop' ? [dropStcc()] : [])],
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
