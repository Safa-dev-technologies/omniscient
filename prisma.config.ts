import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { config } from 'dotenv';

// Load environment variables
config();

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),

  datasource: {
    url: process.env.DATABASE_URL!,
  },

  migrate: {
    url: process.env.DATABASE_URL!,
  },

  studio: {
    url: process.env.DATABASE_URL!,
  },
});
