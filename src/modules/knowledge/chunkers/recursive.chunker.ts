import { CONSTANTS } from '../../../config/index.js';
import { estimateTokens } from '../../../utils/token-counter.js';
import type { Chunk, Chunker, ChunkerConfig } from './chunker.interface.js';

const DEFAULT_CONFIG: ChunkerConfig = {
  chunkSize: CONSTANTS.CHUNK_SIZE,
  chunkOverlap: CONSTANTS.CHUNK_OVERLAP,
  minChunkSize: CONSTANTS.MIN_CHUNK_SIZE,
};

const SEPARATORS = ['\n\n', '\n', '. ', ' '];

export class RecursiveChunker implements Chunker {
  chunk(text: string, config?: Partial<ChunkerConfig>): Chunk[] {
    const { chunkSize, chunkOverlap, minChunkSize } = { ...DEFAULT_CONFIG, ...config };

    const chunks: Chunk[] = [];
    const textChunks = this.splitText(text, chunkSize, chunkOverlap, SEPARATORS);

    for (let i = 0; i < textChunks.length; i++) {
      const chunkText = textChunks[i].trim();

      if (chunkText.length < minChunkSize) {
        continue;
      }

      chunks.push({
        text: chunkText,
        index: chunks.length,
        tokenCount: estimateTokens(chunkText),
        metadata: {},
      });
    }

    return chunks;
  }

  private splitText(
    text: string,
    chunkSize: number,
    chunkOverlap: number,
    separators: string[]
  ): string[] {
    const chunks: string[] = [];
    const separator = this.findBestSeparator(text, separators);

    if (!separator) {
      // No separator works, split by character count
      return this.splitBySize(text, chunkSize, chunkOverlap);
    }

    const parts = text.split(separator);
    let currentChunk = '';

    for (const part of parts) {
      const testChunk = currentChunk + (currentChunk ? separator : '') + part;

      if (testChunk.length <= chunkSize) {
        currentChunk = testChunk;
      } else {
        if (currentChunk) {
          chunks.push(currentChunk);
        }

        if (part.length > chunkSize) {
          // Part is too large, recurse with next separator
          const subChunks = this.splitText(
            part,
            chunkSize,
            chunkOverlap,
            separators.slice(separators.indexOf(separator) + 1)
          );
          chunks.push(...subChunks);
          currentChunk = '';
        } else {
          // Start new chunk with overlap
          const overlapText = this.getOverlap(currentChunk, chunkOverlap);
          currentChunk = overlapText + part;
        }
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  private findBestSeparator(text: string, separators: string[]): string | null {
    for (const sep of separators) {
      if (text.includes(sep)) {
        return sep;
      }
    }
    return null;
  }

  private splitBySize(text: string, chunkSize: number, overlap: number): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      chunks.push(text.slice(start, end));
      start = end - overlap;

      if (start >= text.length - overlap) {
        break;
      }
    }

    return chunks;
  }

  private getOverlap(text: string, overlapSize: number): string {
    if (text.length <= overlapSize) {
      return text;
    }
    return text.slice(-overlapSize);
  }
}

export const recursiveChunker = new RecursiveChunker();
