import type { DocumentProcessor, ExtractedDocument } from './processor.interface.js';
import { logger } from '../../../lib/logger.js';

interface ExtractedCSV extends ExtractedDocument {
  metadata: {
    rowCount: number;
    columnCount: number;
    columns: string[];
    isFAQ: boolean; // True if Q&A columns detected
  };
}

export class CsvProcessor implements DocumentProcessor {
  mimeTypes = ['text/csv', 'application/csv'];

  async extract(buffer: Buffer, _filename: string): Promise<ExtractedDocument> {
    const content = buffer.toString('utf-8');

    // Handle empty CSV
    if (!content.trim()) {
      return {
        text: '',
        metadata: {
          rowCount: 0,
          columnCount: 0,
          columns: [],
          isFAQ: false,
        },
      };
    }

    // Step 1: Detect delimiter (comma, semicolon, tab)
    const delimiter = this.detectDelimiter(content);

    // Step 2: Parse CSV
    const rows = this.parseCSV(content, delimiter);

    if (rows.length === 0) {
      return {
        text: '',
        metadata: {
          rowCount: 0,
          columnCount: 0,
          columns: [],
          isFAQ: false,
        },
      };
    }

    // Step 3: Detect if FAQ format
    const headers = rows[0];
    const faqColumns = this.detectFAQColumns(headers);

    // Step 4: Format output
    if (faqColumns) {
      return this.formatAsFAQ(rows, faqColumns);
    }

    return this.formatAsTable(rows);
  }

  private detectDelimiter(content: string): string {
    // Count occurrences of each delimiter in first 5 lines
    const sample = content.split('\n').slice(0, 5).join('\n');
    const counts = {
      ',': (sample.match(/,/g) || []).length,
      ';': (sample.match(/;/g) || []).length,
      '\t': (sample.match(/\t/g) || []).length,
    };

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0][1] > 0 ? sorted[0][0] : ',';
  }

  private parseCSV(content: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    const lines = content.split('\n');
    let currentRow: string[] = [];
    let inQuotes = false;
    let currentField = '';

    for (const line of lines) {
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            // Escaped quote
            currentField += '"';
            i++; // Skip next quote
          } else {
            // Toggle quote state
            inQuotes = !inQuotes;
          }
        } else if (char === delimiter && !inQuotes) {
          // End of field
          currentRow.push(currentField.trim());
          currentField = '';
        } else {
          currentField += char;
        }
      }

      // End of line
      if (!inQuotes) {
        currentRow.push(currentField.trim());
        currentField = '';
        if (currentRow.some((field) => field.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
      } else {
        // Line continues in quoted field
        currentField += '\n';
      }
    }

    // Handle last field if file doesn't end with newline
    if (currentField.trim() || currentRow.length > 0) {
      currentRow.push(currentField.trim());
      if (currentRow.some((field) => field.length > 0)) {
        rows.push(currentRow);
      }
    }

    return rows;
  }

  private detectFAQColumns(headers: string[]): { q: number; a: number } | null {
    const qPatterns = ['question', 'q', 'query', 'ask', 'faq'];
    const aPatterns = ['answer', 'a', 'response', 'reply'];

    const qIndex = headers.findIndex((h) => qPatterns.some((p) => h.toLowerCase().includes(p)));
    const aIndex = headers.findIndex((h) => aPatterns.some((p) => h.toLowerCase().includes(p)));

    if (qIndex !== -1 && aIndex !== -1) {
      return { q: qIndex, a: aIndex };
    }
    return null;
  }

  private formatAsFAQ(rows: string[][], faqColumns: { q: number; a: number }): ExtractedCSV {
    const headers = rows[0];
    const dataRows = rows.slice(1);
    const formattedText: string[] = [];

    for (const row of dataRows) {
      // Skip rows with missing columns
      if (row.length <= Math.max(faqColumns.q, faqColumns.a)) {
        logger.warn({ row }, 'Skipping row with missing FAQ columns');
        continue;
      }

      const question = row[faqColumns.q] || '';
      const answer = row[faqColumns.a] || '';

      // Skip empty Q&A pairs
      if (!question.trim() && !answer.trim()) {
        continue;
      }

      formattedText.push(`Q: ${question}`);
      formattedText.push(`A: ${answer}`);
      formattedText.push(''); // Blank line between pairs
    }

    return {
      text: formattedText.join('\n'),
      metadata: {
        rowCount: dataRows.length,
        columnCount: headers.length,
        columns: headers,
        isFAQ: true,
      },
    };
  }

  private formatAsTable(rows: string[][]): ExtractedCSV {
    if (rows.length === 0) {
      return {
        text: '',
        metadata: {
          rowCount: 0,
          columnCount: 0,
          columns: [],
          isFAQ: false,
        },
      };
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);
    const formattedText: string[] = [];

    // Format as markdown-style table
    formattedText.push(headers.join(' | '));
    formattedText.push(headers.map(() => '---').join(' | '));

    for (const row of dataRows) {
      // Pad row to match header length
      const paddedRow = [...row];
      while (paddedRow.length < headers.length) {
        paddedRow.push('');
      }
      formattedText.push(paddedRow.slice(0, headers.length).join(' | '));
    }

    return {
      text: formattedText.join('\n'),
      metadata: {
        rowCount: dataRows.length,
        columnCount: headers.length,
        columns: headers,
        isFAQ: false,
      },
    };
  }
}

export const csvProcessor = new CsvProcessor();
