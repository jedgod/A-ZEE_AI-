FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8090
EXPOSE 8090
CMD ["node","src/server.mjs"]
