import type { DocumentProcessor, ExtractedDocument } from './processor.interface.js';
import { RetryableError, NonRetryableError } from '../../../jobs/jobs.types.js';
import { logger } from '../../../lib/logger.js';

export class PdfProcessor implements DocumentProcessor {
  mimeTypes = ['application/pdf'];

  async extract(buffer: Buffer, filename: string): Promise<ExtractedDocument> {
    // Validate PDF header
    if (!this.isValidPdf(buffer)) {
      throw new NonRetryableError(`Invalid PDF file: ${filename}`);
    }

    try {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      const textResult = await parser.getText();
      const infoResult = await parser.getInfo();
      await parser.destroy();

      // Validate extraction result
      if (!textResult.text || textResult.text.trim().length === 0) {
        logger.warn({ filename, numPages: infoResult.total }, 'PDF extracted with no text');
        // This might be a scanned PDF - could add OCR fallback here
        return {
          text: '',
          metadata: {
            pageCount: infoResult.total,
            title: infoResult.info?.Title,
            author: infoResult.info?.Author,
            warning: 'No text extracted - PDF may be scanned/image-based',
          },
        };
      }

      // Clean extracted text
      const cleanedText = this.cleanText(textResult.text);

      return {
        text: cleanedText,
        metadata: {
          pageCount: infoResult.total,
          title: infoResult.info?.Title,
          author: infoResult.info?.Author,
        },
      };
    } catch (error) {
      // Classify error
      const message = error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.constructor.name : '';

      if (message.includes('encrypted') || message.includes('password')) {
        throw new NonRetryableError(`PDF is password protected: ${filename}`);
      }

      if (
        message.includes('corrupt') ||
        message.includes('invalid') ||
        errorName === 'InvalidPDFException' ||
        message.includes('trailer') ||
        message.includes('startxref') ||
        message.includes('xref') ||
        message.includes('object')
      ) {
        throw new NonRetryableError(`PDF is corrupted: ${filename}`);
      }

      // Unknown error - might be transient
      throw new RetryableError(`PDF extraction failed: ${message}`, error as Error);
    }
  }

  private isValidPdf(buffer: Buffer): boolean {
    // Check PDF magic bytes
    return buffer.length > 4 && buffer.toString('ascii', 0, 5) === '%PDF-';
  }

  private cleanText(text: string): string {
    return (
      text
        // Remove excessive whitespace
        .replace(/\s+/g, ' ')
        // Remove null characters
        .replace(/\0/g, '')
        // Fix broken ligatures
        .replace(/ﬁ/g, 'fi')
        .replace(/ﬂ/g, 'fl')
        .replace(/ﬀ/g, 'ff')
        // Normalize quotes
        .replace(/[""]/g, '"')
        .replace(/['']/g, "'")
        // Remove page break markers
        .replace(/\f/g, '\n\n')
        .trim()
    );
  }
}

export const pdfProcessor = new PdfProcessor();
