# GoatMedia — one process serving the site and the API.
#
#   docker build -t goatmedia .
#   docker run -p 3001:3001 -v goatmedia-data:/app/.data \
#     -e APP_ORIGIN=https://your-domain.example goatmedia
#
# /app/.data holds the SQLite database, private pending uploads, posters and
# avatars. It must be a volume, or the platform will wipe it on every deploy.

FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY shared ./shared
COPY src ./src
COPY server ./server
COPY scripts ./scripts

RUN npm run build


FROM node:24-bookworm-slim
# ffmpeg does the duration checks, metadata stripping and poster frames. Without
# it the app still runs, but uploads lose validation and keep their metadata.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/app/.data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY shared ./shared
COPY server ./server
COPY scripts ./scripts

RUN mkdir -p /app/.data && chown -R node:node /app
USER node

EXPOSE 3001
VOLUME ["/app/.data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--import", "tsx", "server/index.ts"]
