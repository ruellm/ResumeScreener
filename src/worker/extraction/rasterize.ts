import path from "node:path";
import { PDFParse } from "pdf-parse";

// pdf.js draws fonts the PDF does not embed from its own bundled copies.
// Without these paths it falls back to whatever fonts the machine has.
const PDFJS_DIR = path
  .dirname(require.resolve("pdfjs-dist/package.json"))
  .split(path.sep)
  .join("/");
const FONT_OPTIONS = {
  standardFontDataUrl: `${PDFJS_DIR}/standard_fonts/`,
  cMapUrl: `${PDFJS_DIR}/cmaps/`,
  cMapPacked: true,
};

export const VISION_MAX_PAGES = 5;
export const VISION_MAX_EDGE_PX = 1600;

export type PageImage = {
  pageNumber: number;
  width: number;
  height: number;
  png: Buffer;
};

type PdfDoc = {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getViewport(options: { scale: number }): { width: number; height: number };
  }>;
};

// Renders the first pages to PNG with the pdf.js and canvas that pdf-parse
// ships, so no system packages are needed on Windows or Ubuntu.
export async function rasterizePdf(
  buffer: Buffer,
  { maxPages = VISION_MAX_PAGES, maxEdge = VISION_MAX_EDGE_PX } = {},
): Promise<PageImage[]> {
  // Pass a copy so pdf.js cannot detach the caller's buffer.
  const parser = new PDFParse({ data: new Uint8Array(buffer), ...FONT_OPTIONS });
  try {
    const doc = await (parser as unknown as { load(): Promise<PdfDoc> }).load();
    const images: PageImage[] = [];
    for (let pageNumber = 1; pageNumber <= Math.min(doc.numPages, maxPages); pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const { width, height } = page.getViewport({ scale: 1 });
      const result = await parser.getScreenshot({
        partial: [pageNumber],
        scale: maxEdge / Math.max(width, height),
        imageBuffer: true,
        imageDataUrl: false,
      });
      const png = Buffer.from(result.pages[0].data);
      // Pixel size as written in the PNG header.
      images.push({
        pageNumber,
        width: png.readUInt32BE(16),
        height: png.readUInt32BE(20),
        png,
      });
    }
    return images;
  } finally {
    await parser.destroy();
  }
}
