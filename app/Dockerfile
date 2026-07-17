# --- Stage 1: install deps ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# --- Stage 2: runtime ---
FROM node:20-alpine AS runtime
WORKDIR /app

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
