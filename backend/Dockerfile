FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++ vips-dev

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN mkdir -p dist/db/migrations && cp src/db/migrations/*.sql dist/db/migrations/

# Prune devDependencies in-place so we can copy the lean node_modules
RUN npm prune --omit=dev

# --- runtime ---
FROM node:20-alpine

RUN apk add --no-cache vips

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

RUN mkdir -p /data/uploads

EXPOSE 3001

CMD ["node", "dist/index.js"]
