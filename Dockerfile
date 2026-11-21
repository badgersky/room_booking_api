FROM node:22-alpine

WORKDIR /app

# Dependencies first - this layer is rebuilt only when package*.json changes
COPY package*.json ./
RUN npm ci --omit=dev

# Then the code
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# exec: node replaces sh as PID 1, so it receives SIGTERM directly (graceful shutdown)
CMD ["sh", "-c", "npx knex migrate:latest && exec node src/server.js"]
