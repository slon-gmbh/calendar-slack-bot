FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY config.json ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]
