import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TxtProcessor } from '../../../src/modules/knowledge/processors/txt.processor.js';
import { getProcessor } from '../../../src/modules/knowledge/processors/index.js';

// Mock mammoth for DOCX tests
vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn(),
  },
}));

// Mock pdf-parse for PDF tests
const mockPdfDestroy = vi.fn();
const mockPdfGetText = vi.fn();
const mockPdfGetInfo = vi.fn();

class MockPDFParse {
  getText = mockPdfGetText;
  getInfo = mockPdfGetInfo;
  destroy = mockPdfDestroy;
}

vi.mock('pdf-parse', () => ({
  PDFParse: MockPDFParse,
}));

describe('Document Processors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('TxtProcessor', () => {
    const processor = new TxtProcessor();

    it('should have correct mime types', () => {
      expect(processor.mimeTypes).toContain('text/plain');
      // CSV has its own CsvProcessor, so TxtProcessor should not handle text/csv
    });

    it('should extract text from buffer', async () => {
      const content = 'Hello, World!';
      const buffer = Buffer.from(content, 'utf-8');

      const result = await processor.extract(buffer, 'test.txt');

      expect(result.text).toBe(content);
      expect(result.metadata).toEqual({});
    });

    it('should handle empty buffer', async () => {
      const buffer = Buffer.from('', 'utf-8');

      const result = await processor.extract(buffer, 'empty.txt');

      expect(result.text).toBe('');
    });

    it('should handle multi-line text', async () => {
      const content = 'Line 1\nLine 2\nLine 3';
      const buffer = Buffer.from(content, 'utf-8');

      const result = await processor.extract(buffer, 'multiline.txt');

      expect(result.text).toBe(content);
      expect(result.text).toContain('\n');
    });

    it('should handle unicode characters', async () => {
      const content = 'Hello, World!';
      const buffer = Buffer.from(content, 'utf-8');

      const result = await processor.extract(buffer, 'unicode.txt');

      expect(result.text).toBe(content);
    });

    it('should handle large text files', async () => {
      const content = 'x'.repeat(100000);
      const buffer = Buffer.from(content, 'utf-8');

      const result = await processor.extract(buffer, 'large.txt');

      expect(result.text).toHaveLength(100000);
    });

    it('should handle CSV content', async () => {
      const content = 'name,age,city\nAlice,30,NYC\nBob,25,LA';
      const buffer = Buffer.from(content, 'utf-8');

      const result = await processor.extract(buffer, 'data.csv');

      expect(result.text).toBe(content);
    });
  });

  describe('getProcessor', () => {
    it('should return processor for text/plain', () => {
      const processor = getProcessor('text/plain');

      expect(processor).not.toBeNull();
      expect(processor?.mimeTypes).toContain('text/plain');
    });

    it('should return processor for text/csv', () => {
      const processor = getProcessor('text/csv');

      expect(processor).not.toBeNull();
      expect(processor?.mimeTypes).toContain('text/csv');
    });

    it('should return processor for application/pdf', () => {
      const processor = getProcessor('application/pdf');

      expect(processor).not.toBeNull();
      expect(processor?.mimeTypes).toContain('application/pdf');
    });

    it('should return processor for DOCX', () => {
      const processor = getProcessor(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );

      expect(processor).not.toBeNull();
    });

    it('should return null for unsupported mime type', () => {
      const processor = getProcessor('image/png');

      expect(processor).toBeNull();
    });

    it('should return null for empty string', () => {
      const processor = getProcessor('');

      expect(processor).toBeNull();
    });

    it('should return null for invalid mime type', () => {
      const processor = getProcessor('not-a-mime-type');

      expect(processor).toBeNull();
    });
  });

  describe('DocxProcessor', () => {
    it('should extract text from DOCX buffer', async () => {
      const mammoth = await import('mammoth');
      vi.mocked(mammoth.default.extractRawText).mockResolvedValue({
        value: 'Document content here',
        messages: [],
      });

      const { DocxProcessor } =
        await import('../../../src/modules/knowledge/processors/docx.processor.js');
      const processor = new DocxProcessor();
      const buffer = Buffer.from('fake docx content');

      const result = await processor.extract(buffer, 'test.docx');

      expect(result.text).toBe('Document content here');
      expect(result.metadata).toEqual({});
      expect(mammoth.default.extractRawText).toHaveBeenCalledWith({ buffer });
    });

    it('should have correct mime type', async () => {
      const { DocxProcessor } =
        await import('../../../src/modules/knowledge/processors/docx.processor.js');
      const processor = new DocxProcessor();

      expect(processor.mimeTypes).toContain(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
    });
  });

  describe('PdfProcessor', () => {
    it('should extract text from PDF buffer', async () => {
      mockPdfGetText.mockResolvedValue({ text: 'PDF content here' });
      mockPdfGetInfo.mockResolvedValue({
        total: 5,
        info: { Title: 'Test PDF', Author: 'Test Author' },
      });

      const { PdfProcessor } =
        await import('../../../src/modules/knowledge/processors/pdf.processor.js');
      const processor = new PdfProcessor();
      const buffer = Buffer.from('%PDF-1.4\nfake pdf content');

      const result = await processor.extract(buffer, 'test.pdf');

      expect(result.text).toBe('PDF content here');
      expect(result.metadata).toEqual({
        pageCount: 5,
        title: 'Test PDF',
        author: 'Test Author',
      });
      expect(mockPdfDestroy).toHaveBeenCalled();
    });

    it('should have correct mime type', async () => {
      const { PdfProcessor } =
        await import('../../../src/modules/knowledge/processors/pdf.processor.js');
      const processor = new PdfProcessor();

      expect(processor.mimeTypes).toContain('application/pdf');
    });

    it('should handle PDF without metadata', async () => {
      mockPdfGetText.mockResolvedValue({ text: 'Content' });
      mockPdfGetInfo.mockResolvedValue({
        total: 1,
        info: null,
      });

      const { PdfProcessor } =
        await import('../../../src/modules/knowledge/processors/pdf.processor.js');
      const processor = new PdfProcessor();
      const buffer = Buffer.from('%PDF-1.4\nfake pdf');

      const result = await processor.extract(buffer, 'test.pdf');

      expect(result.metadata.pageCount).toBe(1);
      expect(result.metadata.title).toBeUndefined();
      expect(result.metadata.author).toBeUndefined();
    });
  });
});
