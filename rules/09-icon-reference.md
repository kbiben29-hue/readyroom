# 9. Icon, Suit & Trait Reference (machine IDs)

Use these IDs verbatim in card data so sprite names, schema enums and rules text line up.

## 9.1 Specialties & icon families

| Icon                  | Meaning            | ID                |
| --------------------- | ------------------ | ----------------- |
| Research              | Specialty track    | `RESEARCH`        |
| Research Focus        | endgame multiplier | `FOCUS_RESEARCH`  |
| Research Restriction  | operation gate     | `REQ_RESEARCH`    |
| Research Skill        | counted by Utilize | `SKILL_RESEARCH`  |
| Influence             | Specialty track    | `INFLUENCE`       |
| Influence Focus       |                    | `FOCUS_INFLUENCE` |
| Influence Restriction |                    | `REQ_INFLUENCE`   |
| Influence Skill       |                    | `SKILL_INFLUENCE` |
| Military              | Specialty track    | `MILITARY`        |
| Military Focus        |                    | `FOCUS_MILITARY`  |
| Military Restriction  |                    | `REQ_MILITARY`    |
| Military Skill        |                    | `SKILL_MILITARY`  |
| Any Skill             | any one Specialty  | `SKILL_ANY`       |
| Variable Skill        | conditional        | `SKILL_VARIABLE`  |

## 9.2 Resources & tokens

| Icon              | ID                |
| ----------------- | ----------------- |
| Dilithium         | `DIL`             |
| Latinum           | `LAT`             |
| Glory             | `GLO`             |
| Victory Points    | `VP`              |
| Action token      | `ACT`             |
| Away Team         | `AWAY_TEAM`       |
| Borg Collective * | `BORG_COLLECTIVE` |
| Borg Drone *      | `BORG_DRONE`      |

`*` = icon exists in the reference but **is not used in this box**.

**Substitution:** `1 GLO = 2 DIL` or `1 GLO = 1 LAT`.

## 9.3 Card suits

| Suit                  | ID          | Market card? |
| --------------------- | ----------- | ------------ |
| Ally                  | `ALLY`      | ✅           |
| Captain               | `CAPTAIN`   |              |
| Cargo                 | `CARGO`     | ✅           |
| Directive             | `DIRECTIVE` |              |
| Discovery / Encounter | `ENCOUNTER` |              |
| Incident              | `INCIDENT`  |              |
| Mission *             | `MISSION`   |              |
| Location              | `LOCATION`  |              |
| Person                | `PERSON`    | ✅           |
| Ship                  | `SHIP`      | ✅           |

`*` not used as a loose card in this box (missions are printed on Crew boards).

## 9.4 Species traits

Referred to collectively as `ANY_SPECIES` / `DIFFERENT_SPECIES`.

| Trait        | ID             |
| ------------ | -------------- |
| Alien        | `ALIEN`        |
| Aenar        | `AENAR`        |
| Andorian     | `ANDORIAN`     |
| Android      | `ANDROID`      |
| Bajoran      | `BAJORAN`      |
| Betazoid     | `BETAZOID`     |
| Borg         | `BORG`         |
| Breen        | `BREEN`        |
| Cardassian   | `CARDASSIAN`   |
| Changeling   | `CHANGELING`   |
| Ferengi      | `FERENGI`      |
| Human        | `HUMAN`        |
| Jem'Hadar *  | `JEM_HADAR`    |
| Kelpien      | `KELPIEN`      |
| Klingon      | `KLINGON`      |
| Orion        | `ORION`        |
| Pakled       | `PAKLED`       |
| Reman        | `REMAN`        |
| Romulan      | `ROMULAN`      |
| Synthetic    | `SYNTHETIC`    |
| Tellarite    | `TELLARITE`    |
| Transcendent | `TRANSCENDENT` |
| Trill        | `TRILL`        |
| Vorta *      | `VORTA`        |
| Vulcan       | `VULCAN`       |
| XB *         | `XB`           |
| Xindi        | `XINDI`        |

## 9.5 Regular traits

| Trait          | ID              |
| -------------- | --------------- |
| Ambassador     | `AMBASSADOR`    |
| Anomaly        | `ANOMALY`       |
| Augment        | `AUGMENT`       |
| Beverage       | `BEVERAGE`      |
| Business       | `BUSINESS`      |
| Cloak          | `CLOAK`         |
| Communication  | `COMMUNICATION` |
| Creature       | `CREATURE`      |
| Doctor         | `DOCTOR`        |
| Dominion       | `DOMINION`      |
| Engineer       | `ENGINEER`      |
| Helmet *       | `HELMET`        |
| Hologram       | `HOLOGRAM`      |
| Imperial       | `IMPERIAL`      |
| Mind Control * | `MIND_CONTROL`  |
| Ops            | `OPS`           |
| Pilot          | `PILOT`         |
| Maquis         | `MAQUIS`        |
| Scientist      | `SCIENTIST`     |
| Security       | `SECURITY`      |
| Shady          | `SHADY`         |
| Spy            | `SPY`           |
| Starbase       | `STARBASE`      |
| Starfleet      | `STARFLEET`     |
| Telepath       | `TELEPATH`      |
| Time Travel    | `TIME_TRAVEL`   |
| Weapon         | `WEAPON`        |

