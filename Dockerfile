# Multi-stage lean production Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY . .

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Run as non-root user for security
USER node

COPY --chown=node:node --from=builder /app ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => { if (r.statusCode !== 200) process.exit(1); })"

CMD ["node", "server/server.js"]
