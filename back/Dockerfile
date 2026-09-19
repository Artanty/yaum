FROM node:24-slim

WORKDIR /srv/mush

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist ./dist
COPY views ./views

ENV DB_PATH=/data/mush.db \
    PORT=8000

EXPOSE 8000
VOLUME /data

CMD ["node", "dist/server.js"]
