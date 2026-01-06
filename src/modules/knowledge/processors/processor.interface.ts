export interface ExtractedDocument {
  text: string;
  metadata: {
    pageCount?: number;
    title?: string;
    author?: string;
    description?: string;
    url?: string;
    // CSV-specific metadata
    rowCount?: number;
    columnCount?: number;
    columns?: string[];
    isFAQ?: boolean;
    warning?: string;
  };
}

export interface DocumentProcessor {
  mimeTypes: string[];
  extract(buffer: Buffer, filename: string): Promise<ExtractedDocument>;
}
