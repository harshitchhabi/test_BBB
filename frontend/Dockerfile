# Build from the REPO ROOT, not this directory - frontend depends on its
# workspace siblings (packages/common, packages/db, packages/game-engine)
# via "file:../packages/*" in package.json, which npm workspaces resolves
# via symlinks that only exist if the whole monorepo is present:
#   docker build -f frontend/Dockerfile -t bbb-frontend .
# (deploy/docker/docker-compose.yml does this for you.)

FROM node:20-slim AS deps
WORKDIR /app
# Only the manifests first, so this layer (the slow one - npm ci) is
# cached across builds that only change application source.
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY packages/common/package.json packages/common/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/game-engine/package.json packages/game-engine/package.json
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
COPY . .
# NEXT_PUBLIC_* env vars are inlined into the client bundle at build
# time, not read at container runtime - must be a build ARG, not just
# an env var on the running container (same reasoning as
# deploy/scripts/deploy.sh's native-deploy equivalent).
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
RUN npm run build --workspace=frontend

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# next.config.ts's output:"standalone" traces only the node_modules this
# app actually uses (from the monorepo root, since that's where the
# lockfile lives) into .next/standalone - the runtime image ships just
# that, not the full node_modules tree from the builder stage.
COPY --from=builder /app/frontend/.next/standalone ./
COPY --from=builder /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder /app/frontend/public ./frontend/public
EXPOSE 3000
CMD ["node", "frontend/server.js"]
