# Converter HTML to PDF

API HTTP self-hosted que **converte HTML em PDF** e devolve o arquivo
**direto para download**. Sem banco de dados e sem estado: você envia o HTML,
recebe o PDF na resposta. Feita para ser chamada por automações como o **n8n**
(nó *HTTP Request*), mas funciona com qualquer cliente HTTP.

A renderização usa **Puppeteer (Chrome headless)** sobre a imagem oficial do
Puppeteer, que já inclui o Chrome e todas as bibliotecas de sistema — sem dor
de cabeça com `libnss3` e afins.

---

## Sumário
- [Pré-requisitos](#pré-requisitos)
- [Como publicar (Docker)](#como-publicar-docker)
- [Endpoints](#endpoints)
- [Integração com o n8n](#integração-com-o-n8n)
- [Opções de PDF](#opções-de-pdf)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Rodando sem Docker](#rodando-sem-docker-nodepm2)
- [Operação e troubleshooting](#operação-e-troubleshooting)

---

## Pré-requisitos

- Um servidor/VM Linux (qualquer provedor) com **Docker** e **Docker Compose**.
- Porta `3000` livre (configurável).

> Recomenda-se pelo menos **1 vCPU / 1 GB de RAM**. O Chrome headless é
> relativamente leve por requisição, mas picos de conversões simultâneas
> consomem CPU/memória.

---

## Como publicar (Docker)

```bash
git clone https://github.com/chbeto/ConverterHTMLtoPDF.git
cd ConverterHTMLtoPDF
docker compose up -d --build
```

Pronto. Verifique:

```bash
curl http://localhost:3000/health      # {"status":"ok", ...}
```

Comandos úteis:

```bash
docker compose logs -f     # acompanhar logs
docker compose restart     # reiniciar
docker compose down        # parar e remover o container
docker compose up -d --build   # aplicar atualizações após um git pull
```

### Atualizando para uma nova versão

```bash
cd ConverterHTMLtoPDF
git pull
docker compose up -d --build
```

### Exposição da porta

Por padrão o `docker-compose.yml` publica a porta **apenas no localhost da VM**
(`127.0.0.1:3000:3000`), pensando no cenário em que o n8n está na mesma máquina.

- Para acessar de **outras máquinas**, troque para `"3000:3000"` e libere o
  firewall (`ufw allow 3000`). Nesse caso, considere colocar atrás de um proxy
  reverso (Nginx/Traefik) com HTTPS e autenticação.
- Para uso **somente interno** (n8n em Docker na mesma VM), mantenha como está e
  use a rede Docker compartilhada (veja abaixo).

---

## Endpoints

### `GET /health`
Verificação de saúde. Retorna `{ "status": "ok" }`.

### `POST /convert`
Converte e devolve o PDF no corpo da resposta (`application/pdf`,
`Content-Disposition: attachment`).

**Corpo (JSON):**
```json
{
  "html": "<h1>Olá mundo</h1><p>Meu primeiro PDF</p>",
  "filename": "relatorio.pdf",
  "options": {
    "format": "A4",
    "landscape": false,
    "printBackground": true,
    "margin": { "top": "1cm", "right": "1cm", "bottom": "1cm", "left": "1cm" }
  }
}
```

| Campo      | Obrigatório | Descrição                                  |
|------------|-------------|--------------------------------------------|
| `html`     | sim         | HTML completo a ser renderizado            |
| `filename` | não         | Nome do arquivo PDF (padrão `documento.pdf`) |
| `options`  | não         | Opções de PDF (veja a tabela mais abaixo)  |

Também aceita o HTML puro no corpo com `Content-Type: text/html`.

**Teste rápido (cURL):**
```bash
curl -X POST http://localhost:3000/convert \
  -H "Content-Type: application/json" \
  -d '{"html":"<h1>Teste</h1>","filename":"teste.pdf"}' \
  --output teste.pdf
```

### Página de teste
Acesse `http://SEU_HOST:3000/` para um formulário simples de colar HTML, gerar
e baixar o PDF.

---

## Integração com o n8n

### 1. Conectar a conversora à rede do n8n (n8n em Docker)

Para o n8n chamar a conversora **pelo nome do container** (sem depender de IP),
os dois precisam estar na mesma rede Docker. Descubra a rede do n8n:

```bash
docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' NOME_DO_CONTAINER_N8N
```

O `docker-compose.yml` deste projeto já está configurado para entrar na rede
externa **`n8n_default`** (padrão de stacks do n8n). Se a sua rede tiver outro
nome, ajuste o final do arquivo:

```yaml
networks:
  n8n_net:
    external: true
    name: n8n_default   # <- troque pelo nome da sua rede
```

Depois aplique e confirme:
```bash
docker compose up -d --build
docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' converter-html-to-pdf
# deve listar a rede do n8n
```

Teste a partir de dentro do container do n8n:
```bash
docker exec NOME_DO_CONTAINER_N8N wget -qO- http://converter-html-to-pdf:3000/health
```

### 2. Configurar o nó HTTP Request

- **Method:** `POST`
- **URL:**
  - n8n em Docker (mesma rede): `http://converter-html-to-pdf:3000/convert`
  - n8n fora de Docker, mesma VM: `http://localhost:3000/convert`
- **Body Content Type:** `JSON`
- **Specify Body → Using JSON**, com uma **expressão** (evita erro de JSON
  inválido quando o HTML tem quebras de linha):
  ```
  {{ { "html": $json.htmlCompleto, "filename": "proposta.pdf" } }}
  ```
- **Options → Response → Response Format:** **File** (binário).

O PDF chega como dado binário e pode seguir para *Write Binary File*, e-mail,
Google Drive, Telegram, etc.

> **Dica:** se montar o corpo manualmente em texto e o HTML tiver quebras de
> linha, o n8n acusa "not valid JSON". Use a forma de objeto/expressão acima,
> que serializa e escapa tudo automaticamente.

---

## Opções de PDF

Repassadas ao Puppeteer dentro de `options`:

| Campo                 | Descrição                                   | Padrão        |
|-----------------------|---------------------------------------------|---------------|
| `format`              | `A4`, `A3`, `Letter`, etc.                  | `A4`          |
| `landscape`           | Orientação paisagem                         | `false`       |
| `printBackground`     | Imprimir cores/imagens de fundo             | `true`        |
| `margin`              | `{ top, right, bottom, left }`              | `1cm`         |
| `scale`               | Escala de renderização (0.1–2)              | `1`           |
| `displayHeaderFooter` | Exibir cabeçalho/rodapé                     | `false`       |
| `headerTemplate`      | HTML do cabeçalho                           | —             |
| `footerTemplate`      | HTML do rodapé                              | —             |

---

## Variáveis de ambiente

| Variável     | Descrição                              | Padrão  |
|--------------|----------------------------------------|---------|
| `PORT`       | Porta HTTP                             | `3000`  |
| `BODY_LIMIT` | Tamanho máximo do corpo da requisição  | `25mb`  |

Defina-as no bloco `environment` do `docker-compose.yml`.

---

## Rodando sem Docker (Node/PM2)

Requer Node.js 18+ e as dependências de sistema do Chromium. Em Ubuntu/Debian:
```bash
sudo apt-get update && sudo apt-get install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0

git clone https://github.com/chbeto/ConverterHTMLtoPDF.git
cd ConverterHTMLtoPDF
npm install
npm start            # ou: pm2 start npm --name html2pdf -- start
```

---

## Operação e troubleshooting

| Sintoma | Causa provável / solução |
|---------|--------------------------|
| `no configuration file provided: not found` no `docker compose` | Você não está na pasta do projeto, ou está numa branch sem o `docker-compose.yml`. Use a branch `main`. |
| n8n: *"The value in the JSON Body field is not valid JSON"* | HTML com quebras de linha montado como texto. Use a expressão de objeto no body (seção n8n). |
| n8n não conecta (`ECONNREFUSED`/timeout) | n8n em Docker usando `localhost`. Use o nome do container na rede compartilhada: `http://converter-html-to-pdf:3000/convert`. |
| PDF vem corrompido / como texto | Faltou definir **Response Format = File** no nó HTTP Request. |
| `libnss3.so: cannot open shared object file` | Acontece em ambientes serverless/sem libs. A imagem Docker oficial usada aqui já resolve isso. Rodando sem Docker, instale as libs listadas acima. |

Estrutura do projeto:
```
src/server.js       Servidor Express (POST /convert, GET /health)
lib/pdf.js          Renderização HTML → PDF (Puppeteer)
public/index.html   Página de teste com formulário
scripts/test-local.js  Teste de renderização sem subir o servidor
Dockerfile          Imagem baseada em ghcr.io/puppeteer/puppeteer
docker-compose.yml  Orquestração + rede compartilhada com o n8n
```
