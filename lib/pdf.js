import puppeteer from "puppeteer";

let browserPromise = null;

/**
 * Mantém uma única instância do Chromium reutilizável entre requisições
 * (lançar um navegador por chamada seria lento e pesado).
 */
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  }
  return browserPromise;
}

/**
 * Converte uma string HTML em um Buffer de PDF.
 *
 * @param {string} html  Conteúdo HTML completo a renderizar.
 * @param {object} options  Opções de PDF repassadas ao Puppeteer:
 *   format, landscape, printBackground, margin, scale, displayHeaderFooter,
 *   headerTemplate, footerTemplate.
 * @returns {Promise<Buffer>}
 */
export async function renderPdf(html, options = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfOptions = {
      format: options.format || "A4",
      printBackground: options.printBackground !== false,
      landscape: Boolean(options.landscape),
      margin: options.margin || {
        top: "1cm",
        right: "1cm",
        bottom: "1cm",
        left: "1cm",
      },
      ...("scale" in options ? { scale: options.scale } : {}),
      ...("displayHeaderFooter" in options
        ? { displayHeaderFooter: options.displayHeaderFooter }
        : {}),
      ...(options.headerTemplate ? { headerTemplate: options.headerTemplate } : {}),
      ...(options.footerTemplate ? { footerTemplate: options.footerTemplate } : {}),
    };

    const pdf = await page.pdf(pdfOptions);
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

/** Fecha o navegador (usado no shutdown gracioso). */
export async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}

export function sanitizeFilename(name) {
  let clean = String(name || "").replace(/[^\w.\- ]+/g, "_").trim();
  if (!clean) clean = "documento.pdf";
  if (!clean.toLowerCase().endsWith(".pdf")) clean += ".pdf";
  return clean;
}
