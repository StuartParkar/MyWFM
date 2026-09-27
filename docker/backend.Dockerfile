# Build context is the monorepo root: docker build -f docker/backend.Dockerfile .
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY backend/package.json backend/package.json
RUN npm ci

FROM deps AS build
COPY tsconfig.base.json ./
COPY shared shared
COPY backend backend
RUN npm run build --workspace=shared && npm run build --workspace=backend

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
# The migration runner resolves database/ relative to its own compiled path
# (backend/dist/db/migrate.js -> ../../../database), so it must ship in the image.
COPY database ./database

WORKDIR /app/backend
EXPOSE 4000
# 127.0.0.1, not localhost - see the same fix's comment in frontend.Dockerfile;
# Express's app.listen() here happens to bind dual-stack so "localhost"
# currently works too, but this avoids relying on that.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:4000/api/system-health || exit 1
CMD ["node", "dist/server.js"]
