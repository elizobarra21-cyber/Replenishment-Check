// PDF writer for the replenishment report. Uses pdf-lib with an embedded
// DejaVu Sans subset (lib/fonts/dejavu.ts) so Cyrillic notes render correctly -
// the standard Helvetica base fonts have no Cyrillic glyphs.

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont } from "pdf-lib";
import { DEJAVU_SANS_BASE64, DEJAVU_SANS_BOLD_BASE64 } from "@/lib/fonts/dejavu";

export type PdfLine = {
  text: string;
  size?: number;
  bold?: boolean;
  // Extra left offset in points (for item lines under a department heading).
  indent?: number;
  // Keep the line single: cut it with an ellipsis instead of wrapping.
  truncate?: boolean;
};

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 50;
const TOP = PAGE_HEIGHT - 50;
const BOTTOM = 50;

// Drop characters outside the embedded subset (Latin, Cyrillic, common
// punctuation) so pdf-lib does not throw on e.g. emoji in a note.
const OUTSIDE_SUBSET =
  /[^\x20-\x7E\u00A0-\u017F\u0400-\u04FF\u2010-\u2027\u2030-\u205E\u20AC\u2116]/g;

function sanitizePdfText(text: string): string {
  return text.replace(OUTSIDE_SUBSET, "?");
}

function truncateLine(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) {
    return text;
  }
  let cut = text;
  while (cut.length > 0 && font.widthOfTextAtSize(`${cut}...`, size) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}...`;
}

function wrapLine(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  if (!text) {
    return [""];
  }
  const words = text.split(/\s+/);
  const rows: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      rows.push(current);
      current = word;
    }
  }
  rows.push(current);
  return rows;
}

export async function buildTextPdf(lines: PdfLine[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(DEJAVU_SANS_BASE64, { subset: true });
  const bold = await doc.embedFont(DEJAVU_SANS_BOLD_BASE64, { subset: true });

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = TOP;

  for (const line of lines) {
    const size = line.size ?? 11;
    const font = line.bold ? bold : regular;
    const indent = line.indent ?? 0;
    const lineHeight = size * 1.45;
    const maxWidth = PAGE_WIDTH - MARGIN_X * 2 - indent;
    const clean = sanitizePdfText(line.text);
    const rows = line.truncate
      ? [truncateLine(clean, font, size, maxWidth)]
      : wrapLine(clean, font, size, maxWidth);

    for (const row of rows) {
      if (y - lineHeight < BOTTOM) {
        page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = TOP;
      }
      y -= lineHeight;
      if (row) {
        page.drawText(row, { x: MARGIN_X + indent, y, size, font });
      }
    }
  }

  return doc.save();
}
