# Desktop app

Ready Room is also built as a desktop app for macOS and Windows with
[Tauri](https://tauri.app/) (`src-tauri/`). The app is the same web build, run in the system
webview (WebKit on macOS, WebView2 on Windows).

## Card data on first launch

The installers ship **code only**: no STCC JSON, scans or icons. On first launch the app shows a
**Card database** screen and downloads its own copy from the pinned upstream commit
(`tools/stcc-source.json`), using the same code as `npm run fetch-cards`
(`src/data/stccFetch.ts`). The download is about 340 MB and only happens once. The player can
skip it and play with text cards.

- The Rust side (`src-tauri/src/lib.rs`) only stores files and serves them back. It downloads only
  from `raw.githubusercontent.com/periodic-agent/stcc-strategy/` and writes only inside the
  app-data folder. The webview reads the data over the `stcc://` scheme (`http://stcc.localhost`
  on Windows). `src/desktop/` holds the bridge and the setup screen.
- The data lives in the app-data folder:
  - macOS: `~/Library/Application Support/io.github.rwolffgang.readyroom/stcc/`
  - Windows: `%APPDATA%\io.github.rwolffgang.readyroom\stcc\`
- When a new app version pins a newer STCC commit, the screen appears again and fetches only what
  is missing. **Card database** on the start screen opens it at any time.
- `vite build --mode desktop` (`npm run build:desktop`, which `tauri build` runs) leaves the STCC
  JSON out of the bundle and deletes `dist/stcc`, even on a machine that has fetched the data.

## Online play

Desktop builds point online play and invite links at the hosted game, which is set at build time
with `VITE_PUBLIC_URL`. In CI it comes from the repository variable `READY_ROOM_PUBLIC_URL`
(Settings → Secrets and variables → Actions → Variables), for example
`https://ready-room-game.fly.dev`. Invite links then open in any browser. Desktop players join a
game by pasting the link into **Play online**. A server address set in the lobby still overrides
the default.

## Releases

`.github/workflows/desktop.yml` runs lint and tests, then builds on `macos-latest` (universal
`.dmg`) and `windows-latest` (NSIS `.exe` installer).

- **Release:** bump `version` in `package.json` (Tauri reads it from there), commit, then
  `git tag v0.1.0 && git push origin v0.1.0`. The workflow creates a **draft** GitHub Release with
  the installers. Review it and publish.
- **Test build:** run the workflow by hand (Actions → Desktop → Run workflow). The installers are
  attached to the run as artifacts.

The builds are **not code-signed**:

- macOS: right-click the app → **Open**, or System Settings → Privacy & Security → **Open
  Anyway**. If macOS says the app "is damaged", run `xattr -cr "/Applications/Ready Room.app"`.
- Windows: SmartScreen → **More info** → **Run anyway**.

Signing can be added later through `tauri-action`'s signing environment variables and GitHub
secrets.

## Local development

You need a Rust toolchain ([rustup](https://rustup.rs/)) in addition to Node.

```bash
npm run desktop:dev     # Vite on :1420 inside a Tauri window
npm run desktop:build   # installers under src-tauri/target/release/bundle/
VITE_PUBLIC_URL=https://ready-room-game.fly.dev npm run desktop:build
```

`cd src-tauri && cargo test` runs the Rust unit tests (path and URL checks).
