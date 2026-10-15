// Runtime identity brand (provisional — todo/04; finalised alongside
// todo/05 engine state). Card instance ids are plain strings at runtime so the
// state stays JSON-serialisable; the brand only exists at compile time.
//
// Instance ids look like "p0#0042" (seat#serial) — the setup phase mints them
// deterministically (todo/06). The resolver never mints new ids; it only moves
// existing instances around.

export type CardInstanceId = string & {
	readonly __cardInstanceId: unique symbol
}

/** Cast a runtime string to a CardInstanceId. Setup/authoring only. */
export function toIid(s: string): CardInstanceId {
	return s as CardInstanceId
}
