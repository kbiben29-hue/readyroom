# Hosting the game on Fly.io

One small always-on machine runs the game server, which also serves the built app from the same
address. Both captains open one URL; invite links point at it. About $4/month (512 MB shared
machine, 1 GB volume).

## What gets deployed

- **`Dockerfile`** builds the app and runs `server/main.ts --public --static dist` on port 8080.
- **No card data.** The image ships code only: it never fetches the STCC database,
  `.dockerignore` keeps any local copy out, and `vite build --mode hosted` drops it from the
  bundle. In a browser the hosted app shows text cards. The desktop apps (docs/desktop.md)
  download their own copy of the card database and use this server for online play, so they show
  full cards there too. The server's own texts name cards by id.
- **`fly.example.toml`** (copied to your own, gitignored `fly.toml`) is one machine in Frankfurt with a volume `games` mounted at `/data`. The machine
  never auto-stops (deadline timers and the live stream need it up).
- **`--public`** switches off the unauthenticated `/sessions` debug store and the debug page, and
  rate-limits each client by `Fly-Client-IP`: 600 API requests a minute, 20 new games an hour.

## Deploy your own copy

You need a Fly.io account (it asks for a credit card) and `flyctl`. Docker is not needed locally —
the image builds on Fly's servers.

1. **Install and log in.**

   ```bash
   brew install flyctl
   fly auth signup            # or: fly auth login
   ```

2. **Pick an app name.** It becomes `https://NAME.fly.dev` and must be unique across all of Fly.
   Copy the example config (your `fly.toml` is gitignored) and put your name in it
   (`app = "ready-room-yourname"`), then create the app — with the name typed in, not in angle
   brackets:

   ```bash
   cp fly.example.toml fly.toml
   fly apps create ready-room-yourname
   ```

   "Name has already been taken" means someone owns it — unless `fly apps list` shows it under
   your account, in which case just carry on.

3. **Create the disk for games** (1 GB, same region as `primary_region` in `fly.toml`):

   ```bash
   fly volumes create games --region fra --size 1 --yes
   ```

4. **Deploy.** The first build takes a few minutes.

   ```bash
   fly deploy --ha=false --remote-only
   ```

   `--ha=false` matters: games live on one volume and in one process, so the app must run on
   exactly one machine.

5. **Play.** Open `https://NAME.fly.dev`, **Play online** → **New online game**, and send the
   invite link to the other captain.

## Later

- **Update:** `fly deploy --ha=false --remote-only` after pulling or committing changes.
- **Newer card data:** `npm run fetch-cards -- --latest` (bumps the pin), commit
  `tools/stcc-source.json`, and cut a new desktop release; the server doesn't need it.
- **Logs:** `fly logs`. **Shell:** `fly ssh console` (games are JSON files in `/data/games`).
- **Backups:** Fly snapshots the volume daily; `fly volumes snapshots list <volume-id>`.
- **Try hosted mode locally:** `npx vite build --mode hosted`, then
  `npx tsx server/main.ts --public --port 8080 --static dist` (the `hosted` entry in
  `.claude/launch.json`).
