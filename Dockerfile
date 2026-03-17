FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/relay-api/package.json apps/relay-api/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN npm install

COPY apps/relay-api apps/relay-api
COPY packages/contracts packages/contracts

RUN npm run build -w @remote-codex/relay-api

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=80

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/relay-api/package.json apps/relay-api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/contracts packages/contracts
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/relay-api/dist ./apps/relay-api/dist

EXPOSE 80

CMD ["node", "apps/relay-api/dist/index.js"]
