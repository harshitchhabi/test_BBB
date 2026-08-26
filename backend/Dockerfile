# Same shape as the legacy backend/Dockerfile, adjusted for the smaller
# dependency set now that this process is a pure WS relay (no db/ package
# needed at runtime).
FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY packages/common/package.json ./packages/common/
COPY packages/common/ ./packages/common/
COPY backend/ ./backend/
RUN npm install

FROM base AS runner
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/ ./packages/
COPY --from=deps /app/backend/ ./backend/
WORKDIR /app/backend

EXPOSE 8080
CMD ["npm", "start"]
