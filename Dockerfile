# Multi-stage production build
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package descriptors
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source and configurations
COPY tsconfig.json tsconfig.build.json nest-cli.json drizzle.config.ts ./
COPY src ./src

# Build application
RUN pnpm run build

# Prune dev dependencies for lean production image
RUN pnpm prune --prod

# Production runtime stage
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# Install runtime dependencies: ffmpeg, yt-dlp, python3, ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    python3 \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000

# Copy node_modules and built dist from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY ecosystem.config.cjs ./

# Expose HTTP API port
EXPOSE 3000

# Run NestJS application
CMD ["node", "dist/src/main.js"]
