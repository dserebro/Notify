# syntax=docker/dockerfile:1.7
#
# Notify — multi-stage build on node:24-alpine.
#
# Stage 1 (`builder`) installs the full workspace with dev deps, compiles
# the shared package, the Node/Hono server (tsc), and the Preact PWA
# (Vite). Stage 2 (`runtime`) copies only production artefacts and runs
# as a non-root user. No secrets are baked in: SUB, SENDKEY, LOGINKEY
# and VAPID_KEY are supplied at runtime.
#
# Image is multi-arch (linux/amd64, linux/arm64). better-sqlite3 ships
# prebuilt binaries for both; the `python3 make g++` toolchain in the
# builder stage is a fallback for musl targets where the prebuilt is
# missing.

############################
# Stage 1 — builder
############################
FROM node:24-alpine AS builder

# Toolchain for better-sqlite3 native build on musl when a matching
# prebuilt binary is not available.
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy manifests first so the `npm ci` layer is cached unless a
# package.json / lockfile changes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY app/server/package.json app/server/package.json
COPY app/frontend/package.json app/frontend/package.json

# Install the full workspace with dev deps. `vite build` and `tsc`
# both need them. The lockfile is authoritative via `npm ci`.
RUN npm ci --include=dev --workspaces --include-workspace-root

# Copy the rest of the sources (respects .dockerignore).
COPY . .

# Build order: shared → server → frontend (declared in root
# package.json's `build` script).
RUN npm run build

# Prune dev deps so the runtime stage can copy a slim node_modules.
# Doing this here (instead of a second `npm ci --omit=dev`) avoids a
# second native rebuild of better-sqlite3.
RUN npm prune --omit=dev --workspaces --include-workspace-root

############################
# Stage 2 — runtime
############################
FROM node:24-alpine AS runtime

# Create non-root user. Numeric uid/gid left to adduser's -S default
# so the system user range is used.
RUN addgroup -S notify && adduser -S notify -G notify

WORKDIR /app

# Production artefacts only. node_modules is already pruned above.
COPY --from=builder --chown=notify:notify /app/node_modules ./node_modules
COPY --from=builder --chown=notify:notify /app/package.json ./package.json
COPY --from=builder --chown=notify:notify /app/package-lock.json ./package-lock.json
COPY --from=builder --chown=notify:notify /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder --chown=notify:notify /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=notify:notify /app/app/server/package.json ./app/server/package.json
COPY --from=builder --chown=notify:notify /app/app/server/dist ./app/server/dist
COPY --from=builder --chown=notify:notify /app/app/frontend/package.json ./app/frontend/package.json
COPY --from=builder --chown=notify:notify /app/app/frontend/dist ./app/frontend/dist

# The data directory lives on a mounted volume so the SQLite file and
# the generated vapid.json survive container restarts. Create it with
# the right owner before the final USER switch.
RUN mkdir -p /data && chown -R notify:notify /data

ENV NODE_ENV=production \
    FRONTEND=/app/app/frontend/dist \
    DATABASE_PATH=/data/notify.db \
    PORT=8787 \
    HOST=0.0.0.0

VOLUME ["/data"]
EXPOSE 8787

USER notify

# Node's built-in fetch replaces the legacy `curl` healthcheck.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Entrypoint is the compiled server; `run` is the commander default so
# `docker run notify` boots the HTTP server with no arguments. Pass
# `generate`, `notify`, `import-devices …` to use the other CLI
# subcommands.
ENTRYPOINT ["node", "app/server/dist/index.js"]
CMD ["run"]
