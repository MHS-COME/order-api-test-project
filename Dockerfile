FROM node:18-alpine

WORKDIR /app

COPY mock-server/package.json mock-server/package-lock.json ./
RUN npm install --production

COPY mock-server/ ./

EXPOSE 3000

CMD ["node", "server.js"]
