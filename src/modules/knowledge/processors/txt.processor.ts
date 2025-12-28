import type { DocumentProcessor, ExtractedDocument } from './processor.interface.js';

export class TxtProcessor implements DocumentProcessor {
  mimeTypes = ['text/plain', 'text/csv'];

  async extract(buffer: Buffer, _filename: string): Promise<ExtractedDocument> {
    const text = buffer.toString('utf-8');

    return {
      text,
      metadata: {},
    };
  }
}

export const txtProcessor = new TxtProcessor();
