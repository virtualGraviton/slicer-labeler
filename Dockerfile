FROM node:22-bookworm-slim AS build

ARG APP_VERSION=dev
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV APP_VERSION=${APP_VERSION}
RUN npm run build

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV LABELER_DATA_ROOT=/data/dataset

COPY package*.json ./
COPY --from=build /app/dist ./dist
COPY server ./server

EXPOSE 3000
CMD ["node", "server/server.mjs"]
