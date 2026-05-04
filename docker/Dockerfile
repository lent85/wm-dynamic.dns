# =============================================================================
# wm-dynamic-dns: single-image build serving API + SPA
# =============================================================================

# ---- Stage 1: build ---------------------------------------------------------
FROM node:20-alpine AS build

# Tools needed to compile the better-sqlite3 native module + argon2.
RUN apk add --no-cache python3 make g++ git

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy manifests first for better layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile=false

# Copy source after install so node_modules are cached across code changes.
COPY apps ./apps
COPY packages ./packages

RUN pnpm --filter @wm-ddns/shared build \
 && pnpm --filter @wm-ddns/api build \
 && pnpm --filter @wm-ddns/web build

# Prune to production-only deps for the api image.
RUN pnpm --filter @wm-ddns/api deploy --prod --legacy /deploy/api

# ---- Stage 2: runtime -------------------------------------------------------
FROM node:20-alpine AS runtime

# tzdata so the TZ env var actually changes cron timezone behavior.
RUN apk add --no-cache tini tzdata wget

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV DATABASE_URL=file:/data/app.db
ENV TZ=UTC

WORKDIR /app

# Pruned, production-only API workspace (includes its node_modules and dist).
COPY --from=build /deploy/api/ ./

# Built SPA — Fastify static plugin will serve this from /app/web/dist.
COPY --from=build /app/apps/web/dist ./web/dist

# The Fastify static handler resolves SPA assets relative to the API dist.
# Move web/dist next to api/dist so server.ts's path probing finds it.
RUN mkdir -p /app/apps/web && mv /app/web/dist /app/apps/web/dist \
 && mkdir -p /data \
 && addgroup -S app && adduser -S app -G app \
 && chown -R app:app /app /data

VOLUME ["/data"]
EXPOSE 8080

USER app

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz | grep -q ok || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
