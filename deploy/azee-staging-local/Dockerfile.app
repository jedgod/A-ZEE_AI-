# A-Zee Next.js application image. Also runs the private mTLS introspection listener and one-shot migrations (different commands).
# UNVERIFIED until the Docker engine is run: build it with `docker compose build app`.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx next build

FROM node:24-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
COPY deploy/azee-staging-local/with-secrets.sh /usr/local/bin/with-secrets
RUN chmod +x /usr/local/bin/with-secrets && chown -R node:node /app/.next
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/with-secrets"]
CMD ["npx", "next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
