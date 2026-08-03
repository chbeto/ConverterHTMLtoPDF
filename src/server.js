import express from "express";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { renderPdf, closeBrowser, sanitizeFilename } from "../lib/pdf.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
// Interface de escuta. Dentro do container precisa ser 0.0.0.0; quem controla
// a exposição para fora é o mapeamento de portas do docker-compose.
const HOST = process.env.HOST || "0.0.0.0";
// Limite do corpo da requisição (HTML pode ser grande).
const BODY_LIMIT = process.env.BODY_LIMIT || "25mb";
// Se definida, /convert passa a exigir o header 'x-api-key' (ou Bearer).
const API_KEY = process.env.API_KEY || "";
// Origens liberadas para chamadas de navegador. Ex.: "https://app.exemplo.com"
// ou "*". Vazio = sem CORS (só same-origin e clientes server-side como o n8n).
const CORS_ORIGINS = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
// Atrás de Nginx/Traefik, para req.ip refletir o IP real do cliente.
const TRUST_PROXY = process.env.TRUST_PROXY || "";

const app = express();
if (TRUST_PROXY) app.set("trust proxy", TRUST_PROXY);

if (CORS_ORIGINS.length) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (CORS_ORIGINS.includes("*") || CORS_ORIGINS.includes(origin))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key, Authorization");
      // Sem isso o navegador não enxerga o nome do arquivo devolvido.
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
}

app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.text({ type: ["text/html", "text/plain"], limit: BODY_LIMIT }));
app.use(express.static(path.join(__dirname, "..", "public")));

/** Comparação de strings resistente a timing attack. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Exige a chave de API quando API_KEY está configurada (no-op se vazia). */
function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  const fromHeader = req.get("x-api-key") || "";
  const fromBearer = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const provided = fromHeader || fromBearer;
  if (provided && safeEqual(provided, API_KEY)) return next();
  return res.status(401).json({ error: "Não autorizado: envie o header 'x-api-key'." });
}

/** Extrai html, options e filename do corpo (aceita JSON ou texto puro). */
function parseBody(req) {
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

// Aberto de propósito: usado por healthcheck de proxy/orquestrador.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), auth: Boolean(API_KEY) });
});

/**
 * POST /convert
 * Converte o HTML recebido e devolve o PDF diretamente no corpo da resposta.
 * Use o nó "HTTP Request" do n8n com Response Format = File (binário).
 */
app.post("/convert", requireApiKey, async (req, res) => {
  try {
    const { html, options, filename } = parseBody(req);
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
    res
      .status(500)
      .json({ error: "Falha ao gerar o PDF.", detail: String(err?.message || err) });
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Conversor HTML -> PDF rodando em ${HOST}:${PORT}`);
  console.log(
    API_KEY
      ? "Autenticação: ATIVA (header x-api-key obrigatório em /convert)"
      : "Autenticação: DESATIVADA — não publique esta porta na internet sem definir API_KEY."
  );
  if (CORS_ORIGINS.length) console.log(`CORS liberado para: ${CORS_ORIGINS.join(", ")}`);
});

async function shutdown(signal) {
  console.log(`Recebido ${signal}, encerrando...`);
  server.close();
  await closeBrowser();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
