import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { logger } from '../lib/logger.js';

/**
 * Secrets that can be loaded from AWS Secrets Manager
 * These will override corresponding environment variables
 */
interface SecretOverrides {
  OPENAI_API_KEY?: string;
  GROQ_API_KEY?: string;
  PINECONE_API_KEY?: string;
  MASTER_API_KEY?: string;
  ADMIN_PASSWORD_HASH?: string;
  ENCRYPTION_KEY?: string;
  DATABASE_URL?: string;
  REDIS_URL?: string;
  SENTRY_DSN?: string;
}

const SECRET_KEYS: (keyof SecretOverrides)[] = [
  'OPENAI_API_KEY',
  'GROQ_API_KEY',
  'PINECONE_API_KEY',
  'MASTER_API_KEY',
  'ADMIN_PASSWORD_HASH',
  'ENCRYPTION_KEY',
  'DATABASE_URL',
  'REDIS_URL',
  'SENTRY_DSN',
];

/**
 * Load secrets from AWS Secrets Manager and inject into process.env
 *
 * This function should be called BEFORE env validation runs.
 * If AWS_SECRETS_ARN is not set, this is a no-op.
 * If AWS_SECRETS_ARN is set but fetch fails, the application will fail to start.
 *
 * @throws Error if AWS_SECRETS_ARN is configured but secrets cannot be loaded
 */
export async function loadSecretsFromAWS(): Promise<void> {
  const secretArn = process.env.AWS_SECRETS_ARN;
  const region = process.env.AWS_REGION || 'us-east-1';

  if (!secretArn) {
    logger.info('AWS_SECRETS_ARN not set, using environment variables directly');
    return;
  }

  logger.info(
    { secretArn: secretArn.substring(0, 40) + '...', region },
    'Loading secrets from AWS Secrets Manager'
  );

  try {
    const client = new SecretsManagerClient({ region });
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));

    if (!response.SecretString) {
      throw new Error('Secret value is empty or binary (expected JSON string)');
    }

    let secrets: SecretOverrides;
    try {
      secrets = JSON.parse(response.SecretString);
    } catch {
      throw new Error('Secret value is not valid JSON');
    }

    // Override environment variables with secrets
    let loadedCount = 0;
    for (const key of SECRET_KEYS) {
      const value = secrets[key];
      if (value !== undefined && value !== null && value !== '') {
        process.env[key] = value;
        loadedCount++;
      }
    }

    logger.info(
      { loadedCount, totalKeys: SECRET_KEYS.length },
      'Secrets loaded from AWS Secrets Manager'
    );
  } catch (error) {
    // Log the error with context but don't expose secret ARN details
    logger.error(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        region,
      },
      'Failed to load secrets from AWS Secrets Manager'
    );

    // Fail fast - if AWS secrets are configured, we must be able to load them
    throw new Error(
      'Failed to load secrets from AWS Secrets Manager - cannot start application. ' +
        'Check AWS credentials, region, and secret ARN configuration.'
    );
  }
}
