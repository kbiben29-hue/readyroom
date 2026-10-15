// Node-side loader for the fetched STCC data (vendor/stcc/, see tools/fetch-stcc.ts).
// Returns an empty index when nothing has been fetched. Also installs the
// index as the card-name source (src/data/cardNames.ts).

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
	STCC_BOXES,
	buildStccIndex,
	type StccBox,
	type StccCard,
} from '../src/data/stcc'
import { setCardNameIndex } from '../src/data/cardNames'

export const VENDOR_DIR = join(
	resolve(fileURLToPath(new URL('.', import.meta.url)), '..'),
	'vendor',
	'stcc',
)

export async function loadStccNode(): Promise<Map<string, StccCard>> {
	const boxes: Partial<Record<StccBox, unknown>> = {}
	for (const box of STCC_BOXES) {
		try {
			boxes[box] = JSON.parse(
				await readFile(join(VENDOR_DIR, `${box}.json`), 'utf8'),
			)
		} catch {
			// not fetched
		}
	}
	const index = buildStccIndex(boxes)
	setCardNameIndex(index)
	return index
}