## 9.6 Gameplay traits

| Trait    | ID         | Effect                                                                                          |
| -------- | ---------- | ----------------------------------------------------------------------------------------------- |
| Attack   | `ATTACK`   | Card has ≥1 ATTACK operation; other cards react to/defend against it                            |
| Ongoing  | `ONGOING`  | Deployed to the Fleet Area by its PLAY operation despite not being a SHIP                       |
| Surprise | `SURPRISE` | **Solo play only**                                                                              |
| Wildcard | `WILDCARD` | Counts as any one trait, owner's choice, per operation/goal. **Never counts at final scoring.** |

## 9.7 Card anatomy — data fields (p.26–27)

### Standard card

| Printed element                       | Field                                                            |
| ------------------------------------- | ---------------------------------------------------------------- |
| Name                                  | `name`                                                           |
| Card ID (small, bottom)               | `cardId`                                                         |
| Suit (top-left)                       | `suit`                                                           |
| Deck icon                             | `deck` (`COMMON` \| `PICARD` \| `SISKO` \| …)                    |
| Traits (top-right)                    | `traits[]`                                                       |
| Skill icons (upper-left under title)  | `skills[]` (max 3)                                               |
| Focus icon (bottom-right, next to VP) | `focus`                                                          |
| Victory Points                        | `vp` (+ `vpAsterisk: boolean`)                                   |
| Position indicator (bottom)           | `startPosition`                                                  |
| PLAY operation (grey strip)           | `operations[] { type: 'PLAY' }`                                  |
| Table operation (blue strip)          | `operations[] { type: 'ACTIVATION' \| 'PASSIVE' \| 'REACTION' }` |
| Resupply / Clean-up (green strip)     | `operations[] { type: 'RESUPPLY' \| 'CLEANUP' }`                 |
| Control operation                     | `operations[] { type: 'CONTROL' }`                               |
| Endgame operation (red strip)         | `operations[] { type: 'ENDGAME' }`                               |
| Special operation (purple strip)      | `operations[] { type: 'SPECIAL' }`                               |
| Development cost (black strip)        | `developmentCost`                                                |
| Action cost prefix                    | `operation.costsAction: true`                                    |

### Captain card

adds `awayTeams: number`, plus the Log slot underneath.

### Ship token

`shipName`, and the owning deck.

### Stardate card

| Element                     | Field                                                   |
| --------------------------- | ------------------------------------------------------- |
| Sequence number (top-right) | `sequence`                                              |
| Game mode                   | `mode` (`2P` \| `CADET` \| `SOLO`)                      |
| Starting Glory              | `glory`                                                 |
| Bot action count            | `botActions` (solo only)                                |
| Effect                      | `effect` (wipe Market / wipe Market + Neutral Zone / …) |

### Crew board

Two sides. Each side: 3 Specialty tracks (0–15) with VP multipliers at certain steps, plus
missions (Basic: 1; Advanced: 3 with printed VP).

## 9.8 Position indicators (where a crew card starts)

| Indicator             | Starting zone                                                     |
| --------------------- | ----------------------------------------------------------------- |
| `AVAILABLE`           | shuffled into the **Draw deck**                                   |
| `RESERVE`             | shuffled into the **Reserve deck**                                |
| `DEVELOPMENT`         | faceup in the **Development pile**                                |
| `DISCARD`             | faceup in the starting **Discard pile**                           |
| `DEPLOYED`            | faceup in the **Fleet Area** (+ Ship token on the card if a SHIP) |
| `CONTROLLED LOCATION` | faceup in the **Location Area**                                   |
| `INCIDENT DECK`       | shuffled into the shared **Incident deck** during central setup   |
| _(none)_              | **Captain card** or **Status card**                               |

## 9.9 Common-terms cheat sheet (p.36)

| Term            | Movement                                                |
| --------------- | ------------------------------------------------------- |
| **Gain / Scan** | Market → top of Draw deck **or** Discard pile           |
| **Take**        | Incident/Encounter deck → **hand**                      |
| **Enlist**      | Reserve deck or Development pile → **top of Draw deck** |
| **Find**        | hand / Draw deck / Discard / Reserve → **hand**         |
| **Deploy**      | Staging Area → Fleet Area                               |
| **Recall**      | in play → hand                                          |
| **Dismiss**     | in play → Discard pile                                  |
| **Discard**     | hand (or top of a deck) → Discard pile                  |
| **Promote**     | PERSON → Duty Officer slot (limit 1)                    |
| **Log**         | → Captain's Log                                         |
| **Junk**        | Market → Junk pile                                      |
| **Destroy**     | → the box (no longer owned)                             |
