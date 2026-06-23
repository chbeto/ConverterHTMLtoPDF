import { renderPdf, sanitizeFilename } from "../lib/pdf.js";

/**
 * POST /api/convert
 *
 * Corpo (JSON):
 * {
 *   "html": "<h1>Olá</h1>",
 *   "filename": "documento.pdf",
 *   "options": { "format": "A4", "landscape": false, ... }
 * }
 *
 * Também aceita o HTML puro no corpo (Content-Type: text/html).
 *
 * Resposta: o PDF binário com Content-Disposition: attachment (download direto).
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    const { html, options, filename } = parseBody(req);
    if (!html || !html.trim()) {
      return res.status(400).json({ error: "Campo 'html' é obrigatório." });
    }

    const pdf = await renderPdf(html, options);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdf.length);
    return res.status(200).send(pdf);
  } catch (err) {
    console.error("Erro ao gerar PDF:", err);
    return res
      .status(500)
      .json({ error: "Falha ao gerar o PDF.", detail: String(err?.message || err) });
  }
}

function parseBody(req) {
  let html = "";
  let options = {};
  let filename = "documento.pdf";

  const body = req.body;
  if (typeof body === "string") {
    html = body;
  } else if (body && typeof body === "object") {
    html = body.html ?? "";
    options = body.options ?? {};
    if (body.filename) filename = sanitizeFilename(body.filename);
  }

  return { html, options, filename };
}
