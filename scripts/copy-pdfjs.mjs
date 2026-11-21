// After the build: the files pdf.js fetches while drawing a page (the decoders for scanned pages, the standard
// fonts, the character maps, the colour profiles) go beside the site, under /pdfjs/. Used for the small preview
// of a PDF on a profile (see drawThumb in src/main.js).
import { cpSync } from 'node:fs';
for (const dir of ['wasm', 'standard_fonts', 'cmaps', 'iccs']) cpSync(`node_modules/pdfjs-dist/${dir}`, `dist/pdfjs/${dir}`, { recursive: true });
console.log('pdf.js files copied to dist/pdfjs');
