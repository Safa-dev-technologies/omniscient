# Task 01: CSV/FAQ Processor

## Overview

Enhance the CSV processor to properly parse CSV files and add an FAQ-specific chunker that intelligently handles question-answer pairs.

## Current State

The existing `txt.processor.ts` treats CSV files as raw text without any parsing. This loses the structured nature of CSV data.

## Objectives

1. Create a proper CSV processor that parses structured data
2. Create an FAQ chunker that keeps Q&A pairs together
3. Support multiple CSV formats (with/without headers, different delimiters)

## Files to Create/Modify

### New Files

```
src/modules/knowledge/processors/csv.processor.ts
src/modules/knowledge/chunkers/faq.chunker.ts
tests/unit/knowledge/csv.processor.test.ts
tests/unit/knowledge/faq.chunker.test.ts
tests/fixtures/csv.fixtures.ts
```

### Modified Files

```
src/modules/knowledge/processors/index.ts          # Export new processor
src/modules/knowledge/chunkers/index.ts            # Export new chunker
src/modules/knowledge/knowledge.service.ts         # Use CSV processor
src/modules/knowledge/processors/txt.processor.ts  # Remove CSV handling
package.json                                       # Add csv-parser dependency
```

## Implementation Details

### 1. CSV Processor (`csv.processor.ts`)

```typescript
import type { DocumentProcessor, ExtractedDocument, ProcessorOptions } from './processor.interface.js';

interface CSVProcessorOptions extends ProcessorOptions {
  hasHeaders?: boolean;
  delimiter?: string;
  questionColumn?: string;  // For FAQ detection
  answerColumn?: string;
}

export class CSVProcessor implements DocumentProcessor {
  canProcess(mimeType: string): boolean {
    return mimeType === 'text/csv' || mimeType === 'application/csv';
  }

  async extract(buffer: Buffer, options?: CSVProcessorOptions): Promise<ExtractedDocument> {
    // 1. Detect delimiter (comma, semicolon, tab)
    // 2. Parse CSV with csv-parser or papaparse
    // 3. Auto-detect headers if not specified
    // 4. Detect FAQ format (question/answer columns)
    // 5. Return structured or plain text based on format
  }
}
```

**Features:**
- Auto-detect delimiter (`,`, `;`, `\t`)
- Auto-detect headers
- Detect FAQ format by column names (`question`, `answer`, `q`, `a`, etc.)
- Handle quoted fields with commas
- Handle multiline fields
- Return metadata about structure (columns, row count, is FAQ)

### 2. FAQ Chunker (`faq.chunker.ts`)

```typescript
import type { Chunker, ChunkResult, ChunkerOptions } from './chunker.interface.js';

interface FAQChunkerOptions extends ChunkerOptions {
  combineRelated?: boolean;  // Group related Q&As
  maxQAsPerChunk?: number;   // Max Q&A pairs per chunk
}

export class FAQChunker implements Chunker {
  async chunk(text: string, options?: FAQChunkerOptions): Promise<ChunkResult[]> {
    // 1. Parse Q&A pairs from structured text
    // 2. Keep each Q&A as atomic unit
    // 3. Optionally combine related Q&As
    // 4. Add metadata (question, answer separately)
  }
}
```

**Features:**
- Keep Q&A pairs atomic (never split mid-pair)
- Store question and answer separately in metadata
- Support combining related Q&As into larger chunks
- Detect Q&A patterns in plain text (Q: ... A: ...)

### 3. Update Knowledge Service

```typescript
// In knowledge.service.ts

// Add logic to select chunker based on content type
function selectChunker(source: KnowledgeSource, metadata: ExtractedDocument['metadata']): Chunker {
  if (source.type === 'CSV' && metadata?.isFAQ) {
    return new FAQChunker();
  }
  return new RecursiveChunker();
}
```

## CSV Format Support

### Standard CSV
```csv
name,email,department
John Doe,john@example.com,Sales
Jane Smith,jane@example.com,Support
```

### FAQ CSV (Auto-detected)
```csv
question,answer
How do I reset my password?,Go to Settings > Security > Reset Password
What are your business hours?,We're open Monday-Friday 9am-5pm
```

### Plain Q&A Text (FAQ Chunker)
```
Q: How do I reset my password?
A: Go to Settings > Security > Reset Password

Q: What are your business hours?
A: We're open Monday-Friday 9am-5pm
```

## Dependencies

Add to `package.json`:
```json
{
  "dependencies": {
    "csv-parser": "^3.0.0"
  }
}
```

Or use `papaparse` for browser compatibility:
```json
{
  "dependencies": {
    "papaparse": "^5.4.1"
  },
  "devDependencies": {
    "@types/papaparse": "^5.3.14"
  }
}
```

## Acceptance Criteria

- [ ] CSV files are properly parsed with structure preserved
- [ ] Delimiters are auto-detected (comma, semicolon, tab)
- [ ] Headers are auto-detected
- [ ] FAQ format is detected by column names
- [ ] FAQ chunker keeps Q&A pairs together
- [ ] Plain text Q&A patterns are recognized
- [ ] Metadata includes column names, row count, isFAQ flag
- [ ] Edge cases handled (quoted commas, multiline, empty cells)
- [ ] Unit tests cover all formats

## Test Cases

1. **Standard CSV with headers**
2. **CSV without headers**
3. **FAQ CSV format**
4. **Semicolon-delimited CSV**
5. **Tab-delimited CSV**
6. **CSV with quoted fields containing commas**
7. **CSV with multiline fields**
8. **Empty cells handling**
9. **Plain text Q&A parsing**
10. **Mixed content detection**

## Security Considerations

- [ ] Limit CSV file size (prevent memory exhaustion)
- [ ] Limit row/column count
- [ ] Sanitize cell content (no script injection)
- [ ] Handle malformed CSV gracefully

## Estimated Complexity

**Low** - Building on existing patterns, straightforward parsing logic.
