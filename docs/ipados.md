# Native iPadOS app

The iPad app uses the existing Tauri 2 shell and React game engine. It does not
require the Mac to run while playing. This is a source configuration, not a
signed or device-tested release yet.

## Prerequisites on the build Mac

Install full Xcode from the Mac App Store, launch it, and finish its setup.
Command Line Tools alone cannot build an iPad app. Select full Xcode:

```sh
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

Install Node.js 22+ and stable Rust, then:

```sh
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
brew install cocoapods
npm ci
npm run ios:check
```

See https://v2.tauri.app/start/prerequisites/#ios for toolchain instructions.

## Generate and run

Set your actual Apple development team ID (do not commit credentials):

```sh
export APPLE_DEVELOPMENT_TEAM=YOUR_TEAM_ID
npm run ios:init
npm run ios:dev
```

Tauri generates the Xcode project in `src-tauri/gen/apple/`. If using an Intel
Mac simulator, also install `x86_64-apple-ios` with rustup. Select an iPad
simulator, or connect your iPad and select it. For physical devices, Xcode needs
your Apple account and signing/provisioning configuration. Use Xcode's Signing &
Capabilities panel to select the team. `npm run ios:open` opens the native project
through Tauri's development command. Developer Mode may be required on the iPad.

The iOS-specific bundle ID is `io.github.kbiben29hue.readyroom`; change it before
initializing if your Apple account uses another identifier. iPadOS 16+ is the
configured minimum. Both portrait and landscape are declared. The tablet layout
is selected automatically on large touch screens; the layout menu can still
select the desktop console manually. Small Split View windows use the phone UI.

## Offline use and saves

The compiled game and fonts are bundled locally. On first launch, download the
card database inside the app while online (approximately 340 MB). It is saved in
the app's private data directory and read by the existing native `stcc` protocol.
After download, local hot-seat and House AI play do not require a Mac or internet.
Online games still need a reachable server. The default localhost server address
is the iPad itself, not the Mac; configure an HTTPS hosted server for remote play.

Saves on the Mac do not automatically transfer to the iPad. Export sessions from
the Mac and import them into the app. Keep exported backups before reinstalling
or deleting the app. Verify export/import on an actual device before relying on it.

## Build and distribute

```sh
npm run ios:build
```

Use Xcode Archive/Organizer and your Apple signing setup for TestFlight/App Store
distribution. This checkout does not contain certificates, provisioning profiles,
or an App Store Connect account. App Store approval is a separate process.

## Device validation still required

- First-run download, resume after interruption, and restart in airplane mode.
- All card faces and icons after force quitting/relaunching offline.
- House AI turn completion without freezing the interface.
- Portrait, landscape, Split View, keyboard, safe areas, and touch selection.
- Background/relaunch restores saves; export/import via the iPad Files picker.
- Online play over HTTPS with a configured server, if needed.

## Source policy

Do not commit the fetched card database, scans, or printed card text. Native
builds reuse `build:desktop`, which excludes that material; each installed app
downloads its own copy. The included font files use the SIL Open Font License;
licenses are in `public/fonts/`.
