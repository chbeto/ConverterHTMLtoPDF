import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPdf, closeBrowser, sanitizeFilename } from "../lib/pdf.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
// Limite do corpo da requisição (HTML pode ser grande).
const BODY_LIMIT = process.env.BODY_LIMIT || "25mb";

const app = express();
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.text({ type: ["text/html", "text/plain"], limit: BODY_LIMIT }));
app.use(express.static(path.join(__dirname, "..", "public")));

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

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

/**
 * POST /convert
 * Converte o HTML recebido e devolve o PDF diretamente no corpo da resposta.
 * Use o nó "HTTP Request" do n8n com Response Format = File (binário).
 */
app.post("/convert", async (req, res) => {
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
