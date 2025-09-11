# 1. Builder
FROM node:20-slim AS builder

WORKDIR /app

# Install all deps (build needs dev)
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

# Copy source
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# Build standalone output
RUN npm run build

# 2. Runner (distroless, minimal)
FROM gcr.io/distroless/nodejs20-debian12 AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy only what's needed
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/config.json ./config.json

USER nonroot

EXPOSE 9002
CMD ["server.js"]
