import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('public/pdfjs', { recursive: true });
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'public/pdfjs/pdf.worker.min.mjs');
