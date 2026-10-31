import { describe, expect, it } from 'vitest'
import { desktopFit } from './ConsoleFit'

describe('PC board fitting', () => {
	it('keeps the PC canvas wide enough in portrait and fits it to the screen', () => {
		for (const [width, height] of [
			[768, 1024],
			[820, 1180],
			[1024, 768],
			[1366, 1024],
		]) {
			const fit = desktopFit(width!, height!)
			expect(fit.width).toBeGreaterThanOrEqual(1080)
			expect(fit.width * fit.scale).toBeCloseTo(width!)
			expect(fit.height * fit.scale).toBeCloseTo(height!)
		}
	})
})
