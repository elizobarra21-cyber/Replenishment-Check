// Minimal dependency-free PDF writer: renders a list of text lines to a simple
// multi-page A4 document using the standard Helvetica fonts (no embedding). Good
// enough for a text report; avoids pulling in a heavy PDF library.

export type PdfLine = { text: string; size?: number; bold?: boolean };

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_X = 50;
const TOP = 800;
const BOTTOM = 50;
const LINE_HEIGHT = 16;

function escapePdfText(text: string): string {
  // Escape PDF string delimiters and drop non-WinAnsi bytes.
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, "?");
}

export function buildTextPdf(lines: PdfLine[]): Uint8Array {
  // Paginate.
  const pages: PdfLine[][] = [];
  let current: PdfLine[] = [];
  let y = TOP;
  for (const line of lines) {
    if (y < BOTTOM) {
      pages.push(current);
      current = [];
      y = TOP;
    }
    current.push(line);
    y -= LINE_HEIGHT;
  }
  pages.push(current);

  // Object numbers: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold,
  // then a (page, content) pair per page.
  const pageObjNums: number[] = [];
  const contentObjNums: number[] = [];
  let nextObj = 5;
  for (let i = 0; i < pages.length; i += 1) {
    pageObjNums.push(nextObj++);
    contentObjNums.push(nextObj++);
  }
  const totalObjs = nextObj - 1;

  const objects: string[] = new Array(totalObjs + 1).fill("");
  objects[1] = "<</Type/Catalog/Pages 2 0 R>>";
  objects[2] = `<</Type/Pages/Kids[${pageObjNums
    .map((n) => `${n} 0 R`)
    .join(" ")}]/Count ${pages.length}>>`;
  objects[3] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>";
  objects[4] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold>>";

  pages.forEach((pageLines, index) => {
    let yy = TOP;
    let stream = "BT\n";
    for (const line of pageLines) {
      const size = line.size ?? 11;
      const font = line.bold ? "F2" : "F1";
      stream += `/${font} ${size} Tf 1 0 0 1 ${MARGIN_X} ${yy} Tm (${escapePdfText(
        line.text,
      )}) Tj\n`;
      yy -= LINE_HEIGHT;
    }
    stream += "ET";

    const pageNum = pageObjNums[index];
    const contentNum = contentObjNums[index];
    objects[pageNum] =
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}]` +
      `/Resources<</Font<</F1 3 0 R/F2 4 0 R>>>>/Contents ${contentNum} 0 R>>`;
    objects[contentNum] =
      `<</Length ${Buffer.byteLength(stream, "latin1")}>>\nstream\n${stream}\nendstream`;
  });

  // Assemble with a cross-reference table.
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = new Array(totalObjs + 1).fill(0);
  for (let n = 1; n <= totalObjs; n += 1) {
    offsets[n] = Buffer.byteLength(pdf, "latin1");
    pdf += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= totalObjs; n += 1) {
    pdf += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<</Size ${totalObjs + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;

  return new Uint8Array(Buffer.from(pdf, "latin1"));
}
