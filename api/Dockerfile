FROM node:22-alpine AS compilacion
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-fund --no-audit
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY --from=compilacion /app/dist ./dist
COPY sql ./sql
EXPOSE 3000
CMD ["node", "dist/index.js"]
