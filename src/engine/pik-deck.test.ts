// The 3PIK crew deck (Second Contact, src/data/cards/crew/pik.json): its
// setup (the Status card, the extra AWAY TEAM on its starting LOCATION) and
// the Status card's "gain 1 on a track matching the card's Skill icon".

import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from '../data/catalog'
import { register } from './resolver/testUtils'
import { setup, type CardCatalog } from './setup'
import { zoneKey } from './state'

let catalog: CardCatalog
beforeAll(async () => {
	catalog = await loadCatalog()
	register(catalog.defs)
})

describe('PIK setup', () => {
	for (const box of ['ORIGINAL', 'TBG'] as const) {
		it(`sets up with the ${box} box`, () => {
			const s = setup(
				{
					mode: 'TWO_PLAYER',
					players: [
						{ deck: 'PIK', boardSide: 'ADVANCED' },
						{ deck: box === 'TBG' ? 'GEO' : 'PIC', boardSide: 'BASIC' },
					],
					seed: 3,
					box,
					expansions: ['SECOND_CONTACT'],
				},
				catalog,
			)
			const zone = (k: string) => s.zones[zoneKey({ k, seat: 0 } as never)] ?? []
			expect(zone('STATUS')).toHaveLength(1)
			expect(zone('DEVELOPMENT')).toHaveLength(7)
			expect(zone('RESERVE')).toHaveLength(5)
			const [home] = zone('LOCATION_AREA')
			expect(s.cards[home!]!.def).toBe('3PIK03-26')
			// 4 on the CAPTAIN + 1 on the starting LOCATION
			expect(s.players[0].awayTeamsInPool).toBe(4)
			expect(s.awayTeamsAt[home!]).toEqual([1, 0])
			expect(s.players[0].awayTeamsTotal).toBe(5)
			expect(s.players[0].missions).toHaveLength(3)
		})
	}
})
