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
COPY --from=build /app/frontend/.next/standalone ./
COPY --from=build /app/frontend/.next/static ./frontend/.next/static
COPY --from=build /app/frontend/public ./frontend/public

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://localhost:3000/login || exit 1
CMD ["node", "frontend/server.js"]
