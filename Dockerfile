# Riptide: build the single-file game, then serve it from a small runtime image.
# Railway picks this up automatically (see railway.json); it also runs anywhere Docker does:
#   docker build -t riptide . && docker run -p 8080:8080 riptide

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/dist ./dist
COPY server.mjs ./
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
