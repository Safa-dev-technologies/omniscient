import { recursiveChunker } from './recursive.chunker.js';

export * from './chunker.interface.js';
export { recursiveChunker };

export function getChunker() {
  return recursiveChunker;
}
