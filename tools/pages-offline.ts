import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import type { Plugin } from 'vite'

/** Cache code/fonts only at install. Card faces are fetched by each player. */
export function pagesOffline(): Plugin {
	let base = '/'
	return {
		name: 'ready-room:offline-pages',
		enforce: 'post',
		configResolved(config) {
			base = config.base
		},
		async generateBundle(_options, bundle) {
			const publicFiles = [
				'icon.svg',
				'apple-touch-icon.png',
				'manifest.webmanifest',
				...(await readdir('public/fonts')).map((f) => `fonts/${f}`),
			]
			const files = [...Object.keys(bundle), ...publicFiles]
			const hash = createHash('sha256').update(JSON.stringify(bundle))
			for (const f of publicFiles) hash.update(await readFile(`public/${f}`))
			const version = hash.digest('hex').slice(0, 16)
			this.emitFile({
				type: 'asset',
				fileName: 'offline-worker.js',
				source: `
const SHELL = 'ready-room-shell-${version}';
const CARDS = 'ready-room-card-images-v1';
const BASE = ${JSON.stringify(base)};
const URLS = ${JSON.stringify(files.map((f) => base + f))};
self.addEventListener('install', event => {
 event.waitUntil(caches.open(SHELL).then(async cache => { await cache.addAll(URLS); await self.skipWaiting(); }));
});
self.addEventListener('activate', event => {
 event.waitUntil((async () => {
  // Retain earlier shells so tabs already open can finish using their assets.
  await self.clients.claim();
  for (const client of await self.clients.matchAll({type:'window'})) client.postMessage({type:'ready-room-updated'});
 })());
});
self.addEventListener('fetch', event => {
 const url = new URL(event.request.url);
 if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
 if (url.pathname.startsWith(BASE + 'stcc/')) {
  event.respondWith(caches.open(CARDS).then(cache => cache.match(event.request)).then(hit => hit || new Response('Card not downloaded', {status:404})));
 } else if (event.request.mode === 'navigate' && url.pathname.startsWith(BASE)) {
  event.respondWith(fetch(event.request).then(response => { if (!response.ok) throw new Error('Navigation failed'); return response; }).catch(() => caches.open(SHELL).then(cache => cache.match(BASE + 'index.html'))));
 } else if (URLS.includes(url.pathname) || url.pathname.startsWith(BASE + 'assets/')) {
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
 }
});
`,
			})
		},
	}
}
