import express from "express";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { renderPdf, closeBrowser } from "./pdf.js";

const PORT = process.env.PORT || 3000;
// Tempo (ms) que um PDF gerado fica disponível para download antes de ser descartado.
const DOWNLOAD_TTL_MS = Number(process.env.DOWNLOAD_TTL_MS || 10 * 60 * 1000);
// Limite do corpo da requisição (HTML pode ser grande).
const BODY_LIMIT = process.env.BODY_LIMIT || "25mb";
// URL pública base usada para montar o link de download (ex.: https://meu-host.com).
const PUBLIC_URL = process.env.PUBLIC_URL || "";

const app = express();
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.text({ type: ["text/html", "text/plain"], limit: BODY_LIMIT }));

// Armazenamento em memória dos PDFs gerados sob demanda (id -> { buffer, filename, expiresAt }).
const store = new Map();

// Remove arquivos expirados periodicamente.
setInterval(() => {
  const now = Date.now();
  for (const [id, item] of store) {
    if (item.expiresAt <= now) store.delete(id);
  }
}, 60 * 1000).unref();

/**
 * Extrai o HTML e as opções da requisição, aceitando tanto JSON quanto
 * corpo de texto puro (text/html). Facilita o uso a partir do n8n.
 */
function parseRequest(req) {
  let html = "";
  let options = {};
  let filename = "documento.pdf";

  if (typeof req.body === "string") {
    html = req.body;
  } else if (req.body && typeof req.body === "object") {
    html = req.body.html ?? "";
    options = req.body.options ?? {};
    if (req.body.filename) filename = sanitizeFilename(req.body.filename);
  }

  return { html, options, filename };
}

function sanitizeFilename(name) {
  let clean = String(name).replace(/[^\w.\- ]+/g, "_").trim();
  if (!clean) clean = "documento.pdf";
  if (!clean.toLowerCase().endsWith(".pdf")) clean += ".pdf";
  return clean;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

/**
 * POST /convert
 * Converte o HTML recebido e devolve o PDF diretamente no corpo da resposta.
 * Ideal para o nó "HTTP Request" do n8n com response "File"/binário.
 */
app.post("/convert", async (req, res) => {
  try {
    const { html, options, filename } = parseRequest(req);
    if (!html || !html.trim()) {
      return res.status(400).json({ error: "Campo 'html' é obrigatório." });
    }

    const pdf = await renderPdf(html, options);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdf.length);
    res.end(pdf);
  } catch (err) {
    console.error("Erro em /convert:", err);
    res.status(500).json({ error: "Falha ao gerar o PDF.", detail: String(err.message || err) });
  }
});

/**
 * POST /convert/link
 * Gera o PDF, armazena temporariamente e devolve um JSON com a URL de download.
 * Útil quando o n8n só precisa repassar um link para o usuário final.
 */
app.post("/convert/link", async (req, res) => {
  try {
    const { html, options, filename } = parseRequest(req);
    if (!html || !html.trim()) {
      return res.status(400).json({ error: "Campo 'html' é obrigatório." });
    }

    const pdf = await renderPdf(html, options);
    const id = crypto.randomUUID();
    const expiresAt = Date.now() + DOWNLOAD_TTL_MS;
    store.set(id, { buffer: pdf, filename, expiresAt });

    const base = PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
    res.json({
      id,
      filename,
      size: pdf.length,
      downloadUrl: `${base}/download/${id}`,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  } catch (err) {
    console.error("Erro em /convert/link:", err);
    res.status(500).json({ error: "Falha ao gerar o PDF.", detail: String(err.message || err) });
  }
});

/**
 * GET /download/:id
 * Faz o download de um PDF previamente gerado por /convert/link.
 */
app.get("/download/:id", (req, res) => {
  const item = store.get(req.params.id);
  if (!item || item.expiresAt <= Date.now()) {
    store.delete(req.params.id);
    return res.status(404).json({ error: "Arquivo não encontrado ou expirado." });
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${item.filename}"`);
  res.setHeader("Content-Length", item.buffer.length);
  res.end(item.buffer);
});

const server = app.listen(PORT, () => {
  console.log(`Conversor HTML -> PDF rodando na porta ${PORT}`);
});

async function shutdown(signal) {
  console.log(`Recebido ${signal}, encerrando...`);
  server.close();
  await closeBrowser();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Exporta para facilitar testes.
const __filename = fileURLToPath(import.meta.url);
export { app, __filename as serverPath, path };
