import { PDFParse } from "pdf-parse";

// Hidden-text detection for PDF resumes, ported from AIntervue
// (lib/resume-hidden-text.ts, PDF path only). Thresholds and the flag shape
// are identical so results from the two apps can be compared.
//
// The text is extracted twice. FULL is what a plain extractor returns. VISIBLE
// is the same extraction with every run a reader cannot see removed. Only the
// visible text is returned for storage. What was removed is reported as flags.
// There is no model judgement anywhere in here.
//
// pdf-parse wraps pdf.js, whose operator list carries fill colour, alpha, text
// render mode, font size and position. That list is walked to classify each
// text run, then the hidden runs are stripped out of the pdf.js text items.
//
// Known gaps: optional-content layers switched off, text covered by an opaque
// vector shape, clipped-away text.

// Thresholds. Same starting values as AIntervue, not yet calibrated against
// real resumes.

// Text whose effective rendered size is under this many points is unreadable.
// Whitespace-only runs are ignored, since Word exports tiny spacer runs.
export const MIN_VISIBLE_FONT_PT = 5;
// Fill alpha at or below this is treated as fully transparent.
export const MAX_INVISIBLE_ALPHA = 0.05;
// A fill or image must be at least this opaque to count as a background or as
// something that covers text.
export const MIN_OPAQUE_ALPHA = 0.95;
// Text colour counts as "the background colour" when every RGB channel is
// within this many steps (0-255) of the background. 16 catches near-white
// (#fafaf7 on white) without touching light gray body text (#999 on white).
export const MAX_BACKGROUND_CHANNEL_DELTA = 16;
// Slack, in points, before text outside the page box counts as off page.
export const OFF_PAGE_TOLERANCE_PT = 2;
// PDF text render modes that paint nothing (3 = invisible, 7 = clip only).
export const INVISIBLE_RENDER_MODES = [3, 7];
// A page is treated as a scanned page with an OCR text layer (legitimate
// invisible text, kept) when at least this fraction of its characters is
// invisible-mode text and an image covers at least this fraction of the page.
export const OCR_LAYER_MIN_INVISIBLE_FRACTION = 0.9;
export const OCR_LAYER_MIN_IMAGE_COVERAGE = 0.5;
// Metadata values shorter than this are ordinary (title, author, keywords).
export const METADATA_FLAG_MIN_CHARS = 80;
// Annotation / comment bodies shorter than this are ignored.
export const ANNOTATION_FLAG_MIN_CHARS = 20;
// Evidence caps so one resume cannot bloat the stored JSON.
export const FLAG_TEXT_MAX_CHARS = 1000;
export const MAX_FLAGS = 40;

// The same union as AIntervue's resumeFlagsJson. The values that only its
// DOCX path or its unscanned fallback produce never occur here.
export type ResumeFlagSignature =
  | "invisible_render_mode"
  | "zero_alpha"
  | "off_page"
  | "tiny_font"
  | "background_color"
  | "behind_image"
  | "hidden_property"
  | "metadata"
  | "annotation"
  | "form_field"
  | "comment"
  | "tracked_deletion"
  | "ocr_text_layer"
  | "scan_failed";

export interface ResumeFlag {
  signature: ResumeFlagSignature;
  // The hidden content itself, verbatim (capped).
  text: string;
  // 1-based page number. null for document-level findings (metadata).
  page: number | null;
  // What exactly tripped the signature, e.g. "1.0pt font".
  detail: string;
  // True when the content was kept out of the stored resume text. False for
  // informational entries (OCR layer kept, scan failed).
  dropped: boolean;
}

export interface ResumeExtraction {
  visibleText: string;
  fullText: string;
  flags: ResumeFlag[];
  pageCount: number;
  // Visible text per page, without the page markers visibleText has.
  visiblePages: string[];
}

type Rgb = [number, number, number];
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(c: Rgb): string {
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

function colorsMatch(a: Rgb, b: Rgb): boolean {
  return a.every((v, i) => Math.abs(v - b[i]) <= MAX_BACKGROUND_CHANNEL_DELTA);
}

function stripWhitespace(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "");
}

function capText(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > FLAG_TEXT_MAX_CHARS
    ? t.slice(0, FLAG_TEXT_MAX_CHARS) + "…[truncated]"
    : t;
}

