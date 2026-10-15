# The hosted game: one Node process serving the built app and the online-game
# API from the same origin (docs/deploy.md). Games live on a volume at /data.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
# Card data and scans from the pinned STCC commit — its own layer, so it is
# only fetched again when the pin changes.
COPY tools/fetch-stcc.ts tools/stcc-source.json tools/
RUN node_modules/.bin/tsx tools/fetch-stcc.ts
COPY . .
RUN npm run validate:cards && node_modules/.bin/vite build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/tsconfig*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/server ./server
# card names for server text (log, recap) come from the STCC data at runtime
COPY --from=build /app/tools/stcc-node.ts ./tools/
COPY --from=build /app/vendor/stcc ./vendor/stcc
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "server/main.ts", "--public", "--host", "0.0.0.0", "--port", "8080", "--games", "/data/games", "--static", "dist"]
