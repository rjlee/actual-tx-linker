FROM node:22-slim AS base
WORKDIR /app

# Accept Actual API version and metadata as build args
ARG ACTUAL_API_VERSION
ARG GIT_SHA
ARG APP_VERSION

# Install native build deps and production dependencies; allow overriding @actual-app/api when provided
COPY package*.json ./
ENV HUSKY=0
RUN set -eux; \
    apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*; \
    if [ -n "$ACTUAL_API_VERSION" ]; then \
      npm pkg set dependencies.@actual-app/api=$ACTUAL_API_VERSION && \
      npm install --package-lock-only --no-audit --no-fund; \
    fi; \
    npm ci --omit=dev --no-audit --no-fund

# Copy src
COPY src ./src

ENV NODE_ENV=production

# Useful metadata labels
LABEL org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.version="$APP_VERSION" \
      io.actual.api.version="$ACTUAL_API_VERSION"

ENTRYPOINT ["node", "src/index.js"]