// Adjacent findings with the same signature/page/detail are one hidden block.
function mergeFlags(flags: ResumeFlag[]): ResumeFlag[] {
  const out: ResumeFlag[] = [];
  for (const f of flags) {
    const last = out[out.length - 1];
    if (
      last &&
      last.signature === f.signature &&
      last.page === f.page &&
      last.detail === f.detail &&
      last.dropped === f.dropped
    ) {
      last.text = `${last.text} ${f.text}`;
    } else {
      out.push({ ...f });
    }
  }
  return out.slice(0, MAX_FLAGS).map((f) => ({ ...f, text: capText(f.text) }));
}

// pdf.js operator codes (pdfjs-dist 5.x OPS). pdf-parse bundles its own pdf.js
// and does not re-export OPS, so the few we need are named here.
const OPS = {
  setGState: 9,
  save: 10,
  restore: 11,
  transform: 12,
  fill: 22,
  closeEOFillStroke: 27,
  clip: 29,
  eoClip: 30,
  beginText: 31,
  endText: 32,
  setCharSpacing: 33,
  setWordSpacing: 34,
  setHScale: 35,
  setLeading: 36,
  setFont: 37,
  setTextRenderingMode: 38,
  setTextRise: 39,
  moveText: 40,
  setLeadingMoveText: 41,
  setTextMatrix: 42,
  nextLine: 43,
  showText: 44,
  setStrokeColorN: 53,
  setFillColorN: 55,
  setStrokeRGBColor: 58,
  setFillRGBColor: 59,
  shadingFill: 62,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  beginGroup: 76,
  endGroup: 77,
  beginAnnotation: 80,
  endAnnotation: 81,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  constructPath: 91,
  setStrokeTransparent: 92,
  setFillTransparent: 93,
} as const;

// A kerning adjustment this large (thousandths of an em) reads as a space.
const KERNING_SPACE_THRESHOLD = 200;
// pdf.js ImageKind.RGBA_32BPP
const IMAGE_KIND_RGBA = 3;

