import mammoth from 'mammoth';
import type { DocumentProcessor, ExtractedDocument } from './processor.interface.js';

export class DocxProcessor implements DocumentProcessor {
  mimeTypes = ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

  async extract(buffer: Buffer, _filename: string): Promise<ExtractedDocument> {
    const result = await mammoth.extractRawText({ buffer });

    return {
      text: result.value,
      metadata: {},
    };
  }
}

export const docxProcessor = new DocxProcessor();
