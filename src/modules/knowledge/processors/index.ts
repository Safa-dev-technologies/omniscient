import type { DocumentProcessor } from './processor.interface.js';
import { pdfProcessor } from './pdf.processor.js';
import { docxProcessor } from './docx.processor.js';
import { txtProcessor } from './txt.processor.js';
import { csvProcessor } from './csv.processor.js';

const processors: DocumentProcessor[] = [pdfProcessor, docxProcessor, txtProcessor, csvProcessor];

export function getProcessor(mimeType: string): DocumentProcessor | null {
  return processors.find((p) => p.mimeTypes.includes(mimeType)) ?? null;
}

export * from './processor.interface.js';
