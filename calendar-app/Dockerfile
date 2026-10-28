# glibc base: better-sqlite3 (and later sharp) ship prebuilt binaries for glibc,
# so no compiler is needed here. Keep the tag in step with .node-version.
ARG NODE_IMAGE=node:24-bookworm-slim

# ---- build ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app

# Use the pnpm version pinned by "packageManager" in package.json.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Dependencies first, so this layer is reused until the lockfile changes.
# --ignore-scripts skips the "postinstall" (nuxt prepare), which needs the
# sources and config; "pnpm rebuild" then runs just the allowed build scripts
# (better-sqlite3, esbuild) and "nuxt build" prepares the project itself.
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts \
    && pnpm rebuild

COPY . .
RUN pnpm build

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
ARG VERSION=dev

LABEL org.opencontainers.image.title="Wall Display calendar-app" \
      org.opencontainers.image.description="Self-hosted smart wall calendar: the Nuxt app and server." \
      org.opencontainers.image.source="https://github.com/Kallb123/Wall-Display" \
      org.opencontainers.image.version="${VERSION}"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    TZ=Europe/London \
    WALLCAL_CONFIG_DIR=/config \
    WALLCAL_DATA_DIR=/data \
    WALLCAL_MIGRATIONS_DIR=/app/.output/server/db/migrations

# /config is mounted read-only by compose; /data must be writable by the node user (uid 1000).
RUN mkdir -p /config /data && chown node:node /config /data

WORKDIR /app
COPY --from=build --chown=node:node /app/.output ./.output

USER node
EXPOSE 8080

# No curl in the slim image, so ask the app from Node itself.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "/app/.output/server/index.mjs"]
