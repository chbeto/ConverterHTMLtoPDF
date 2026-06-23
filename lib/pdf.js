import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

// Detecta se estamos rodando em ambiente serverless (Vercel/Lambda).
const isServerless =
  Boolean(process.env.VERCEL) ||
  Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
  process.env.NODE_ENV === "production";

/**
 * Resolve as opções de launch do navegador.
 * - No Vercel/Lambda usa o Chromium do @sparticuz/chromium.
 * - Localmente, usa o Chrome apontado por CHROME_EXECUTABLE_PATH, ou ainda
 *   o próprio binário extraído pelo @sparticuz/chromium (funciona em Linux x64).
 */
async function launchOptions() {
  if (!isServerless && process.env.CHROME_EXECUTABLE_PATH) {
    return {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath: process.env.CHROME_EXECUTABLE_PATH,
      headless: true,
    };
  }

  return {
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    defaultViewport: chromium.defaultViewport,
  };
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
  const browser = await puppeteer.launch(await launchOptions());
  try {
    const page = await browser.newPage();
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
    await browser.close();
  }
}

export function sanitizeFilename(name) {
  let clean = String(name || "").replace(/[^\w.\- ]+/g, "_").trim();
  if (!clean) clean = "documento.pdf";
  if (!clean.toLowerCase().endsWith(".pdf")) clean += ".pdf";
  return clean;
}
