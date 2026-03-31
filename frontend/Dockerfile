# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Accept build-time env vars (NEXT_PUBLIC_* must be present at build time)
ARG NEXT_PUBLIC_API_URL=http://localhost:5000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Build the Next.js app (produces standalone output)
RUN npm run build

# ---- Runtime Stage ----
FROM node:20-alpine

WORKDIR /app

# Copy the standalone server
COPY --from=builder /app/.next/standalone/ ./
# Copy static assets
COPY --from=builder /app/.next/static/ ./.next/static/
# Copy public dir if it exists
COPY --from=builder /app/public/ ./public/

# Expose port
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1

# Start the standalone Next.js server
CMD ["node", "server.js"]
