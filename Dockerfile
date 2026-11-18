# PROPNIGHT 2 - single container: Node game server + static client. Terminate TLS in front of it (see deploy/nginx.conf or deploy/Caddyfile).
# (No package-lock.json is committed in this repo yet; "npm install" is used. Commit a lockfile and switch to "npm ci" for reproducible builds.)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY docs ./docs
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 8080
USER node
CMD ["node", "dist/server.js"]
