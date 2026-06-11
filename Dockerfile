# Single-image deploy: builds the React client and runs the Express server,
# which serves both the API and the built UI on one port. Works on Render,
# Railway, Fly.io, Cloud Run, or any Docker host.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./
# SQLite data lives here; mount a volume to persist games across restarts.
VOLUME ["/app/data"]
ENV PORT=8787
EXPOSE 8787
CMD ["npm", "start"]
