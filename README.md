# Converter HTML to PDF

API HTTP simples para **converter HTML em PDF** e disponibilizá-lo para download.
Pensada para ser chamada pelo **n8n** (nó *HTTP Request*), mas funciona com
qualquer cliente HTTP.

A renderização usa **Puppeteer (Chrome headless)**, garantindo alta fidelidade
de HTML/CSS no PDF gerado.

---

## Como funciona

Há duas formas de uso:

1. **PDF direto** (`POST /convert`) — a resposta já é o binário do PDF. Melhor
   quando o n8n vai anexar/encaminhar o arquivo.
2. **Link de download** (`POST /convert/link`) — gera o PDF, guarda na memória
   por um tempo e devolve um JSON com uma `downloadUrl`. Melhor quando você só
   precisa entregar um link ao usuário final.

---

## Endpoints

### `GET /health`
Verificação de saúde. Retorna `{ "status": "ok" }`.

### `POST /convert`
Converte e devolve o PDF no corpo da resposta (`application/pdf`).

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

Também aceita o HTML direto no corpo com `Content-Type: text/html`.

### `POST /convert/link`
Igual ao `/convert`, mas retorna um JSON com a URL de download:
```json
{
  "id": "f1c2...",
  "filename": "relatorio.pdf",
  "size": 24813,
  "downloadUrl": "http://localhost:3000/download/f1c2...",
  "expiresAt": "2026-06-23T12:34:56.000Z"
}
```

### `GET /download/:id`
Baixa um PDF gerado por `/convert/link` (enquanto não expirar).

---

## Opções de PDF (`options`)

Repassadas ao Puppeteer:

| Campo                 | Descrição                                              | Padrão        |
|-----------------------|--------------------------------------------------------|---------------|
| `format`              | `A4`, `A3`, `Letter`, etc.                             | `A4`          |
| `landscape`           | Orientação paisagem                                    | `false`       |
| `printBackground`     | Imprimir cores/imagens de fundo                        | `true`        |
| `margin`              | `{ top, right, bottom, left }`                          | `1cm` em tudo |
| `scale`               | Escala de renderização (0.1–2)                          | `1`           |
| `displayHeaderFooter` | Exibir cabeçalho/rodapé                                | `false`       |
| `headerTemplate`      | HTML do cabeçalho                                      | —             |
| `footerTemplate`      | HTML do rodapé                                         | —             |

---

## Rodando localmente

### Com Docker (recomendado)
```bash
docker compose up --build
```
A API sobe em `http://localhost:3000`.

### Sem Docker
Requer Node.js 18+. O Puppeteer baixa o Chromium na instalação.
```bash
npm install
npm start
```

---

## Variáveis de ambiente

| Variável           | Descrição                                                | Padrão     |
|--------------------|----------------------------------------------------------|------------|
| `PORT`             | Porta HTTP                                                | `3000`     |
| `DOWNLOAD_TTL_MS`  | Tempo de vida dos links de download (ms)                 | `600000`   |
| `BODY_LIMIT`       | Tamanho máximo do corpo da requisição                    | `25mb`     |
| `PUBLIC_URL`       | URL pública base p/ montar a `downloadUrl` (atrás de proxy) | —        |

---

## Teste rápido (cURL)

PDF direto, salvando em arquivo:
```bash
curl -X POST http://localhost:3000/convert \
  -H "Content-Type: application/json" \
  -d '{"html":"<h1>Teste</h1>","filename":"teste.pdf"}' \
  --output teste.pdf
```

Gerando link de download:
```bash
curl -X POST http://localhost:3000/convert/link \
  -H "Content-Type: application/json" \
  -d '{"html":"<h1>Teste</h1>"}'
```

---

## Usando no n8n

### Opção A — receber o PDF direto
1. Adicione um nó **HTTP Request**.
2. **Method:** `POST` · **URL:** `http://SEU_HOST:3000/convert`
3. **Body Content Type:** `JSON` · envie `{ "html": "{{ $json.html }}", "filename": "documento.pdf" }`
4. Em **Options → Response → Response Format**, selecione **File** (binário).
   O PDF chega como dado binário e pode ir para *Write Binary File*, e-mail,
   Google Drive, Telegram, etc.

### Opção B — receber um link
1. Nó **HTTP Request** · `POST` para `http://SEU_HOST:3000/convert/link`
2. **Body Content Type:** `JSON` com `{ "html": "{{ $json.html }}" }`
3. A resposta traz `downloadUrl`, que você repassa para onde precisar.
