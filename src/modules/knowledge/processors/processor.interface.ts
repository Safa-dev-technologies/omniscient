export interface ExtractedDocument {
  text: string;
  metadata: {
    pageCount?: number;
    title?: string;
    author?: string;
  };
}

export interface DocumentProcessor {
  mimeTypes: string[];
  extract(buffer: Buffer, filename: string): Promise<ExtractedDocument>;
}
