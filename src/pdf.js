// Builds a PDF in the browser (loaded only when someone exports; see "pdf" in main.js). Takes a
// simple list of blocks — what to write, not where — and lays them out on A4 pages.
//
// Hebrew: jsPDF writes text in the order it's given, so a Hebrew line would come out backwards.
// Each line is put into visual order first with the Unicode bidi algorithm (bidi-js), and jsPDF is
// told the text is already visual. Hebrew has no glyph shaping (final letters are their own
// characters), so visual-order text is all it needs. The font is Alef (SIL OFL), Hebrew and Latin.
import { jsPDF } from 'jspdf';
import bidiFactory from 'bidi-js';

const bidi = bidiFactory();
const toVisual = (text, dir) => bidi.getReorderedString(text, bidi.getEmbeddingLevels(text, dir));

const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 48, INDENT = 14, MAX_DEPTH = 7;
const PURPLE = [91, 63, 176], INK = [36, 50, 58], GREY = [110, 122, 128];

async function fontBase64(url) {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * @param {object} o
 * @param {boolean} o.rtl          Hebrew (right to left) or English
 * @param {string}  o.title        first-page title
 * @param {string}  o.subtitle     line under it
 * @param {string}  o.footer       left of the page number on every page (e.g. the site address)
 * @param {Array}   o.blocks       { type: 'heading', text } | { type: 'item', text, sub?, depth?, bold?, keepWithNext? }
 * @returns {Promise<Blob>}
 */
export async function makePdf({ rtl, title, subtitle, footer, blocks }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const [regular, bold] = await Promise.all([fontBase64('/fonts/Alef-Regular.ttf'), fontBase64('/fonts/Alef-Bold.ttf')]);
  doc.addFileToVFS('Alef-Regular.ttf', regular); doc.addFont('Alef-Regular.ttf', 'Alef', 'normal');
  doc.addFileToVFS('Alef-Bold.ttf', bold); doc.addFont('Alef-Bold.ttf', 'Alef', 'bold');
  const dir = rtl ? 'rtl' : 'ltr';

  /** Writes one logical line at `y`, indented by `depth`, wrapping to the width; returns the new y. */
  const write = (text, y, { size, weight = 'normal', color = INK, depth = 0, lineGap = 1.25 }) => {
    doc.setFont('Alef', weight); doc.setFontSize(size); doc.setTextColor(...color);
    const indent = Math.min(depth, MAX_DEPTH) * INDENT;
    const width = PAGE_W - 2 * MARGIN - indent;
    for (const part of doc.splitTextToSize(text, width)) {
      const x = rtl ? PAGE_W - MARGIN - indent : MARGIN + indent;
      doc.text(toVisual(part, dir), x, y, { align: rtl ? 'right' : 'left', isInputVisual: true, isOutputVisual: true });
      y += size * lineGap;
    }
    return y;
  };
  const height = (b) => (b.type === 'heading' ? 34 : 18 + (b.sub ? 14 : 0));
  const bottom = PAGE_H - MARGIN - 24;

  let y = MARGIN + 16;
  y = write(title, y, { size: 22, weight: 'bold', color: PURPLE });
  if (subtitle) y = write(subtitle, y + 2, { size: 10.5, color: GREY });
  y += 10;

  blocks.forEach((b, i) => {
    // Keep a heading, or a couple marked keepWithNext, together with what follows it.
    const need = height(b) + (b.type === 'heading' || b.keepWithNext ? height(blocks[i + 1] ?? {}) : 0);
    if (y + need > bottom) { doc.addPage(); y = MARGIN + 10; }
    if (b.type === 'heading') {
      y = write(b.text, y + 10, { size: 15, weight: 'bold', color: PURPLE });
      doc.setDrawColor(...PURPLE); doc.setLineWidth(0.6); doc.line(MARGIN, y - 10, PAGE_W - MARGIN, y - 10);
      y += 4;
    } else {
      y = write(b.text, y, { size: 11.5, weight: b.bold ? 'bold' : 'normal', depth: b.depth ?? 0 });
      if (b.sub) y = write(b.sub, y - 2, { size: 9.5, color: GREY, depth: b.depth ?? 0 });
      y += 4;
    }
  });

  // Footer on every page: the site, and "n / N".
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('Alef', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GREY);
    const text = `${footer} · ${p} / ${pages}`;
    doc.text(toVisual(text, dir), PAGE_W / 2, PAGE_H - MARGIN + 10, { align: 'center', isInputVisual: true, isOutputVisual: true });
  }
  return doc.output('blob');
}
