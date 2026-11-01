// iPhone screenshots for layout work (.github/workflows/phone-shots.yml).
// Starts a PIC vs SHR game through the dev-only store handle and captures the
// phone shell in portrait and landscape, plus a few opened views.
import { webkit, devices } from 'playwright'

const out = process.argv[2] ?? '/tmp/shots'
const URL = 'http://localhost:5173/'

async function shoot(name, deviceName, steps) {
	const browser = await webkit.launch()
	const ctx = await browser.newContext({ ...devices[deviceName] })
	const page = await ctx.newPage()
	page.on('console', (m) => {
		if (m.type() === 'error') console.log(`[${name}] console:`, m.text())
	})
	page.on('pageerror', (e) => console.log(`[${name}] pageerror:`, e.message))
	await page.goto(URL)
	await page.waitForFunction(() => globalThis.__rrStore !== undefined, null, {
		timeout: 60000,
	})
	await page.waitForFunction(
		() => globalThis.__rrStore.getState().catalog !== null,
		null,
		{ timeout: 60000 },
	)
	await page.screenshot({ path: `${out}/${name}-0-setup.png` })
	await page.evaluate(() => {
		globalThis.__rrStore.getState().startGame({
			mode: 'TWO_PLAYER',
			players: [
				{ deck: 'PIC', boardSide: 'BASIC' },
				{ deck: 'SHR', boardSide: 'BASIC' },
			],
			seed: 7,
		})
	})
	await page.waitForTimeout(2500)
	await page.screenshot({ path: `${out}/${name}-1-start.png` })
	let i = 2
	for (const [label, fn] of steps) {
		try {
			await fn(page)
			await page.waitForTimeout(1200)
			await page.screenshot({ path: `${out}/${name}-${i}-${label}.png` })
		} catch (e) {
			console.log(`[${name}] step ${label} failed:`, e.message)
		}
		i++
	}
	const html = await page.evaluate(() => document.body.innerHTML.length)
	console.log(`[${name}] done, body html ${html} chars`)
	await browser.close()
}

const advance = async (page) => {
	// play on until the first Action Step: START, then PASS through phases
	await page.evaluate(async () => {
		const s = globalThis.__rrStore
		for (let k = 0; k < 8; k++) {
			const st = s.getState()
			if (st.state?.phase?.k === 'ACTION') break
			const legal = st.legal ?? []
			const pass = legal.find((l) => l.t === 'START' || l.t === 'PASS')
			if (pass) st.dispatch(pass)
			else if (st.pendingChoice) break
			await new Promise((r) => setTimeout(r, 300))
		}
	})
}

const tapFirstHandCard = async (page) => {
	const el = page.locator('[data-iid]').first()
	await el.click({ timeout: 5000 })
}

const steps = [
	['action', advance],
	['tap-card', tapFirstHandCard],
	['close', async (p) => p.keyboard.press('Escape')],
	[
		'scrolled',
		async (p) =>
			p.evaluate(() => {
				const h = document.querySelector('.console-fit-host')
				if (h) h.scrollTop = h.scrollHeight
			}),
	],
]

await shoot('iphone13', 'iPhone 13', steps)
await shoot('iphone13-land', 'iPhone 13 landscape', steps)
await shoot('iphoneSE', 'iPhone SE', steps.slice(0, 1))
await shoot('iphone15max-land', 'iPhone 15 Pro Max landscape', steps)
