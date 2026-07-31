FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

# ── CI stage: unit tests only (vitest) ──────────────────────────────────────
# Does NOT include Playwright; use Dockerfile.e2e for browser tests.
FROM node:22-alpine AS ci

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm test

# ── Production runtime: no test deps ────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./

RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 3000

CMD ["node", "dist/server.cjs"]

# -- Dev stage: a RUNTIME ONLY, no source and no dependencies ---------------
# Used only by dev-deploy/ in-cluster; CI never builds this target.
#
# No COPY, no npm ci: the Deployment mounts the workspace PVC over /app, which
# would shadow anything baked here anyway. node_modules lives on that PVC next
# to the checkout (`npm install` from the devbox, once) -- the same shape as a
# local dev machine, and what the PVC was sized for.
#
# node:22 (Debian/glibc), NOT -alpine (musl): deps are installed on the devbox,
# which is Debian bookworm. sharp ships prebuilt native binaries, so a musl
# runtime cannot load what a glibc host installed.
FROM node:22 AS dev
WORKDIR /app
CMD ["npm", "run", "dev"]