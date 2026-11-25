# Multi-stage Dockerfile for AutoMint Next.js Frontend

# Stage 1: Dependencies
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Environment variables for build time
ENV NEXT_TELEMETRY_DISABLED 1
ENV NODE_ENV production

# Build-time configuration. The contract IDs have NO defaults: the app validates
# them (StrKey checksum) at import time, so real deployed IDs must be passed with
# --build-arg (see docs/DEPLOYMENT.md).
ARG NEXT_PUBLIC_NETWORK=TESTNET
ARG NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
ARG NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
ARG NEXT_PUBLIC_REGISTRY_CONTRACT_ID
ARG NEXT_PUBLIC_BOT_NFT_CONTRACT_ID
ARG NEXT_PUBLIC_ACCRUAL_CONTRACT_ID
ARG NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID
ARG NEXT_PUBLIC_TOKEN_CONTRACT_ID
ARG NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
ARG NEXT_PUBLIC_SIMULATION_SOURCE=""
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_APP_ENV=production
ARG NEXT_PUBLIC_ANALYTICS_ENABLED=false

ENV NEXT_PUBLIC_NETWORK=${NEXT_PUBLIC_NETWORK}
ENV NEXT_PUBLIC_SOROBAN_RPC_URL=${NEXT_PUBLIC_SOROBAN_RPC_URL}
ENV NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE=${NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE}
ENV NEXT_PUBLIC_REGISTRY_CONTRACT_ID=${NEXT_PUBLIC_REGISTRY_CONTRACT_ID}
ENV NEXT_PUBLIC_BOT_NFT_CONTRACT_ID=${NEXT_PUBLIC_BOT_NFT_CONTRACT_ID}
ENV NEXT_PUBLIC_ACCRUAL_CONTRACT_ID=${NEXT_PUBLIC_ACCRUAL_CONTRACT_ID}
ENV NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID=${NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID}
ENV NEXT_PUBLIC_TOKEN_CONTRACT_ID=${NEXT_PUBLIC_TOKEN_CONTRACT_ID}
ENV NEXT_PUBLIC_HORIZON_URL=${NEXT_PUBLIC_HORIZON_URL}
ENV NEXT_PUBLIC_SIMULATION_SOURCE=${NEXT_PUBLIC_SIMULATION_SOURCE}
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
ENV NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV}
ENV NEXT_PUBLIC_ANALYTICS_ENABLED=${NEXT_PUBLIC_ANALYTICS_ENABLED}

# Fail early with a clear message when contract IDs were not provided.
RUN for v in REGISTRY BOT_NFT ACCRUAL MARKETPLACE TOKEN; do \
      eval "val=\$NEXT_PUBLIC_${v}_CONTRACT_ID"; \
      if [ -z "$val" ]; then \
        echo "ERROR: NEXT_PUBLIC_${v}_CONTRACT_ID build arg is required (a real 56-character Soroban contract ID starting with 'C'). Pass it with --build-arg." >&2; \
        exit 1; \
      fi; \
    done

RUN npm run build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./ 2>/dev/null || true
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next

USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["npm", "start"]
