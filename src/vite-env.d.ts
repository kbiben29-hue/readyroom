/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** The hosted game's URL, set for builds it does not serve (desktop). */
	readonly VITE_PUBLIC_URL?: string
}
