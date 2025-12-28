import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { generateApiKey } from '../src/utils/hash.js';

config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: ['error'],
});

async function main() {
  console.log('Seeding database...\n');

  // Create test tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'test-company' },
    update: {},
    create: {
      slug: 'test-company',
      name: 'Test Company',
      botName: 'TestBot',
      systemPrompt: 'You are a helpful assistant for Test Company. Be concise and friendly.',
      welcomeMessage: 'Hello! How can I help you today?',
      fallbackMessage: "I'm not sure about that. Would you like to speak with a human agent?",
      status: 'ACTIVE',
    },
  });

  console.log('Created tenant:', tenant.name);

  // Generate API key
  const { key, hash, prefix } = generateApiKey('test');

  // Check if API key already exists for this tenant
  const existingKey = await prisma.apiKey.findFirst({
    where: { tenantId: tenant.id },
  });

  if (existingKey) {
    console.log('\nAPI key already exists for this tenant.');
    console.log('Delete existing keys from database to generate a new one.');
  } else {
    await prisma.apiKey.create({
      data: {
        tenantId: tenant.id,
        name: 'Test API Key',
        keyHash: hash,
        keyPrefix: prefix,
        permissions: {
          chat: true,
          knowledge: true,
          admin: true, // First key gets admin permission
        },
      },
    });

    console.log('\n========================================');
    console.log('API KEY (save this - shown only once):');
    console.log('========================================');
    console.log(key);
    console.log('========================================\n');
  }

  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
