import { globalSetup, globalTeardown } from './setup.js';

// Vitest global setup/teardown
export async function setup() {
  await globalSetup();
}

export async function teardown() {
  await globalTeardown();
}
