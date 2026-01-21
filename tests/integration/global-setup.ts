import { globalSetup, globalTeardown } from './setup.js';
import type { Worker } from 'bullmq';

// Store worker references for cleanup
let documentWorker: Worker | null = null;
let embeddingWorker: Worker | null = null;
let crawlWorker: Worker | null = null;

// Vitest global setup/teardown
export async function setup() {
  console.log('🚀 Running global setup...');
  try {
    await globalSetup();

    // Start workers for integration tests
    console.log('🔧 Starting workers...');
    const [docModule, embModule, crawlModule] = await Promise.all([
      import('../../src/jobs/workers/document.worker.js'),
      import('../../src/jobs/workers/embedding.worker.js'),
      import('../../src/jobs/workers/crawl.worker.js'),
    ]);
    documentWorker = docModule.documentWorker;
    embeddingWorker = embModule.embeddingWorker;
    crawlWorker = crawlModule.worker;
    console.log('✅ Workers started');

    console.log('✅ Global setup complete');
  } catch (error) {
    console.error('❌ Global setup failed:', error);
    throw error;
  }
}

export async function teardown() {
  console.log('🧹 Running global teardown...');
  try {
    // Close workers first to prevent hanging
    console.log('🔧 Closing workers...');
    await Promise.all([
      documentWorker?.close().catch(() => {}),
      embeddingWorker?.close().catch(() => {}),
      crawlWorker?.close().catch(() => {}),
    ]);
    console.log('✅ Workers closed');

    await globalTeardown();
    console.log('✅ Global teardown complete');
  } catch (error) {
    console.error('⚠️  Global teardown failed:', error);
    // Don't throw - allow tests to complete even if teardown fails
  }
}
