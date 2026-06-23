// Teste rápido da renderização sem precisar do Vercel.
// Uso: node scripts/test-local.js
import { writeFile } from "node:fs/promises";
import { renderPdf } from "../lib/pdf.js";

const html = `<!DOCTYPE html><html><body>
  <h1>Teste local</h1>
  <p>PDF gerado por scripts/test-local.js em ${new Date().toISOString()}</p>
</body></html>`;

const pdf = await renderPdf(html, { landscape: false });
await writeFile("saida-teste.pdf", pdf);
console.log(`OK: saida-teste.pdf gerado (${pdf.length} bytes)`);
