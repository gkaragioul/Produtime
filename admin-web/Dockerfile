# ============================================================================
# ProduTime Admin Console - Web Edition
# Multi-stage Dockerfile for Railway deployment
# ============================================================================

# --- Stage 1: Build ---
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files and install
COPY package.json ./
RUN npm install

# Copy source code and assets
COPY tsconfig.server.json tsconfig.json webpack.config.js ./
COPY src/ ./src/
COPY assets/ ./assets/

# Build server and client
RUN npm run build:server
RUN npm run build:client

# --- Stage 2: Production ---
FROM node:20-slim

WORKDIR /app

# Install runtime dependencies for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files and install production deps only
COPY package.json ./
RUN npm install --omit=dev

# Copy built artifacts
COPY --from=builder /app/dist ./dist

# Create data directory for SQLite (mount a Railway Volume at /data for persistence)
RUN mkdir -p /data

# Environment variables (overridable — Railway sets PORT automatically)
ENV DATABASE_PATH=/data/admin-console.db
ENV NODE_ENV=production

# No HEALTHCHECK here — Railway manages its own healthcheck via /health
# No EXPOSE — Railway assigns the port dynamically

# Start server
CMD ["node", "dist/server/server/index.js"]
