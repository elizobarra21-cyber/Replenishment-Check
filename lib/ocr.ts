// Client-side OCR pipeline for the label scanner.
//
// Goals:
// 1. Speed - keep one reusable Tesseract worker (the deprecated
//    `Tesseract.recognize` helper spins up and tears down a fresh worker on
//    every call) and recognize digits only, on a downscaled grayscale canvas.
// 2. Strictly read the code above the barcode - locate the barcode band in the
//    image and OCR only the region above it, returning the line closest to the
//    barcode first.
//
// This module is browser-only and must only be imported from client code.
// `tesseract.js` itself is loaded lazily so it stays out of the initial bundle.

type OcrBbox = { x0: number; y0: number; x1: number; y1: number };
type OcrLine = { text?: string; bbox?: OcrBbox };
type OcrParagraph = { lines?: OcrLine[] };
type OcrBlock = { paragraphs?: OcrParagraph[] };
type OcrPage = { text?: string; blocks?: OcrBlock[] | null };
type OcrResult = { data: OcrPage };

type OcrRectangle = { left: number; top: number; width: number; height: number };
type OcrOutputFormats = { text?: boolean; blocks?: boolean };

type OcrWorker = {
  setParameters(params: Record<string, string>): Promise<unknown>;
  recognize(
    image: HTMLCanvasElement,
    options?: { rectangle?: OcrRectangle },
    output?: OcrOutputFormats,
  ): Promise<OcrResult>;
  terminate(): Promise<unknown>;
};

type FlatLine = { text: string; y: number };
type BarcodeBand = { top: number; bottom: number };
type PreparedScan = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  band: BarcodeBand | null;
};

// Downscale huge phone photos before OCR. The 17-digit strip stays legible at
// this size while recognition runs on a fraction of the pixels.
const MAX_OCR_SIDE = 2000;

let workerPromise: Promise<OcrWorker> | null = null;
let textWorkerPromise: Promise<OcrWorker> | null = null;

async function createOcrWorker(): Promise<OcrWorker> {
  const mod = (await import("tesseract.js")) as unknown as {
    createWorker: (
      langs?: string,
      oem?: number,
      options?: Record<string, unknown>,
    ) => Promise<OcrWorker>;
  };

  // `eng` + LSTM only. The label code is numeric, so we whitelist digits: this
  // is both faster and more accurate (no digit/letter confusion) than the old
  // `eng+rus` full-text pass.
  const worker = await mod.createWorker("eng", 1);
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789 ",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });
  return worker;
}

function getOcrWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    workerPromise = createOcrWorker().catch((err) => {
      // Allow a later retry if setup failed (e.g. lang data download error).
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

// A second worker that also reads uppercase letters, used to find the "EUR"
// size line (e.g. "EUR 38" or "EUR M") so we can pick the right size system.
async function createTextWorker(): Promise<OcrWorker> {
  const mod = (await import("tesseract.js")) as unknown as {
    createWorker: (
      langs?: string,
      oem?: number,
      options?: Record<string, unknown>,
    ) => Promise<OcrWorker>;
  };
  const worker = await mod.createWorker("eng", 1);
  await worker.setParameters({
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });
  return worker;
}

function getTextWorker(): Promise<OcrWorker> {
  if (!textWorkerPromise) {
    textWorkerPromise = createTextWorker().catch((err) => {
      textWorkerPromise = null;
      throw err;
    });
  }
  return textWorkerPromise;
}

/** Prepare the OCR workers ahead of time so the first scan is fast. */
export function warmUpOcr(): void {
  void getOcrWorker().catch(() => {});
  void getTextWorker().catch(() => {});
}

/** Tear the workers down to free memory (e.g. on unmount). */
export async function terminateOcr(): Promise<void> {
  const pending = [workerPromise, textWorkerPromise];
  workerPromise = null;
  textWorkerPromise = null;
  for (const p of pending) {
    if (!p) {
      continue;
    }
    try {
      const worker = await p;
      await worker.terminate();
    } catch {
      // ignore - nothing to clean up
    }
  }
}

// Tesseract workers accumulate memory across many recognitions, which made the
// scanner less accurate after ~10 scans in a session. Recycle both workers
// every few scans so quality stays stable. Call once at the start of each scan,
// before the recognition passes run (so nothing is terminated mid-recognition).
let scanCount = 0;
const RECYCLE_EVERY = 8;

export async function beginScan(): Promise<void> {
  if (scanCount >= RECYCLE_EVERY) {
    scanCount = 0;
    await terminateOcr();
    warmUpOcr(); // recreate both workers ahead of the passes
  }
  scanCount += 1;
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to load scan photo"));
    };
    image.src = url;
  });
}

