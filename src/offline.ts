// Wait for control before rendering the card download screen: its images are
// served from a local cache, not from files on the GitHub Pages server.
export async function prepareOfflineApp(): Promise<void> {
	if (!('serviceWorker' in navigator))
		throw new Error('Offline storage requires a supported browser and HTTPS.')
	await navigator.serviceWorker.register(
		`${import.meta.env.BASE_URL}offline-worker.js`,
		{
			scope: import.meta.env.BASE_URL,
		},
	)
	await navigator.serviceWorker.ready
	if (!navigator.serviceWorker.controller) {
		await new Promise<void>((resolve) =>
			navigator.serviceWorker.addEventListener(
				'controllerchange',
				() => resolve(),
				{ once: true },
			),
		)
	}
	await navigator.storage?.persist?.().catch(() => false)
}
