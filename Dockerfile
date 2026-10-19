# The hosted game: one Node process serving the built app and the online-game
# API from the same origin (docs/deploy.md). Games live on a volume at /data.
# Code only: no STCC card data is fetched or served here. Browsers get text
# cards; the desktop apps bring their own copy of the card database.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run validate:cards && node_modules/.bin/vite build --mode hosted

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/tsconfig*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/server ./server
# server/main.ts loads STCC names when present; here there are none, so the
# server's texts fall back to card ids and clients name cards from their own data
COPY --from=build /app/tools/stcc-node.ts ./tools/
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "server/main.ts", "--public", "--host", "0.0.0.0", "--port", "8080", "--games", "/data/games", "--static", "dist"]