function toGrayscale(imageData: ImageData): void {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    data[i] = lum;
    data[i + 1] = lum;
    data[i + 2] = lum;
  }
}

// Locate the barcode as the tallest horizontal band of dense vertical edges.
// Barcodes pack many full-height black/white transitions into a contiguous run
// of rows, which separates them from text lines (short) and blank areas (sparse).
function findBarcodeBand(imageData: ImageData, width: number, height: number): BarcodeBand | null {
  if (width < 2 || height < 2) {
    return null;
  }

  const data = imageData.data;
  const EDGE = 45; // grayscale jump that counts as a bar edge
  const stepX = width > 1400 ? 2 : 1; // subsample wide rows for speed
  const density = new Float32Array(height);
  let maxDensity = 0;

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width * 4;
    let edges = 0;
    let samples = 0;
    let prev = -1;
    for (let x = 0; x < width; x += stepX) {
      const lum = data[rowStart + x * 4];
      if (prev >= 0 && Math.abs(lum - prev) > EDGE) {
        edges += 1;
      }
      prev = lum;
      samples += 1;
    }
    const den = samples > 0 ? edges / samples : 0;
    density[y] = den;
    if (den > maxDensity) {
      maxDensity = den;
    }
  }

  if (maxDensity < 0.06) {
    return null;
  }

  // Smooth so quiet zones inside a barcode do not split the band.
  const smooth = new Float32Array(height);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    let n = 0;
    for (let k = -2; k <= 2; k += 1) {
      const yy = y + k;
      if (yy >= 0 && yy < height) {
        sum += density[yy];
        n += 1;
      }
    }
    smooth[y] = sum / n;
  }

  const threshold = Math.max(0.06, maxDensity * 0.5);
  let best: { top: number; bottom: number; rows: number } | null = null;
  let runTop = -1;
  for (let y = 0; y <= height; y += 1) {
    const on = y < height && smooth[y] >= threshold;
    if (on && runTop < 0) {
      runTop = y;
    } else if (!on && runTop >= 0) {
      const rows = y - runTop;
      if (!best || rows > best.rows) {
        best = { top: runTop, bottom: y - 1, rows };
      }
      runTop = -1;
    }
  }

  if (!best || best.rows < Math.max(8, height * 0.02)) {
    return null;
  }

  return { top: best.top, bottom: best.bottom };
}

async function prepareScan(file: File): Promise<PreparedScan> {
  const image = await loadImageFromFile(file);
  const sourceWidth = image.naturalWidth || image.width || 1;
  const sourceHeight = image.naturalHeight || image.height || 1;
  const scale = Math.min(1, MAX_OCR_SIDE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return { canvas, width, height, band: null };
  }

  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  toGrayscale(imageData);
  context.putImageData(imageData, 0, 0);

  const band = findBarcodeBand(imageData, width, height);
  return { canvas, width, height, band };
}

function flattenLines(page: OcrPage): FlatLine[] {
  const blocks = page.blocks;
  if (!Array.isArray(blocks)) {
    return (page.text ?? "")
      .split(/\r?\n/)
      .map((text, index) => ({ text: text.trim(), y: index }))
      .filter((line) => line.text.length > 0);
  }

  const lines: FlatLine[] = [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const text = (line.text ?? "").trim();
        if (!text) {
          continue;
        }
        const y = line.bbox ? (line.bbox.y0 + line.bbox.y1) / 2 : 0;
        lines.push({ text, y });
      }
    }
  }
  return lines;
}

// True when the digits in `text` can form the 17-digit label code (compact,
// as an exact run, or by concatenating consecutive numeric groups).
function assemblesLabelCode(text: string): boolean {
  const compact = text.replace(/\D/g, "");
  if (compact.length === 17) {
    return true;
  }
  if (/(?:^|\D)\d{17}(?=\D|$)/.test(text)) {
    return true;
  }
  const groups = text.match(/\d+/g) ?? [];
  for (let start = 0; start < groups.length; start += 1) {
    let acc = "";
    for (let end = start; end < groups.length; end += 1) {
      acc += groups[end];
      if (acc.length === 17) {
        return true;
      }
      if (acc.length > 17) {
        break;
      }
    }
  }
  return false;
}

function pushUnique(target: string[], seen: Set<string>, value: string): void {
  const trimmed = value.trim();
  if (trimmed && !seen.has(trimmed)) {
    seen.add(trimmed);
    target.push(trimmed);
  }
}

