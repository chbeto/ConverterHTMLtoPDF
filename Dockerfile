# Imagem oficial do Puppeteer: já traz o Chrome e todas as dependências de
# sistema (libnss3, etc.). A versão DEVE casar com a do puppeteer no package.json.
FROM ghcr.io/puppeteer/puppeteer:23.11.1

ENV NODE_ENV=production \
    PORT=3000

# Diretório dentro do home do usuário pptruser (já existente na imagem),
# evitando problemas de permissão.
WORKDIR /home/pptruser/app

# Instala dependências primeiro para aproveitar o cache de camadas.
COPY --chown=pptruser:pptruser package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --chown=pptruser:pptruser . .

EXPOSE 3000

CMD ["node", "src/server.js"]
