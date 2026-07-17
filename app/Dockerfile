# --- Stage 1: install deps ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# --- Stage 2: runtime ---
# --- Stage 2: runtime ---
FROM node:20-alpine AS runtime
WORKDIR /app

# Patch OS packages (fixes the OpenSSL libssl3/libcrypto3 CVE Trivy flags)
RUN apk upgrade --no-cache

# Strip build-only tooling that ships in the base image but is never used
# at runtime (the app only ever calls `node server.js`). This is also
# where most of Trivy's findings live — npm/yarn's own bundled
# dependencies, not the app's.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /opt/yarn-v* \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg 2>/dev/null || true

# Create a non-root user (DevSecOps requirement — containers must not run as root)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=deps /app/node_modules ./node_modules
COPY server.js ./
COPY package.json ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER appuser

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["node", "server.js"]
