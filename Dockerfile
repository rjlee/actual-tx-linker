FROM node:20-alpine AS base
WORKDIR /app

# Accept Actual API version and metadata as build args
ARG ACTUAL_API_VERSION
ARG GIT_SHA
ARG APP_VERSION

# Install production dependencies; allow overriding @actual-app/api when provided
COPY package*.json ./
RUN if [ -n "$ACTUAL_API_VERSION" ]; then \
      npm pkg set dependencies.@actual-app/api=$ACTUAL_API_VERSION && \
      npm install --package-lock-only; \
    fi && \
    npm ci --only=production

# Copy src
COPY src ./src

ENV NODE_ENV=production

# Useful metadata labels
LABEL org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.version="$APP_VERSION" \
      io.actual.api.version="$ACTUAL_API_VERSION"

ENTRYPOINT ["node", "src/index.js"]
