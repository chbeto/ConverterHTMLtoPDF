# Imagem oficial do Puppeteer já traz o Chromium e todas as dependências de sistema.
FROM ghcr.io/puppeteer/puppeteer:22.12.1

ENV PUPPETEER_SKIP_DOWNLOAD=false \
    NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Instala dependências primeiro para aproveitar o cache de camadas.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "src/server.js"]