type Matrix = [number, number, number, number, number, number];
type Box = [number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

// m1 x m2: apply m2 first, then m1 (same as pdf.js Util.transform).
function mul(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function boxOf(m: Matrix, x0: number, y0: number, x1: number, y1: number): Box {
  const pts = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function intersect(a: Box, b: Box): Box {
  return [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ];
}

function boxArea(b: Box): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

function contains(b: Box, x: number, y: number): boolean {
  return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
}

interface GState {
  ctm: Matrix;
  clip: Box;
  fill: Rgb | null; // null = pattern/unknown
  stroke: Rgb | null;
  fillAlpha: number;
  strokeAlpha: number;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  hScale: number;
  leading: number;
  rise: number;
  renderMode: number;
}

// Something painted that can sit under or over text.
interface Region {
  box: Box;
  kind: "fill" | "image";
  color: Rgb | null; // null = not a single known colour
  opaque: boolean;
  opIndex: number;
}

interface TextRun {
  text: string;
  opIndex: number;
  origin: [number, number];
  sample: [number, number]; // a point inside the glyph band, for region tests
  fontPt: number;
  renderMode: number;
  fill: Rgb | null;
  stroke: Rgb | null;
  fillAlpha: number;
  strokeAlpha: number;
  hidden?: { signature: ResumeFlagSignature; detail: string };
}

// Minimal structural views of the pdf.js objects we touch.
interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}
interface PdfPage {
  view: number[];
  getViewport(o: { scale: number }): {
    convertToViewportPoint(x: number, y: number): number[];
  };
  getTextContent(): Promise<{ items: unknown[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  getAnnotations(): Promise<Record<string, unknown>[]>;
  objs: { get(id: string): unknown };
  cleanup(): void;
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  getMetadata(): Promise<{
    info?: Record<string, unknown>;
    metadata?: { getAll?: () => Record<string, unknown> } | null;
  }>;
}

function readColor(args: unknown[]): Rgb | null {
  if (typeof args[0] === "string") return parseHex(args[0]);
  if (args.length >= 3 && args.every((a) => typeof a === "number")) {
    return [args[0] as number, args[1] as number, args[2] as number];
  }
  return null;
}

function imageIsOpaque(page: PdfPage, id: unknown): boolean {
  if (typeof id !== "string") return false;
  try {
    const img = page.objs.get(id) as
      | { kind?: number; data?: Uint8Array | Uint8ClampedArray }
      | null;
    if (!img || !img.data) return false;
    if (img.kind !== IMAGE_KIND_RGBA) return true;
    // Sample the alpha channel; any see-through pixel means text may show.
    const step = Math.max(4, Math.floor(img.data.length / 4 / 4000) * 4);
    for (let i = 3; i < img.data.length; i += step) {
      if (img.data[i] < 250) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Walk one page's operator list, tracking just enough graphics state to know
// how and where every text run is painted.
function walkOperators(
  page: PdfPage,
  ops: { fnArray: number[]; argsArray: unknown[][] }
): { runs: TextRun[]; regions: Region[] } {
  const pageBox: Box = [page.view[0], page.view[1], page.view[2], page.view[3]];
  let state: GState = {
    ctm: IDENTITY,
    clip: pageBox,
    fill: BLACK,
    stroke: BLACK,
    fillAlpha: 1,
    strokeAlpha: 1,
    fontSize: 0,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    rise: 0,
    renderMode: 0,
  };
  const stack: GState[] = [];
  let textMatrix: Matrix = IDENTITY;
  let lineMatrix: Matrix = IDENTITY;
  let pendingClip = false;
  let annotationDepth = 0;
  const runs: TextRun[] = [];
  const regions: Region[] = [];

  const push = () => stack.push({ ...state });
  const pop = () => {
    const prev = stack.pop();
    if (prev) state = prev;
  };
  const moveText = (x: number, y: number) => {
    lineMatrix = mul(lineMatrix, [1, 0, 0, 1, x, y]);
    textMatrix = lineMatrix;
  };

  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    const args = (ops.argsArray[i] ?? []) as unknown[];

    // Annotation appearances are reported through getAnnotations instead.
    if (fn === OPS.beginAnnotation) {
      annotationDepth += 1;
      continue;
    }
    if (fn === OPS.endAnnotation) {
      annotationDepth = Math.max(0, annotationDepth - 1);
      continue;
    }
    if (annotationDepth > 0) continue;

    switch (fn) {
      case OPS.save:
      case OPS.beginGroup:
        push();
        break;
      case OPS.restore:
      case OPS.endGroup:
      case OPS.paintFormXObjectEnd:
        pop();
        break;
      case OPS.paintFormXObjectBegin: {
        push();
        const m = args[0] as number[] | null;
        if (Array.isArray(m) && m.length === 6) state.ctm = mul(state.ctm, m as Matrix);
        const bbox = args[1] as number[] | null;
        if (bbox && bbox.length === 4) {
          state.clip = intersect(
            state.clip,
            boxOf(state.ctm, bbox[0], bbox[1], bbox[2], bbox[3])
          );
        }
        break;
      }
      case OPS.transform:
        state.ctm = mul(state.ctm, args as Matrix);
        break;
      case OPS.setGState:
        for (const entry of (args[0] as [string, unknown][]) ?? []) {
          if (entry[0] === "ca" && typeof entry[1] === "number") state.fillAlpha = entry[1];
          if (entry[0] === "CA" && typeof entry[1] === "number") state.strokeAlpha = entry[1];
          if (entry[0] === "Font" && Array.isArray(entry[1])) {
            state.fontSize = Math.abs(Number(entry[1][1]) || 0);
          }
        }
        break;
      case OPS.setFillRGBColor:
        state.fill = readColor(args);
        break;
      case OPS.setStrokeRGBColor:
        state.stroke = readColor(args);
        break;
      case OPS.setFillColorN:
      case OPS.setFillTransparent:
        state.fill = null;
        break;
      case OPS.setStrokeColorN:
      case OPS.setStrokeTransparent:
        state.stroke = null;
        break;
      case OPS.clip:
      case OPS.eoClip:
        pendingClip = true;
        break;
      case OPS.constructPath: {
        const paintOp = args[0] as number;
        const minMax = args[2] as ArrayLike<number> | null;
        if (!minMax || minMax.length < 4) {
          pendingClip = false;
          break;
        }
        const box = boxOf(state.ctm, minMax[0], minMax[1], minMax[2], minMax[3]);
        const isFill = paintOp >= OPS.fill && paintOp <= OPS.closeEOFillStroke;
        if (isFill && state.fillAlpha > MAX_INVISIBLE_ALPHA) {
          const opaque = state.fillAlpha >= MIN_OPAQUE_ALPHA;
          regions.push({
            box: intersect(box, state.clip),
            kind: "fill",
            color: opaque ? state.fill : null,
            opaque,
            opIndex: i,
          });
        }
        if (pendingClip) {
          state.clip = intersect(state.clip, box);
          pendingClip = false;
        }
        break;
      }
      case OPS.shadingFill:
        regions.push({ box: state.clip, kind: "fill", color: null, opaque: false, opIndex: i });
        break;
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
        regions.push({
          box: intersect(boxOf(state.ctm, 0, 0, 1, 1), state.clip),
          kind: "image",
          color: null,
          opaque:
            state.fillAlpha >= MIN_OPAQUE_ALPHA &&
            fn === OPS.paintImageXObject &&
            imageIsOpaque(page, args[0]),
          opIndex: i,
        });
        break;
      case OPS.beginText:
        textMatrix = IDENTITY;
        lineMatrix = IDENTITY;
        break;
      case OPS.setCharSpacing:
        state.charSpacing = Number(args[0]) || 0;
        break;
      case OPS.setWordSpacing:
        state.wordSpacing = Number(args[0]) || 0;
        break;
      case OPS.setHScale:
        state.hScale = (Number(args[0]) || 100) / 100;
        break;
      case OPS.setLeading:
        state.leading = Number(args[0]) || 0;
        break;
      case OPS.setFont:
        state.fontSize = Math.abs(Number(args[1]) || 0);
        break;
      case OPS.setTextRenderingMode:
        state.renderMode = Number(args[0]) || 0;
        break;
      case OPS.setTextRise:
        state.rise = Number(args[0]) || 0;
        break;
      case OPS.moveText:
        moveText(Number(args[0]) || 0, Number(args[1]) || 0);
        break;
      case OPS.setLeadingMoveText:
        state.leading = -(Number(args[1]) || 0);
        moveText(Number(args[0]) || 0, Number(args[1]) || 0);
        break;
      case OPS.setTextMatrix: {
        // pdf.js 5 passes the six numbers either spread or as one array.
        const m = (Array.isArray(args[0]) || ArrayBuffer.isView(args[0])
          ? Array.from(args[0] as ArrayLike<number>)
          : args) as number[];
        if (m.length >= 6) {
          textMatrix = [m[0], m[1], m[2], m[3], m[4], m[5]];
          lineMatrix = textMatrix;
        }
        break;
      }
      case OPS.nextLine:
        moveText(0, -state.leading);
        break;
      case OPS.showText: {
        const glyphs = (args[0] as unknown[]) ?? [];
        let text = "";
        let advance = 0;
        for (const g of glyphs) {
          if (typeof g === "number") {
            advance -= (g * state.fontSize) / 1000;
            if (g < -KERNING_SPACE_THRESHOLD && !text.endsWith(" ")) text += " ";
          } else if (g && typeof g === "object") {
            const glyph = g as { unicode?: string; width?: number; isSpace?: boolean };
            text += glyph.unicode ?? "";
            advance +=
              ((glyph.width ?? 0) * state.fontSize) / 1000 +
              state.charSpacing +
              (glyph.isSpace ? state.wordSpacing : 0);
          }
        }
        advance *= state.hScale;
        const trm = mul(state.ctm, textMatrix);
        const fontPt = state.fontSize * Math.hypot(trm[2], trm[3]);
        if (text.trim()) {
          runs.push({
            text,
            opIndex: i,
            origin: apply(trm, 0, state.rise),
            sample: apply(trm, advance / 2, state.rise + state.fontSize * 0.3),
            fontPt,
            renderMode: state.renderMode,
            fill: state.fill,
            stroke: state.stroke,
            fillAlpha: state.fillAlpha,
            strokeAlpha: state.strokeAlpha,
          });
        }
        textMatrix = mul(textMatrix, [1, 0, 0, 1, advance, 0]);
        break;
      }
      default:
        break;
    }
  }
  return { runs, regions };
}

// Which paint channels a render mode uses. Modes 4-6 add clipping to 0-2.
function paints(mode: number): { fill: boolean; stroke: boolean } {
  const m = mode % 4;
  return { fill: m === 0 || m === 2, stroke: m === 1 || m === 2 };
}

function classifyRun(run: TextRun, regions: Region[], pageBox: Box): void {
  if (INVISIBLE_RENDER_MODES.includes(run.renderMode)) {
    run.hidden = {
      signature: "invisible_render_mode",
      detail: `text render mode ${run.renderMode}`,
    };
    return;
  }
  const mode = paints(run.renderMode);
  const fillSeen = mode.fill && run.fillAlpha > MAX_INVISIBLE_ALPHA;
  const strokeSeen = mode.stroke && run.strokeAlpha > MAX_INVISIBLE_ALPHA;
  if (!fillSeen && !strokeSeen) {
    run.hidden = {
      signature: "zero_alpha",
      detail: `opacity ${mode.fill ? run.fillAlpha : run.strokeAlpha}`,
    };
    return;
  }
  const t = OFF_PAGE_TOLERANCE_PT;
  const outer: Box = [pageBox[0] - t, pageBox[1] - t, pageBox[2] + t, pageBox[3] + t];
  if (!contains(outer, run.sample[0], run.sample[1])) {
    run.hidden = {
      signature: "off_page",
      detail: `positioned at (${Math.round(run.origin[0])}, ${Math.round(run.origin[1])}), outside the page`,
    };
    return;
  }
  if (run.fontPt > 0 && run.fontPt < MIN_VISIBLE_FONT_PT) {
    run.hidden = { signature: "tiny_font", detail: `${run.fontPt.toFixed(1)}pt font` };
    return;
  }

  // Background = the last thing painted under the text before it was drawn.
  // Unknown backgrounds (images, gradients, see-through fills) are never
  // judged, so white text on a photo or a dark sidebar is left alone.
  let background: Rgb | null = WHITE;
  for (let r = regions.length - 1; r >= 0; r -= 1) {
    const region = regions[r];
    if (region.opIndex > run.opIndex) continue;
    if (region.box[3] - region.box[1] < run.fontPt * 0.5) continue;
    if (contains(region.box, run.sample[0], run.sample[1])) {
      background = region.color;
      break;
    }
  }
  if (background) {
    const fillHidden = !fillSeen || (run.fill != null && colorsMatch(run.fill, background));
    const strokeHidden =
      !strokeSeen || (run.stroke != null && colorsMatch(run.stroke, background));
    if (fillHidden && strokeHidden) {
      const ink = fillSeen ? run.fill : run.stroke;
      run.hidden = {
        signature: "background_color",
        detail: `${ink ? toHex(ink) : "text"} on ${toHex(background)} background`,
      };
      return;
    }
  }

  for (const region of regions) {
    if (region.opIndex < run.opIndex || region.kind !== "image" || !region.opaque) continue;
    if (contains(region.box, run.sample[0], run.sample[1])) {
      run.hidden = { signature: "behind_image", detail: "covered by an opaque image" };
      return;
    }
  }
}

// Remove `needle` (whitespace-insensitive) from `haystack`, choosing the
// occurrence nearest `expectedFraction` of the way through. Null = not found.
function removeSpan(
  haystack: string,
  needle: string,
  expectedFraction: number
): string | null {
  const target = stripWhitespace(needle);
  if (!target) return null;
  const chars: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < haystack.length; i += 1) {
    const c = haystack[i].normalize("NFKC");
    if (/^\s*$/.test(c)) continue;
    for (const ch of c) {
      chars.push(ch);
      map.push(i);
    }
  }
  const flat = chars.join("");
  const expected = expectedFraction * flat.length;
  let best = -1;
  for (let at = flat.indexOf(target); at !== -1; at = flat.indexOf(target, at + 1)) {
    if (best === -1 || Math.abs(at - expected) < Math.abs(best - expected)) best = at;
  }
  if (best === -1) return null;
  const start = map[best];
  const end = map[best + target.length - 1] + 1;
  return haystack.slice(0, start) + haystack.slice(end);
}

// Same assembly pdf-parse's getPageText does with its defaults, so the stored
// text keeps the shape it always had.
const LINE_THRESHOLD = 4.6;
const CELL_THRESHOLD = 7;
function assemblePageText(page: PdfPage, items: PdfTextItem[]): string {
  const viewport = page.getViewport({ scale: 1 });
  const buf: string[] = [];
  let lastX: number | undefined;
  let lastY: number | undefined;
  let lineHeight = 0;
  for (const item of items) {
    let str = item.str;
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    if (lastY !== undefined && Math.abs(lastY - y) > LINE_THRESHOLD) {
      const last = buf.length ? buf[buf.length - 1] : undefined;
      const hasNewLine = str.startsWith("\n") || (str.trim() === "" && item.hasEOL);
      if (last?.endsWith("\n") === false && !hasNewLine) {
        if (Math.abs(lastY - y) - 1 > lineHeight) {
          buf.push("\n");
          lineHeight = 0;
        }
      }
    }
    if (lastY !== undefined && Math.abs(lastY - y) < LINE_THRESHOLD) {
      if (lastX !== undefined && Math.abs(lastX - x) > CELL_THRESHOLD) str = `\t${str}`;
    }
    buf.push(str);
    lastX = x + item.width;
    lastY = y;
    lineHeight = Math.max(lineHeight, item.height);
    if (item.hasEOL) buf.push("\n");
    if (item.hasEOL || str.endsWith("\n")) lineHeight = 0;
  }
  return buf.join("");
}

function joinPages(pages: string[]): string {
  return pages
    .map((text, i) => `${text}\n\n-- ${i + 1} of ${pages.length} --\n\n`)
    .join("");
}

async function analyzePdfPage(
  page: PdfPage,
  pageNumber: number
): Promise<{ full: string; visible: string; flags: ResumeFlag[] }> {
  const pageBox: Box = [page.view[0], page.view[1], page.view[2], page.view[3]];
  const flags: ResumeFlag[] = [];

  const textContent = await page.getTextContent();
  const items = (textContent.items as Partial<PdfTextItem>[]).filter(
    (it): it is PdfTextItem => typeof it.str === "string" && Array.isArray(it.transform)
  );
  const full = assemblePageText(page, items);

  const { runs, regions } = walkOperators(page, await page.getOperatorList());
  for (const run of runs) classifyRun(run, regions, pageBox);

  // Scanned page with an OCR layer: invisible text that mirrors the picture.
  // Keep it (dropping it would erase the whole resume) and leave a note.
  const totalChars = runs.reduce((n, r) => n + r.text.length, 0);
  const invisibleChars = runs
    .filter((r) => r.hidden?.signature === "invisible_render_mode")
    .reduce((n, r) => n + r.text.length, 0);
  const imageCoverage =
    Math.max(0, ...regions.filter((r) => r.kind === "image").map((r) => boxArea(r.box))) /
    Math.max(1, boxArea(pageBox));
  if (
    totalChars > 0 &&
    invisibleChars / totalChars >= OCR_LAYER_MIN_INVISIBLE_FRACTION &&
    imageCoverage >= OCR_LAYER_MIN_IMAGE_COVERAGE
  ) {
    for (const run of runs) {
      if (run.hidden?.signature === "invisible_render_mode") run.hidden = undefined;
    }
    flags.push({
      signature: "ocr_text_layer",
      text: "",
      page: pageNumber,
      detail: "scanned page with an invisible OCR text layer; text kept",
      dropped: false,
    });
  }

  // Strip each hidden run out of the text item it landed in. A run must match
  // an item by position AND by content, so a hidden copy stacked on top of
  // visible text never removes the visible text.
  const visibleItems = items.map((it) => ({ ...it }));
  for (const run of runs) {
    if (!run.hidden) continue;
    flags.push({
      signature: run.hidden.signature,
      text: run.text,
      page: pageNumber,
      detail: run.hidden.detail,
      dropped: true,
    });
    for (const item of visibleItems) {
      if (!item.str.trim()) continue;
      const scale = Math.hypot(item.transform[0], item.transform[1]) || 1;
      const ux = item.transform[0] / scale;
      const uy = item.transform[1] / scale;
      const dx = run.origin[0] - item.transform[4];
      const dy = run.origin[1] - item.transform[5];
      const along = dx * ux + dy * uy;
      const across = Math.abs(-dx * uy + dy * ux);
      const slack = Math.max(2, item.height * 0.5);
      if (along < -slack || along > item.width + slack || across > slack) continue;
      const next = removeSpan(item.str, run.text, item.width ? along / item.width : 0);
      if (next !== null) {
        item.str = next;
        break;
      }
    }
  }
  const visible = assemblePageText(
    page,
    visibleItems.filter((it, i) => it.str.trim() !== "" || items[i].str.trim() === "")
  );

  // Comments, hidden annotations and hidden form fields. None of these are in
  // the extracted text, so they are recorded only.
  try {
    for (const a of await page.getAnnotations()) {
      const subtype = String(a.subtype ?? "");
      if (subtype === "Link" || subtype === "Popup") continue;
      const flagsBits = Number(a.annotationFlags ?? 0);
      const isHidden = Boolean(a.hidden) || (flagsBits & 2) !== 0 || (flagsBits & 32) !== 0;
      const contents = String((a.contentsObj as { str?: string } | undefined)?.str ?? "").trim();
      if (subtype === "Widget") {
        const value = typeof a.fieldValue === "string" ? a.fieldValue.trim() : "";
        if (isHidden && value.length >= ANNOTATION_FLAG_MIN_CHARS) {
          flags.push({
            signature: "form_field",
            text: value,
            page: pageNumber,
            detail: "value of a hidden form field",
            dropped: true,
          });
        }
        continue;
      }
      if (contents.length >= ANNOTATION_FLAG_MIN_CHARS) {
        flags.push({
          signature: "annotation",
          text: contents,
          page: pageNumber,
          detail: `${subtype || "unknown"} annotation${isHidden ? " (hidden)" : ""}`,
          dropped: true,
        });
      }
    }
  } catch {
    // Annotations are evidence only; a failure here must not lose the text.
  }

  return { full, visible, flags };
}

// Info-dictionary keys that are always tool noise, never candidate prose.
const METADATA_IGNORED_KEYS = new Set([
  "PDFFormatVersion",
  "Producer",
  "Creator",
  "CreationDate",
  "ModDate",
  "Trapped",
  "Language",
  "EncryptFilterName",
  // pdfTeX build banner, seen on a real LaTeX resume in the first DB scan.
  "PTEX.Fullbanner",
]);

function metadataFlags(
  entries: Iterable<[string, unknown]>,
  source: string
): ResumeFlag[] {
  const flags: ResumeFlag[] = [];
  for (const [key, raw] of entries) {
    if (METADATA_IGNORED_KEYS.has(key)) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    const value = values.filter((v) => typeof v === "string").join(" ").trim();
    if (value.length >= METADATA_FLAG_MIN_CHARS) {
      flags.push({
        signature: "metadata",
        text: value,
        page: null,
        detail: `${source} field "${key}"`,
        dropped: true,
      });
    }
  }
  return flags;
}

// Throws pdf-parse's exceptions when the file cannot be loaded or parsed.
export async function extractPdfWithFlags(buffer: Buffer): Promise<ResumeExtraction> {
  // Pass a copy so pdf.js can't detach the caller's buffer.
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    // load() is private in the typings but is how pdf-parse itself gets the
    // pdf.js document; reusing it avoids loading a second copy of pdf.js.
    const doc = await (parser as unknown as { load(): Promise<PdfDoc> }).load();
    const fullPages: string[] = [];
    const visiblePages: string[] = [];
    let flags: ResumeFlag[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const result = await analyzePdfPage(page, n);
      fullPages.push(result.full);
      visiblePages.push(result.visible);
      flags = flags.concat(result.flags);
      page.cleanup();
    }
    try {
      const meta = await doc.getMetadata();
      const info = meta.info ?? {};
      const custom = (info.Custom ?? {}) as Record<string, unknown>;
      flags = flags.concat(
        metadataFlags(Object.entries(info), "document info"),
        metadataFlags(Object.entries(custom), "custom document info"),
        metadataFlags(Object.entries(meta.metadata?.getAll?.() ?? {}), "XMP metadata")
      );
    } catch {
      // Metadata is evidence only.
    }
    return {
      fullText: joinPages(fullPages),
      visibleText: joinPages(visiblePages),
      flags: mergeFlags(flags),
      pageCount: doc.numPages,
      visiblePages,
    };
  } finally {
    await parser.destroy();
  }
}
