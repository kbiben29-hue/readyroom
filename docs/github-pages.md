# GitHub Pages on iPad

The Pages build is a standalone web app at
https://kbiben29-hue.github.io/readyroom/ . It does not need Xcode or a running Mac.

## Publish

In GitHub repository Settings → Pages, choose **GitHub Actions** as the build
source. Push the changes to `main`; `.github/workflows/pages.yml` builds and
publishes the site. The workflow can also be run manually from Actions.
The workflow deliberately does not fetch or publish card scans or card text.

## Install on iPad

1. Open the published URL in Safari while online.
2. Share → Add to Home Screen, then open the new Home Screen app.
3. Choose Download card database. Keep the app open until it finishes (about
   340 MB). Each iPad downloads its own copy from the community database.
4. Start a local game or play against House AI. After the first download, local
   play can work offline. Online multiplayer needs a separate reachable HTTPS
   game server: GitHub Pages only serves static files.

The site caches its code, AI worker, fonts, and icons with a service worker.
Card metadata is stored in IndexedDB; downloaded scans and card icons are
stored separately in Cache Storage. Failed downloads can be retried. A new
version installs in the background and activates after all old app windows close,
so updates do not interrupt a running game.

Browser storage may be cleared by the device or user. Keep session JSON exports
as backups. Install/open the Home Screen app before downloading the cards there,
as Safari and installed apps can use separate storage. Mac saves do not sync
automatically; export/import a session to move it.

## Local verification

```sh
npm ci
npm run build:pages
npm run preview:pages
```

Open the preview's `/readyroom/` path. Service workers require HTTPS, except for
localhost. A plain HTTP address on your Wi-Fi is not an offline-install test.
The production bundle excludes fetched card assets even if present locally.

If renaming the repository, update the Pages `base` in vite.config.ts and this URL.
