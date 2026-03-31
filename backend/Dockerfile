# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy source code
COPY . .

# ---- Runtime Stage ----
FROM node:20-alpine

WORKDIR /app

# Copy everything from builder
COPY --from=builder /app .

# Create logs and data directories
RUN mkdir -p logs data

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

# Start the server
CMD ["sh", "-c", "npx prisma db push --skip-generate && node src/index.js"]
