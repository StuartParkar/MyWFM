# Build context is the monorepo root: docker build -f docker/frontend.Dockerfile .
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci

FROM deps AS build
COPY tsconfig.base.json ./
COPY shared shared
COPY frontend frontend
# This app has no frontend/public dir yet (no static assets beyond what
# src/app/ itself serves) - ensure the runtime stage's COPY below always has
# a source, empty or not, instead of failing the build when it's missing.
RUN mkdir -p frontend/public
ENV NEXT_TELEMETRY_DISABLED=1
ARG BACKEND_API_URL=http://backend:4000
ENV BACKEND_API_URL=${BACKEND_API_URL}
RUN npm run build --workspace=shared && npm run build --workspace=frontend

# outputFileTracingRoot (frontend/next.config.ts) is set to the monorepo root,
# so the standalone bundle lands at /app/frontend/.next/standalone/frontend/server.js.
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Docker sets HOSTNAME to the container id by default, and the Next.js
# standalone server binds to whatever HOSTNAME resolves to instead of all
# interfaces if it's set - found by running this for real: the server ended
# up listening only on the container's own Docker-network IP, so anything
# using loopback (this file's own HEALTHCHECK, `wget localhost` from inside
# the container) got "Connection refused" even though the container's
# externally-published port worked fine. Force it to bind everywhere.
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/frontend/.next/standalone ./
COPY --from=build /app/frontend/.next/static ./frontend/.next/static
COPY --from=build /app/frontend/public ./frontend/public

EXPOSE 3000
# 127.0.0.1, not localhost: found by running this for real - this Alpine
# image's wget resolves "localhost" to ::1 first, which nothing listens on
# (the server binds the IPv4 0.0.0.0 above, not the IPv6/dual-stack ::).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/login || exit 1
CMD ["node", "frontend/server.js"]
