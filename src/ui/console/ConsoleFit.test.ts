import { describe, expect, it } from 'vitest'
import { desktopFit, MAX_PORTRAIT_H, MIN_CANVAS_H } from './ConsoleFit'

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

	it('fits a phone by width and never lays the canvas out too short', () => {
		for (const [width, height] of [
			[390, 844],
			[844, 390],
			[932, 430],
		]) {
			const fit = desktopFit(width!, height!)
			expect(fit.width * fit.scale).toBeCloseTo(width!)
			if (width! > height!)
				expect(fit.height).toBeGreaterThanOrEqual(MIN_CANVAS_H)
			else expect(fit.height).toBeLessThanOrEqual(MAX_PORTRAIT_H)
			expect(fit.rotateHint).toBe(width! < height!)
		}
	})
})
