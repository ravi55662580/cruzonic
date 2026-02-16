# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy shared package first (workspace dependency)
COPY shared/package.json shared/tsconfig.json ./shared/
COPY shared/src ./shared/src/

# Copy backend
COPY backend/package.json backend/tsconfig.json ./backend/
COPY backend/src ./backend/src/

# Install all workspace deps
COPY package.json ./
RUN npm install --workspaces

# Build shared then backend
RUN cd shared && npm run build
RUN cd backend && npm run build

# ── Stage 2: Production image ────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/shared/package.json ./shared/package.json
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/package.json ./backend/package.json
COPY package.json ./

RUN npm install --workspaces --omit=dev

EXPOSE 4000

CMD ["node", "backend/dist/index.js"]
