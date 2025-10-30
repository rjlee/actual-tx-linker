FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy src
COPY src ./src

ENV NODE_ENV=production

ENTRYPOINT ["node", "src/index.js"]

