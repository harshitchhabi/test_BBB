# Build from the REPO ROOT - same reasoning as frontend/Dockerfile (the
# backend depends on its workspace siblings via "file:../packages/*"):
#   docker build -f backend/Dockerfile -t bbb-backend .
# No compile step - the backend runs straight off tsx (see its own
# "start" script), same as it does outside Docker.

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY packages/common/package.json packages/common/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/game-engine/package.json packages/game-engine/package.json
RUN npm ci

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY backend backend
COPY packages/common packages/common
COPY packages/db packages/db
COPY packages/game-engine packages/game-engine
WORKDIR /app/backend
EXPOSE 8080
CMD ["npm", "run", "start"]
