import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
			'@data': fileURLToPath(new URL('./src/data', import.meta.url)),
			'@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
			'@session': fileURLToPath(new URL('./src/session', import.meta.url)),
		},
	},
})
