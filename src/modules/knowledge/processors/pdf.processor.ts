import type { DocumentProcessor, ExtractedDocument } from './processor.interface.js';

export class PdfProcessor implements DocumentProcessor {
  mimeTypes = ['application/pdf'];

  async extract(buffer: Buffer, _filename: string): Promise<ExtractedDocument> {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo();
    await parser.destroy();

    return {
      text: textResult.text,
      metadata: {
        pageCount: infoResult.total,
        title: infoResult.info?.Title,
        author: infoResult.info?.Author,
      },
    };
  }
}

export const pdfProcessor = new PdfProcessor();
