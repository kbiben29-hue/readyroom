/** Bound first-install waiting; an existing worker can start the app immediately. */
export async function prepareOfflineApp(): Promise<void> {
	if (!('serviceWorker' in navigator))
		throw new Error('Offline storage requires a supported browser and HTTPS.')
	const workers = navigator.serviceWorker
	const registration = workers.register(
		`${import.meta.env.BASE_URL}offline-worker.js`,
		{
			scope: import.meta.env.BASE_URL,
			updateViaCache: 'none',
		},
	)
	// Never hold the loading screen for an update or a storage permission prompt.
	if (workers.controller) {
		void registration.catch(() => {})
		return
	}
	let timer: ReturnType<typeof setTimeout> | undefined
	let controlled: (() => void) | undefined
	try {
		await Promise.race([
			(async () => {
				await registration
				await workers.ready
				if (workers.controller) return
				await new Promise<void>((resolve) => {
					controlled = () => {
						if (workers.controller) resolve()
					}
					workers.addEventListener('controllerchange', controlled)
					controlled()
				})
			})(),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() =>
						reject(
							new Error('Offline setup timed out. Reconnect and try again.'),
						),
					12000,
				)
			}),
		])
	} finally {
		clearTimeout(timer)
		if (controlled) workers.removeEventListener('controllerchange', controlled)
	}
}