// Order lines so the one closest above the barcode comes first. Without a
// detected barcode, fall back to bottom-most first (where the code usually sits).
function orderLinesByBarcode(lines: FlatLine[], bandTop: number): FlatLine[] {
  const above = lines.filter((line) => line.y < bandTop).sort((a, b) => b.y - a.y);
  const below = lines.filter((line) => line.y >= bandTop).sort((a, b) => a.y - b.y);
  return [...above, ...below];
}

/**
 * Recognize the label and return candidate code strings, best first.
 *
 * When a barcode is found we OCR only a narrow strip directly above it (so the
 * bars, the EAN below the barcode, and numbers higher up the label can never
 * win) and put the line nearest the barcode first. The whole-image text is
 * appended only as a fallback. The caller runs the structured parser over these
 * candidates in order.
 */
export async function readLabelCandidates(file: File): Promise<string[]> {
  const worker = await getOcrWorker();
  const { canvas, width, height, band } = await prepareScan(file);

  const candidates: string[] = [];
  const seen = new Set<string>();

  // Primary path: OCR only the narrow strip of digits immediately above the
  // barcode. We deliberately exclude the bars themselves and any numbers higher
  // up the label - only the code line directly above the barcode is read.
  if (band) {
    const barcodeTop = Math.round(band.top);
    // The code line sits just above the bars. A strip of ~12% of the image
    // height (floored at 48px, capped by the space above the barcode) reliably
    // covers that single line without reaching unrelated numbers higher up.
    const stripHeight = Math.min(barcodeTop, Math.max(48, Math.round(height * 0.12)));
    const stripTop = Math.max(0, barcodeTop - stripHeight);
    const rectHeight = barcodeTop - stripTop;

    if (rectHeight >= Math.max(16, Math.round(height * 0.025))) {
      const region = await worker.recognize(
        canvas,
        { rectangle: { left: 0, top: stripTop, width, height: rectHeight } },
        { text: true, blocks: true },
      );
      const lines = flattenLines(region.data).sort((a, b) => b.y - a.y); // closest to barcode first
      for (const line of lines) {
        pushUnique(candidates, seen, line.text);
      }
      pushUnique(candidates, seen, region.data.text ?? "");

      if (candidates.some(assemblesLabelCode)) {
        return candidates;
      }
    }
  }

  // Fallback / no-barcode path: OCR the whole image.
  const full = await worker.recognize(canvas, undefined, { text: true, blocks: true });
  const bandTop = band ? band.top : Number.POSITIVE_INFINITY;
  for (const line of orderLinesByBarcode(flattenLines(full.data), bandTop)) {
    pushUnique(candidates, seen, line.text);
  }
  pushUnique(candidates, seen, full.data.text ?? "");

  return candidates;
}

/**
 * Recognize an already-cropped canvas (e.g. the live-scanner mask window) with
 * the digit worker and return candidate strings, best first. Used by the live
 * camera loop to detect when the label code is inside the frame.
 */
export async function recognizeStripCanvas(
  canvas: HTMLCanvasElement,
): Promise<string[]> {
  const worker = await getOcrWorker();
  const res = await worker.recognize(canvas, undefined, { text: true, blocks: true });

  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const line of flattenLines(res.data).sort((a, b) => a.y - b.y)) {
    pushUnique(candidates, seen, line.text);
  }
  pushUnique(candidates, seen, res.data.text ?? "");
  return candidates;
}

// Raw size token from the label's EUR line. The caller combines this with the
// department (men's if it starts with 45) to pick the concrete size system.
export type SizeDetection = { kind: "letter" } | { kind: "number"; value: number };

/**
 * Detect the garment size token from the label by reading the line that
 * contains "EUR":
 *   - a numeric size in the 20..58 range -> { kind: "number", value }
 *   - letters XS/S/M/L/XL -> { kind: "letter" }
 * Returns null if nothing is recognized.
 */
export async function detectSizeToken(file: File): Promise<SizeDetection | null> {
  try {
    const worker = await getTextWorker();
    const { canvas } = await prepareScan(file);
    const res = await worker.recognize(canvas, undefined, { text: true, blocks: true });

    for (const line of flattenLines(res.data)) {
      const upper = line.text.toUpperCase();
      if (!/\bEUR?\b/.test(upper)) {
        continue;
      }
      // Drop the EUR token; the size sits on the same line.
      const rest = upper.replace(/\bEUR?\b/g, " ");
      // A plausible garment size number (women 24..44, men 28..54).
      const numbers = rest.match(/\d{2}/g) ?? [];
      for (const raw of numbers) {
        const value = Number(raw);
        if (value >= 20 && value <= 58) {
          return { kind: "number", value };
        }
      }
      if (/\b(XS|S|M|L|XL)\b/.test(rest)) {
        return { kind: "letter" };
      }
    }
    return null;
  } catch {
    return null;
  }
}
