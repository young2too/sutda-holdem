FROM node:20-alpine

WORKDIR /app
COPY . .

ENV NODE_ENV=production
EXPOSE 4173

CMD ["node", "outputs/server.js"]
