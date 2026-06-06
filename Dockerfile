FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache tini

COPY package*.json ./

RUN npm ci --only=production && npm cache clean --force

COPY src/ ./src/
COPY .env.example ./

RUN mkdir -p /app/logs && chown -R node:node /app

USER node

EXPOSE 3000

ENTRYPOINT ["tini", "--"]
CMD ["node", "src/index.js"]