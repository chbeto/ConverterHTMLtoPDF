# Converter HTML to PDF

API HTTP self-hosted que **converte HTML em PDF** e devolve o arquivo
**direto para download**. Sem banco de dados: você envia o HTML, recebe o PDF.
Pensada para ser chamada pelo **n8n** (nó *HTTP Request*).

A renderização usa **Puppeteer (Chrome headless)** via imagem oficial, que já
inclui o Chrome e todas as bibliotecas de sistema — sem dor de cabeça com
`libnss3` e afins.

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
Também aceita o HTML puro no corpo com `Content-Type: text/html`.

### Página de teste
Acesse `http://SEU_HOST:3000/` para um formulário simples de teste.

---

## Subindo na VM (Docker — recomendado)

Na VM (ex.: droplet da DigitalOcean), com Docker + Docker Compose instalados:

```bash
git clone https://github.com/chbeto/ConverterHTMLtoPDF.git
cd ConverterHTMLtoPDF
docker compose up -d --build
```

A API sobe em `http://SEU_IP:3000`. Teste:
```bash
curl http://localhost:3000/health
```

Para ver logs / parar:
```bash
docker compose logs -f
docker compose down
```

### Integração com o n8n na mesma VM
- Se o **n8n também roda em Docker**, coloque os dois na mesma rede e use o nome
  do serviço como host. Exemplo no `docker-compose.yml` do n8n: adicione este
  serviço (ou uma rede externa compartilhada) e chame
  `http://html-to-pdf:3000/convert` a partir do n8n.
- Se o n8n roda direto na VM (sem Docker), use `http://localhost:3000/convert`
  ou `http://IP_DA_VM:3000/convert`.

> **Firewall:** se for acessar de fora da VM, libere a porta `3000`
> (`ufw allow 3000`). Para uso só interno (n8n na mesma VM), **não** exponha a
> porta publicamente.

---

## Subindo sem Docker (Node + PM2)

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

## Opções de PDF (`options`)

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

---

## Usando no n8n

1. Adicione um nó **HTTP Request**.
2. **Method:** `POST` · **URL:** `http://HOST:3000/convert`
3. **Body Content Type:** `JSON`. Para evitar erro de JSON inválido com HTML que
   tem quebras de linha, use **Specify Body → Using JSON** com uma expressão:
   ```
   {{ { "html": $json.htmlCompleto, "filename": "proposta.pdf" } }}
   ```
4. Em **Options → Response → Response Format**, selecione **File** (binário).

O PDF chega como dado binário e pode seguir para *Write Binary File*, e-mail,
Google Drive, Telegram, etc.

---

## Teste rápido (cURL)

```bash
curl -X POST http://localhost:3000/convert \
  -H "Content-Type: application/json" \
  -d '{"html":"<h1>Teste</h1>","filename":"teste.pdf"}' \
  --output teste.pdf
```
