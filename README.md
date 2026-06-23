# Converter HTML to PDF (Vercel)

Função **serverless na Vercel** que converte HTML em PDF e devolve o arquivo
**direto para download**. Sem banco de dados, sem armazenamento: você envia o
HTML, recebe o PDF. Pensada para ser chamada pelo **n8n** (nó *HTTP Request*),
mas funciona com qualquer cliente HTTP.

A renderização usa **`puppeteer-core` + `@sparticuz/chromium`**, um build do
Chromium compatível com o ambiente serverless da Vercel.

---

## Endpoint

### `POST /api/convert`
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
Há uma página em `/` (`public/index.html`) com um formulário simples para colar
HTML, gerar e baixar o PDF.

---

## Opções de PDF (`options`)

Repassadas ao Puppeteer:

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

## Publicando na Vercel

### Pela interface
1. Faça push deste repositório para o GitHub.
2. Na Vercel, **Add New → Project** e importe o repositório.
3. Não precisa configurar build: a Vercel detecta a função em `api/` e a página
   estática em `public/`. Clique em **Deploy**.

### Pela CLI
```bash
npm i -g vercel
vercel        # ambiente de preview
vercel --prod # produção
```

A função fica disponível em `https://SEU-PROJETO.vercel.app/api/convert`.

> **Configuração** (`vercel.json`): a função usa `memory: 1024` e
> `maxDuration: 60`, recomendado para o Chromium. No plano Hobby esses são os
> limites máximos; ajuste conforme seu plano.

---

## Usando no n8n

1. Adicione um nó **HTTP Request**.
2. **Method:** `POST` · **URL:** `https://SEU-PROJETO.vercel.app/api/convert`
3. **Body Content Type:** `JSON` ·
   `{ "html": "{{ $json.html }}", "filename": "documento.pdf" }`
4. Em **Options → Response → Response Format**, selecione **File** (binário).

O PDF chega como dado binário e pode seguir para *Write Binary File*, e-mail,
Google Drive, Telegram, etc. Não há etapa de download separada — a própria
resposta já é o arquivo.

---

## Teste rápido (cURL)

```bash
curl -X POST https://SEU-PROJETO.vercel.app/api/convert \
  -H "Content-Type: application/json" \
  -d '{"html":"<h1>Teste</h1>","filename":"teste.pdf"}' \
  --output teste.pdf
```

---

## Desenvolvimento local

Testar só a renderização (gera `saida-teste.pdf`):
```bash
npm install
npm run test:local
```

Rodar a função como na Vercel (requer a CLI da Vercel):
```bash
vercel dev
```
> Localmente, se preferir usar um Chrome já instalado, defina
> `CHROME_EXECUTABLE_PATH` apontando para o executável.

---

## Estrutura

```
api/convert.js      Função serverless (POST → PDF)
lib/pdf.js          Renderização HTML → PDF (puppeteer-core + @sparticuz/chromium)
public/index.html   Página de teste com formulário
scripts/test-local.js  Teste de renderização sem a Vercel
vercel.json         Memória e timeout da função
```
