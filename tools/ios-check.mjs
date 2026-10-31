// Read-only preflight: explain missing tools before a long native build.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const missing = []
const run = (cmd, args = []) => spawnSync(cmd, args, { encoding: 'utf8' })
if (process.platform !== 'darwin')
	missing.push('A Mac is required for iPadOS builds.')
const sdk = run('xcrun', ['--sdk', 'iphoneos', '--show-sdk-path'])
if (sdk.status !== 0 || !sdk.stdout.trim())
	missing.push(
		'Install full Xcode with the iOS SDK, open it to finish setup, and select it with sudo xcode-select -s /Applications/Xcode.app/Contents/Developer.',
	)
if (run('cargo', ['--version']).status !== 0)
	missing.push('Install the stable Rust toolchain from https://rustup.rs/.')
const targets = run('rustup', ['target', 'list', '--installed'])
for (const target of ['aarch64-apple-ios', 'aarch64-apple-ios-sim']) {
	if (targets.status !== 0 || !targets.stdout.split(/\s+/).includes(target))
		missing.push(`Install Rust target: rustup target add ${target}`)
}
if (run('pod', ['--version']).status !== 0)
	missing.push(
		'Install CocoaPods (see https://v2.tauri.app/start/prerequisites/#ios).',
	)
if (!existsSync('src-tauri/tauri.ios.conf.json'))
	missing.push('Run this command from the Ready Room repository root.')
if (missing.length) {
	console.error(
		'iPadOS build prerequisites:\n' + missing.map((x) => `- ${x}`).join('\n'),
	)
	process.exitCode = 1
} else {
	console.log(
		'Native build tools are ready. Use npm run ios:init once, then npm run ios:dev. Device signing requires your Apple development team.',
	)
}
