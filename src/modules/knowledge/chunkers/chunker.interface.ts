export interface Chunk {
  text: string;
  index: number;
  tokenCount: number;
  metadata: {
    pageNumber?: number;
    sectionTitle?: string;
  };
}

export interface ChunkerConfig {
  chunkSize: number;
  chunkOverlap: number;
  minChunkSize: number;
}

export interface Chunker {
  chunk(text: string, config?: Partial<ChunkerConfig>): Chunk[];
}
